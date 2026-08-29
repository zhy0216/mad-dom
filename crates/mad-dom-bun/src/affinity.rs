//! Isolate/thread affinity guard boundary (T20A seam placeholder).
//!
//! T20A registers only the module declaration and this minimal placeholder;
//! **T21B** owns the implementation after T20A archives and **T21** wires it
//! into the FFI entries. Intended contract (frozen by T20A for the seam):
//!
//! * a narrow API to create an ownership token, check the current call's
//!   affinity and return a stable guard error;
//! * an explicit statement of how an unreadable Bun/Node-API isolate identity
//!   is represented and which cases must conservatively reject;
//! * pure-Rust tests for same-affinity success, forged/mismatched tokens,
//!   token lifecycle and concurrent calls;
//! * no locks, no cross-thread DOM and no second document state (ADR-0001 §2).
//!
//! Extension modules must not implement affinity semantics themselves; they
//! consume the guard only through the T21 wiring. Seam contract and
//! dependency rules: [`crate::extensions`] and [`crate::handle`].

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "affinity",
    owner: "T21B",
    gate: "T21",
    status: "placeholder",
};
