//! Document and node handles: the opaque JS objects that cross the native
//! boundary.
//!
//! # Shape of a handle
//!
//! A [`NodeHandle`] is the "绑定对象" fixed by ADR-0001 §3 and milestone M3:
//! it stores a Core [`NodeId`] (opaque — never fabricated or decomposed here)
//! plus a document ownership reference ([`SharedDocument`]), so any reachable
//! node wrapper keeps its document's arena alive. It never stores a raw
//! pointer into the arena.
//!
//! A [`DocumentHandle`] hosts the live Core [`Document`]: it holds the strong
//! [`Arc`] that node handles clone, so dropping the last handle (document or
//! node) drops the Core document and its arena.
//!
//! # Wrapper identity and lifetime (T20)
//!
//! Every document owns a weak wrapper cache ([`SharedDocument::wrappers`])
//! mapping a Core [`NodeId`] to the JS wrapper object created for it. All
//! wrapper-producing paths funnel through [`SharedDocument::wrap_node`], which
//! returns the cached wrapper when one is still alive, so repeated reads of
//! the same node hand JavaScript one and the same object (strict equality).
//! The cache is *weak*: entries never keep a wrapper alive. When JavaScript
//! collects a wrapper, its finalizer drops the Rust [`NodeHandle`], whose
//! [`Drop`] evicts the cache entry. Between a wrapper's collection and its
//! finalizer ("collected but not yet finalized") an entry still upgrades, so
//! every cache hit probes the upgraded reference for liveness and mints a
//! fresh wrapper when the value reads back empty — see
//! [`SharedDocument::wrap_node`]. This keeps the cache bounded without pinning
//! wrapper objects — no strong cache that would let every wrapper live forever.
//!
//! # Ownership chain
//!
//! The Window→Document link proper lands with T22. Until then the chain is:
//! [`DocumentHandle`] holds a strong [`Arc`] to [`SharedDocument`] (which owns
//! the Core document and arena), and every node wrapper ([`NodeHandle`])
//! clones that same strong [`Arc`]. Any reachable wrapper therefore keeps the
//! whole arena alive; dropping the last reachable handle frees it. T22's
//! Window will simply reuse the same strong-reference chain — nothing in this
//! module changes for it beyond an additional `Arc` holder.
//!
//! # Extension seam (T20A)
//!
//! This module hosts the stable internal context that the M4 native extension
//! modules (`crate::extensions`) and the affinity guard (`crate::affinity`)
//! build on. The seam is frozen by T20A and records exactly what a subtask may
//! use — no guessing of private fields:
//!
//! * **Document access** — [`SharedDocument`] plus [`with_document`]: the only
//!   sanctioned way to reach the live Core [`Document`] (or observe
//!   [`BindingError::Destroyed`]).
//! * **NodeId validation** — ids are minted and validated only by Core; the
//!   binding extracts an already-validated id with [`NodeHandle::id`] and
//!   forwards it verbatim. Core rejects foreign/stale ids with a structured
//!   error before touching memory.
//! * **Wrapper factory** — [`SharedDocument::wrap_node`]: the single,
//!   per-document weak-cache entry that mints `Reference<NodeHandle>` wrappers
//!   with stable identity. Every wrapper-producing native path must funnel
//!   through it.
//! * **Lifecycle error outlet** — [`crate::error::BindingError`] and its
//!   `into_napi` mapping; the affinity hook lands in [`crate::affinity`]
//!   (owned by T21B, wired by T21).
//! * **Core delegation** — extensions delegate every tree operation to Core
//!   through [`with_document`]; they never keep a second DOM state and never
//!   fabricate a [`NodeId`].
//!
//! Ownership: this file is shared and has a single integration owner (the
//! T2x gates). Extension subtasks import the seam (`with_document`,
//! [`SharedDocument::wrap_node`], the `shared`/`id` accessors, the error
//! outlet) but must not modify this file.
//!
//! # Safety preconditions (this module is FFI surface)
//!
//! * Every `#[napi]` method is marked `#[napi(catch_unwind)]`, so a Rust panic
//!   cannot unwind across the Node-API boundary (crate safety model).
//! * Every entry checks the T21B affinity guard ([`check_affinity`]) first:
//!   a call that cannot be attributed to the document's creating
//!   thread/isolate fails with a structured `ERR_MAD_DOM_AFFINITY_*` error
//!   before any Core state is touched. First phase: no cross-thread DOM.
//! * All tree reads and writes delegate to Core. This module never re-
//!   implements a DOM rule and keeps no second copy of tree state.
//! * A [`NodeId`] extracted from a node handle is only passed back to the Core
//!   document that created it; Core rejects foreign or stale handles with a
//!   structured error before any memory is touched.
//! * The [`Mutex`]es are never left poisoned: a poisoned lock is recovered
//!   with [`Mutex::into_inner`], so a panicking entry cannot wedge a document.
//! * [`NodeHandle`] field construction happens only inside
//!   [`SharedDocument::wrap_node`] (plus the `cfg(test)` helper), the single
//!   point where wrapper identity is minted — at most one live JS wrapper per
//!   document and node.
//!
//! FFI/unsafe is otherwise confined to the `napi` crates; the single exception
//! is the liveness probe in [`SharedDocument::wrap_node`] /
//! [`SharedDocument::wrap_document`], which peeks at the raw reference value
//! through `napi`'s `ToNapiValue` (one confined `unsafe` call, documented
//! there).

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeType, HTML_NAMESPACE};
use napi::bindgen_prelude::{
    FromNapiValue, JavaScriptClassExt, Reference, ToNapiValue, Uint32Array, Unknown, WeakReference,
};
use napi::{check_status, Env, Error as NapiError, Status};
use napi_derive::napi;
use rustc_hash::FxHashMap;

use crate::affinity::{AffinityError, AffinityToken};
use crate::error::BindingError;
use crate::extensions::mutation_observer_api::{
    schedule_pending_observer_deliveries, schedule_pending_observer_deliveries_after_local_epoch,
};

/// Number of documents currently alive (created minus destroyed / collected).
static LIVE_DOCUMENT_COUNT: AtomicU64 = AtomicU64::new(0);

/// Process-wide source for primitive node tokens. Tokens are resolved only by
/// their owning document, while unique values ensure that accidentally using
/// one with another document cannot alias an unrelated local node.
static NEXT_NODE_TOKEN: AtomicU64 = AtomicU64::new(0);

fn reserve_node_tokens(count: usize) -> u32 {
    let count = u64::try_from(count).expect("node token count exceeds u64::MAX");
    let limit = u64::from(u32::MAX) + 1;
    let start = NEXT_NODE_TOKEN
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
            current.checked_add(count).filter(|&next| next <= limit)
        })
        .expect("node token space exhausted");
    u32::try_from(start).expect("node token space exhausted")
}

/// Returns [`LIVE_DOCUMENT_COUNT`]. Diagnostic for the GC and destroy smoke
/// tests.
pub(crate) fn live_document_count() -> u64 {
    LIVE_DOCUMENT_COUNT.load(Ordering::SeqCst)
}

/// Wraps the Core [`Document`] so its drop is observable through
/// [`LIVE_DOCUMENT_COUNT`].
struct LiveDocument {
    document: Document,
}

impl Drop for LiveDocument {
    fn drop(&mut self) {
        LIVE_DOCUMENT_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Document-scoped primitive handles used by the facade's lazy-node fast
/// path. JavaScript only sees a monotonically assigned `u32` token; the opaque
/// Core `NodeId` remains here and is resolved against the owning document
/// before every operation. Values are process-unique until exhaustion, so a
/// foreign token is rejected instead of aliasing a local node. The reverse map
/// preserves wrapper identity across creation, query and navigation paths.
#[derive(Default)]
struct NodeTokens {
    // FxHashMap is deliberately confined to trusted keys: tokens are minted
    // monotonically by this binding and NodeIds come from Core's arena. Do
    // not reuse it for author-controlled strings or general facade state.
    ids: FxHashMap<u32, NodeId>,
    by_id: FxHashMap<NodeId, u32>,
}

/// Weak subscription to a JavaScript-owned epoch ArrayBuffer. Raw pointer
/// values are stored as integers solely to keep `SharedDocument` within
/// napi-rs's class bounds; affinity guarantees every use occurs on the
/// originating JS thread. The backing-store pointer itself is never retained.
struct EpochView {
    env: usize,
    reference: usize,
    /// Facade-local views are published by the token hot path from the epoch
    /// returned by native. Ordinary/raw views are always published here.
    local_publisher: bool,
}

impl Drop for EpochView {
    fn drop(&mut self) {
        // SAFETY: `reference` was created for `env` by
        // `SharedDocument::register_epoch_view`. Epoch subscriptions are
        // confined to that document's affinity thread, just like napi-rs's
        // weak wrapper references stored alongside them.
        unsafe {
            napi::sys::napi_delete_reference(
                self.env as napi::sys::napi_env,
                self.reference as napi::sys::napi_ref,
            );
        }
    }
}

/// Shared document state behind every handle.
///
/// `None` once the document has been explicitly destroyed, which eagerly drops
/// the Core [`Document`] and its arena while node handles may still be alive.
///
/// `wrappers` is the per-document weak wrapper cache (T20): a [`NodeId`] maps
/// to the [`WeakReference`] of the JS wrapper last created for it. Entries do
/// *not* keep wrappers alive — JavaScript solely owns each wrapper object.
/// An entry is evicted when the napi finalizer drops its wrapper's Rust value
/// (the `Drop for NodeHandle` path); see [`SharedDocument::wrap_node`] for
/// the "collected but not yet finalized" window semantics.
pub(crate) struct SharedDocument {
    document: Mutex<Option<LiveDocument>>,
    /// Fast terminal lifecycle bit used to preserve destroyed-document error
    /// precedence before token lookup and epoch-view allocation.
    destroyed: AtomicBool,
    /// Each entry pairs the weak wrapper reference with the mint stamp of the
    /// [`NodeHandle`] value that owns it. A stale value finalized *after* its
    /// cache entry was replaced by a re-mint (the "collected but not yet
    /// finalized" window) must only evict its own entry — [`Drop for
    /// NodeHandle`] compares stamps before removing.
    wrappers: Mutex<HashMap<NodeId, (WeakReference<NodeHandle>, u64)>>,
    /// Stable document-local token registry for lazy facade wrappers. Tokens
    /// never get reused, so a stale wrapper can never alias a later node even
    /// when Core recycles an arena slot with a new generation.
    tokens: Mutex<NodeTokens>,
    /// Token stamps are opt-in. The raw low-level binding does not pay token
    /// registry/property costs unless a facade epoch view or token API has
    /// enabled the optimized facade path for this document.
    tokens_enabled: AtomicBool,
    /// The single JS `DocumentHandle` wrapper minted for this document, held
    /// weakly. `window.document()` and `NodeHandle.owner_document()` both
    /// resolve through [`SharedDocument::wrap_document`], so every route hands
    /// back the same JS document object (stable `document ===
    /// node.ownerDocument` identity) while the wrapper stays alive.
    document_wrapper: Mutex<Option<WeakReference<DocumentHandle>>>,
    /// The immutable T21B affinity token minted exactly once when this
    /// document was created. Every native entry checks the current call
    /// against it ([`check_affinity`]) before delegating to Core, so a call
    /// from another thread/isolate fails with a structured
    /// `ERR_MAD_DOM_AFFINITY_*` error instead of racing (first phase: no
    /// cross-thread DOM).
    affinity: AffinityToken,
    /// Monotonic mint stamp counter for the wrapper caches (see `wrappers`).
    stamps: AtomicU64,
    /// Canonical structural epoch plus weak subscriptions to ordinary
    /// JS-owned ArrayBuffers. We never expose Rust-owned memory: a transferred
    /// buffer detaches and simply stops receiving updates.
    epoch: AtomicI32,
    epoch_views: Mutex<Vec<EpochView>>,
    epoch_has_raw_views: AtomicBool,
    /// Independent attribute-storage epoch and its subscribed views.
    attribute_epoch: AtomicI32,
    attribute_epoch_views: Mutex<Vec<EpochView>>,
    attribute_epoch_has_raw_views: AtomicBool,
}

/// Probes a wrapper-cache entry for the "collected but not yet finalized"
/// window, upgrading it to a live [`Reference`] when the JS object is still
/// alive.
///
/// A [`WeakReference`] survives JS-side collection until the Node-API
/// finalizer runs, yet the reference value already reads back empty at that
/// point. This probe reads the raw value — one of the module's confined
/// `unsafe` islands, one plain Node-API read through the `napi` conversion
/// trait: a null value (measured on Bun 1.4.0 for a collected object) or a
/// finalized entry marks the wrapper dead and the caller mints a replacement;
/// a live value takes the regular [`WeakReference::upgrade`] path, so the
/// return machinery hands back the same JS object (identity preserved).
fn reference_value_if_live<T: 'static>(
    env: Env,
    weak: WeakReference<T>,
) -> napi::Result<Option<Reference<T>>> {
    let raw_env = env.raw();
    let probe = weak.clone();
    let value = match unsafe { ToNapiValue::to_napi_value(raw_env, probe) } {
        Ok(value) => value,
        // The finalizer already ran and dropped the entry's value: dead.
        Err(_) => return Ok(None),
    };
    if value.is_null() {
        // Collected but not yet finalized: the value reads back empty.
        return Ok(None);
    }
    weak.upgrade(env)
}

/// Raw-value variant of the liveness probe: returns the live wrapper's JS
/// value directly, without upgrading the weak reference into a refcounted
/// [`Reference`].
///
/// The upgrade round trip (`napi_reference_ref` on upgrade, the trailing
/// `napi_reference_unref` on the returned [`Reference`]'s drop, plus the
/// reference-value read of the return conversion) exists only to satisfy the
/// `Reference` return type; the JS heap alone keeps a synchronously returned
/// object alive, so the raw value is sufficient and the per-read cost drops
/// to a single Node-API reference read. Same `unsafe` island shape as
/// [`reference_value_if_live`].
fn raw_value_if_live<T: 'static>(
    env: napi::sys::napi_env,
    weak: &WeakReference<T>,
) -> napi::Result<Option<napi::sys::napi_value>> {
    let probe = weak.clone();
    let value = match unsafe { ToNapiValue::to_napi_value(env, probe) } {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(value))
}

/// Stamps the wrapper classification (`madDomType`, and `madDomName` /
/// `madDomNamespace` for elements) onto a freshly minted node wrapper object.
///
/// The facade's wrapper factory needs nodeType + nodeName + namespace to pick
/// the WHATWG wrapper class; reading them through a separate `wrapperKind()`
/// FFI crossing per minted wrapper dominated DOM-churn workloads (tree walks,
/// bulk creation). All three values are immutable per node, so minting them
/// onto the object lets the facade classify with plain property reads.
/// Confined `unsafe` island: up to three Node-API value creations plus one
/// descriptor definition.
fn stamp_wrapper_kind(
    env: Env,
    value: napi::sys::napi_value,
    kind: u32,
    name: &str,
    namespace: Option<&str>,
    token: Option<u32>,
) -> napi::Result<()> {
    let raw_env = env.raw();
    let create_u32 = |number: u32| {
        let mut created = std::ptr::null_mut();
        check_status!(unsafe { napi::sys::napi_create_uint32(raw_env, number, &mut created) })?;
        Ok::<_, napi::Error>(created)
    };
    let create_str = |text: &str| {
        let mut created = std::ptr::null_mut();
        check_status!(unsafe {
            napi::sys::napi_create_string_utf8(
                raw_env,
                text.as_ptr().cast(),
                text.len().try_into().expect("string length fits isize"),
                &mut created,
            )
        })?;
        Ok::<_, napi::Error>(created)
    };

    // Classification is an immutable internal stamp, not mutable DOM state.
    // Default Node-API descriptor flags make each property non-writable,
    // non-enumerable and non-configurable. Besides keeping the fast facade
    // reads trustworthy, defining the whole element bundle in one call avoids
    // three separate property-definition round trips while minting wrappers.
    let empty = napi::sys::napi_property_descriptor {
        utf8name: std::ptr::null(),
        name: std::ptr::null_mut(),
        method: None,
        getter: None,
        setter: None,
        value: std::ptr::null_mut(),
        attributes: napi::sys::PropertyAttributes::default,
        data: std::ptr::null_mut(),
    };
    let mut properties = [empty; 4];
    properties[0].utf8name = c"madDomType".as_ptr();
    properties[0].value = create_u32(kind)?;
    let mut count = 1;
    if let Some(token) = token {
        properties[count].utf8name = c"madDomToken".as_ptr();
        properties[count].value = create_u32(token)?;
        count += 1;
    }
    let count = if kind == 1 {
        properties[count].utf8name = c"madDomName".as_ptr();
        properties[count].value = create_str(name)?;
        count += 1;
        properties[count].utf8name = c"madDomNamespace".as_ptr();
        properties[count].value = create_str(namespace.unwrap_or(""))?;
        count + 1
    } else {
        count
    };
    check_status!(unsafe {
        napi::sys::napi_define_properties(raw_env, value, count, properties.as_ptr())
    })?;
    Ok(())
}

/// Wraps a raw Node-API value into the type-erased [`Unknown`] return shape.
///
/// # Safety
///
/// `value` must be a Node-API value of `env`.
unsafe fn unknown_of(env: Env, value: napi::sys::napi_value) -> napi::Result<Unknown<'static>> {
    Unknown::from_napi_value(env.raw(), value)
}

/// The JS `null` as the type-erased return shape (an empty raw value would
/// surface as `undefined`; the frozen navigation contract hands back `null`).
fn null_unknown(env: Env) -> napi::Result<Unknown<'static>> {
    let mut value = std::ptr::null_mut();
    check_status!(unsafe { napi::sys::napi_get_null(env.raw(), &mut value) })?;
    Ok(unsafe { Unknown::from_napi_value(env.raw(), value)? })
}

impl SharedDocument {
    /// Sentinel written to JavaScript-visible epoch views when the
    /// document is destroyed. Structural generations only increment from
    /// zero, so this value lets facade metadata reads distinguish destruction
    /// from an ordinary mutation without another native call.
    pub(crate) const DESTROYED_EPOCH: i32 = i32::MIN;
    /// Live terminal value reached before a 32-bit epoch could repeat. Facade
    /// caches treat it as permanently uncacheable, avoiding an ABA match even
    /// after billions of mutations while leaving the document usable.
    pub(crate) const CACHE_DISABLED_EPOCH: i32 = -1;

    pub(crate) fn is_destroyed(&self) -> bool {
        self.destroyed.load(Ordering::Relaxed)
    }

    pub(crate) fn enable_tokens(&self) {
        self.tokens_enabled.store(true, Ordering::Relaxed);
    }

    /// Advances an epoch while reserving `i32::MIN` as the terminal destroy
    /// sentinel. Before a live value could repeat, the epoch saturates at
    /// [`Self::CACHE_DISABLED_EPOCH`], which permanently disables facade
    /// cache hits for that generation while keeping native reads usable.
    fn advance_epoch(epoch: &AtomicI32) -> i32 {
        let previous = epoch
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                if value == Self::CACHE_DISABLED_EPOCH {
                    return Some(value);
                }
                let next = value.wrapping_add(1);
                Some(if next == Self::DESTROYED_EPOCH {
                    next.wrapping_add(1)
                } else {
                    next
                })
            })
            .expect("epoch update closure always succeeds");
        if previous == Self::CACHE_DISABLED_EPOCH {
            return Self::CACHE_DISABLED_EPOCH;
        }
        let next = previous.wrapping_add(1);
        if next == Self::DESTROYED_EPOCH {
            next.wrapping_add(1)
        } else {
            next
        }
    }

    /// Copies `value` into every still-live, still-attached JS ArrayBuffer.
    /// A weak reference whose buffer was collected or transferred is deleted;
    /// critically, no backing-store pointer survives this function call.
    fn sync_epoch_views(
        views: &Mutex<Vec<EpochView>>,
        value: i32,
        include_local: bool,
        include_raw: bool,
    ) -> bool {
        let mut views = views
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut has_raw_views = false;
        views.retain(|view| {
            if (view.local_publisher && !include_local) || (!view.local_publisher && !include_raw) {
                return true;
            }
            let env = view.env as napi::sys::napi_env;
            let reference = view.reference as napi::sys::napi_ref;
            let mut buffer = std::ptr::null_mut();
            let live = unsafe {
                napi::sys::napi_get_reference_value(env, reference, &mut buffer)
                    == napi::sys::Status::napi_ok
                    && !buffer.is_null()
            };
            let mut data: *mut c_void = std::ptr::null_mut();
            let mut length = 0usize;
            let attached =
                live && unsafe {
                    napi::sys::napi_get_arraybuffer_info(env, buffer, &mut data, &mut length)
                        == napi::sys::Status::napi_ok
                } && !data.is_null()
                    && length == std::mem::size_of::<i32>();
            if attached {
                // SAFETY: Node-API returned an attached four-byte backing store
                // for this call. Affinity means JavaScript is suspended on the
                // same thread while the native mutation completes.
                unsafe { data.cast::<i32>().write_unaligned(value) };
                has_raw_views |= !view.local_publisher;
                true
            } else {
                // Dropping the subscription deletes its weak Node-API ref.
                false
            }
        });
        has_raw_views
    }

    /// Bumps the JavaScript-visible structural epoch subscriptions.
    pub(crate) fn bump_epoch(&self) -> i32 {
        let value = Self::advance_epoch(&self.epoch);
        let has_raw = Self::sync_epoch_views(&self.epoch_views, value, true, true);
        self.epoch_has_raw_views.store(has_raw, Ordering::Relaxed);
        value
    }

    fn bump_attribute_epoch(&self) -> i32 {
        let value = Self::advance_epoch(&self.attribute_epoch);
        let has_raw = Self::sync_epoch_views(&self.attribute_epoch_views, value, true, true);
        self.attribute_epoch_has_raw_views
            .store(has_raw, Ordering::Relaxed);
        value
    }

    /// Advances the canonical structural epoch for a facade token mutation.
    /// The facade publishes the returned value to its private local view; raw
    /// views, when any exist, are still updated natively.
    fn bump_epoch_locally_published(&self) -> i32 {
        let value = Self::advance_epoch(&self.epoch);
        if self.epoch_has_raw_views.load(Ordering::Relaxed) {
            let has_raw = Self::sync_epoch_views(&self.epoch_views, value, false, true);
            self.epoch_has_raw_views.store(has_raw, Ordering::Relaxed);
        }
        value
    }

    fn bump_attribute_epoch_locally_published(&self) -> i32 {
        let value = Self::advance_epoch(&self.attribute_epoch);
        if self.attribute_epoch_has_raw_views.load(Ordering::Relaxed) {
            let has_raw = Self::sync_epoch_views(&self.attribute_epoch_views, value, false, true);
            self.attribute_epoch_has_raw_views
                .store(has_raw, Ordering::Relaxed);
        }
        value
    }

    /// Publishes both canonical generations to facade-local subscriptions
    /// before a native scheduler is allowed to call back into JavaScript.
    /// Token hot writes normally let the facade perform one cheap typed-array
    /// store after the native call returns. An observer scheduler is a rare
    /// re-entrant boundary, however, so pending deliveries synchronize the
    /// local views first. Raw subscriptions were already handled by the
    /// locally-published bump and are deliberately skipped here.
    pub(crate) fn publish_local_epochs(&self) {
        Self::sync_epoch_views(&self.epoch_views, self.epoch_value(), true, false);
        Self::sync_epoch_views(
            &self.attribute_epoch_views,
            self.attribute_epoch_value(),
            true,
            false,
        );
    }

    /// Marks a registered JavaScript epoch view as destroyed.
    ///
    /// Unlike a normal structural change, destruction is terminal. Facade
    /// reads may use immutable wrapper stamps while the epoch is live, but on
    /// this sentinel they must re-enter native so the frozen
    /// `ERR_MAD_DOM_DOCUMENT_DESTROYED` error is preserved.
    fn mark_epoch_destroyed(&self) {
        self.epoch.store(Self::DESTROYED_EPOCH, Ordering::SeqCst);
        self.attribute_epoch
            .store(Self::DESTROYED_EPOCH, Ordering::SeqCst);
        Self::sync_epoch_views(&self.epoch_views, Self::DESTROYED_EPOCH, true, true);
        Self::sync_epoch_views(
            &self.attribute_epoch_views,
            Self::DESTROYED_EPOCH,
            true,
            true,
        );
        self.epoch_has_raw_views.store(false, Ordering::Relaxed);
        self.attribute_epoch_has_raw_views
            .store(false, Ordering::Relaxed);
        self.epoch_views
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        self.attribute_epoch_views
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }

    pub(crate) fn epoch_value(&self) -> i32 {
        self.epoch.load(Ordering::SeqCst)
    }

    pub(crate) fn attribute_epoch_value(&self) -> i32 {
        self.attribute_epoch.load(Ordering::SeqCst)
    }

    /// Registers a weak subscription for an ordinary JS-owned ArrayBuffer.
    pub(crate) fn register_epoch_view(
        &self,
        env: Env,
        buffer: napi::sys::napi_value,
        attribute: bool,
        local_publisher: bool,
    ) -> napi::Result<()> {
        let mut reference = std::ptr::null_mut();
        check_status!(unsafe {
            napi::sys::napi_create_reference(env.raw(), buffer, 0, &mut reference)
        })?;
        let view = EpochView {
            env: env.raw() as usize,
            reference: reference as usize,
            local_publisher,
        };
        let views = if attribute {
            &self.attribute_epoch_views
        } else {
            &self.epoch_views
        };
        views
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(view);
        if !local_publisher {
            if attribute {
                self.attribute_epoch_has_raw_views
                    .store(true, Ordering::Relaxed);
            } else {
                self.epoch_has_raw_views.store(true, Ordering::Relaxed);
            }
        }
        Ok(())
    }

    /// Returns the stable document-local primitive token for `id`, assigning
    /// one on first exposure. The token table is independent of the weak
    /// Node-API wrapper cache: a facade node can therefore exist without a
    /// native class object and materialize that object only on demand.
    fn token_for(&self, id: NodeId) -> u32 {
        self.enable_tokens();
        let mut tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(token) = tokens.by_id.get(&id) {
            return *token;
        }
        let token = reserve_node_tokens(1);
        tokens.ids.insert(token, id);
        tokens.by_id.insert(id, token);
        token
    }

    /// Registers one freshly allocated id without probing a map that the
    /// caller proves cannot contain it. This is the single-node counterpart
    /// to `register_tokens_for_fresh`; debug builds keep the proof executable.
    fn register_token_for_fresh(&self, id: NodeId) -> u32 {
        self.enable_tokens();
        let mut tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        debug_assert!(!tokens.by_id.contains_key(&id));
        let token = reserve_node_tokens(1);
        tokens.ids.insert(token, id);
        let previous = tokens.by_id.insert(id, token);
        debug_assert!(previous.is_none());
        token
    }

    /// Registers a contiguous token range for freshly allocated ids. The
    /// caller proves none has been exposed before, so one registry lock and
    /// one capacity reservation cover the complete batch without redundant
    /// hash probes. Returning only the range start lets bindings avoid
    /// allocating and converting a per-node result array when the caller can
    /// derive `start + offset` itself.
    fn register_tokens_for_fresh(&self, ids: &[NodeId]) -> u32 {
        self.enable_tokens();
        let mut tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let start = reserve_node_tokens(ids.len());
        tokens.ids.reserve(ids.len());
        tokens.by_id.reserve(ids.len());
        for (offset, id) in ids.iter().copied().enumerate() {
            let token = start
                .checked_add(u32::try_from(offset).expect("node token space exhausted"))
                .expect("node token space exhausted");
            tokens.ids.insert(token, id);
            tokens.by_id.insert(id, token);
        }
        start
    }

    /// Compatibility array form for callers that cannot consume a contiguous
    /// range. Registration remains shared with the allocation-free range
    /// companion so both APIs preserve identical token ordering.
    fn tokens_for_fresh(&self, ids: &[NodeId]) -> Vec<u32> {
        let start = self.register_tokens_for_fresh(ids);
        (0..ids.len())
            .map(|offset| {
                start
                    .checked_add(u32::try_from(offset).expect("node token space exhausted"))
                    .expect("node token space exhausted")
            })
            .collect()
    }

    /// Resolves tokens and writes an already-classified subtree directly into
    /// the flat transfer buffer. One registry lock and one allocation cover
    /// the snapshot; nodes already exposed keep their token.
    pub(crate) fn token_snapshot(
        &self,
        nodes: &[(NodeId, u32)],
        continuation_depth: Option<u32>,
    ) -> Vec<u32> {
        self.enable_tokens();
        let mut tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut flat = Vec::with_capacity(nodes.len() * 2 + 1);
        flat.push(
            continuation_depth
                .map(|depth| depth.checked_add(1).expect("DOM depth exceeds u32::MAX"))
                .unwrap_or(0),
        );
        let mut missing = Vec::new();
        for (index, &(id, packed)) in nodes.iter().enumerate() {
            let token = tokens.by_id.get(&id).copied().unwrap_or_else(|| {
                missing.push(index);
                0
            });
            flat.push(token);
            flat.push(packed);
        }
        if !missing.is_empty() {
            let fresh_start = reserve_node_tokens(missing.len());
            tokens.ids.reserve(missing.len());
            tokens.by_id.reserve(missing.len());
            for (offset, &node_index) in missing.iter().enumerate() {
                let id = nodes[node_index].0;
                let token = fresh_start
                    .checked_add(u32::try_from(offset).expect("node token space exhausted"))
                    .expect("node token space exhausted");
                tokens.ids.insert(token, id);
                tokens.by_id.insert(id, token);
                flat[1 + node_index * 2] = token;
                // Reserve the high descriptor bit as a proof that this token
                // was assigned by this snapshot. No token could previously
                // have crossed into the facade, so current facades may skip
                // an otherwise mandatory wrapper-identity map probe. Older
                // facades safely take their unknown-kind materialization
                // fallback for the flagged descriptor.
                flat[2 + node_index * 2] |= 1 << 31;
            }
        }
        flat
    }

    /// Resolves a document-local primitive token back to the opaque Core id.
    /// Callers still delegate to Core afterwards, so stale/adopted ids retain
    /// the existing structured lifecycle errors.
    fn id_for_token(&self, token: u32) -> Option<NodeId> {
        self.tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .ids
            .get(&token)
            .copied()
    }

    /// Resolves an ordered token pair under one registry lock. Returning the
    /// first missing token preserves the single-token API's error precedence
    /// while avoiding two mutex acquisitions on every token append.
    fn ids_for_tokens(&self, first: u32, second: u32) -> Result<(NodeId, NodeId), u32> {
        let tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let first_id = tokens.ids.get(&first).copied().ok_or(first)?;
        let second_id = tokens.ids.get(&second).copied().ok_or(second)?;
        Ok((first_id, second_id))
    }

    /// Returns the JS wrapper for `id`, creating (and caching) it on a miss.
    ///
    /// This is the single point where wrapper identity is minted: while a
    /// wrapper object is alive, every read of `id` returns that same object,
    /// so repeated reads compare strictly equal in JavaScript. The cache is
    /// weak: once the wrapper's finalizer drops the Rust value, its [`Drop`]
    /// evicts the entry and the next miss mints a fresh wrapper (overwriting
    /// any residual entry).
    ///
    /// "Collected but not yet finalized" window: Bun defers Node-API
    /// finalizers to a later event-loop turn, so between a wrapper's GC and
    /// its finalizer a cache entry still upgrades — but the reference value
    /// reads back empty (measured on Bun 1.4.0: `napi_get_reference_value`
    /// yields an empty handle for a collected object). Returning such an entry
    /// would hand JavaScript `undefined` instead of a node. Every cache hit
    /// therefore probes the raw reference value ([`reference_value_if_live`])
    /// and falls through to a fresh mint when it is empty. The re-mint
    /// overwrites the stale entry; the stale value's delayed [`Drop`] compares
    /// mint stamps and only evicts its own entry, so the replacement's
    /// identity survives.
    ///
    /// Construction of the [`NodeHandle`] value lives here (the uniqueness
    /// invariant): the value is immediately boxed into the new JS object by
    /// `into_reference`, so no intermediate handle can register or evict a
    /// cache entry behind the wrapper's back.
    pub(crate) fn wrap_node(
        self: &Arc<Self>,
        env: Env,
        id: NodeId,
    ) -> napi::Result<Reference<NodeHandle>> {
        let value = self.wrap_node_value(env, id)?;
        // SAFETY: the value is the `NodeHandle` class wrapper minted (or
        // cache-handed-back) by `wrap_node_value` above.
        unsafe { Reference::from_napi_value(env.raw(), value) }
    }

    /// Returns the JS wrapper for `id` as a raw Node-API value, creating (and
    /// caching) it on a miss — the hot-path variant of [`wrap_node`].
    ///
    /// Identity and staleness semantics are exactly [`wrap_node`]'s; the
    /// difference is the return shape. A cache hit hands back the live
    /// wrapper's value with a single Node-API reference read — no refcount
    /// round trip ([`WeakReference::upgrade`] + the returned [`Reference`]'s
    /// drop), which the per-node cost of tree walks and bulk reads is
    /// dominated by. A miss mints, stamps the wrapper classification
    /// ([`stamp_wrapper_kind`], so the facade picks the WHATWG class without a
    /// second FFI crossing) and caches the weak entry.
    ///
    /// Callers that need the [`Reference`] type route through [`wrap_node`],
    /// which re-adopts the value returned here.
    pub(crate) fn wrap_node_value(
        self: &Arc<Self>,
        env: Env,
        id: NodeId,
    ) -> napi::Result<napi::sys::napi_value> {
        let raw_env = env.raw();
        let cached = self
            .wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&id)
            .cloned();
        if let Some((weak, _)) = cached {
            if let Some(value) = raw_value_if_live(raw_env, &weak)? {
                return Ok(value);
            }
        }
        // The wrapper factory needs the node's immutable classification; read
        // it under the document lock (nested inside the wrappers re-lock
        // below — the lock order every path agrees on).
        let kind = with_document(self, |doc| {
            let kind = doc.node_type(id).map(node_type_value)?;
            let (name, namespace) = if kind == 1 {
                (
                    doc.node_name(id)?.to_owned(),
                    doc.element_namespace_uri(id)?.map(str::to_owned),
                )
            } else {
                (String::new(), None)
            };
            Ok((kind, name, namespace))
        })
        // A live node of a live document always classifies; the error arm is
        // the destroyed-document guard (`with_document` rejects before Core).
        .map_err(|err| napi::Error::new(Status::GenericFailure, format!("{err:?}")))?;
        self.mint_node_value(env, id, kind.0, &kind.1, kind.2.as_deref())
    }

    /// Mints and caches the JS wrapper for a node whose immutable
    /// classification is already known.
    ///
    /// Fresh-node creation uses this directly: the returned [`NodeId`] cannot
    /// already have a wrapper, and the creating entry already knows its node
    /// kind, name and namespace. Skipping the cache probe and second document
    /// lock avoids repeating fixed work for every `createElement` /
    /// `createText` call while keeping all [`NodeHandle`] construction in this
    /// single helper. Existing-node paths continue through
    /// [`SharedDocument::wrap_node_value`] and its identity/liveness probe.
    fn mint_node_value(
        self: &Arc<Self>,
        env: Env,
        id: NodeId,
        kind: u32,
        name: &str,
        namespace: Option<&str>,
    ) -> napi::Result<napi::sys::napi_value> {
        let raw_env = env.raw();
        let stamp = self.stamps.fetch_add(1, Ordering::Relaxed);
        let reference = NodeHandle {
            shared: Arc::clone(self),
            id,
            stamp,
        }
        .into_reference(env)?;
        let weak = reference.downgrade();
        // Consumes the reference: the value is extracted, then the reference's
        // drop releases its refcount back to the weak cache entry's level.
        let value = unsafe { ToNapiValue::to_napi_value(raw_env, reference)? };
        let token = self
            .tokens_enabled
            .load(Ordering::Relaxed)
            .then(|| self.token_for(id));
        stamp_wrapper_kind(env, value, kind, name, namespace, token)?;
        self.wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id, (weak, stamp));
        Ok(value)
    }

    /// Type-erased return variant of [`SharedDocument::mint_node_value`] for
    /// native creation entries, where the node is guaranteed fresh.
    fn mint_node_unknown(
        self: &Arc<Self>,
        env: Env,
        id: NodeId,
        kind: u32,
        name: &str,
        namespace: Option<&str>,
    ) -> napi::Result<Unknown<'_>> {
        let value = self.mint_node_value(env, id, kind, name, namespace)?;
        unsafe { unknown_of(env, value) }
    }

    /// [`wrap_node_value`] convenience for `#[napi]` entries that return the
    /// type-erased value shape.
    pub(crate) fn wrap_node_unknown(
        self: &Arc<Self>,
        env: Env,
        id: NodeId,
    ) -> napi::Result<Unknown<'_>> {
        let value = self.wrap_node_value(env, id)?;
        unsafe { unknown_of(env, value) }
    }

    /// Returns the single JS `DocumentHandle` wrapper for this document,
    /// minting and caching it weakly on a miss.
    ///
    /// Every route that hands the document to JavaScript — the window
    /// (`WindowHandle.document`) and any node (`NodeHandle.owner_document`) —
    /// goes through this point, so the same native handle object is returned
    /// on every read while it stays alive. Like `wrap_node`, the cache is
    /// weak and probes for the "collected but not yet finalized" window before
    /// handing back a cached entry. No stamp is needed here: `DocumentHandle`
    /// has no evicting [`Drop`], so a re-mint simply overwrites the entry and
    /// no late drop can clobber the replacement.
    pub(crate) fn wrap_document(
        self: &Arc<Self>,
        env: Env,
    ) -> napi::Result<Reference<DocumentHandle>> {
        let cached = self
            .document_wrapper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(weak) = cached {
            if let Some(reference) = reference_value_if_live(env, weak)? {
                return Ok(reference);
            }
        }
        let reference = DocumentHandle {
            shared: Arc::clone(self),
        }
        .into_reference(env)?;
        *self
            .document_wrapper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(reference.downgrade());
        Ok(reference)
    }

    /// Raw-value variant of [`wrap_document`] for the hot entries that return
    /// the type-erased value shape (same identity and staleness semantics;
    /// a cache hit costs a single Node-API reference read).
    pub(crate) fn wrap_document_value(
        self: &Arc<Self>,
        env: Env,
    ) -> napi::Result<napi::sys::napi_value> {
        let raw_env = env.raw();
        let cached = self
            .document_wrapper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(weak) = cached {
            if let Some(value) = raw_value_if_live(raw_env, &weak)? {
                return Ok(value);
            }
        }
        let reference = DocumentHandle {
            shared: Arc::clone(self),
        }
        .into_reference(env)?;
        let weak = reference.downgrade();
        let value = unsafe { ToNapiValue::to_napi_value(raw_env, reference)? };
        *self
            .document_wrapper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(weak);
        Ok(value)
    }
}

/// Runs `f` against the live Core document, or reports
/// [`BindingError::Destroyed`] once the document has been destroyed.
///
/// A poisoned lock (a panicking entry that held the guard) is recovered with
/// [`Mutex::into_inner`] so the document stays usable instead of wedging.
///
/// Structural epoch: Core's `structure_generation` is compared before/after
/// `f`; a change means the call mutated the tree relations, so the
/// subscribed JavaScript epoch views are updated ([`SharedDocument::bump_epoch`]).
/// This is the single chokepoint every native document access funnels
/// through, so no mutation path — present or future — can bypass the
/// invalidation signal the facade navigation memo reads.
pub(crate) fn with_document<T>(
    shared: &Arc<SharedDocument>,
    f: impl FnOnce(&mut Document) -> std::result::Result<T, BindingError>,
) -> std::result::Result<T, BindingError> {
    let mut guard = shared
        .document
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match guard.as_mut() {
        None => Err(BindingError::Destroyed),
        Some(live) => {
            let generation_before = live.document.structure_generation();
            let attribute_generation_before = live.document.attribute_generation();
            let result = f(&mut live.document);
            if live.document.structure_generation() != generation_before {
                shared.bump_epoch();
            }
            if live.document.attribute_generation() != attribute_generation_before {
                shared.bump_attribute_epoch();
            }
            result
        }
    }
}

/// Variant used only by facade-local token hot paths. It advances the same
/// canonical generations as [`with_document`], but leaves publication to the
/// facade-local epoch buffers to the caller and returns their exact values.
/// Any ordinary/raw epoch views remain native-published. If a failed Core call
/// ever changes a generation, all views are published natively because the JS
/// caller will not receive a return value.
fn with_document_locally_published<T>(
    shared: &Arc<SharedDocument>,
    f: impl FnOnce(&mut Document) -> std::result::Result<T, BindingError>,
) -> std::result::Result<(T, i32, i32), BindingError> {
    let mut guard = shared
        .document
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(live) = guard.as_mut() else {
        return Err(BindingError::Destroyed);
    };
    let generation_before = live.document.structure_generation();
    let attribute_generation_before = live.document.attribute_generation();
    let result = f(&mut live.document);
    let succeeded = result.is_ok();
    let structure_changed = live.document.structure_generation() != generation_before;
    let attributes_changed = live.document.attribute_generation() != attribute_generation_before;
    let structure_epoch = if structure_changed {
        if succeeded {
            shared.bump_epoch_locally_published()
        } else {
            shared.bump_epoch()
        }
    } else {
        shared.epoch_value()
    };
    let attribute_epoch = if attributes_changed {
        if succeeded {
            shared.bump_attribute_epoch_locally_published()
        } else {
            shared.bump_attribute_epoch()
        }
    } else {
        shared.attribute_epoch_value()
    };
    result.map(|value| (value, structure_epoch, attribute_epoch))
}

/// Maps a [`AffinityError`] from the T21B guard to the pending JavaScript
/// exception and returns the napi error signalling it.
///
/// The failure is a plain `Error` (the T21A lifecycle/internal bucket): it
/// carries the frozen T21B `code` and a stable, hand-written message (no Rust
/// debug formatting), so JavaScript can key on `error.code` exactly like the
/// Core taxonomy.
pub(crate) fn affinity_error_to_napi(env: &Env, err: &AffinityError) -> NapiError {
    let code = err.code();
    let message = format!("[{code}] {err}");
    let _ = env.throw_error(&message, Some(code));
    NapiError::new(Status::PendingException, message)
}

/// The single T21 affinity wiring point: verifies that the current call runs
/// on the thread/isolate that created the document behind `shared`, throwing
/// the T21B-mapped exception when it does not.
///
/// Every `#[napi]` entry calls this before delegating to Core; later gates
/// wire their entries through the same point, so the guard semantics stay
/// owned by T21B and are never re-implemented by a subtask.
pub(crate) fn check_affinity(shared: &Arc<SharedDocument>, env: &Env) -> napi::Result<()> {
    shared
        .affinity
        .check()
        .map_err(|err| affinity_error_to_napi(env, &err))
}

/// Maps a Core [`NodeType`] to the WHATWG `Node.nodeType` number.
///
/// Pure value conversion (the binding's job); no DOM rule is implemented here.
pub(crate) fn node_type_value(node_type: NodeType) -> u32 {
    match node_type {
        NodeType::Element => 1,
        NodeType::Text => 3,
        NodeType::Comment => 8,
        NodeType::Document => 9,
        NodeType::DocumentType => 10,
        NodeType::DocumentFragment => 11,
        NodeType::ShadowRoot => 11,
        NodeType::ProcessingInstruction => 7,
    }
}

/// Compact tag code shared with `SNAPSHOT_HTML_NAMES` in the facade. Codes
/// start at 16 so ordinary WHATWG node types retain their numeric values;
/// zero means exact native classification is still required.
fn snapshot_html_element_descriptor(name: &str) -> u32 {
    let offset = match name {
        "html" => 0,
        "head" => 1,
        "body" => 2,
        "title" => 3,
        "div" => 4,
        "span" => 5,
        "p" => 6,
        "a" => 7,
        "h1" => 8,
        "h2" => 9,
        "h3" => 10,
        "h4" => 11,
        "h5" => 12,
        "h6" => 13,
        "ul" => 14,
        "ol" => 15,
        "li" => 16,
        "table" => 17,
        "caption" => 18,
        "tr" => 19,
        "td" => 20,
        "th" => 21,
        "thead" => 22,
        "tbody" => 23,
        "tfoot" => 24,
        "br" => 25,
        "hr" => 26,
        "form" => 27,
        "input" => 28,
        "button" => 29,
        "select" => 30,
        "option" => 31,
        "textarea" => 32,
        "label" => 33,
        "img" => 34,
        "script" => 35,
        "style" => 36,
        "link" => 37,
        "meta" => 38,
        "blockquote" => 39,
        "q" => 40,
        "slot" => 41,
        "template" => 42,
        "section" => 43,
        _ => return 0,
    };
    16 + offset
}

/// Numeric immutable classification for the facade subtree snapshot. Values
/// below 16 are ordinary WHATWG node types. A known HTML element is encoded
/// as a compact code into the facade's fixed name table; zero means the
/// element needs the ordinary opaque-handle classification path
/// (unknown/custom/non-HTML).
pub(crate) fn node_snapshot_descriptor(doc: &Document, id: NodeId) -> Result<u32, BindingError> {
    let data = doc.get(id).map_err(BindingError::Core)?.data();
    let node_type = data.node_type();
    if node_type != NodeType::Element {
        return Ok(node_type_value(node_type));
    }
    let name = data
        .element_name()
        .expect("Element node data carries a local name");
    if data.element_namespace() != Some(HTML_NAMESPACE) {
        return Ok(0);
    }
    Ok(snapshot_html_element_descriptor(name))
}

/// JavaScript-facing wrapper for a live Core [`Document`].
///
/// Constructed only from Rust (`create_document`); there is no public
/// constructor, so JavaScript receives it as an opaque handle.
#[napi]
pub struct DocumentHandle {
    shared: Arc<SharedDocument>,
}

impl DocumentHandle {
    /// Creates a fresh document with its own arena and bumps the live count.
    ///
    /// The `Arc` is the handle→document ownership token mandated by the T20
    /// design; it is never actually used across threads (Bun drives this
    /// binding from its single JS thread and napi class values are not
    /// `Send`), so the weak [`WeakReference`] cache inside
    /// [`SharedDocument`] legitimately makes the pointee `!Send + !Sync`.
    /// The `napi` crate itself carries the same allow for its class
    /// machinery.
    #[allow(clippy::arc_with_non_send_sync)]
    pub(crate) fn new() -> Self {
        LIVE_DOCUMENT_COUNT.fetch_add(1, Ordering::SeqCst);
        Self {
            shared: Arc::new(SharedDocument {
                document: Mutex::new(Some(LiveDocument {
                    document: Document::new(),
                })),
                destroyed: AtomicBool::new(false),
                wrappers: Mutex::new(HashMap::new()),
                tokens: Mutex::new(NodeTokens::default()),
                tokens_enabled: AtomicBool::new(false),
                document_wrapper: Mutex::new(None),
                affinity: AffinityToken::create(),
                stamps: AtomicU64::new(0),
                epoch: AtomicI32::new(0),
                epoch_views: Mutex::new(Vec::new()),
                epoch_has_raw_views: AtomicBool::new(false),
                attribute_epoch: AtomicI32::new(0),
                attribute_epoch_views: Mutex::new(Vec::new()),
                attribute_epoch_has_raw_views: AtomicBool::new(false),
            }),
        }
    }

    /// Runs `f` against this document, mapping lifecycle failures.
    fn run<T>(
        &self,
        f: impl FnOnce(&mut Document) -> std::result::Result<T, BindingError>,
    ) -> std::result::Result<T, BindingError> {
        with_document(&self.shared, f)
    }

    /// Returns the shared document context behind this handle.
    ///
    /// T20A seam accessor: extension modules reach the live Core [`Document`]
    /// through [`with_document`](crate::handle::with_document) on this
    /// context, never through the private field.
    ///
    /// Dormant until the first M4 extension lands; consumed by downstream
    /// subtasks through the frozen seam, not by current production code.
    #[allow(dead_code)]
    pub(crate) fn shared(&self) -> &Arc<SharedDocument> {
        &self.shared
    }

    /// Resolves an internal facade token or raises the same stable usage error
    /// family as an invalid opaque handle. Tokens are deliberately scoped to
    /// this `DocumentHandle`; the facade checks document identity before a
    /// two-node operation reaches this helper.
    fn resolve_node_token(&self, env: &Env, token: u32) -> napi::Result<NodeId> {
        if self.shared.is_destroyed() {
            return Err(BindingError::Destroyed.into_napi(env));
        }
        self.shared.id_for_token(token).ok_or_else(|| {
            let code = "ERR_MAD_DOM_INVALID_HANDLE";
            let message = format!("[{code}] invalid document node token {token}");
            let _ = env.throw_type_error(&message, Some(code));
            NapiError::new(Status::PendingException, message)
        })
    }

    /// Pair form of [`Self::resolve_node_token`] for two-node operations.
    fn resolve_node_tokens(
        &self,
        env: &Env,
        first: u32,
        second: u32,
    ) -> napi::Result<(NodeId, NodeId)> {
        if self.shared.is_destroyed() {
            return Err(BindingError::Destroyed.into_napi(env));
        }
        self.shared.ids_for_tokens(first, second).map_err(|token| {
            let code = "ERR_MAD_DOM_INVALID_HANDLE";
            let message = format!("[{code}] invalid document node token {token}");
            let _ = env.throw_type_error(&message, Some(code));
            NapiError::new(Status::PendingException, message)
        })
    }

    // --- pure helpers (tested without a JS runtime) ---

    pub(crate) fn create_element_inner(
        &self,
        name: &str,
    ) -> std::result::Result<NodeId, BindingError> {
        self.run(|doc| doc.create_element(name).map_err(BindingError::Core))
    }

    pub(crate) fn create_element_ns_inner(
        &self,
        namespace: &str,
        name: &str,
    ) -> std::result::Result<NodeId, BindingError> {
        self.run(|doc| {
            doc.create_element_ns(namespace, name)
                .map_err(BindingError::Core)
        })
    }

    #[cfg(test)]
    pub(crate) fn create_text_inner(
        &self,
        data: &str,
    ) -> std::result::Result<NodeId, BindingError> {
        self.run(|doc| doc.create_text(data).map_err(BindingError::Core))
    }

    pub(crate) fn create_text_owned_inner(
        &self,
        data: String,
    ) -> std::result::Result<NodeId, BindingError> {
        self.run(move |doc| doc.create_text_owned(data).map_err(BindingError::Core))
    }

    pub(crate) fn create_comment_inner(
        &self,
        data: &str,
    ) -> std::result::Result<NodeId, BindingError> {
        self.run(|doc| doc.create_comment(data).map_err(BindingError::Core))
    }

    pub(crate) fn create_document_fragment_inner(
        &self,
    ) -> std::result::Result<NodeId, BindingError> {
        self.run(|doc| doc.create_document_fragment().map_err(BindingError::Core))
    }

    pub(crate) fn append_child_inner(
        &self,
        parent: &NodeHandle,
        child: &NodeHandle,
    ) -> std::result::Result<(), BindingError> {
        self.run(|doc| {
            doc.append_child(parent.id, child.id)
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn insert_before_inner(
        &self,
        parent: &NodeHandle,
        child: &NodeHandle,
        reference: &NodeHandle,
    ) -> std::result::Result<(), BindingError> {
        self.run(|doc| {
            doc.insert_before(parent.id, child.id, reference.id)
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn remove_child_inner(
        &self,
        parent: &NodeHandle,
        child: &NodeHandle,
    ) -> std::result::Result<(), BindingError> {
        self.run(|doc| {
            doc.remove_child(parent.id, child.id)
                .map(|_| ())
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn replace_child_inner(
        &self,
        parent: &NodeHandle,
        child: &NodeHandle,
        node: &NodeHandle,
    ) -> std::result::Result<(), BindingError> {
        self.run(|doc| {
            doc.replace_child(parent.id, child.id, node.id)
                .map(|_| ())
                .map_err(BindingError::Core)
        })
    }

    /// Destroys the document eagerly, dropping its arena. Node handles keep
    /// their `Arc`, but every further operation fails with
    /// [`BindingError::Destroyed`].
    ///
    /// The wrapper cache is cleared with the document (T20): after this point
    /// no new wrapper can be minted anyway — every binding operation fails
    /// with [`BindingError::Destroyed`] before reaching
    /// [`SharedDocument::wrap_node`] — so stale entries would never be read,
    /// only leaked.
    pub(crate) fn destroy_inner(&self) {
        let mut guard = self
            .shared
            .document
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
        self.shared.destroyed.store(true, Ordering::Relaxed);
        drop(guard);
        self.shared
            .wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        let mut tokens = self
            .shared
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        tokens.ids.clear();
        tokens.by_id.clear();
        drop(tokens);
        // Structural epoch: destroy is the one state change that never runs
        // through `with_document` (the document is already gone), so mark the
        // epoch terminal here — a facade navigation memo cached before the
        // destroy must miss and re-enter the native path, which reports
        // `ERR_MAD_DOM_DOCUMENT_DESTROYED` instead of serving stale nodes.
        self.shared.mark_epoch_destroyed();
    }
}

#[napi]
impl DocumentHandle {
    // Creation entries return the type-erased value shape, like the
    // navigation surface: the minted wrapper objects are identical
    // (identity preserved by the weak cache), minus the per-return refcount
    // round trip.

    #[napi(catch_unwind)]
    pub fn create_element(&self, env: Env, name: String) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_element_inner(&name)
            .map_err(|err| err.into_napi(&env))?;
        self.shared.mint_node_unknown(
            env,
            id,
            node_type_value(NodeType::Element),
            &name,
            Some(mad_dom_core::dom::HTML_NAMESPACE),
        )
    }

    /// Primitive-return companion used by the facade's lazy-node creation
    /// path. It performs the exact same Core allocation and validation as
    /// `createElement`, but defers allocation of the expensive Node-API class
    /// wrapper until an operation actually needs one.
    #[napi(catch_unwind)]
    pub fn create_element_token(&self, env: Env, name: String) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_element_inner(&name)
            .map_err(|err| err.into_napi(&env))?;
        Ok(self.shared.register_token_for_fresh(id))
    }

    /// Amortized companion for ordinary built-in HTML elements. The facade
    /// keeps the returned detached tokens in a small per-document pool, so a
    /// run of `createElement("div")` calls pays one string conversion, lock
    /// acquisition and JS/native crossing per batch instead of per node.
    #[napi(catch_unwind)]
    pub fn create_element_token_batch(
        &self,
        env: Env,
        name: String,
        count: u32,
    ) -> napi::Result<Vec<u32>> {
        check_affinity(&self.shared, &env)?;
        if self.shared.is_destroyed() {
            return Err(BindingError::Destroyed.into_napi(&env));
        }
        if count == 0 || count > 4096 {
            let message = "createElementTokenBatch count must be between 1 and 4096";
            return Err(NapiError::new(Status::InvalidArg, message));
        }
        let ids = self
            .run(|doc| {
                doc.create_elements(&name, count as usize)
                    .map_err(BindingError::Core)
            })
            .map_err(|err| err.into_napi(&env))?;
        Ok(self.shared.tokens_for_fresh(&ids))
    }

    /// Contiguous-range companion to `createElementTokenBatch`. Every token
    /// in `[start, start + count)` is registered to one independent freshly
    /// allocated element in ascending allocation order. The facade consumes
    /// the range locally and avoids creating `count` JavaScript numbers at the
    /// Node-API boundary; older facades keep using the array-returning method.
    #[napi(catch_unwind)]
    pub fn create_element_token_range(
        &self,
        env: Env,
        name: String,
        count: u32,
    ) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        if self.shared.is_destroyed() {
            return Err(BindingError::Destroyed.into_napi(&env));
        }
        if count == 0 || count > 4096 {
            let message = "createElementTokenRange count must be between 1 and 4096";
            return Err(NapiError::new(Status::InvalidArg, message));
        }
        let ids = self
            .run(|doc| {
                doc.create_elements(&name, count as usize)
                    .map_err(BindingError::Core)
            })
            .map_err(|err| err.into_napi(&env))?;
        Ok(self.shared.register_tokens_for_fresh(&ids))
    }

    /// Creates an element in the given namespace (the read behind
    /// `document.createElementNS`). The element keeps `namespace` verbatim, so
    /// an SVG element reports its SVG namespace URI and its mixed-case name.
    #[napi(catch_unwind)]
    pub fn create_element_ns(
        &self,
        env: Env,
        namespace: String,
        name: String,
    ) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_element_ns_inner(&namespace, &name)
            .map_err(|err| err.into_napi(&env))?;
        self.shared.mint_node_unknown(
            env,
            id,
            node_type_value(NodeType::Element),
            &name,
            Some(&namespace),
        )
    }

    #[napi(catch_unwind)]
    pub fn create_text(&self, env: Env, data: String) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_text_owned_inner(data)
            .map_err(|err| err.into_napi(&env))?;
        self.shared
            .mint_node_unknown(env, id, node_type_value(NodeType::Text), "", None)
    }

    /// Primitive-return companion to `createText`; see
    /// [`DocumentHandle::create_element_token`].
    #[napi(catch_unwind)]
    pub fn create_text_token(&self, env: Env, data: String) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_text_owned_inner(data)
            .map_err(|err| err.into_napi(&env))?;
        Ok(self.shared.register_token_for_fresh(id))
    }

    /// Materializes the canonical opaque native handle for a lazy facade
    /// token. The ordinary weak wrapper cache remains authoritative once the
    /// handle exists; repeated materializations return that same object.
    #[napi(catch_unwind)]
    pub fn materialize_node_token(&self, env: Env, token: u32) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        let id = self.resolve_node_token(&env, token)?;
        // A weak-cache hit alone does not prove that the Core id survived an
        // adoption. Validate before the identity cache can return a stale
        // native wrapper; this also preserves destroyed-document precedence.
        with_document(&self.shared, |doc| {
            doc.get(id).map(|_| ()).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node_unknown(env, id)
    }

    /// Returns the stable token for an already-materialized node. This is a
    /// compatibility bridge for a NodeHandle minted through the raw API
    /// before a facade enabled token stamping on its document. Normal facade
    /// nodes already carry `madDomToken` and never call this entry.
    #[napi(catch_unwind)]
    pub fn node_token(&self, env: Env, node: &NodeHandle) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        let id = node.id();
        self.run(|doc| doc.get(id).map(|_| ()).map_err(BindingError::Core))
            .map_err(|err| err.into_napi(&env))?;
        Ok(self.shared.token_for(id))
    }

    /// Reads a token-backed node without first allocating its opaque wrapper.
    #[napi(catch_unwind)]
    pub fn matches_token(&self, env: Env, token: u32, selector: String) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        let id = self.resolve_node_token(&env, token)?;
        self.run(|doc| doc.matches(id, &selector).map_err(BindingError::Core))
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn text_content_token(&self, env: Env, token: u32) -> napi::Result<Option<String>> {
        check_affinity(&self.shared, &env)?;
        let id = self.resolve_node_token(&env, token)?;
        self.run(|doc| doc.text_content(id).map_err(BindingError::Core))
            .map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn child_nodes_tokens(&self, env: Env, token: u32) -> napi::Result<Uint32Array> {
        check_affinity(&self.shared, &env)?;
        let id = self.resolve_node_token(&env, token)?;
        let nodes = self
            .run(|doc| {
                doc.children(id)
                    .map_err(BindingError::Core)?
                    .into_iter()
                    .map(|child| {
                        node_snapshot_descriptor(doc, child).map(|kind| (child, kind << 16))
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|err| err.into_napi(&env))?;
        Ok(self.shared.token_snapshot(&nodes, None).into())
    }

    /// Returns a bounded pre-order subtree chunk as a flat `Uint32Array`.
    /// Word zero is `0` for a complete subtree or the next node's depth plus
    /// one when traversal must continue; the remaining words are
    /// `(token, descriptor/depth)` pairs. Descriptor and depth are packed into
    /// one integer (`descriptor << 16 | depth`).
    #[napi(catch_unwind)]
    pub fn preorder_token_snapshot(&self, env: Env, root_token: u32) -> napi::Result<Uint32Array> {
        const LIMIT: usize = u16::MAX as usize;

        check_affinity(&self.shared, &env)?;
        let root = self.resolve_node_token(&env, root_token)?;
        let (nodes, continuation_depth) = self
            .run(|doc| {
                let (mut nodes, continuation_depth) = doc
                    .preorder_subtree_chunk(root, LIMIT)
                    .map_err(BindingError::Core)?;
                for (id, depth) in &mut nodes {
                    let descriptor = node_snapshot_descriptor(doc, *id)?;
                    // Bit 31 belongs to token_snapshot's fresh-token marker;
                    // the descriptor occupies only the remaining high bits.
                    debug_assert!(descriptor < (1 << 15));
                    debug_assert!(*depth < (1 << 16));
                    *depth |= descriptor << 16;
                }
                Ok((nodes, continuation_depth))
            })
            .map_err(|err| err.into_napi(&env))?;
        Ok(self
            .shared
            .token_snapshot(&nodes, continuation_depth)
            .into())
    }

    /// Token-based attribute write used by facade-created lazy elements. Core
    /// remains the sole attribute store and observer/custom-element queues are
    /// identical to the opaque-handle entry.
    #[napi(catch_unwind)]
    pub fn set_attribute_token(
        &self,
        env: Env,
        token: u32,
        name: String,
        value: String,
    ) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let id = self.resolve_node_token(&env, token)?;
        with_document(&self.shared, |doc| {
            doc.set_attribute(id, &name, &value)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        schedule_pending_observer_deliveries(&env, &self.shared);
        Ok(())
    }

    /// Facade-local counterpart to [`Self::set_attribute_token`]. The caller
    /// owns a buffer returned by `facadeAttributeEpochView`; returning the
    /// exact canonical epoch lets JavaScript publish it with one typed-array
    /// store while any ordinary/raw subscribers are still updated natively.
    #[napi(catch_unwind)]
    pub fn set_attribute_token_local(
        &self,
        env: Env,
        token: u32,
        name: String,
        value: String,
    ) -> napi::Result<i32> {
        check_affinity(&self.shared, &env)?;
        let id = self.resolve_node_token(&env, token)?;
        let (_, _, attribute_epoch) = with_document_locally_published(&self.shared, |doc| {
            doc.set_attribute(id, &name, &value)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let may_have_reentered =
            schedule_pending_observer_deliveries_after_local_epoch(&env, &self.shared);
        // A deliberately synchronous scheduler can re-enter and mutate again;
        // return the newest canonical value so the outer facade store cannot
        // overwrite that nested publication with its older mutation epoch.
        Ok(if may_have_reentered {
            self.shared.attribute_epoch_value()
        } else {
            attribute_epoch
        })
    }

    #[napi(catch_unwind)]
    pub fn create_comment(&self, env: Env, data: String) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_comment_inner(&data)
            .map_err(|err| err.into_napi(&env))?;
        self.shared
            .mint_node_unknown(env, id, node_type_value(NodeType::Comment), "", None)
    }

    #[napi(catch_unwind)]
    pub fn create_document_fragment(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_document_fragment_inner()
            .map_err(|err| err.into_napi(&env))?;
        self.shared.mint_node_unknown(
            env,
            id,
            node_type_value(NodeType::DocumentFragment),
            "",
            None,
        )
    }

    /// Returns the document-root node (`#document`) as a `NodeHandle`.
    ///
    /// happy-dom's `MutationObserver.observe(document, …)` and the WHATWG
    /// traversal / collection surfaces observe the document node itself; the
    /// facade resolves the `Document` wrapper to this root node handle through
    /// the sealed `with_document` seam (the only legal way to read a Core
    /// `NodeId` from a `DocumentHandle`).
    #[napi(catch_unwind)]
    pub fn document_root(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        let root = with_document(&self.shared, |doc| Ok(doc.document_root()))
            .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node_unknown(env, root)
    }

    #[napi(catch_unwind)]
    pub fn append_child(
        &self,
        env: Env,
        parent: &NodeHandle,
        child: &NodeHandle,
    ) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        self.append_child_inner(parent, child)
            .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, &self.shared);
        Ok(())
    }

    /// Token-based append companion for facade nodes owned by this document.
    /// The facade verifies both wrappers belong to this handle before calling;
    /// Core still performs all hierarchy, liveness and relation writes.
    #[napi(catch_unwind)]
    pub fn append_child_token(&self, env: Env, parent: u32, child: u32) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let (parent, child) = self.resolve_node_tokens(&env, parent, child)?;
        with_document(&self.shared, |doc| {
            doc.append_child(parent, child).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        schedule_pending_observer_deliveries(&env, &self.shared);
        Ok(())
    }

    /// Facade-local counterpart to [`Self::append_child_token`]; see
    /// [`Self::set_attribute_token_local`] for the publication protocol.
    #[napi(catch_unwind)]
    pub fn append_child_token_local(&self, env: Env, parent: u32, child: u32) -> napi::Result<i32> {
        check_affinity(&self.shared, &env)?;
        let (parent, child) = self.resolve_node_tokens(&env, parent, child)?;
        let (_, structure_epoch, _) = with_document_locally_published(&self.shared, |doc| {
            doc.append_child(parent, child).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let may_have_reentered =
            schedule_pending_observer_deliveries_after_local_epoch(&env, &self.shared);
        Ok(if may_have_reentered {
            self.shared.epoch_value()
        } else {
            structure_epoch
        })
    }

    #[napi(catch_unwind)]
    pub fn insert_before(
        &self,
        env: Env,
        parent: &NodeHandle,
        child: &NodeHandle,
        reference: &NodeHandle,
    ) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        self.insert_before_inner(parent, child, reference)
            .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, &self.shared);
        Ok(())
    }

    #[napi(catch_unwind)]
    pub fn remove_child(
        &self,
        env: Env,
        parent: &NodeHandle,
        child: &NodeHandle,
    ) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        self.remove_child_inner(parent, child)
            .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, &self.shared);
        Ok(())
    }

    #[napi(catch_unwind)]
    pub fn replace_child(
        &self,
        env: Env,
        parent: &NodeHandle,
        child: &NodeHandle,
        node: &NodeHandle,
    ) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        self.replace_child_inner(parent, child, node)
            .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, &self.shared);
        Ok(())
    }

    #[napi(catch_unwind)]
    pub fn destroy(&self, env: Env) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        self.destroy_inner();
        Ok(())
    }

    /// Diagnostic (safety-boundary fixture only, not part of the DOM facade):
    /// panics deliberately *while holding the document lock*. `catch_unwind`
    /// must convert the panic into a throwable JS `Error` instead of aborting
    /// the process, and the next entry must recover the poisoned [`Mutex`]
    /// ([`Mutex::into_inner`]), so a panicking native call can never crash
    /// Bun or wedge a document.
    #[napi(catch_unwind)]
    pub fn diagnose_panic(&self, env: Env) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let _guard = self
            .shared
            .document
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        panic!("diagnostic panic: the native panic boundary is contained")
    }

    /// Diagnostic (safety-boundary fixture only, not part of the DOM facade):
    /// runs the T21B affinity check from a freshly spawned thread. The spawned
    /// thread has a distinct [`std::thread::ThreadId`], so the check is
    /// guaranteed to fail with [`AffinityError::Mismatch`] — surfacing the
    /// exact JS error (code, name, message) every real cross-thread entry
    /// produces. First phase: cross-thread access fails explicitly; it is
    /// never silently allowed.
    #[napi(catch_unwind)]
    pub fn diagnose_cross_thread(&self, env: Env) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let token = self.shared.affinity.clone();
        let checked = std::thread::spawn(move || token.check()).join();
        let err = match checked {
            Ok(Ok(())) => return Ok(()),
            Ok(Err(err)) => err,
            Err(_) => AffinityError::Unverifiable,
        };
        Err(affinity_error_to_napi(&env, &err))
    }
}

/// JavaScript-facing opaque wrapper for a Core node.
///
/// Stores the Core [`NodeId`] and a document ownership reference — never a raw
/// pointer. The ownership `Arc` is the wrapper→Document link: a reachable
/// wrapper keeps its document's arena alive.
///
/// # Identity (T20)
///
/// Wrappers are minted only by [`SharedDocument::wrap_node`], which caches
/// them weakly per document: while a wrapper object is alive, the same node
/// always reads back as the same JS object (strict equality). A wrapper's
/// value is dropped when JavaScript collects its object (the napi finalizer)
/// or at process teardown; the [`Drop`] below evicts the cache entry so dead
/// entries cannot accumulate and a recycled arena slot can never alias an old
/// wrapper's identity.
#[napi]
pub struct NodeHandle {
    shared: Arc<SharedDocument>,
    id: NodeId,
    /// Mint stamp matching the cache entry this value owns (see
    /// [`SharedDocument::wrappers`]).
    stamp: u64,
}

/// Maximum number of wrappers returned by one navigation prefetch.  The
/// facade deliberately batches a bounded window rather than materializing a
/// parent's complete child list: reading a handful of siblings must stay
/// constant-space even when the parent has millions of children.
const NEXT_SIBLING_CHUNK_SIZE: usize = 32;

impl Drop for NodeHandle {
    /// Evicts this wrapper's cache entry.
    ///
    /// This [`Drop`] runs when the wrapper's JS object was collected (the napi
    /// finalizer drops the wrapped Rust value) or at process teardown. The
    /// cache holds at most one entry per [`NodeId`]; normally that entry
    /// belongs to this very value and removing by id is correct. The one
    /// exception is the "collected but not yet finalized" window:
    /// [`SharedDocument::wrap_node`] may have re-minted a replacement wrapper
    /// for the same node after this value was collected but before this
    /// [`Drop`] ran. The mint stamp distinguishes the two — only the entry
    /// this value owns is evicted, so a replacement's identity survives this
    /// late drop. Eviction keeps dead entries from accumulating and guarantees
    /// identity never bleeds across reused arena slots once Core enables slot
    /// recycling.
    fn drop(&mut self) {
        let mut guard = self
            .shared
            .wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if matches!(guard.get(&self.id), Some((_, stamp)) if *stamp == self.stamp) {
            guard.remove(&self.id);
        }
    }
}

impl NodeHandle {
    /// Runs `f` against the owning document, mapping lifecycle failures.
    fn run<T>(
        &self,
        f: impl FnOnce(&mut Document) -> std::result::Result<T, BindingError>,
    ) -> std::result::Result<T, BindingError> {
        with_document(&self.shared, f)
    }

    /// Returns the shared document context behind this wrapper.
    ///
    /// T20A seam accessor: extension modules delegate to Core and mint
    /// sibling wrappers through this context (`with_document`,
    /// [`SharedDocument::wrap_node`]).
    ///
    /// Dormant until the first M4 extension lands; consumed by downstream
    /// subtasks through the frozen seam, not by current production code.
    #[allow(dead_code)]
    pub(crate) fn shared(&self) -> &Arc<SharedDocument> {
        &self.shared
    }

    /// Returns the Core [`NodeId`] carried by this wrapper.
    ///
    /// T20A seam accessor: the id was minted and is validated only by Core;
    /// the binding stores and forwards it verbatim. Extensions pass it back
    /// to the owning document and Core rejects foreign or stale ids with a
    /// structured error.
    ///
    /// Dormant until the first M4 extension lands; consumed by downstream
    /// subtasks through the frozen seam, not by current production code.
    #[allow(dead_code)]
    pub(crate) fn id(&self) -> NodeId {
        self.id
    }

    // --- pure helpers (tested without a JS runtime) ---

    pub(crate) fn node_type_inner(&self) -> std::result::Result<u32, BindingError> {
        self.run(|doc| {
            doc.node_type(self.id)
                .map(node_type_value)
                .map_err(BindingError::Core)
        })
    }

    #[allow(dead_code)]
    pub(crate) fn namespace_uri_inner(&self) -> std::result::Result<Option<String>, BindingError> {
        self.run(|doc| {
            doc.element_namespace_uri(self.id)
                .map(|uri| uri.map(str::to_owned))
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn node_name_inner(&self) -> std::result::Result<String, BindingError> {
        self.run(|doc| {
            doc.node_name(self.id)
                .map(str::to_owned)
                .map_err(BindingError::Core)
        })
    }

    pub(crate) fn parent_node_inner(&self) -> std::result::Result<Option<NodeId>, BindingError> {
        self.run(|doc| doc.parent(self.id).map_err(BindingError::Core))
    }

    pub(crate) fn first_child_inner(&self) -> std::result::Result<Option<NodeId>, BindingError> {
        self.run(|doc| doc.first_child(self.id).map_err(BindingError::Core))
    }

    /// Returns the first two children plus a flag saying whether that bounded
    /// window reached the end of the child axis.  The extra child lets the
    /// facade seed the overwhelmingly common one- and two-child relations in
    /// a single native crossing while keeping an isolated `firstChild` read
    /// constant-space.
    fn first_child_pair_inner(
        &self,
    ) -> std::result::Result<(Option<NodeId>, Option<NodeId>, bool), BindingError> {
        self.run(|doc| {
            let Some(first) = doc.first_child(self.id).map_err(BindingError::Core)? else {
                return Ok((None, None, true));
            };
            let Some(second) = doc.next_sibling(first).map_err(BindingError::Core)? else {
                return Ok((Some(first), None, true));
            };
            let reached_end = doc
                .next_sibling(second)
                .map_err(BindingError::Core)?
                .is_none();
            Ok((Some(first), Some(second), reached_end))
        })
    }

    pub(crate) fn last_child_inner(&self) -> std::result::Result<Option<NodeId>, BindingError> {
        self.run(|doc| doc.last_child(self.id).map_err(BindingError::Core))
    }

    pub(crate) fn previous_sibling_inner(
        &self,
    ) -> std::result::Result<Option<NodeId>, BindingError> {
        self.run(|doc| doc.previous_sibling(self.id).map_err(BindingError::Core))
    }

    pub(crate) fn next_sibling_inner(&self) -> std::result::Result<Option<NodeId>, BindingError> {
        self.run(|doc| doc.next_sibling(self.id).map_err(BindingError::Core))
    }

    /// Returns at most [`NEXT_SIBLING_CHUNK_SIZE`] following siblings plus a
    /// flag saying whether that window reached the end of the chain.
    ///
    /// The one-node lookahead used to compute the flag remains a `NodeId` and
    /// is not wrapped.  This keeps the JavaScript-visible allocation strictly
    /// bounded while still allowing the facade to memoize a terminal `null`
    /// only when native has proved that the chain ended.
    fn next_sibling_chunk_inner(&self) -> std::result::Result<(Vec<NodeId>, bool), BindingError> {
        self.run(|doc| {
            let Some(first) = doc.next_sibling(self.id).map_err(BindingError::Core)? else {
                // The common short-chain terminal check needs no heap storage.
                return Ok((Vec::new(), true));
            };
            let mut ids = Vec::with_capacity(NEXT_SIBLING_CHUNK_SIZE);
            let mut current = Some(first);
            while let Some(id) = current {
                if ids.len() == NEXT_SIBLING_CHUNK_SIZE {
                    return Ok((ids, false));
                }
                ids.push(id);
                current = doc.next_sibling(id).map_err(BindingError::Core)?;
            }
            Ok((ids, true))
        })
    }

    pub(crate) fn child_nodes_inner(&self) -> std::result::Result<Vec<NodeId>, BindingError> {
        self.run(|doc| doc.children(self.id).map_err(BindingError::Core))
    }
}

#[napi]
impl NodeHandle {
    #[napi(catch_unwind)]
    pub fn node_type(&self, env: Env) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        self.node_type_inner().map_err(|err| err.into_napi(&env))
    }

    #[napi(catch_unwind)]
    pub fn node_name(&self, env: Env) -> napi::Result<String> {
        check_affinity(&self.shared, &env)?;
        self.node_name_inner().map_err(|err| err.into_napi(&env))
    }

    /// Fixed-name companion for the facade's cached `id` reflection. Avoids
    /// converting the same JavaScript name string on every cold cache fill
    /// while retaining Core's exact null/empty distinction.
    #[napi(catch_unwind)]
    pub fn id_attribute(&self, env: Env) -> napi::Result<Option<String>> {
        check_affinity(&self.shared, &env)?;
        self.run(|doc| {
            doc.get_attribute(self.id, "id")
                .map(|value| value.map(str::to_owned))
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Fixed-name companion for the facade's cached `class` reflection.
    #[napi(catch_unwind)]
    pub fn class_attribute(&self, env: Env) -> napi::Result<Option<String>> {
        check_affinity(&self.shared, &env)?;
        self.run(|doc| {
            doc.get_attribute(self.id, "class")
                .map(|value| value.map(str::to_owned))
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Bundled fixed-name read for a facade cold fill. This returns both hot
    /// reflected attributes in one Node-API crossing and one document lock.
    #[napi(catch_unwind)]
    pub fn id_class_attributes(&self, env: Env) -> napi::Result<(Option<String>, Option<String>)> {
        check_affinity(&self.shared, &env)?;
        self.run(|doc| {
            let id = doc
                .get_attribute(self.id, "id")
                .map_err(BindingError::Core)?
                .map(str::to_owned);
            let class_value = doc
                .get_attribute(self.id, "class")
                .map_err(BindingError::Core)?
                .map(str::to_owned);
            Ok((id, class_value))
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The wrapper-classification bundle: `nodeType`, `nodeName` and
    /// `namespaceUri` in one crossing.
    ///
    /// The facade wrapper factory needs all three to pick the wrapper class;
    /// reading them separately costs three FFI crossings per minted wrapper,
    /// which dominates DOM-churn workloads (tree walks, bulk node creation).
    /// One call, one document-lock scope. Name and namespace are empty for
    /// non-element nodes, which never read them.
    #[napi(catch_unwind)]
    pub fn wrapper_kind(&self, env: Env) -> napi::Result<(u32, String, Option<String>)> {
        check_affinity(&self.shared, &env)?;
        self.run(|doc| {
            let kind = doc.node_type(self.id).map(node_type_value)?;
            let (name, namespace) = if kind == 1 {
                (
                    doc.node_name(self.id)?.to_owned(),
                    doc.element_namespace_uri(self.id)?.map(str::to_owned),
                )
            } else {
                (String::new(), None)
            };
            Ok((kind, name, namespace))
        })
        .map_err(|err| err.into_napi(&env))
    }

    // The navigation reads return the type-erased value shape (`Unknown`):
    // JavaScript observes the exact same wrapper objects (identity preserved
    // by the weak cache) as the earlier `Reference`-typed surface, but the
    // binding skips the per-read refcount round trip that dominated
    // tree-walk workloads (see `wrap_node_value` / `raw_value_if_live`).

    #[napi(catch_unwind)]
    pub fn parent_node(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        match self
            .parent_node_inner()
            .map_err(|err| err.into_napi(&env))?
        {
            None => null_unknown(env),
            Some(id) => self.shared.wrap_node_unknown(env, id),
        }
    }

    #[napi(catch_unwind)]
    pub fn first_child(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        match self
            .first_child_inner()
            .map_err(|err| err.into_napi(&env))?
        {
            None => null_unknown(env),
            Some(id) => self.shared.wrap_node_unknown(env, id),
        }
    }

    /// Bounded companion for the facade's cold first-child path. Returns at
    /// most the first two child wrappers and appends `null` only when native
    /// proved that no third child exists.
    #[napi(catch_unwind)]
    pub fn first_child_pair(&self, env: Env) -> napi::Result<Vec<Unknown<'_>>> {
        check_affinity(&self.shared, &env)?;
        let (first, second, reached_end) = self
            .first_child_pair_inner()
            .map_err(|err| err.into_napi(&env))?;
        let child_count = usize::from(first.is_some()) + usize::from(second.is_some());
        let mut values = Vec::with_capacity(child_count + usize::from(reached_end));
        if let Some(id) = first {
            values.push(self.shared.wrap_node_unknown(env, id)?);
        }
        if let Some(id) = second {
            values.push(self.shared.wrap_node_unknown(env, id)?);
        }
        if reached_end {
            values.push(null_unknown(env)?);
        }
        Ok(values)
    }

    #[napi(catch_unwind)]
    pub fn last_child(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        match self.last_child_inner().map_err(|err| err.into_napi(&env))? {
            None => null_unknown(env),
            Some(id) => self.shared.wrap_node_unknown(env, id),
        }
    }

    #[napi(catch_unwind)]
    pub fn previous_sibling(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        match self
            .previous_sibling_inner()
            .map_err(|err| err.into_napi(&env))?
        {
            None => null_unknown(env),
            Some(id) => self.shared.wrap_node_unknown(env, id),
        }
    }

    #[napi(catch_unwind)]
    pub fn next_sibling(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        match self
            .next_sibling_inner()
            .map_err(|err| err.into_napi(&env))?
        {
            None => null_unknown(env),
            Some(id) => self.shared.wrap_node_unknown(env, id),
        }
    }

    /// Returns a bounded window of following siblings for the facade's
    /// sequential-axis memo.  A trailing JavaScript `null` is an end marker;
    /// its absence means more siblings may follow.  At most 32 node wrappers
    /// are materialized by one call.
    #[napi(catch_unwind)]
    pub fn next_sibling_chunk(&self, env: Env) -> napi::Result<Vec<Unknown<'_>>> {
        check_affinity(&self.shared, &env)?;
        let (ids, reached_end) = self
            .next_sibling_chunk_inner()
            .map_err(|err| err.into_napi(&env))?;
        let mut values = Vec::with_capacity(ids.len() + usize::from(reached_end));
        for id in ids {
            values.push(self.shared.wrap_node_unknown(env, id)?);
        }
        if reached_end {
            values.push(null_unknown(env)?);
        }
        Ok(values)
    }

    #[napi(catch_unwind)]
    pub fn child_nodes(&self, env: Env) -> napi::Result<Vec<Unknown<'_>>> {
        check_affinity(&self.shared, &env)?;
        let ids = self
            .child_nodes_inner()
            .map_err(|err| err.into_napi(&env))?;
        ids.iter()
            .map(|id| self.shared.wrap_node_unknown(env, *id))
            .collect()
    }

    /// Returns the owning document of this node.
    ///
    /// Resolves through [`SharedDocument::wrap_document`], so every node of a
    /// document hands back the same JS `DocumentHandle` the window exposes
    /// (`node.ownerDocument() === window.document()` identity, matching
    /// happy-dom). Works for detached nodes too.
    #[napi(catch_unwind)]
    pub fn owner_document(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(&self.shared, &env)?;
        let value = self.shared.wrap_document_value(env)?;
        unsafe { unknown_of(env, value) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The live-document counter is process-global, so every test that creates
    /// a [`DocumentHandle`] must run exclusively against the others. Serialize
    /// them with a shared test mutex to keep the counter assertions
    /// deterministic.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Builds a handle to `id` under `doc`'s ownership, without a JS runtime.
    ///
    /// The `#[napi]` runtime paths mint wrappers exclusively through
    /// [`SharedDocument::wrap_node`] (it needs a live `Env`); this helper is
    /// the test-only equivalent so the pure Core delegation and lifecycle
    /// logic below stays testable. It is the only other place a `NodeHandle`
    /// is constructed, per the uniqueness invariant — and because unit tests
    /// never populate the wrapper cache (a [`WeakReference`] cannot be
    /// fabricated without a JS runtime), the cache-evicting [`Drop`] is a
    /// no-op here. Wrapper identity and cache behavior are exercised end to
    /// end by `tests/bun/gc.test.js`.
    fn wrap(doc: &DocumentHandle, id: NodeId) -> NodeHandle {
        NodeHandle {
            shared: Arc::clone(&doc.shared),
            id,
            stamp: 0,
        }
    }

    fn live_before() -> u64 {
        live_document_count()
    }

    #[test]
    fn epoch_skips_destroy_sentinel_and_saturates_before_aba() {
        let epoch = AtomicI32::new(i32::MAX);
        assert_eq!(
            SharedDocument::advance_epoch(&epoch),
            i32::MIN + 1,
            "a live epoch must skip the destroy sentinel"
        );
        assert_eq!(epoch.load(Ordering::SeqCst), i32::MIN + 1);

        epoch.store(SharedDocument::CACHE_DISABLED_EPOCH - 1, Ordering::SeqCst);
        assert_eq!(
            SharedDocument::advance_epoch(&epoch),
            SharedDocument::CACHE_DISABLED_EPOCH,
            "the last unique generation disables caching"
        );
        assert_eq!(
            SharedDocument::advance_epoch(&epoch),
            SharedDocument::CACHE_DISABLED_EPOCH,
            "the disabled generation must never return or publish a wrapped value"
        );
        assert_eq!(
            epoch.load(Ordering::SeqCst),
            SharedDocument::CACHE_DISABLED_EPOCH
        );
    }

    #[test]
    fn create_and_destroy_tracks_live_documents() {
        let _guard = lock();
        let before = live_before();
        {
            let doc = DocumentHandle::new();
            assert_eq!(live_document_count(), before + 1);
            doc.destroy_inner();
            assert_eq!(live_document_count(), before, "destroy drops the document");
        }
        assert_eq!(
            live_document_count(),
            before,
            "drop after destroy is idempotent"
        );
    }

    #[test]
    fn dropping_last_handle_collects_document() {
        let _guard = lock();
        let before = live_before();
        {
            let _doc = DocumentHandle::new();
            assert_eq!(live_document_count(), before + 1);
        }
        assert_eq!(
            live_document_count(),
            before,
            "drop of last Arc drops the document"
        );
    }

    #[test]
    fn node_handle_keeps_document_alive() {
        let _guard = lock();
        let before = live_before();
        let node;
        {
            let doc = DocumentHandle::new();
            node = wrap(&doc, doc.create_element_inner("div").unwrap());
            assert_eq!(live_document_count(), before + 1);
        }
        assert_eq!(
            live_document_count(),
            before + 1,
            "a reachable node handle keeps its document alive"
        );
        drop(node);
        assert_eq!(
            live_document_count(),
            before,
            "dropping the node frees the document"
        );
    }

    #[test]
    fn create_element_returns_typed_node() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let el = wrap(&doc, doc.create_element_inner("div").unwrap());
        assert_eq!(el.node_type_inner().unwrap(), 1);
        assert_eq!(el.node_name_inner().unwrap(), "div");

        let text = wrap(&doc, doc.create_text_inner("hello").unwrap());
        assert_eq!(text.node_type_inner().unwrap(), 3);
        assert_eq!(text.node_name_inner().unwrap(), "#text");

        let comment = wrap(&doc, doc.create_comment_inner("note").unwrap());
        assert_eq!(comment.node_type_inner().unwrap(), 8);
        assert_eq!(comment.node_name_inner().unwrap(), "#comment");

        let frag = wrap(&doc, doc.create_document_fragment_inner().unwrap());
        assert_eq!(frag.node_type_inner().unwrap(), 11);
        assert_eq!(frag.node_name_inner().unwrap(), "#document-fragment");
    }

    #[test]
    fn create_element_ns_keeps_namespace_and_name() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let svg = wrap(
            &doc,
            doc.create_element_ns_inner("http://www.w3.org/2000/svg", "feBlend")
                .unwrap(),
        );
        assert_eq!(svg.node_type_inner().unwrap(), 1);
        assert_eq!(svg.node_name_inner().unwrap(), "feBlend");
        assert_eq!(
            svg.namespace_uri_inner().unwrap().as_deref(),
            Some("http://www.w3.org/2000/svg")
        );
    }

    #[test]
    fn append_and_navigation_roundtrip() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let parent = wrap(&doc, doc.create_element_inner("ul").unwrap());
        let a = wrap(&doc, doc.create_element_inner("li").unwrap());
        let b = wrap(&doc, doc.create_element_inner("li").unwrap());
        let text = wrap(&doc, doc.create_text_inner("first").unwrap());
        doc.append_child_inner(&a, &text).unwrap();
        doc.append_child_inner(&parent, &a).unwrap();
        doc.append_child_inner(&parent, &b).unwrap();

        assert_eq!(
            wrap(&doc, parent.first_child_inner().unwrap().unwrap())
                .node_name_inner()
                .unwrap(),
            "li"
        );
        assert_eq!(
            wrap(&doc, parent.last_child_inner().unwrap().unwrap())
                .node_name_inner()
                .unwrap(),
            "li"
        );
        assert_eq!(
            wrap(&doc, a.next_sibling_inner().unwrap().unwrap())
                .node_name_inner()
                .unwrap(),
            "li"
        );
        assert_eq!(
            wrap(&doc, b.previous_sibling_inner().unwrap().unwrap())
                .node_name_inner()
                .unwrap(),
            "li"
        );
        assert_eq!(
            wrap(&doc, a.parent_node_inner().unwrap().unwrap())
                .node_name_inner()
                .unwrap(),
            "ul"
        );
        assert_eq!(parent.child_nodes_inner().unwrap().len(), 2);
        assert_eq!(a.child_nodes_inner().unwrap().len(), 1);
        assert!(parent.parent_node_inner().unwrap().is_none());
    }

    #[test]
    fn insert_remove_replace_roundtrip() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let parent = wrap(&doc, doc.create_element_inner("div").unwrap());
        let a = wrap(&doc, doc.create_element_inner("a").unwrap());
        let b = wrap(&doc, doc.create_element_inner("b").unwrap());
        let c = wrap(&doc, doc.create_element_inner("c").unwrap());
        doc.append_child_inner(&parent, &a).unwrap();
        doc.append_child_inner(&parent, &c).unwrap();
        doc.insert_before_inner(&parent, &b, &c).unwrap();
        assert_eq!(parent.child_nodes_inner().unwrap().len(), 3);

        doc.remove_child_inner(&parent, &a).unwrap();
        assert_eq!(parent.child_nodes_inner().unwrap().len(), 2);
        assert!(
            a.parent_node_inner().unwrap().is_none(),
            "removed node is detached"
        );

        let d = wrap(&doc, doc.create_element_inner("d").unwrap());
        doc.replace_child_inner(&parent, &b, &d).unwrap();
        let names: Vec<String> = parent
            .child_nodes_inner()
            .unwrap()
            .iter()
            .map(|id| wrap(&doc, *id).node_name_inner().unwrap())
            .collect();
        assert_eq!(names, vec!["d", "c"]);
    }

    #[test]
    fn cross_document_handle_is_rejected() {
        let _guard = lock();
        let doc_a = DocumentHandle::new();
        let doc_b = DocumentHandle::new();
        let el = wrap(&doc_a, doc_a.create_element_inner("div").unwrap());
        let target = wrap(&doc_b, doc_b.create_element_inner("p").unwrap());

        let err = doc_b.append_child_inner(&target, &el).unwrap_err();
        assert!(matches!(
            err,
            BindingError::Core(mad_dom_core::error::CoreError::WrongDocument { .. })
        ));
    }

    #[test]
    fn destroyed_document_rejects_all_operations() {
        let _guard = lock();
        let doc = DocumentHandle::new();
        let el = wrap(&doc, doc.create_element_inner("div").unwrap());
        doc.destroy_inner();

        assert!(matches!(
            doc.create_element_inner("span"),
            Err(BindingError::Destroyed)
        ));
        assert!(matches!(el.node_name_inner(), Err(BindingError::Destroyed)));
        assert!(matches!(
            el.parent_node_inner(),
            Err(BindingError::Destroyed)
        ));
        assert!(matches!(
            doc.append_child_inner(&el, &el),
            Err(BindingError::Destroyed)
        ));
    }

    #[test]
    fn destroy_clears_the_wrapper_cache_map() {
        // The cache itself can only be populated with a JS runtime (a
        // `WeakReference` cannot be fabricated), so this only pins the
        // observable pure part: destroying leaves an empty map behind that
        // keeps working as a map.
        let _guard = lock();
        let doc = DocumentHandle::new();
        doc.destroy_inner();
        assert!(doc
            .shared
            .wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
    }

    #[test]
    fn every_document_mints_an_affinity_token_bound_to_its_thread() {
        // T21 wiring: the token minted in the constructor lives in the shared
        // state (so every handle checks the same one), passes on the creating
        // thread, and rejects a foreign thread with the T21B contract error.
        let _guard = lock();
        let doc = DocumentHandle::new();
        assert_eq!(doc.shared.affinity.check(), Ok(()));

        let token = doc.shared.affinity.clone();
        let result = std::thread::spawn(move || token.check()).join().unwrap();
        assert!(matches!(result, Err(AffinityError::Mismatch { .. })));
        assert_eq!(
            result.unwrap_err().code(),
            "ERR_MAD_DOM_AFFINITY_MISMATCH",
            "cross-thread access must surface the frozen T21B code"
        );
    }
}
