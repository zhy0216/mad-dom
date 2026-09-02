// T50 hardening: the Core is runtime-independent and must stay free of
// handwritten `unsafe`/FFI. This is enforced at the compiler level (T18
// deferred the attribute to T50) so the zero-unsafe inventory cannot regress
// silently; the binding crate (mad-dom-bun) owns the fixed, documented FFI
// surface instead (SAFETY.md).
#![forbid(unsafe_code)]

pub mod arena;
pub mod dom;
pub mod error;
pub mod html;
pub mod selectors;
pub mod serialize;
pub mod traversal;
