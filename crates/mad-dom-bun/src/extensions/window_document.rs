//! Native `Window`/`Document` binding (T22A).
//!
//! This module is the first M4 native extension to take over its T20A seam: it
//! delivers the minimal native `Window`/`Document` capability that `createWindow`
//! needs and freezes the internal contract every later native subtask (T23A node,
//! T24A/T24B mutation) builds on.
//!
//! # Frozen native contract (consumed by the T22B facade and T23A/T24A/T24B)
//!
//! * `createWindow(): WindowHandle` — mints a fresh Core
//!   [`Document`](mad_dom_core::dom::Document) (via [`DocumentHandle::new`])
//!   and hands it to the new `Window` as its *strongly owned* document.
//! * `WindowHandle.document(): DocumentHandle` — the window's live document;
//!   repeated reads hand back *one and the same* JS object. The window handle
//!   stores a strong [`Reference`] to the document wrapper, so the document is
//!   pinned exactly as long as the window is alive.
//! * `WindowHandle.destroy(): void` — eagerly destroys the document. After the
//!   call, every Core-touching operation on any handle — window, document or
//!   node — fails per the T21 rules with `ERR_MAD_DOM_DOCUMENT_DESTROYED`. The
//!   pure accessor `document()` keeps handing back the same (now-destroyed)
//!   document handle; every use of that handle fails.
//!
//! # Ownership chain (Window → Document)
//!
//! The `Window` is an *additional* strong holder of the shared document state:
//! [`DocumentHandle::new`] creates the [`Arc`](std::sync::Arc) and the window
//! clones it, so a lone surviving node wrapper keeps the document (and its
//! arena) alive even when both the window and document wrappers are collected —
//! exactly the chain documented in [`crate::handle`]. Explicit `destroy()`
//! drops the Core document eagerly; GC-driven destruction follows the T20 rule.
//!
//! # Frozen internal contract for later native subtasks
//!
//! The `DocumentContext` is the [`Arc<SharedDocument>`](crate::handle::SharedDocument)
//! behind every handle. Later modules reach the live Core document and mint
//! wrappers exclusively through the stable seam in [`crate::handle`]:
//!
//! * **Document access** — [`crate::handle::with_document`] against
//!   [`DocumentHandle::shared`](crate::handle::DocumentHandle::shared) /
//!   [`NodeHandle::shared`](crate::handle::NodeHandle::shared);
//! * **Unique native handle → wrapper entry** —
//!   [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node);
//! * **Error outlet** — [`BindingError`](crate::error::BindingError) and its
//!   `into_napi` mapping; never a second error table;
//! * **Affinity guard** — [`crate::handle::check_affinity`], owned by T21B / T21.
//!
//! This module does **not** implement node navigation or mutation (T23A /
//! T24A / T24B own those) and does **not** re-export any low-level method
//! already defined in [`crate::handle`]. Registry wiring stays with the T22
//! gate; the seam metadata below remains `"placeholder"` until then.
//!
//! # Safety preconditions
//!
//! Every `#[napi]` entry is marked `#[napi(catch_unwind)]` and checks the T21B
//! affinity guard before touching any Core state, matching the crate safety
//! model (no `unsafe` is written here; FFI stays inside the `napi` crates).

use napi::bindgen_prelude::Reference;
use napi::Env;
use napi_derive::napi;

use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, DocumentHandle};

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "window_document",
    owner: "T22A",
    gate: "T22",
    status: "placeholder",
};

/// JavaScript-facing opaque wrapper for a native `Window`.
///
/// A `Window` strongly owns its [`DocumentHandle`]: the shared document state
/// (`Arc`) cloned out of the document at construction keeps the Core arena
/// alive, and the strong [`Reference`] to the document wrapper pins the JS
/// document object while the window is alive, so
/// `window.document() === window.document()` holds.
///
/// Constructed only from Rust ([`create_window`]); JavaScript receives it as an
/// opaque handle with no public constructor.
#[napi]
pub struct WindowHandle {
    document: Reference<DocumentHandle>,
}

#[napi]
impl WindowHandle {
    /// Returns the window's live `Document`.
    ///
    /// The return value is the *same* JS `DocumentHandle` object on every read
    /// (the window holds a strong reference to it), so the facade can rely on
    /// stable document identity without a second cache.
    #[napi(catch_unwind)]
    pub fn document(&self, env: Env) -> napi::Result<Reference<DocumentHandle>> {
        check_affinity(self.document.shared(), &env)?;
        self.document.clone(env)
    }

    /// Destroys the window's document eagerly, dropping its arena.
    ///
    /// Node and document handles keep their ownership `Arc`, but every further
    /// Core-touching operation on any handle — window, document or node —
    /// fails with
    /// [`BindingError::Destroyed`](crate::error::BindingError::Destroyed) per
    /// the T21 rules. `document()` still hands back the same (now-destroyed)
    /// document handle. Idempotent: destroying an already-destroyed window is
    /// a no-op.
    #[napi(catch_unwind)]
    pub fn destroy(&self, env: Env) -> napi::Result<()> {
        check_affinity(self.document.shared(), &env)?;
        self.document.destroy_inner();
        Ok(())
    }
}

/// Creates a new `Window` strongly owning a fresh `Document` and returns the
/// opaque [`WindowHandle`] for it.
///
/// The document is destroyed when `destroy()` is called or when the last handle
/// to it (window, document or node) is collected by the JavaScript GC.
///
/// Rust callers never invoke this function directly: napi-derive registers it
/// as a module export through a load-time ctor, so only the non-test build
/// references it. The allow keeps the `cfg(test)` target lint-clean.
#[napi(catch_unwind)]
#[allow(dead_code)]
pub fn create_window(env: Env) -> napi::Result<WindowHandle> {
    let document = DocumentHandle::new();
    // Mint the document wrapper through the per-document cache so
    // `window.document()` and every `NodeHandle.owner_document()` share the
    // same JS document object (stable identity).
    let document = document.shared().wrap_document(env)?;
    Ok(WindowHandle { document })
}
