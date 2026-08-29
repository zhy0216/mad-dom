//! Native append/insert mutation contract (T24A).
//!
//! # Role
//!
//! This module is the third M4 native extension to take over its T20A seam. It
//! freezes the native **append**/**insert** mutation contract that the T24C
//! facade and the T24 integration gate build on, and — like
//! [`crate::extensions::node_api`] before it — **audits** the already-delivered
//! low-level surface in [`crate::handle`] instead of minting new native
//! symbols: `appendChild` and `insertBefore` were shipped during T19/T20, so
//! re-exporting them under the same name is forbidden by the T20A seam rules
//! (see [`crate::extensions`]). Remove/replace is **not** part of this contract
//! — it belongs to [`crate::extensions::mutation_remove_api`] (T24B).
//!
//! # Frozen native contract (consumed by the T24C facade)
//!
//! The contract is expressed entirely through the stable seam in
//! [`crate::handle`]; the module defines no class of its own and adds no native
//! surface. The *method names, parameters and return values* below are the
//! frozen contract T24C depends on.
//!
//! ## Mutation (on the native `DocumentHandle` from [`crate::handle`])
//!
//! Both operations delegate verbatim to the Core unified mutation entry
//! ([`Document::append_child`](mad_dom_core::dom::Document::append_child) /
//! [`Document::insert_before`](mad_dom_core::dom::Document::insert_before))
//! through [`crate::handle::with_document`]; the binding converts the
//! [`NodeHandle`](crate::handle::NodeHandle) arguments to their Core
//! [`NodeId`](mad_dom_core::arena::NodeId) via
//! [`NodeHandle::id`](crate::handle::NodeHandle::id) and implements **no tree
//! rule** — every structural check and every relation write is Core's.
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `Node.appendChild` | `appendChild` | `(parent: NodeHandle, child: NodeHandle) → void` | inserts `child` as `parent`'s last child; a `DocumentFragment` child is spliced (its children are moved, the fragment is emptied); a node with a parent is moved, and appending an already-last child is a no-op |
//! | `Node.insertBefore` | `insertBefore` | `(parent: NodeHandle, child: NodeHandle, reference: NodeHandle) → void` | inserts `child` immediately before `reference`, which must be a child of `parent`; moving, fragment splicing and no-op rules follow [`Document::append_child`](mad_dom_core::dom::Document::append_child) |
//!
//! The native returns are `void` (the audited T19/T20 shape); the WHATWG
//! return of the inserted node is a facade adaptation, not a native symbol.
//!
//! # Identity, ownership and delegation
//!
//! * **Stable wrapper identity** — mutation itself returns no wrapper, but
//!   every *read* of the resulting tree (navigation through
//!   [`crate::handle::NodeHandle`]) funnels through
//!   [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node),
//!   so after an append/insert the moved or inserted node reads back as one
//!   and the same JS object while its wrapper is alive.
//! * **No second DOM state** — both entries delegate verbatim to Core through
//!   [`crate::handle::with_document`]; a Core [`NodeId`](mad_dom_core::arena::NodeId)
//!   is never fabricated and never crosses the boundary as a primitive.
//! * **Document ownership** — every node wrapper keeps its document's arena
//!   alive (T20 ownership chain); a lone surviving node wrapper therefore
//!   keeps the whole document readable under GC.
//!
//! # Error semantics (frozen, unchanged from the audited surface)
//!
//! Every failure is classified by the T21A taxonomy and propagated through
//! [`BindingError::into_napi`](crate::error::BindingError::into_napi); a failed
//! operation never modifies the tree (Core validates all preconditions before
//! touching a single relation field):
//!
//! | condition | error |
//! | --- | --- |
//! | document destroyed (explicit `destroy` or collected) | every mutation fails with `ERR_MAD_DOM_DOCUMENT_DESTROYED` |
//! | `parent`/`child`/`reference` from another document | `ERR_MAD_DOM_WRONG_DOCUMENT` |
//! | stale or invalid handle | `ERR_MAD_DOM_INVALID_HANDLE` / `ERR_MAD_DOM_STALE_HANDLE` |
//! | invalid parent kind, `child` is a `Document`, `child` is `parent` itself or its ancestor | `ERR_MAD_DOM_HIERARCHY` (`HierarchyRequestError`) |
//! | `reference` is not a child of `parent` (a live node in the wrong position, or a detached node) | `ERR_MAD_DOM_HIERARCHY` |
//! | call from a foreign thread/isolate | `ERR_MAD_DOM_AFFINITY_*` (T21B guard, checked before any Core state is touched) |
//!
//! # Safety preconditions
//!
//! The audited entries in [`crate::handle`] are all marked `#[napi(catch_unwind)]`
//! and check the T21B affinity guard before touching Core state, matching the
//! crate safety model. This module adds no FFI of its own; `unsafe` stays
//! inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T24A**; integration gate: **T24**. Do not write to this file from
//! any other task. Registry wiring and the `status` flip to `"implemented"`
//! belong to the T24 gate; the seam metadata below stays `"placeholder"` until
//! then. The constants in this module are the Rust-side pin of the frozen
//! surface; the machine-readable contract fixture
//! (`tests/bun/fixtures/native-mutation-insert.contract.json`) and
//! `tests/bun/mutation-insert-api.test.js` carry the end-to-end evidence.

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "mutation_insert_api",
    owner: "T24A",
    gate: "T24",
    status: "placeholder",
};

/// The frozen native append/insert mutation surface on
/// [`DocumentHandle`](crate::handle::DocumentHandle).
///
/// Exactly the audited T19/T20 low-level methods — no renamed or added symbol,
/// so no export is duplicated with [`crate::handle`].
#[allow(dead_code)]
pub(crate) const MUTATION_INSERT_CONTRACT: &[&str] = &["appendChild", "insertBefore"];

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen contract surface is exactly the audited `handle.rs` surface:
    /// mutation_insert_api adds no symbol and renames none, so there is no
    /// duplicate export and the ABI stays byte-for-byte the T19/T20 shape. This
    /// is the Rust-side regression pin; `tests/bun/mutation-insert-api.test.js`
    /// re-checks the same names against the live module.
    #[test]
    fn frozen_contract_surface_is_the_audited_handle_surface() {
        assert_eq!(
            MUTATION_INSERT_CONTRACT,
            &["appendChild", "insertBefore"],
            "native append/insert contract must stay exactly the T19/T20 handle surface"
        );
    }

    /// The insert contract pins exactly the two insert-family methods and
    /// nothing else: append/insert is T24A's surface, and the remove/replace
    /// family stays with T24B (`mutation_remove_api`), so the seam split is
    /// frozen on the Rust side too.
    #[test]
    fn insert_contract_is_append_and_insert_only() {
        assert_eq!(MUTATION_INSERT_CONTRACT.len(), 2);
        assert!(
            MUTATION_INSERT_CONTRACT
                .iter()
                .all(|name| *name == "appendChild" || *name == "insertBefore"),
            "mutation_insert_api must only pin appendChild and insertBefore"
        );
        assert!(
            MUTATION_INSERT_CONTRACT
                .iter()
                .all(|name| !name.starts_with("remove") && !name.starts_with("replace")),
            "the T24B remove/replace surface must never leak into the insert contract"
        );
    }
}
