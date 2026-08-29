//! Production Bun / JavaScriptCore native binding for MAD DOM (T19).
//!
//! # Role
//!
//! This crate is the thin production FFI layer between JavaScript (loaded by
//! Bun through Node-API) and the runtime-agnostic Rust DOM Core
//! ([`mad_dom_core`]). Following ADR-0001 (three-layer architecture),
//! ADR-0003 (binding technology) and ADR-0005 (native build & release
//! architecture), it performs *only*:
//!
//! * value conversion (strings, numbers, arrays, `null`);
//! * opaque-handle wrapping — JS objects that carry a Core
//!   [`NodeId`](mad_dom_core::arena::NodeId) plus a document ownership
//!   reference (see [`handle`]);
//! * wrapper identity — a per-document *weak* wrapper cache (T20) so the same
//!   node always reads back as the same JS object while it is alive, without
//!   pinning wrappers against collection;
//! * lifecycle — document creation, explicit `destroy()` and GC-driven
//!   destruction;
//! * minimal error mapping (see [`error`]);
//! * the ABI probe ([`api::abi_version`]).
//!
//! It deliberately does **not** copy tree state and does not implement any DOM
//! rule: every structural operation is delegated verbatim to
//! [`Document`](mad_dom_core::dom::Document). No second authoritative DOM
//! state exists on this side of the boundary (ADR-0001 §2 "Core 优先").
//!
//! # Safety model
//!
//! * **All FFI/`unsafe` lives inside the `napi` / `napi-sys` crates.** The
//!   handwritten code in this crate contains no `unsafe` blocks; the only FFI
//!   surface is the `#[napi]`-annotated entries in [`handle`] and [`api`].
//! * **Panic containment**: every `#[napi]` entry point is marked
//!   `#[napi(catch_unwind)]`, so a Rust panic is converted into a JavaScript
//!   `Error` instead of unwinding across the FFI boundary (which would abort
//!   the process). This requires the `panic = unwind` profile; it must never
//!   be switched to `panic = abort` (ADR-0005 §1).
//! * **No raw pointers cross the boundary.** JavaScript only ever receives
//!   opaque class instances ([`handle::DocumentHandle`],
//!   [`handle::NodeHandle`]) and primitives. A node handle stores a Core
//!   [`NodeId`](mad_dom_core::arena::NodeId) plus an `Arc` document ownership
//!   reference — never a pointer into the arena.
//! * **Handle opacity**: [`NodeId`](mad_dom_core::arena::NodeId) values are
//!   created and validated only inside `mad-dom-core`; the binding stores and
//!   forwards them verbatim and can neither fabricate nor decompose one.
//!   Cross-document misuse is rejected by Core with
//!   [`CoreError::WrongDocument`](mad_dom_core::error::CoreError::WrongDocument).
//! * **Document liveness**: every node wrapper holds an `Arc` to the shared
//!   document state, so any reachable node keeps its document's arena alive.
//!   `destroy()` clears the document eagerly; operations afterwards fail with
//!   a structured error instead of touching freed memory.
//! * **Wrapper identity, not pinning (T20)**: each document keeps a *weak*
//!   cache of its node wrappers, so repeated reads of a node yield one and
//!   the same JS object, while a wrapper nobody references is collected
//!   normally and its cache entry is evicted by the wrapper's finalizer. The
//!   cache never strong-refs a wrapper object.
//! * **Ownership chain**: the (T22) Window and every [`DocumentHandle`] /
//!   [`NodeHandle`] hold the same strong `Arc` to the shared document state,
//!   so any single reachable handle — document or node — keeps the whole
//!   arena alive.
//! * **No cross-thread sharing**: this binding targets Bun's single JS
//!   thread. Every native entry first checks the T21B affinity guard in
//!   [`affinity`] (wired by T21 through [`handle::check_affinity`]), so a
//!   call that cannot be attributed to the document's creating thread/isolate
//!   fails with a structured `ERR_MAD_DOM_AFFINITY_*` error before any Core
//!   state is touched. The shared document state is additionally guarded by a
//!   `Mutex` so accidental concurrent use fails safe rather than races. First
//!   phase: no cross-thread DOM.
//!
//! # Extension seam (T20A)
//!
//! M4 expands this binding in dedicated extension modules registered in
//! [`extensions`], each owned by one subtask; the frozen seam contract and the
//! ownership table live in [`extensions`] and [`handle`]. This crate root only
//! declares the module boundaries — the shared files (`lib.rs`, [`handle`],
//! [`api`], the registry) have a single integration owner (the T2x gates) and
//! are never written by a subtask.

mod affinity;
mod api;
mod error;
mod extensions;
mod handle;

pub use api::{abi_version, binding_identity, create_document, live_document_count};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanity() {
        assert_eq!(binding_identity(), "mad-dom-bun");
        assert_eq!(mad_dom_core::core_identity(), "mad-dom-core");
    }
}
