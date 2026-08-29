//! Native node creation and navigation contract (T23A).
//!
//! # Role
//!
//! This module is the second M4 native extension to take over its T20A seam. It
//! freezes the native node **creation** and **navigation** contract that the
//! T23B facade and the T23 integration gate build on. Unlike
//! [`crate::extensions::window_document`] — which minted genuinely new native
//! symbols (`create_window`, `WindowHandle`) — every operation in this contract
//! was already delivered by the low-level surface in [`crate::handle`] during
//! T19/T20. T23A therefore **audits** that surface, pins it here as the frozen
//! contract, and adds **no** new `#[napi]` export: re-exporting an existing
//! low-level method under the same name is forbidden by the T20A seam rules
//! (see [`crate::extensions`] and the acceptance "既有低层导出没有重复符号").
//!
//! # Frozen native contract (consumed by the T23B facade)
//!
//! The contract is expressed entirely through the stable seam in
//! [`crate::handle`]; the module defines no class of its own and adds no native
//! surface. The *method names, parameters and return values* below are the
//! frozen contract T23B depends on.
//!
//! ## Creation (on the native `DocumentHandle` from [`crate::handle`])
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `document.createElement` | `createElement` | `(name: String) → Reference<NodeHandle>` | mints a *detached* `Element`; an invalid name fails with `ERR_MAD_DOM_INVALID_CHARACTER` |
//! | `document.createTextNode` | `createText` | `(data: String) → Reference<NodeHandle>` | mints a *detached* `Text` node; the facade adapts the WHATWG name — `createTextNode` is **not** a native symbol (no duplicate of `createText`) |
//!
//! ## Navigation (on the native `NodeHandle` from [`crate::handle`])
//!
//! Every read delegates to Core and funnels its result through
//! [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node), so a
//! live wrapper is handed back *one and the same* JS object on every read:
//!
//! | native method | params → returns | behavior |
//! | --- | --- | --- |
//! | `nodeType` | `() → u32` | WHATWG `Node.nodeType` (`1` Element, `3` Text, `8` Comment, `9` Document, `11` DocumentFragment) |
//! | `nodeName` | `() → String` | lowercased tag name for `Element`, otherwise `#text` / `#comment` / `#document` / `#document-fragment` |
//! | `parentNode` | `() → Option<Reference<NodeHandle>>` | `null` when the node is detached |
//! | `firstChild` | `() → Option<Reference<NodeHandle>>` | `null` when the node has no children |
//! | `lastChild` | `() → Option<Reference<NodeHandle>>` | `null` when the node has no children |
//! | `previousSibling` | `() → Option<Reference<NodeHandle>>` | `null` at the head of the sibling chain |
//! | `nextSibling` | `() → Option<Reference<NodeHandle>>` | `null` at the tail of the sibling chain |
//! | `childNodes` | `() → Vec<Reference<NodeHandle>>` | ordered children; an empty array for a leaf node (the live `childNodes` *facade* is T25D's) |
//!
//! # Identity, ownership and delegation
//!
//! * **Stable wrapper identity** — every wrapper-producing path (creation,
//!   navigation) funnels through [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node),
//!   the single per-document *weak* wrapper cache (T20): while a node wrapper is
//!   alive, repeated reads of the same node hand JavaScript one and the same
//!   object (strict equality), and a freshly minted `createElement`/`createText`
//!   is always a *distinct* node.
//! * **No second DOM state** — all tree reads delegate verbatim to Core through
//!   [`crate::handle::with_document`]; a Core [`NodeId`](mad_dom_core::arena::NodeId)
//!   is never fabricated and never crosses the boundary as a primitive.
//! * **Document ownership** — every node wrapper keeps its document's arena
//!   alive (T20 ownership chain); a lone surviving node wrapper therefore
//!   keeps the whole document readable under GC.
//!
//! # Error semantics (frozen, unchanged from the audited surface)
//!
//! | condition | error |
//! | --- | --- |
//! | document destroyed (explicit `destroy` or collected) | every creation/navigation read fails with `ERR_MAD_DOM_DOCUMENT_DESTROYED` |
//! | invalid element name | `ERR_MAD_DOM_INVALID_CHARACTER` |
//! | node used against a foreign document (mutation) | `ERR_MAD_DOM_WRONG_DOCUMENT`; navigation reads stay confined to the owning document |
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
//! Owned by **T23A**; integration gate: **T23**. Do not write to this file from
//! any other task. Registry wiring and the `status` flip to `"implemented"`
//! belong to the T23 gate; the seam metadata below stays `"placeholder"` until
//! then. The constants in this module are the Rust-side pin of the frozen
//! surface; the machine-readable contract fixture
//! (`tests/bun/fixtures/native-node-contract.json`) and
//! `tests/bun/native-node-contract.test.js` carry the end-to-end evidence.

use crate::extensions::ExtensionSeam;

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "node_api",
    owner: "T23A",
    gate: "T23",
    status: "placeholder",
};

/// The frozen native node-creation surface on [`DocumentHandle`](crate::handle::DocumentHandle).
///
/// Exactly the audited T19/T20 low-level methods — no renamed or added symbol.
/// `createText` is the native implementation of the WHATWG `createTextNode`;
/// the facade adapts the name, so no native `createTextNode` exists.
#[allow(dead_code)]
pub(crate) const DOCUMENT_CREATION_CONTRACT: &[&str] = &["createElement", "createText"];

/// The frozen native node-navigation surface on [`NodeHandle`](crate::handle::NodeHandle).
///
/// Exactly the audited T19/T20 low-level methods — no renamed or added symbol.
#[allow(dead_code)]
pub(crate) const NODE_NAVIGATION_CONTRACT: &[&str] = &[
    "nodeType",
    "nodeName",
    "parentNode",
    "firstChild",
    "lastChild",
    "previousSibling",
    "nextSibling",
    "childNodes",
];

#[cfg(test)]
mod tests {
    use super::*;
    use mad_dom_core::dom::NodeType;

    use crate::handle::node_type_value;

    /// The frozen contract surface is exactly the audited `handle.rs` surface:
    /// node_api adds no symbol and renames none, so there is no duplicate export
    /// and the ABI stays byte-for-byte the T19/T20 shape. This is the Rust-side
    /// regression pin; `tests/bun/native-node-contract.test.js` re-checks the
    /// same names against the live module.
    #[test]
    fn frozen_contract_surface_is_the_audited_handle_surface() {
        assert_eq!(
            DOCUMENT_CREATION_CONTRACT,
            &["createElement", "createText"],
            "native creation contract must stay exactly the T19/T20 handle surface"
        );
        assert_eq!(
            NODE_NAVIGATION_CONTRACT,
            &[
                "nodeType",
                "nodeName",
                "parentNode",
                "firstChild",
                "lastChild",
                "previousSibling",
                "nextSibling",
                "childNodes",
            ],
            "native navigation contract must stay exactly the T19/T20 handle surface"
        );
    }

    /// The numbers `nodeType()` hands to JavaScript are the WHATWG `Node.nodeType`
    /// constants — the binding's pure value conversion, frozen for the facade.
    #[test]
    fn node_type_values_are_the_whatwg_numbers() {
        assert_eq!(node_type_value(NodeType::Element), 1);
        assert_eq!(node_type_value(NodeType::Text), 3);
        assert_eq!(node_type_value(NodeType::Comment), 8);
        assert_eq!(node_type_value(NodeType::Document), 9);
        assert_eq!(node_type_value(NodeType::DocumentFragment), 11);
    }
}
