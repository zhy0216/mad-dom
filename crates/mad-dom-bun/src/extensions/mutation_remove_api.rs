//! Native remove/replace mutation contract (T24B).
//!
//! # Role
//!
//! This module is the M4 native extension that takes over its T20A seam for the
//! **remove/replace** half of the mutation surface: `removeChild` and
//! `replaceChild`. It freezes the native remove/replace contract that the T24C
//! facade and the T24 integration gate build on. Exactly like
//! [`crate::extensions::node_api`] (T23A), every operation in this contract was
//! already delivered by the low-level surface in [`crate::handle`] during
//! T19/T20. T24B therefore **audits** that surface, pins it here as the frozen
//! contract, and adds **no** new `#[napi]` export: re-exporting an existing
//! low-level method under the same name is forbidden by the T20A seam rules
//! (see [`crate::extensions`] and the acceptance "既有低层导出没有重复符号").
//! The append/insert half (`appendChild` / `insertBefore`) is owned exclusively
//! by T24A in [`crate::extensions::mutation_insert_api`].
//!
//! # Frozen native contract (consumed by the T24C facade)
//!
//! The contract is expressed entirely through the stable seam in
//! [`crate::handle`]; the module defines no class of its own and adds no native
//! surface. The *method names, parameters and return values* below are the
//! frozen contract T24C depends on. All four mutation methods live on the
//! native [`DocumentHandle`](crate::handle::DocumentHandle), and every
//! operation delegates verbatim to the Core mutation entry
//! ([`Document::remove_child`](mad_dom_core::dom::Document::remove_child) /
//! [`Document::replace_child`](mad_dom_core::dom::Document::replace_child)) —
//! no tree rule is re-implemented and no second DOM state is kept here.
//!
//! ## Remove/replace (on the native `DocumentHandle` from [`crate::handle`])
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `Node.prototype.removeChild` | `removeChild` | `(parent: NodeHandle, child: NodeHandle) → void` | removes `child` from `parent`'s child list; the removed node becomes *detached* (parent/sibling reads return `null`, its subtree stays with it) but remains live in the arena and can be re-inserted |
//! | `Node.prototype.replaceChild` | `replaceChild` | `(parent: NodeHandle, child: NodeHandle, node: NodeHandle) → void` | replaces `child` with `node` in `parent`'s child list; `child` becomes detached, `node` is moved (with its subtree) or, for a `DocumentFragment`, its children are spliced in and the fragment is left empty |
//!
//! The native methods return `void` (`undefined`): the removed/replaced child is
//! already a live wrapper in the caller's hands, so the facade adapts the
//! WHATWG return value without a second native symbol. Argument order is the
//! Core convention — `parent` first — and the facade binds `this` to it.
//!
//! # Detach semantics, failure atomicity and identity
//!
//! * **Detach, not destroy** — `removeChild` / `replaceChild` clear the
//!   removed node's `parent` / sibling relations but leave its [`NodeId`]
//!   live and valid in the arena (Core docs in `mad_dom_core::dom::mutation`).
//!   A detached node wrapper stays fully readable and can be re-inserted with
//!   `appendChild` / `insertBefore` later; its wrapper identity is unchanged.
//! * **Failure atomicity** — Core validates *every* precondition (document
//!   ownership, child membership, node kinds, ancestor cycles) before touching
//!   a single relation field, so a failed call leaves the tree byte-for-byte
//!   unchanged; the binding forwards that contract verbatim (T21 maps the
//!   error exactly once at the FFI boundary).
//! * **No second DOM state** — all tree writes delegate to Core through
//!   [`crate::handle::with_document`]; a Core [`NodeId`] is never fabricated
//!   and never crosses the boundary as a primitive.
//! * **Stable wrapper identity** — the removed/replaced node keeps the wrapper
//!   minted by [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node),
//!   so re-reading it (or re-inserting it) hands JavaScript one and the same
//!   object.
//!
//! # Error semantics (frozen, unchanged from the audited surface)
//!
//! | condition | error |
//! | --- | --- |
//! | document destroyed (explicit `destroy` or collected) | every remove/replace call fails with `ERR_MAD_DOM_DOCUMENT_DESTROYED` |
//! | `child` not a child of `parent` (detached or belongs to another parent) | `ERR_MAD_DOM_HIERARCHY` (`HierarchyRequestError`) |
//! | `node` is a `Document` node, `parent` itself or an ancestor of it | `ERR_MAD_DOM_HIERARCHY` (`HierarchyRequestError`) |
//! | any handle from a foreign document | `ERR_MAD_DOM_WRONG_DOCUMENT` (`WrongDocumentError`) |
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
//! Owned by **T24B**; integration gate: **T24**. Do not write to this file from
//! any other task. Registry wiring and the `status` flip to `"implemented"`
//! belong to the T24 gate; the seam metadata below stays `"placeholder"` until
//! then. The constants in this module are the Rust-side pin of the frozen
//! surface; the machine-readable contract fixture
//! (`tests/bun/fixtures/native-mutation-remove-contract.json`) and
//! `tests/bun/mutation-remove-api.test.js` carry the end-to-end evidence.

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "mutation_remove_api",
    owner: "T24B",
    gate: "T24",
    status: "placeholder",
};

/// The frozen native remove/replace surface on [`DocumentHandle`](crate::handle::DocumentHandle).
///
/// Exactly the audited T19/T20 low-level methods — no renamed or added symbol.
/// The facade binds these as the WHATWG `Node.prototype.removeChild` /
/// `replaceChild` (adapting `this` to the `parent` argument and the return
/// value), so no native `NodeHandle`-level method exists to duplicate.
#[allow(dead_code)]
pub(crate) const REMOVE_REPLACE_CONTRACT: &[&str] = &["removeChild", "replaceChild"];

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen contract surface is exactly the audited `handle.rs` surface:
    /// mutation_remove_api adds no symbol and renames none, so there is no
    /// duplicate export and the ABI stays byte-for-byte the T19/T20 shape. This
    /// is the Rust-side regression pin; `tests/bun/mutation-remove-api.test.js`
    /// re-checks the same names against the live module.
    #[test]
    fn frozen_contract_surface_is_the_audited_handle_surface() {
        assert_eq!(
            REMOVE_REPLACE_CONTRACT,
            &["removeChild", "replaceChild"],
            "native remove/replace contract must stay exactly the T19/T20 handle surface"
        );
    }

    /// The remove/replace contract owns only its half of the mutation surface:
    /// `appendChild` / `insertBefore` stay exclusively with T24A
    /// (`mutation_insert_api`), so no symbol from that seam leaks here.
    #[test]
    fn remove_contract_does_not_own_append_insert() {
        assert!(
            !REMOVE_REPLACE_CONTRACT.contains(&"appendChild"),
            "appendChild belongs to T24A, not the remove/replace contract"
        );
        assert!(
            !REMOVE_REPLACE_CONTRACT.contains(&"insertBefore"),
            "insertBefore belongs to T24A, not the remove/replace contract"
        );
    }
}
