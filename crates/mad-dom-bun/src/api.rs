//! Free functions exported at the native-module boundary — the "minimal Core
//! API" callable from Bun (T19).
//!
//! The functions are deliberately thin: each one converts values and delegates
//! to Core or to [`handle`](crate::handle). No DOM rule or tree state lives
//! here.
//!
//! # Safety preconditions (this module is FFI surface)
//!
//! * Every `#[napi]` entry point is marked `#[napi(catch_unwind)]` (crate
//!   safety model).
//! * No raw pointer crosses this boundary. The only handle-like value a
//!   function can hand back is the [`DocumentHandle`] class instance, which
//!   owns its document through an `Arc`.
//! * No `unsafe` is written in this module; FFI/unsafe is confined to the
//!   `napi` / `napi-sys` crates.

use napi_derive::napi;

use crate::handle::{live_document_count as handle_live_document_count, DocumentHandle};

/// Identity of this binding crate, used by the workspace sanity test.
#[napi]
pub fn binding_identity() -> &'static str {
    "mad-dom-bun"
}

/// ABI version of the native binding (ADR-0005 §8).
///
/// The main package loader compares this against its expected constant at load
/// time and fails with `MAD_DOM_ABI_MISMATCH` on mismatch. The full loader
/// wiring lands with T49; this function pins the binding-side probe.
#[napi(catch_unwind)]
pub fn abi_version() -> u32 {
    ABI_VERSION
}

/// The current ABI version. Bump whenever the native surface changes in a way
/// a stale package + native pair could misdetect.
pub(crate) const ABI_VERSION: u32 = 1;

/// Creates a new document with its own node arena and returns an opaque
/// [`DocumentHandle`] wrapper. The document is destroyed when `destroy()` is
/// called or when the last handle to it (document or node) is collected by the
/// JavaScript GC.
#[napi(catch_unwind)]
pub fn create_document() -> DocumentHandle {
    DocumentHandle::new()
}

/// Number of documents currently alive in this process (created minus
/// destroyed / GC-collected). Diagnostic for the GC and destroy smoke tests.
#[napi(catch_unwind)]
pub fn live_document_count() -> u32 {
    handle_live_document_count() as u32
}
