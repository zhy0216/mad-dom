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
//! [`Drop`] evicts the cache entry. One transient gap — see
//! [`SharedDocument::wrap_node`]: between a wrapper's collection and its
//! finalizer, a cache hit hands JavaScript `undefined` instead of an object.
//! This keeps the cache bounded without pinning wrapper objects — no
//! strong cache that would let every wrapper live forever.
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
//! No `unsafe` is written in this module; FFI/unsafe is confined to the `napi`
//! crates.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeType};
use napi::bindgen_prelude::{JavaScriptClassExt, Reference, WeakReference};
use napi::{Env, Error as NapiError, Status};
use napi_derive::napi;

use crate::affinity::{AffinityError, AffinityToken};
use crate::error::BindingError;
use crate::extensions::mutation_observer_api::schedule_pending_observer_deliveries;

/// Number of documents currently alive (created minus destroyed / collected).
static LIVE_DOCUMENT_COUNT: AtomicU64 = AtomicU64::new(0);

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
    wrappers: Mutex<HashMap<NodeId, WeakReference<NodeHandle>>>,
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
}

impl SharedDocument {
    /// Returns the JS wrapper for `id`, creating (and caching) it on a miss.
    ///
    /// This is the single point where wrapper identity is minted: while a
    /// wrapper object is alive, every read of `id` returns that same object,
    /// so repeated reads compare strictly equal in JavaScript. The cache is
    /// weak: once the wrapper's finalizer drops the Rust value, its [`Drop`]
    /// evicts the entry and the next miss mints a fresh wrapper (overwriting
    /// any residual entry).
    ///
    /// Known transient gap: in the "collected but not yet finalized" window,
    /// `upgrade` still succeeds — it probes the finalize-callback `Arc`, not
    /// object liveness — and returning that entry hands JavaScript `undefined`
    /// (measured on Bun 1.4.0: `napi_get_reference_value` yields an empty
    /// handle for a collected object). The finalizer turn evicts the entry and
    /// normal behavior resumes. This is a correctness gap, not a memory-safety
    /// issue; production code re-reading a node right after a GC in the same
    /// event-loop turn may observe it, and a later milestone can harden it
    /// (e.g. re-mint on an empty reference value). The Bun GC tests drain
    /// finalizers before asserting, so they never observe the window.
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
        let cached = self
            .wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&id)
            .cloned();
        if let Some(weak) = cached {
            if let Some(reference) = weak.upgrade(env)? {
                return Ok(reference);
            }
        }
        let reference = NodeHandle {
            shared: Arc::clone(self),
            id,
        }
        .into_reference(env)?;
        self.wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id, reference.downgrade());
        Ok(reference)
    }

    /// Returns the single JS `DocumentHandle` wrapper for this document,
    /// minting and caching it weakly on a miss.
    ///
    /// Every route that hands the document to JavaScript — the window
    /// (`WindowHandle.document`) and any node (`NodeHandle.owner_document`) —
    /// goes through this point, so the same native handle object is returned
    /// on every read while it stays alive. Like `wrap_node`, the cache is
    /// weak: once the wrapper's finalizer runs, the next miss mints a fresh
    /// wrapper.
    pub(crate) fn wrap_document(
        self: &Arc<Self>,
        env: Env,
    ) -> napi::Result<Reference<DocumentHandle>> {
        let mut guard = self
            .document_wrapper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(weak) = guard.as_ref() {
            if let Some(reference) = weak.upgrade(env)? {
                return Ok(reference);
            }
        }
        let reference = DocumentHandle {
            shared: Arc::clone(self),
        }
        .into_reference(env)?;
        *guard = Some(reference.downgrade());
        Ok(reference)
    }
}

/// Runs `f` against the live Core document, or reports
/// [`BindingError::Destroyed`] once the document has been destroyed.
///
/// A poisoned lock (a panicking entry that held the guard) is recovered with
/// [`Mutex::into_inner`] so the document stays usable instead of wedging.
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
        Some(live) => f(&mut live.document),
    }
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
                wrappers: Mutex::new(HashMap::new()),
                document_wrapper: Mutex::new(None),
                affinity: AffinityToken::create(),
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

    // --- pure helpers (tested without a JS runtime) ---

    pub(crate) fn create_element_inner(
        &self,
        name: &str,
    ) -> std::result::Result<NodeId, BindingError> {
        self.run(|doc| doc.create_element(name).map_err(BindingError::Core))
    }

    pub(crate) fn create_text_inner(
        &self,
        data: &str,
    ) -> std::result::Result<NodeId, BindingError> {
        self.run(|doc| doc.create_text(data).map_err(BindingError::Core))
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
        drop(guard);
        self.shared
            .wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }
}

#[napi]
impl DocumentHandle {
    #[napi(catch_unwind)]
    pub fn create_element(&self, env: Env, name: String) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_element_inner(&name)
            .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node(env, id)
    }

    #[napi(catch_unwind)]
    pub fn create_text(&self, env: Env, data: String) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_text_inner(&data)
            .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node(env, id)
    }

    #[napi(catch_unwind)]
    pub fn create_comment(&self, env: Env, data: String) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_comment_inner(&data)
            .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node(env, id)
    }

    #[napi(catch_unwind)]
    pub fn create_document_fragment(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        let id = self
            .create_document_fragment_inner()
            .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node(env, id)
    }

    /// Returns the document-root node (`#document`) as a `NodeHandle`.
    ///
    /// happy-dom's `MutationObserver.observe(document, …)` and the WHATWG
    /// traversal / collection surfaces observe the document node itself; the
    /// facade resolves the `Document` wrapper to this root node handle through
    /// the sealed `with_document` seam (the only legal way to read a Core
    /// `NodeId` from a `DocumentHandle`).
    #[napi(catch_unwind)]
    pub fn document_root(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        let root = with_document(&self.shared, |doc| Ok(doc.document_root()))
            .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node(env, root)
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
}

impl Drop for NodeHandle {
    /// Evicts this wrapper's cache entry.
    ///
    /// This [`Drop`] runs when the wrapper's JS object was collected (the napi
    /// finalizer drops the wrapped Rust value) or at process teardown. The
    /// cache holds at most one entry per [`NodeId`], and that entry belongs to
    /// this very value — a replacement wrapper is only minted after this entry
    /// upgraded to `None` (i.e. after this value was already dropped) — so
    /// removing by id is correct. It keeps dead entries from accumulating and
    /// guarantees identity never bleeds across reused arena slots once Core
    /// enables slot recycling.
    fn drop(&mut self) {
        self.shared
            .wrappers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.id);
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

    #[napi(catch_unwind)]
    pub fn parent_node(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        match self
            .parent_node_inner()
            .map_err(|err| err.into_napi(&env))?
        {
            None => Ok(None),
            Some(id) => self.shared.wrap_node(env, id).map(Some),
        }
    }

    #[napi(catch_unwind)]
    pub fn first_child(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        match self
            .first_child_inner()
            .map_err(|err| err.into_napi(&env))?
        {
            None => Ok(None),
            Some(id) => self.shared.wrap_node(env, id).map(Some),
        }
    }

    #[napi(catch_unwind)]
    pub fn last_child(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        match self.last_child_inner().map_err(|err| err.into_napi(&env))? {
            None => Ok(None),
            Some(id) => self.shared.wrap_node(env, id).map(Some),
        }
    }

    #[napi(catch_unwind)]
    pub fn previous_sibling(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        match self
            .previous_sibling_inner()
            .map_err(|err| err.into_napi(&env))?
        {
            None => Ok(None),
            Some(id) => self.shared.wrap_node(env, id).map(Some),
        }
    }

    #[napi(catch_unwind)]
    pub fn next_sibling(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        match self
            .next_sibling_inner()
            .map_err(|err| err.into_napi(&env))?
        {
            None => Ok(None),
            Some(id) => self.shared.wrap_node(env, id).map(Some),
        }
    }

    #[napi(catch_unwind)]
    pub fn child_nodes(&self, env: Env) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        let ids = self
            .child_nodes_inner()
            .map_err(|err| err.into_napi(&env))?;
        ids.iter()
            .map(|id| self.shared.wrap_node(env, *id))
            .collect()
    }

    /// Returns the owning document of this node.
    ///
    /// Resolves through [`SharedDocument::wrap_document`], so every node of a
    /// document hands back the same JS `DocumentHandle` the window exposes
    /// (`node.ownerDocument() === window.document()` identity, matching
    /// happy-dom). Works for detached nodes too.
    #[napi(catch_unwind)]
    pub fn owner_document(&self, env: Env) -> napi::Result<Reference<DocumentHandle>> {
        check_affinity(&self.shared, &env)?;
        self.shared.wrap_document(env)
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
        }
    }

    fn live_before() -> u64 {
        live_document_count()
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
