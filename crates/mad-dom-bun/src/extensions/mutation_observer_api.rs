//! Native `MutationObserver` binding (T41).
//!
//! # Role
//!
//! This module is the M7 native extension that exposes the Core T41 observer
//! contract (crates/mad-dom-core/src/dom/mutation_observer.rs) to JavaScript:
//! the `MutationObserverHandle` class (`observe` / `disconnect` /
//! `takeRecords`), the opaque `MutationRecordHandle` behind each record, the
//! module-level `createMutationObserver` factory and `deliverObserverRecords`
//! entry, and the delivery-scheduler seam. Like the M5/M6/M7 extensions before
//! it, it adds *new* native symbols through `#[napi]` classes and module
//! functions; it touches no shared wiring file beyond the module declaration.
//!
//! # Core owns the records; this module owns the callback and the microtask
//!
//! Core stores the observer registrations and the record queues (per
//! (observer, target) listener, mirroring the happy-dom baseline's batching
//! granularity). This module owns the two things Core cannot:
//!
//! * the **callback identity** — one `FunctionRef` per observer, keyed by the
//!   globally-unique observer id the binding mints (`NEXT_OBSERVER_ID`), plus
//!   a strong reference to the native observer handle so the callback's second
//!   argument is the very object the caller constructed;
//! * the **microtask delivery** — after every mutating native entry, the
//!   binding calls [`schedule_pending_observer_deliveries`], which drains
//!   [`Document::pending_observer_deliveries`](mad_dom_core::dom::Document::pending_observer_deliveries)
//!   and hands each newly-pending (observer id, observation key) pair to the
//!   facade-registered scheduler (`registerObserverScheduler`). The scheduler
//!   runs a `queueMicrotask`; the microtask calls `deliverObserverRecords`,
//!   which drains that listener's queue (records accumulated in the same task
//!   are delivered in one callback), converts the records into
//!   [`MutationRecordHandle`]s and invokes the callback with `(records,
//!   observer)` — all *outside* the document lock, so a callback may freely
//!   mutate the tree or re-enter the API.
//!
//! # Frozen native contract (consumed by the T41 facade)
//!
//! | WHATWG name (facade) | native entry | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `new MutationObserver(callback)` | `createMutationObserver` | `(callback) → MutationObserverHandle` | mints the observer id and stores the callback |
//! | `observer.observe(target, init)` | `observe` | `(target, childList, attributes, characterData, subtree, attributeOldValue, characterDataOldValue, attributeFilter) → ()` | registers (or replaces) the observation in Core; the facade owns the WebIDL option validation |
//! | `observer.disconnect()` | `disconnect` | `() → ()` | drops every observation of this observer |
//! | `observer.takeRecords()` | `takeRecords` | `() → MutationRecordHandle[]` | drains every queue of this observer |
//! | `record.*` reads | on `MutationRecordHandle` | `type / target / addedNodes / removedNodes / previousSibling / nextSibling / attributeName / attributeNamespace / oldValue` | the WHATWG record surface; node reads mint wrappers through the T20 weak cache |
//! | scheduler | `registerObserverScheduler` | `(scheduler) → ()` | stores the facade `queueMicrotask` scheduler |
//! | delivery | `deliverObserverRecords` | `(observerId, observationKey) → ()` | drains one listener and invokes its callback |
//!
//! The facade owns the WebIDL conversions and option validation (the
//! happy-dom `observe` checks: auto-setting `attributes` when
//! `attributeFilter` / `attributeOldValue` is present, auto-setting
//! `characterData` when `characterDataOldValue` is present, and throwing when
//! no mutation type is enabled); this module receives resolved booleans and
//! the lowercased filter and forwards them verbatim.
//!
//! # Callback exceptions
//!
//! A throwing callback propagates as an uncaught microtask error (the happy-dom
//! baseline behavior — `MutationObserverListener` does not swallow). Each
//! (observer, target) listener is delivered by its own microtask, so a throw
//! in one delivery never cancels another listener's microtask or corrupts the
//! registry: the queue was already drained before the callback ran, and a
//! later mutation schedules a fresh delivery.
//!
//! # Lifecycle
//!
//! The observer handle holds a strong `Arc` to its document (adopted on the
//! first `observe`, so a live observer keeps its document's arena alive — the
//! T20 ownership chain). Dropping the handle (JS collection finalizer)
//! disconnects the observer in Core and releases the callback reference, so a
//! collected observer cannot leak records or callbacks. The registry holds a
//! `Weak` document link and a `WeakReference` to the handle, and stale entries
//! are pruned when a delivery observes either weak as dead.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard before touching Core state, matching the crate safety model. The
//! document lock is never held across a JS call: records are drained with the
//! lock released, and the callback runs after the drain. No `unsafe` is
//! written here except the single well-contained callback cast (the `Function`
//! phantom type is erased at runtime), exactly as in `events_api.rs`.
//!
//! # Ownership
//!
//! Owned by **T41**; like T37 there is no separate integration gate, so T41
//! also wires the facade, the shared entry/type/ledger surfaces and the seam
//! metadata itself. `tests/bun/mutation-observer.test.js` and the
//! `hc-diff-mutation-observer` differential scenario carry the end-to-end
//! evidence.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use napi::bindgen_prelude::{
    FnArgs, Function, FunctionRef, JavaScriptClassExt, Reference, Unknown, WeakReference,
};
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{MutationRecord, ObserverOptions, RecordType};

use crate::error::BindingError;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, NodeHandle, SharedDocument};

/// Seam metadata for the M7 `mutation_observer_api` boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "mutation_observer_api",
    owner: "T41",
    gate: "T41",
    status: "implemented",
};

/// The frozen native `MutationObserver` surface on [`MutationObserverHandle`].
#[allow(dead_code)]
pub(crate) const OBSERVER_CONTRACT: &[&str] = &["observe", "disconnect", "takeRecords"];

/// The frozen native `MutationRecord` surface on [`MutationRecordHandle`].
#[allow(dead_code)]
pub(crate) const MUTATION_RECORD_CONTRACT: &[&str] = &[
    "type",
    "target",
    "addedNodes",
    "removedNodes",
    "previousSibling",
    "nextSibling",
    "attributeName",
    "attributeNamespace",
    "oldValue",
];

/// Global counter minting document-unique observer ids (the binding owns the
/// id; Core stores it in the per-document registry).
static NEXT_OBSERVER_ID: AtomicU64 = AtomicU64::new(1);

/// The JS observer callback argument shape: `(records, observer)`.
type ObserverCallbackArgs = FnArgs<(
    Vec<Reference<MutationRecordHandle>>,
    Reference<MutationObserverHandle>,
)>;

/// The stored observer callback reference.
type ObserverCallbackRef = FunctionRef<ObserverCallbackArgs, ()>;

/// The facade-registered delivery scheduler: `(observerId, observationKey)`.
type SchedulerRef = FunctionRef<FnArgs<(u32, u32)>, ()>;

/// Set once the first observer exists anywhere in the process. The delivery
/// flush helper checks it first so mutations in processes that never create an
/// observer skip the document-lock/scan entirely.
static OBSERVERS_EXIST: AtomicBool = AtomicBool::new(false);

// --- callback registry -------------------------------------------------------
//
// Per-observer binding state: the JS callback (FunctionRef), the document link
// (Weak, adopted on first observe) and a WeakReference to the native observer
// handle (so the callback's second argument is the caller's own object). Keyed
// by the globally-unique observer id. Entries are released by the handle's
// `Drop` or pruned when a delivery observes a dead document / handle.

struct ObserverCallback {
    shared: Option<Weak<SharedDocument>>,
    #[allow(dead_code)] // only invoked from the napi-callback delivery path
    callback: ObserverCallbackRef,
    #[allow(dead_code)] // only upgraded from the napi-callback delivery path
    observer: WeakReference<MutationObserverHandle>,
}

thread_local! {
    static OBSERVERS: RefCell<Option<HashMap<u64, ObserverCallback>>> = const { RefCell::new(None) };
    static SCHEDULER: RefCell<Option<SchedulerRef>> = const { RefCell::new(None) };
}

/// Borrows the observer registry mutably, initializing it on first use.
fn with_observers_mut<T>(f: impl FnOnce(&mut HashMap<u64, ObserverCallback>) -> T) -> T {
    OBSERVERS.with(|cell| {
        let mut slot = cell.borrow_mut();
        f(slot.get_or_insert_with(HashMap::new))
    })
}

/// Releases one observer's registry entry (callback reference and handle weak).
fn prune_observer(observer_id: u64) {
    let _ = with_observers_mut(|guard| guard.remove(&observer_id));
}

// --- scheduler seam ----------------------------------------------------------

/// Stores the facade-registered delivery scheduler (a `queueMicrotask`
/// wrapper). Registered once at facade initialization; the flush helper no-ops
/// until then, leaving records pending.
#[napi(catch_unwind)]
#[allow(dead_code)] // registered as a native module export by napi-derive's load-time ctor
pub fn register_observer_scheduler(scheduler: Unknown<'_>) -> napi::Result<()> {
    let function: Function<'static, FnArgs<(u32, u32)>, ()> = unsafe { scheduler.cast() }?;
    let reference = function.create_ref()?;
    SCHEDULER.with(|cell| {
        *cell.borrow_mut() = Some(reference);
    });
    Ok(())
}

/// Schedules one delivery microtask per newly-pending (observer, observation)
/// listener of `shared`'s document.
///
/// Called by the binding after every mutating native entry. Records queued by
/// a mutation are left in Core; the microtask drains them at the end of the
/// current task, so further mutations in the same task batch into the same
/// callback. Cheap when no observer exists anywhere (a single atomic read).
pub(crate) fn schedule_pending_observer_deliveries(env: &Env, shared: &Arc<SharedDocument>) {
    let _ = schedule_pending_observer_deliveries_inner(env, shared, false);
}

/// Scheduler variant for token hot writes whose facade-local epoch store
/// normally happens after the native call returns. If a pending scheduler can
/// re-enter JavaScript synchronously, publish those views before invoking it.
pub(crate) fn schedule_pending_observer_deliveries_after_local_epoch(
    env: &Env,
    shared: &Arc<SharedDocument>,
) -> bool {
    schedule_pending_observer_deliveries_inner(env, shared, true)
}

fn schedule_pending_observer_deliveries_inner(
    env: &Env,
    shared: &Arc<SharedDocument>,
    publish_local_epoch: bool,
) -> bool {
    if !OBSERVERS_EXIST.load(Ordering::SeqCst) {
        return false;
    }
    let scheduler = match SCHEDULER.with(|cell| cell.borrow().as_ref().map(|f| f.borrow_back(env)))
    {
        Some(Ok(scheduler)) => scheduler,
        _ => return false, // scheduler not registered: leave records pending
    };
    let pending = match with_document(shared, |doc| Ok(doc.pending_observer_deliveries())) {
        Ok(pending) => pending,
        Err(_) => return false,
    };
    let may_reenter = !pending.is_empty();
    if publish_local_epoch && may_reenter {
        shared.publish_local_epochs();
    }
    for (observer_id, observation_key) in pending {
        let _ = scheduler.call(FnArgs::from((observer_id as u32, observation_key as u32)));
    }
    may_reenter
}

// --- MutationObserverHandle --------------------------------------------------

/// JavaScript-facing wrapper for one `MutationObserver`.
///
/// Carries the observer id (the registry key) and the document link adopted on
/// the first `observe` (a strong `Arc`, so a live observer keeps its
/// document's arena alive — the T20 ownership chain).
#[napi]
pub struct MutationObserverHandle {
    shared: Mutex<Option<Arc<SharedDocument>>>,
    observer_id: u64,
}

impl Drop for MutationObserverHandle {
    /// Disconnects the observer in Core and releases its callback reference.
    ///
    /// Runs when the JS observer object is collected; without it a collected
    /// observer would keep generating records in Core forever (a leak). A
    /// destroyed document is skipped (its records are gone with it).
    fn drop(&mut self) {
        let shared = self
            .shared
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(shared) = shared {
            let _ = with_document(&shared, |doc| {
                doc.disconnect_observer(self.observer_id);
                Ok(())
            });
        }
        prune_observer(self.observer_id);
    }
}

impl MutationObserverHandle {
    /// Locks the handle's document link, recovering a poisoned lock.
    fn lock_shared(&self) -> MutexGuard<'_, Option<Arc<SharedDocument>>> {
        self.shared
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Adopts `target`'s document as this observer's document on the first
    /// `observe`, and returns the bound document. Subsequent observations use
    /// the already-bound document (Core rejects a foreign target).
    fn bind_shared(&self, target: &Arc<SharedDocument>) -> Arc<SharedDocument> {
        let mut slot = self.lock_shared();
        if slot.is_none() {
            *slot = Some(Arc::clone(target));
        }
        slot.clone().expect("the document link was just adopted")
    }
}

/// Creates a `MutationObserver` and returns its opaque handle.
///
/// The callback is wrapped by the facade before it crosses the boundary (the
/// facade converts the raw record/observer handles through `ctx.wrap`), so
/// this entry stores the wrapper verbatim. The observer is bound to a document
/// only on the first `observe`.
#[napi(catch_unwind)]
#[allow(dead_code)] // registered as a native module export by napi-derive's load-time ctor
pub fn create_mutation_observer(
    env: Env,
    callback: Unknown<'_>,
) -> napi::Result<Reference<MutationObserverHandle>> {
    OBSERVERS_EXIST.store(true, Ordering::SeqCst);
    let observer_id = NEXT_OBSERVER_ID.fetch_add(1, Ordering::Relaxed);
    let function: Function<'static, ObserverCallbackArgs, ()> = unsafe { callback.cast() }?;
    let reference = function.create_ref()?;
    let handle = MutationObserverHandle {
        shared: Mutex::new(None),
        observer_id,
    }
    .into_reference(env)?;
    with_observers_mut(|guard| {
        guard.insert(
            observer_id,
            ObserverCallback {
                shared: None,
                callback: reference,
                observer: handle.downgrade(),
            },
        );
    });
    Ok(handle)
}

#[napi]
impl MutationObserverHandle {
    /// Registers (or replaces) an observation of `target` with the given
    /// resolved options.
    ///
    /// The first `observe` binds this observer to `target`'s document; every
    /// later target must belong to the same document (Core rejects a foreign
    /// one with `ERR_MAD_DOM_WRONG_DOCUMENT`).
    #[napi(catch_unwind)]
    #[allow(clippy::too_many_arguments)]
    pub fn observe(
        &self,
        env: Env,
        target: &NodeHandle,
        child_list: bool,
        attributes: bool,
        character_data: bool,
        subtree: bool,
        attribute_old_value: bool,
        character_data_old_value: bool,
        attribute_filter: Option<Vec<String>>,
    ) -> napi::Result<()> {
        check_affinity(target.shared(), &env)?;
        // A bound live handle owns a strong document Arc until Drop, which
        // also removes its callback entry. Scanning every observer for dead
        // document links here cannot release a live handle's entry and makes
        // registering N observers quadratic. Drop and delivery prune entries
        // directly by observer id instead.
        let shared = self.bind_shared(target.shared());
        with_document(&shared, |doc| {
            doc.observe(
                self.observer_id,
                target.id(),
                ObserverOptions {
                    child_list,
                    attributes,
                    character_data,
                    subtree,
                    attribute_old_value,
                    character_data_old_value,
                    attribute_filter,
                },
            )
            .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        with_observers_mut(|guard| {
            if let Some(entry) = guard.get_mut(&self.observer_id) {
                entry.shared = Some(Arc::downgrade(&shared));
            }
        });
        Ok(())
    }

    /// Drops every observation of this observer; the observer itself stays
    /// usable (it may `observe()` again).
    #[napi(catch_unwind)]
    pub fn disconnect(&self, env: Env) -> napi::Result<()> {
        let shared = self.lock_shared().clone();
        let Some(shared) = shared else {
            return Ok(());
        };
        check_affinity(&shared, &env)?;
        with_document(&shared, |doc| {
            doc.disconnect_observer(self.observer_id);
            Ok(())
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Returns and clears every queued record of this observer (the WHATWG
    /// `takeRecords()`), without notifying the callback.
    #[napi(catch_unwind)]
    pub fn take_records(&self, env: Env) -> napi::Result<Vec<Reference<MutationRecordHandle>>> {
        let shared = self.lock_shared().clone();
        let Some(shared) = shared else {
            return Ok(Vec::new());
        };
        check_affinity(&shared, &env)?;
        let records = with_document(&shared, |doc| {
            Ok(doc.take_observer_all_records(self.observer_id))
        })
        .map_err(|err| err.into_napi(&env))?;
        records
            .into_iter()
            .map(|record| record_handle(&env, &shared, record))
            .collect()
    }
}

// --- MutationRecordHandle ----------------------------------------------------

/// JavaScript-facing wrapper for one `MutationRecord`.
///
/// Carries the owning document link (to mint node wrappers for `target` and
/// the added/removed/sibling reads) plus the record payload. Node ids stay
/// opaque: every node read funnels through the T20 weak cache.
#[napi]
pub struct MutationRecordHandle {
    document: Arc<SharedDocument>,
    record_type: String,
    target: NodeId,
    added_nodes: Vec<NodeId>,
    removed_nodes: Vec<NodeId>,
    previous_sibling: Option<NodeId>,
    next_sibling: Option<NodeId>,
    attribute_name: Option<String>,
    attribute_namespace: Option<String>,
    old_value: Option<String>,
}

/// Converts a drained Core [`MutationRecord`] into an opaque JS handle.
fn record_handle(
    env: &Env,
    shared: &Arc<SharedDocument>,
    record: MutationRecord,
) -> napi::Result<Reference<MutationRecordHandle>> {
    MutationRecordHandle {
        document: Arc::clone(shared),
        record_type: match record.record_type {
            RecordType::ChildList => "childList",
            RecordType::Attributes => "attributes",
            RecordType::CharacterData => "characterData",
        }
        .to_string(),
        target: record.target,
        added_nodes: record.added_nodes,
        removed_nodes: record.removed_nodes,
        previous_sibling: record.previous_sibling,
        next_sibling: record.next_sibling,
        attribute_name: record.attribute_name,
        attribute_namespace: record.attribute_namespace,
        old_value: record.old_value,
    }
    .into_reference(*env)
}

#[napi]
impl MutationRecordHandle {
    /// The record's `type` (`childList` / `attributes` / `characterData`).
    #[napi(catch_unwind)]
    pub fn record_type(&self) -> String {
        self.record_type.clone()
    }

    /// The node whose children / attributes / data changed.
    #[napi(catch_unwind)]
    pub fn target(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        self.document.wrap_node(env, self.target)
    }

    /// The added nodes (childList records).
    #[napi(catch_unwind)]
    pub fn added_nodes(&self, env: Env) -> napi::Result<Vec<Reference<NodeHandle>>> {
        self.added_nodes
            .iter()
            .map(|id| self.document.wrap_node(env, *id))
            .collect()
    }

    /// The removed nodes (childList records).
    #[napi(catch_unwind)]
    pub fn removed_nodes(&self, env: Env) -> napi::Result<Vec<Reference<NodeHandle>>> {
        self.removed_nodes
            .iter()
            .map(|id| self.document.wrap_node(env, *id))
            .collect()
    }

    /// The removed node's previous sibling (childList removal records), or
    /// `null`.
    #[napi(catch_unwind)]
    pub fn previous_sibling(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        match self.previous_sibling {
            None => Ok(None),
            Some(id) => self.document.wrap_node(env, id).map(Some),
        }
    }

    /// The removed node's next sibling (childList removal records), or `null`.
    #[napi(catch_unwind)]
    pub fn next_sibling(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        match self.next_sibling {
            None => Ok(None),
            Some(id) => self.document.wrap_node(env, id).map(Some),
        }
    }

    /// The changed attribute's name (attributes records), or `null`.
    #[napi(catch_unwind)]
    pub fn attribute_name(&self) -> Option<String> {
        self.attribute_name.clone()
    }

    /// The changed attribute's namespace (always `null` in this no-namespace
    /// milestone).
    #[napi(catch_unwind)]
    pub fn attribute_namespace(&self) -> Option<String> {
        self.attribute_namespace.clone()
    }

    /// The old value (attributes / characterData records), or `null`.
    #[napi(catch_unwind)]
    pub fn old_value(&self) -> Option<String> {
        self.old_value.clone()
    }
}

// --- delivery -----------------------------------------------------------------

/// Delivers the accumulated records of one (observer, observation) listener.
///
/// Runs inside the facade-scheduled microtask. Drains the listener's queue
/// (with the document lock released), converts the records to opaque handles
/// and invokes the callback with `(records, observer)`. Skips the callback
/// when the queue is empty (e.g. `takeRecords` drained it) or the observation
/// no longer exists (`disconnect`), and prunes the registry entry when the
/// document or the observer handle is gone.
#[napi(catch_unwind)]
#[allow(dead_code)] // invoked from JS by the facade-registered delivery microtask
pub fn deliver_observer_records(
    env: Env,
    observer_id: u32,
    observation_key: u32,
) -> napi::Result<()> {
    let observer_id = observer_id as u64;
    let observation_key = observation_key as u64;
    let entry = with_observers_mut(|guard| {
        guard.get(&observer_id).map(|entry| {
            let callback = entry.callback.borrow_back(&env);
            let observer = entry.observer.upgrade(env);
            let shared = entry.shared.as_ref().and_then(|weak| weak.upgrade());
            (callback, observer, shared)
        })
    });
    let Some((callback, observer, shared)) = entry else {
        return Ok(()); // registry entry already released
    };
    let Some(shared) = shared else {
        prune_observer(observer_id);
        return Ok(()); // document gone
    };
    let Ok(callback) = callback else {
        return Ok(());
    };
    let records = match with_document(&shared, |doc| {
        Ok(doc.take_observer_records(observer_id, observation_key))
    }) {
        Ok(records) => records,
        Err(BindingError::Destroyed) => {
            // The window can be destroyed after this microtask was queued.
            // Its handle still owns the Arc, but no document or records remain.
            prune_observer(observer_id);
            return Ok(());
        }
        Err(err) => return Err(err.into_napi(&env)),
    };
    if records.is_empty() {
        return Ok(()); // takeRecords drained the queue, or the observation is gone
    }
    let Some(observer) = observer? else {
        prune_observer(observer_id);
        return Ok(()); // the observer handle was collected
    };
    let record_refs: Vec<Reference<MutationRecordHandle>> = records
        .into_iter()
        .map(|record| record_handle(&env, &shared, record))
        .collect::<napi::Result<_>>()?;
    let _ = callback.call(FnArgs::from((record_refs, observer)));
    Ok(())
}

// --- unit tests ---------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native surface is exactly the observer trio plus the record
    /// reads; `tests/bun/mutation-observer.test.js` re-checks the same names
    /// against the live module.
    #[test]
    fn frozen_contract_surfaces_are_the_mutation_observer_api() {
        assert_eq!(
            OBSERVER_CONTRACT,
            &["observe", "disconnect", "takeRecords"],
            "native observer contract must stay exactly the T41 surface"
        );
        assert_eq!(
            MUTATION_RECORD_CONTRACT,
            &[
                "type",
                "target",
                "addedNodes",
                "removedNodes",
                "previousSibling",
                "nextSibling",
                "attributeName",
                "attributeNamespace",
                "oldValue",
            ],
            "native record contract must stay exactly the WHATWG MutationRecord surface"
        );
    }

    /// The observer contract must never drift into the event-target, attribute
    /// or tree-mutation seams (T37 / T25E / T24 boundaries).
    #[test]
    fn contract_has_no_foreign_surface() {
        for name in OBSERVER_CONTRACT {
            assert!(
                !name.starts_with("on")
                    && !name.starts_with("get")
                    && !name.starts_with("set")
                    && !name.contains("Attribute")
                    && !name.contains("Child")
                    && !name.contains("Event"),
                "mutation_observer_api must not declare a foreign seam's surface: {name}"
            );
        }
        for name in MUTATION_RECORD_CONTRACT {
            assert!(
                *name != "timeStamp"
                    && *name != "composedPath"
                    && *name != "eventPhase"
                    && *name != "initEvent"
                    && !name.contains("EventListener"),
                "record contract must not declare the T37/T38 event surface: {name}"
            );
        }
        assert_eq!(MUTATION_RECORD_CONTRACT.len(), 9);
    }
}
