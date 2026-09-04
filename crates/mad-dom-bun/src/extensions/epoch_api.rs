//! Native structural-epoch surface (navigation-memo invalidation).
//!
//! # Role
//!
//! The facade memoizes `Node` navigation reads (`firstChild` / `nextSibling`
//! / …) so a repeated tree walk over an unchanged tree stays in JavaScript.
//! For the memo to be *safe*, JavaScript must be able to detect "the tree
//! relations changed since I cached this" without an FFI round trip — this
//! module provides that signal.
//!
//! `DocumentHandle.epochView()` hands JavaScript a 4-byte `ArrayBuffer` view
//! over the document's epoch slot (a binding-owned `AtomicI32`, registered on
//! [`SharedDocument`](crate::handle::SharedDocument) via
//! `set_epoch_slot`). [`crate::handle::with_document`] — the single chokepoint
//! every native document access funnels through — bumps the slot whenever a
//! call changed Core's `structure_generation` (all tree-relation writes). The
//! facade compares the view's word against the stamp it cached with each memo
//! entry; a mismatch discards the entry. No facade enumeration of mutation
//! entry points can drift, because the bump lives below all of them.
//!
//! # Memory model
//!
//! The slot is a 4-byte `Box<AtomicI32>` deliberately leaked into the process:
//! JavaScript may hold the buffer view longer than any facade reference to the
//! document (a raw handle can still mutate while the facade is gone), so the
//! binding can never prove the view dead — 4 bytes per document is the price
//! of an airtight invalidation signal. The external `ArrayBuffer` is created
//! directly through Node-API (no finalize callback), so collecting the JS view
//! frees only the view.
//!
//! # Safety preconditions
//!
//! The single confined `unsafe` block creates the external ArrayBuffer over
//! the leaked slot and reads the slot pointer; the slot's immortality makes
//! every access valid for the process lifetime. Writes to the slot happen only
//! through [`crate::handle::SharedDocument::bump_epoch`] on the document's
//! affinity thread — the same thread JavaScript reads it from.

use std::sync::atomic::AtomicI32;

use napi::bindgen_prelude::{FromNapiValue, Unknown};
use napi::{check_status, Env};
use napi_derive::napi;

use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, DocumentHandle};

/// Seam metadata for the navigation-memo epoch boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "epoch_api",
    owner: "perf-navigation-memo",
    gate: "none",
    status: "implemented",
};

/// Adds the epoch surface to the existing [`DocumentHandle`] class through a
/// second `#[napi] impl` block — napi merges class properties registered for
/// the same Rust type (the same pattern `traversal_api` uses), so the shared
/// class keeps its audited surface with no duplicate export.
#[napi]
impl DocumentHandle {
    /// Returns a fresh 4-byte `ArrayBuffer` view over this document's
    /// structural epoch slot, registering the slot on first call.
    ///
    /// JavaScript wraps the buffer in an `Int32Array` and reads element 0:
    /// the value changes exactly when a native call mutated this document's
    /// tree relations (see module docs). Repeated calls return independent
    /// views over the same slot. The facade calls this once per document,
    /// when the document wrapper is first minted.
    #[napi(catch_unwind)]
    pub fn epoch_view(&self, env: Env) -> napi::Result<Unknown<'_>> {
        check_affinity(self.shared(), &env)?;
        let mut slot = self.shared().epoch_slot();
        if slot.is_null() {
            slot = Box::into_raw(Box::new(AtomicI32::new(0)));
            self.shared().set_epoch_slot(slot);
        }
        let mut buffer = std::ptr::null_mut();
        // SAFETY: `slot` points at a leaked `AtomicI32` valid for the process
        // lifetime (module docs "Memory model"); no finalize callback, so
        // collecting the view never touches the slot memory.
        check_status!(unsafe {
            napi::sys::napi_create_external_arraybuffer(
                env.raw(),
                slot.cast(),
                std::mem::size_of::<AtomicI32>(),
                None,
                std::ptr::null_mut(),
                &mut buffer,
            )
        })?;
        // SAFETY: `buffer` is the ArrayBuffer value just created on `env`.
        // JavaScript wraps it in an `Int32Array` itself.
        unsafe { Unknown::from_napi_value(env.raw(), buffer) }
    }
}
