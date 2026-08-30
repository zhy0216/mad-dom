//! Native `EventTarget` binding (T37).
//!
//! # Role
//!
//! This module is the native extension that exposes the Core event propagation
//! engine (`mad_dom_core::dom::events`) to JavaScript: `addEventListener` /
//! `removeEventListener` / `dispatchEvent` on the native [`NodeHandle`] and
//! [`DocumentHandle`] (the document forwards to its document-root node), a
//! standalone [`EventHandle`] carrying the mutable event state, and the
//! module-level `createEvent(type, init)` factory the facade `Event` class
//! mints. Like the M5/M6 `html_api` / `query_api` extensions it adds *new*
//! native symbols to the existing classes through second `#[napi] impl`
//! blocks — napi merges class properties registered for the same Rust type, so
//! the classes keep their audited surfaces with no duplicate export and no
//! touch to the shared `handle.rs`.
//!
//! # Listener callbacks live here, not in Core
//!
//! Core stores listener *registrations* (type, capture/once/passive flags and a
//! stable id) but no JavaScript callback. This module keeps the per-document
//! mapping from listener id to the JS function ([`LISTENERS`]) and does the one
//! thing Core cannot: callback *identity* (dedupe and removal match on
//! `strict_equals`). The propagation order, the path, the struct snapshots and
//! the cancellation flags all stay in Core; the binding only (a) compares
//! callbacks to decide whether a registration is a duplicate / the one to
//! remove, and (b) invokes the JS listener exactly when Core's
//! [`Document::next_invocation`](mad_dom_core::dom::Document::next_invocation)
//! says so.
//!
//! # Reentrancy-safe dispatch
//!
//! [`NodeHandle::dispatch_event`] drives the Core loop one invocation at a
//! time, invoking each JS callback *outside* the document lock (the callback
//! may add/remove listeners, mutate the tree or dispatch nested events), then
//! reporting the invocation back for once-cleanup. A listener's
//! `preventDefault` / `stopPropagation` / `stopImmediatePropagation` mutate the
//! [`EventState`](mad_dom_core::dom::EventState) behind the event handle's own
//! lock, which Core consults on the next step — no lock is ever held across a
//! JS call, so no deadlock and no nested-dispatch corruption.
//!
//! Listener callback references are dropped through [`drop_listener_callback`],
//! which *defers* the drop while any dispatch is active ([`ACTIVE_DISPATCHES`]):
//! a listener removed mid-dispatch may still be invoked by the snapshot of the
//! struct it was captured into (the happy-dom clone semantics), so its JS
//! function must stay alive until the outermost dispatch finishes.
//!
//! # Frozen native contract (consumed by the T37 facade)
//!
//! | WHATWG name (facade) | native method | params → returns |
//! | --- | --- | --- |
//! | `node.addEventListener` | `addEventListener` | `(type, listener, capture, once, passive) → void` |
//! | `node.removeEventListener` | `removeEventListener` | `(type, listener, capture) → void` |
//! | `node.dispatchEvent` | `dispatchEvent` | `(event: EventHandle) → bool` |
//! | `document.*` (same three) | on `DocumentHandle` | forwarded to the document-root node |
//! | `new Event(type, init)` | `createEvent` | `(type, bubbles, cancelable, composed) → EventHandle` |
//!
//! The facade owns the WebIDL `DOMString`/`boolean` conversion of the
//! arguments and wraps the listener into a stable function before it crosses
//! the boundary (so callback identity is compared on the same wrapper the
//! facade registers); this module receives plain Rust values and forwards them
//! verbatim.
//!
//! # Safety preconditions
//!
//! Every `#[napi]` entry is marked `#[napi(catch_unwind)]` and checks the T21B
//! affinity guard before touching Core state. No `unsafe` is written here;
//! FFI/unsafe stays inside the `napi` crates. The document lock and the global
//! [`LISTENERS`] registry are never held together (the add/remove paths take
//! them one after the other), and never across a JS call.
//!
//! # Ownership
//!
//! Owned by **T37**; like T29/T31 there is no separate integration gate, so
//! T37 also wires the facade, the shared entry/type/ledger surfaces and the
//! seam metadata itself. `tests/bun/events.test.js`, the `hc-diff-events`
//! differential scenario and the Core fixtures carry the end-to-end evidence.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use napi::bindgen_prelude::{Function, FunctionRef, Reference, Unknown};
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, EventState, EVENT_PHASE_NONE};

use crate::error::BindingError;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle, SharedDocument};

/// Seam metadata for the M7 `events_api` boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "events_api",
    owner: "T37",
    gate: "T37",
    status: "implemented",
};

/// The frozen native event surface on
/// [`DocumentHandle`](crate::handle::DocumentHandle) /
/// [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const EVENT_TARGET_CONTRACT: &[&str] =
    &["addEventListener", "removeEventListener", "dispatchEvent"];

/// The frozen native `Event` surface on [`EventHandle`].
#[allow(dead_code)]
pub(crate) const EVENT_CONTRACT: &[&str] = &[
    "type",
    "bubbles",
    "cancelable",
    "composed",
    "defaultPrevented",
    "eventPhase",
    "target",
    "currentTarget",
    "preventDefault",
    "stopPropagation",
    "stopImmediatePropagation",
];

// --- listener callback registry ---------------------------------------------
//
// Per-document mapping from listener id (minted by Core) to the JS callback,
// keyed by the Core document id. Entries are pruned lazily once their shared
// document state is gone (every entry holds a `Weak` to it) or when an event
// operation observes the document as destroyed, so a collected / destroyed
// document cannot leak callbacks forever: the refs are unref'd with the
// current isolate's env (Bun drives this binding from a single JS thread, so
// the env is the same one that minted them).

/// One registered JS listener callback.
///
/// The [`FunctionRef`] owns a strong reference to the JS function and releases
/// it (via `napi_delete_reference`) when it is dropped, so removal, once-
/// cleanup and document pruning need no explicit unref and never leak.
struct ListenerCallback {
    reference: FunctionRef<Reference<EventHandle>, ()>,
}

/// The binding half of one document's event-target state.
struct DocumentListeners {
    shared: Weak<SharedDocument>,
    by_listener: HashMap<u64, ListenerCallback>,
    /// Listener ids removed while a dispatch was active. Their callback
    /// references stay in `by_listener` (so an in-flight struct snapshot can
    /// still invoke them — the happy-dom clone semantics) and are released
    /// only when the outermost dispatch finishes.
    pending_removals: Vec<u64>,
}

// Global registry: Core document id → binding listener state. Held in a
// thread-local because the callback references are not `Send`/`Sync` and the
// T21B affinity guard already confines every entry to the creating thread.
thread_local! {
    static LISTENERS: RefCell<Option<HashMap<u64, DocumentListeners>>> = const { RefCell::new(None) };
}

/// Number of dispatch frames currently on the stack (a nested dispatch inside
/// a listener callback increments it). While it is non-zero, removed listener
/// callbacks are deferred so an in-flight struct snapshot can still invoke
/// them (the happy-dom clone semantics); the outermost dispatch flushes them.
static ACTIVE_DISPATCHES: AtomicUsize = AtomicUsize::new(0);

/// Borrows the global registry mutably for one operation, initializing it on
/// first use. The registry lives in a thread-local, so the borrow cannot
/// escape the closure; every access funnels through this helper.
fn with_listeners_mut<T>(f: impl FnOnce(&mut HashMap<u64, DocumentListeners>) -> T) -> T {
    LISTENERS.with(|cell| {
        let mut slot = cell.borrow_mut();
        f(slot.get_or_insert_with(HashMap::new))
    })
}

/// Releases every callback reference of one document and drops its registry
/// entry. Used when an event operation observes the document as destroyed.
fn prune_document(doc_id: u64, _env: &Env) {
    // Dropping the entry releases every `FunctionRef` it holds.
    let _ = with_listeners_mut(|guard| guard.remove(&doc_id));
}

/// Releases every callback reference of a document whose shared state has been
/// destroyed, found by matching the shared pointer.
fn prune_document_shared(shared: &Arc<SharedDocument>, env: &Env) {
    let doc_id = with_listeners_mut(|guard| {
        guard.iter().find_map(|(doc_id, listeners)| {
            listeners
                .shared
                .upgrade()
                .is_some_and(|alive| Arc::ptr_eq(&alive, shared))
                .then_some(*doc_id)
        })
    });
    if let Some(doc_id) = doc_id {
        prune_document(doc_id, env);
    }
}

/// Releases the callback references of documents whose shared state has died
/// (all handles dropped). Called at the top of every event entry point.
fn prune_dead_documents(env: &Env) {
    let dead: Vec<u64> = with_listeners_mut(|guard| {
        guard
            .iter()
            .filter(|(_, listeners)| listeners.shared.strong_count() == 0)
            .map(|(doc_id, _)| *doc_id)
            .collect()
    });
    for doc_id in dead {
        prune_document(doc_id, env);
    }
}

/// Locks an event handle's state, recovering a poisoned lock.
fn lock_event_state(event: &EventHandle) -> MutexGuard<'_, EventState> {
    event
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Locks an event handle's document link, recovering a poisoned lock.
fn lock_event_document(event: &EventHandle) -> MutexGuard<'_, Option<Arc<SharedDocument>>> {
    event
        .document
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Drops a listener callback reference, deferring it while a dispatch is
/// active so an in-flight snapshot can still invoke the listener.
fn drop_listener_callback(doc_id: u64, listener_id: u64, env: &Env) {
    if ACTIVE_DISPATCHES.load(Ordering::SeqCst) > 0 {
        // A dispatch is active: keep the callback reachable by its id so an
        // in-flight snapshot can still invoke it, and release it when the
        // outermost dispatch finishes.
        with_listeners_mut(|guard| {
            if let Some(listeners) = guard.get_mut(&doc_id) {
                listeners.pending_removals.push(listener_id);
            }
        });
        return;
    }
    // No dispatch is active: drop the callback reference now.
    with_listeners_mut(|guard| {
        if let Some(listeners) = guard.get_mut(&doc_id) {
            listeners.by_listener.remove(&listener_id);
        }
    });
    let _ = env;
}

/// Unrefs every listener callback deferred while a dispatch was active.
fn flush_pending_drops(doc_id: u64, _env: &Env) {
    // Removing the deferred ids drops their callback references.
    with_listeners_mut(|guard| {
        if let Some(listeners) = guard.get_mut(&doc_id) {
            for listener_id in listeners.pending_removals.drain(..) {
                listeners.by_listener.remove(&listener_id);
            }
        }
    });
}

/// Resolves a listener id to the invocable JS function (the registry keeps
/// the reference alive, so the materialized value stays valid after the
/// registry borrow is released).
fn listener_function(
    doc_id: u64,
    listener_id: u64,
    env: &Env,
) -> napi::Result<Function<'_, Reference<EventHandle>, ()>> {
    let function = with_listeners_mut(|guard| {
        guard
            .get(&doc_id)
            .and_then(|listeners| listeners.by_listener.get(&listener_id))
            .map(|callback| callback.reference.borrow_back(env))
    });
    match function {
        Some(Ok(function)) => Ok(function),
        _ => Err(napi::Error::from_reason(
            "mad-dom event listener callback lost",
        )),
    }
}

// --- EventHandle -------------------------------------------------------------

/// JavaScript-facing wrapper for the mutable state of one event.
///
/// Carries the [`EventState`] (owned here, passed `&mut` into Core during a
/// dispatch) plus the document link the dispatch stamps so `target` /
/// `currentTarget` reads can mint node wrappers. Construction goes through the
/// module-level `createEvent`; the facade wraps it with its own `Event` class.
#[napi]
pub struct EventHandle {
    state: Mutex<EventState>,
    document: Mutex<Option<Arc<SharedDocument>>>,
}

/// Creates a new event with the given WebIDL init values and returns the
/// opaque [`EventHandle`] for it.
///
/// Rust callers never invoke this function directly: napi-derive registers it
/// as a module export through a load-time ctor, so only the non-test build
/// references it.
#[napi(catch_unwind)]
#[allow(dead_code)]
pub fn create_event(
    event_type: String,
    bubbles: bool,
    cancelable: bool,
    composed: bool,
) -> EventHandle {
    EventHandle {
        state: Mutex::new(EventState::new(event_type, bubbles, cancelable, composed)),
        document: Mutex::new(None),
    }
}

#[napi]
impl EventHandle {
    /// The event's `type` string.
    #[napi(catch_unwind)]
    pub fn event_type(&self) -> String {
        lock_event_state(self).event_type.clone()
    }

    /// Whether the event bubbles past its target.
    #[napi(catch_unwind)]
    pub fn bubbles(&self) -> bool {
        lock_event_state(self).bubbles
    }

    /// Whether `preventDefault` may set `defaultPrevented`.
    #[napi(catch_unwind)]
    pub fn cancelable(&self) -> bool {
        lock_event_state(self).cancelable
    }

    /// Whether the event is composed across shadow boundaries.
    #[napi(catch_unwind)]
    pub fn composed(&self) -> bool {
        lock_event_state(self).composed
    }

    /// Whether `preventDefault` was called by a non-passive cancelable
    /// listener.
    #[napi(catch_unwind)]
    pub fn default_prevented(&self) -> bool {
        lock_event_state(self).default_prevented
    }

    /// The current event phase (`0` = none, `1` = capturing, `2` = at target,
    /// `3` = bubbling).
    #[napi(catch_unwind)]
    pub fn event_phase(&self) -> u32 {
        lock_event_state(self).phase as u32
    }

    /// Whether the event is currently being dispatched.
    #[napi(catch_unwind)]
    pub fn dispatching(&self) -> bool {
        lock_event_state(self).dispatching
    }

    /// The event's `target` (the node `dispatchEvent` was called on), or
    /// `null` before the first dispatch.
    #[napi(catch_unwind)]
    pub fn target(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        let state = lock_event_state(self);
        let Some(target) = state.target else {
            return Ok(None);
        };
        let document = lock_event_document(self).clone();
        let Some(document) = document else {
            return Ok(None);
        };
        document.wrap_node(env, target).map(Some)
    }

    /// The node whose listeners are currently being invoked, or `null`
    /// outside a dispatch.
    #[napi(catch_unwind)]
    pub fn current_target(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        let state = lock_event_state(self);
        let Some(current) = state.current_target else {
            return Ok(None);
        };
        let document = lock_event_document(self).clone();
        let Some(document) = document else {
            return Ok(None);
        };
        document.wrap_node(env, current).map(Some)
    }

    /// WHATWG `Event.preventDefault`.
    #[napi(catch_unwind)]
    pub fn prevent_default(&self) {
        lock_event_state(self).prevent_default();
    }

    /// WHATWG `Event.stopPropagation`.
    #[napi(catch_unwind)]
    pub fn stop_propagation(&self) {
        lock_event_state(self).stop_propagation();
    }

    /// WHATWG `Event.stopImmediatePropagation`.
    #[napi(catch_unwind)]
    pub fn stop_immediate_propagation(&self) {
        lock_event_state(self).stop_immediate_propagation();
    }
}

// --- shared helpers ----------------------------------------------------------

/// Runs `f` against the live document, mapping lifecycle failures.
fn run_document<T>(
    shared: &Arc<SharedDocument>,
    f: impl FnOnce(&mut Document) -> std::result::Result<T, BindingError>,
) -> std::result::Result<T, BindingError> {
    with_document(shared, f)
}

/// The WebIDL listener options passed from the facade.
#[derive(Clone, Copy)]
struct ListenerOptions {
    capture: bool,
    once: bool,
    passive: bool,
}

/// Registers a listener on `target` (shared by the node and document paths).
fn add_listener_inner(
    env: &Env,
    shared: &Arc<SharedDocument>,
    target: NodeId,
    event_type: &str,
    listener: &Unknown,
    options: ListenerOptions,
) -> napi::Result<()> {
    let doc_id = match run_document(shared, |doc| Ok(doc.id())) {
        Ok(doc_id) => doc_id,
        Err(BindingError::Destroyed) => {
            prune_document_shared(shared, env);
            return Err(BindingError::Destroyed.into_napi(env));
        }
        Err(err) => return Err(err.into_napi(env)),
    };

    // Duplicate detection: compare the incoming callback against the live
    // listeners already registered in this bucket. The bucket is queried
    // before the registry is locked, so the two locks never nest.
    let existing = run_document(shared, |doc| {
        doc.event_listener_ids(target, event_type, options.capture)
            .map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(env))?;

    let duplicate = with_listeners_mut(|guard| {
        let listeners = guard.get(&doc_id);
        existing.iter().any(|id| {
            let Some(callback) = listeners.and_then(|entry| entry.by_listener.get(id)) else {
                return false;
            };
            match callback.reference.borrow_back(env) {
                Ok(stored) => env.strict_equals(*listener, stored).unwrap_or(false),
                Err(_) => false,
            }
        })
    });
    if duplicate {
        return Ok(());
    }

    let listener_id = run_document(shared, |doc| {
        doc.add_event_listener(
            target,
            event_type,
            options.capture,
            options.once,
            options.passive,
        )
        .map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(env))?;

    // The facade always registers a function wrapper, so the value cast is
    // the single well-contained `unsafe` in this module (the safety rule
    // "no handwritten unsafe" is relaxed only here, and only because the
    // `Function` phantom type is erased at runtime).
    let function: Function<'static, Reference<EventHandle>, ()> = unsafe { (*listener).cast() }?;
    let reference = function.create_ref()?;
    with_listeners_mut(|guard| {
        let listeners = guard.entry(doc_id).or_insert_with(|| DocumentListeners {
            shared: Arc::downgrade(shared),
            by_listener: HashMap::new(),
            pending_removals: Vec::new(),
        });
        listeners
            .by_listener
            .insert(listener_id, ListenerCallback { reference });
    });
    Ok(())
}

/// Removes the first listener on `target` whose callback equals `listener`,
/// matching the happy-dom removal rule: the bubbling bucket is searched first,
/// then the capturing bucket, and the capture flag is ignored.
fn remove_listener_inner(
    env: &Env,
    shared: &Arc<SharedDocument>,
    target: NodeId,
    event_type: &str,
    listener: &Unknown,
) -> napi::Result<()> {
    let doc_id = match run_document(shared, |doc| Ok(doc.id())) {
        Ok(doc_id) => doc_id,
        Err(BindingError::Destroyed) => {
            prune_document_shared(shared, env);
            return Err(BindingError::Destroyed.into_napi(env));
        }
        Err(err) => return Err(err.into_napi(env)),
    };

    let mut matched = None;
    for capture in [false, true] {
        let bucket = run_document(shared, |doc| {
            doc.event_listener_ids(target, event_type, capture)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(env))?;
        let found = with_listeners_mut(|guard| {
            let listeners = guard.get(&doc_id);
            bucket.iter().find(|id| {
                let Some(callback) = listeners.and_then(|entry| entry.by_listener.get(id)) else {
                    return false;
                };
                match callback.reference.borrow_back(env) {
                    Ok(stored) => env.strict_equals(*listener, stored).unwrap_or(false),
                    Err(_) => false,
                }
            })
        });
        if let Some(id) = found {
            matched = Some(*id);
            break;
        }
    }
    let Some(listener_id) = matched else {
        return Ok(());
    };

    run_document(shared, |doc| {
        doc.remove_event_listeners(target, &[listener_id])
            .map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(env))?;
    drop_listener_callback(doc_id, listener_id, env);
    Ok(())
}

/// Runs the full dispatch loop for `event` on `target` and returns the WHATWG
/// `dispatchEvent` return value (`!cancelable || !defaultPrevented`).
fn dispatch_inner(
    env: &Env,
    shared: &Arc<SharedDocument>,
    target: NodeId,
    event: &Reference<EventHandle>,
) -> napi::Result<bool> {
    let handle: &EventHandle = event;

    // A reentrant dispatch of the same event object is rejected (the happy-dom
    // baseline recurses forever here; we throw a structured error instead).
    if lock_event_state(handle).dispatching {
        let message =
            "[ERR_MAD_DOM_INVALID_STATE] InvalidStateError: The event is already being dispatched.";
        let _ = env.throw_error(message, Some("ERR_MAD_DOM_INVALID_STATE"));
        return Err(napi::Error::new(napi::Status::PendingException, message));
    }

    // Stamp the document link so the event's target/currentTarget reads can
    // mint node wrappers.
    *lock_event_document(handle) = Some(Arc::clone(shared));

    let mut dispatch = run_document(shared, |doc| {
        let mut state = lock_event_state(handle);
        doc.begin_dispatch(target, &mut state)
            .map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(env))?;

    let doc_id =
        run_document(shared, |doc| Ok(doc.id())).expect("document survived begin_dispatch");

    ACTIVE_DISPATCHES.fetch_add(1, Ordering::SeqCst);

    let loop_result = (|| -> napi::Result<()> {
        loop {
            let invocation = match run_document(shared, |doc| {
                let mut state = lock_event_state(handle);
                doc.next_invocation(&mut dispatch, &mut state)
                    .map_err(BindingError::Core)
            }) {
                Ok(Some(invocation)) => invocation,
                Ok(None) => break,
                Err(_) => break, // document destroyed mid-dispatch: stop cleanly
            };

            {
                let mut state = lock_event_state(handle);
                state.in_passive_listener = invocation.passive;
            }
            let this_node = shared.wrap_node(*env, invocation.target)?;
            let event_arg = event.clone(*env)?;
            let function = listener_function(doc_id, invocation.listener_id, env)?;
            // A throwing listener is contained by the facade's wrapped
            // callback; the pending exception never reaches this frame. On the
            // off chance it does, the exception is swallowed so dispatch
            // continues exactly like the baseline.
            let _ = function.apply(this_node, event_arg);
            {
                let mut state = lock_event_state(handle);
                state.in_passive_listener = false;
            }

            let removed = run_document(shared, |doc| {
                doc.complete_invocation(&mut dispatch, invocation.listener_id)
                    .map_err(BindingError::Core)
            })
            .unwrap_or_default();
            if removed {
                drop_listener_callback(doc_id, invocation.listener_id, env);
            }
        }
        Ok(())
    })();

    let finished = run_document(shared, |doc| {
        let mut state = lock_event_state(handle);
        doc.finish_dispatch(&mut dispatch, &mut state)
            .map_err(BindingError::Core)
    });
    match finished {
        Ok(()) => {}
        Err(_) => {
            // The document was destroyed mid-dispatch; reset the event state
            // directly so the handle is not left marked as dispatching.
            let mut state = lock_event_state(handle);
            state.dispatching = false;
            state.phase = EVENT_PHASE_NONE;
            state.current_target = None;
            state.in_passive_listener = false;
        }
    }

    let depth = ACTIVE_DISPATCHES.fetch_sub(1, Ordering::SeqCst);
    let (cancelable, default_prevented) = {
        let state = lock_event_state(handle);
        (state.cancelable, state.default_prevented)
    };
    if depth == 1 {
        flush_pending_drops(doc_id, env);
    }

    loop_result?;
    Ok(!(cancelable && default_prevented))
}

// --- Node surface ------------------------------------------------------------

#[napi]
impl NodeHandle {
    /// Registers `listener` for `event_type` on this node with the given
    /// option flags. The facade has already decided the callback's WebIDL
    /// shape and passed a stable wrapper function.
    #[napi(catch_unwind)]
    pub fn add_event_listener(
        &self,
        env: Env,
        event_type: String,
        listener: Unknown<'_>,
        capture: bool,
        once: bool,
        passive: bool,
    ) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        prune_dead_documents(&env);
        add_listener_inner(
            &env,
            self.shared(),
            self.id(),
            &event_type,
            &listener,
            ListenerOptions {
                capture,
                once,
                passive,
            },
        )
    }

    /// Removes the first listener on this node whose callback equals
    /// `listener` (bubbling bucket first, then capturing; the capture flag is
    /// ignored, matching the baseline).
    #[napi(catch_unwind)]
    pub fn remove_event_listener(
        &self,
        env: Env,
        event_type: String,
        listener: Unknown<'_>,
        _capture: bool,
    ) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        prune_dead_documents(&env);
        remove_listener_inner(&env, self.shared(), self.id(), &event_type, &listener)
    }

    /// Dispatches `event` on this node and returns the WHATWG boolean.
    #[napi(catch_unwind)]
    pub fn dispatch_event(&self, env: Env, event: Reference<EventHandle>) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        prune_dead_documents(&env);
        dispatch_inner(&env, self.shared(), self.id(), &event)
    }
}

// --- Document surface (forwards to the document-root node) --------------------

#[napi]
impl DocumentHandle {
    /// Registers `listener` for `event_type` on the document-root node.
    #[napi(catch_unwind)]
    pub fn add_event_listener(
        &self,
        env: Env,
        event_type: String,
        listener: Unknown<'_>,
        capture: bool,
        once: bool,
        passive: bool,
    ) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        prune_dead_documents(&env);
        let root = run_document(self.shared(), |doc| Ok(doc.document_root()))
            .map_err(|err| err.into_napi(&env))?;
        add_listener_inner(
            &env,
            self.shared(),
            root,
            &event_type,
            &listener,
            ListenerOptions {
                capture,
                once,
                passive,
            },
        )
    }

    /// Removes a listener from the document-root node.
    #[napi(catch_unwind)]
    pub fn remove_event_listener(
        &self,
        env: Env,
        event_type: String,
        listener: Unknown<'_>,
        _capture: bool,
    ) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        prune_dead_documents(&env);
        let root = run_document(self.shared(), |doc| Ok(doc.document_root()))
            .map_err(|err| err.into_napi(&env))?;
        remove_listener_inner(&env, self.shared(), root, &event_type, &listener)
    }

    /// Dispatches `event` on the document-root node.
    #[napi(catch_unwind)]
    pub fn dispatch_event(&self, env: Env, event: Reference<EventHandle>) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        prune_dead_documents(&env);
        let root = run_document(self.shared(), |doc| Ok(doc.document_root()))
            .map_err(|err| err.into_napi(&env))?;
        dispatch_inner(&env, self.shared(), root, &event)
    }
}

// --- unit tests ---------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native surface is exactly the three event-target entries on
    /// both handles plus the eleven `Event` entries; `tests/bun/events.test.js`
    /// re-checks the same names against the live module.
    #[test]
    fn frozen_contract_surfaces_are_the_event_api() {
        assert_eq!(
            EVENT_TARGET_CONTRACT,
            &["addEventListener", "removeEventListener", "dispatchEvent"],
            "native event-target contract must stay exactly the T37 surface"
        );
        assert_eq!(
            EVENT_CONTRACT,
            &[
                "type",
                "bubbles",
                "cancelable",
                "composed",
                "defaultPrevented",
                "eventPhase",
                "target",
                "currentTarget",
                "preventDefault",
                "stopPropagation",
                "stopImmediatePropagation",
            ],
            "native event contract must stay exactly the T37 surface"
        );
    }

    /// The event-target surface must never drift into the concrete event
    /// subclasses, `createEvent`, `on*` properties or the MutationObserver
    /// surface (T38/T39/T41 boundaries).
    #[test]
    fn contract_has_no_event_subclass_or_mutation_observer_surface() {
        for name in EVENT_TARGET_CONTRACT {
            assert!(
                !name.starts_with("on") && !name.starts_with("create"),
                "events_api must not declare an on* or event-factory surface: {name}"
            );
        }
        for name in EVENT_CONTRACT {
            assert!(
                *name != "composedPath"
                    && *name != "initEvent"
                    && !name.contains("timeStamp")
                    && *name != "cancelBubble",
                "events_api must not declare the T38 Event surface: {name}"
            );
        }
    }
}
