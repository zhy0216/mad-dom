//! Native extended-node binding (T33).
//!
//! # Role
//!
//! This module is the M7 native extension that exposes the T33 Core contract
//! (crates/mad-dom-core/src/dom/character_data.rs and the
//! `ProcessingInstruction` model additions) to JavaScript: the
//! `CharacterData` surface (`data` / `length` / `substringData` /
//! `appendData` / `insertData` / `deleteData` / `replaceData`), `Text.splitText`,
//! `createProcessingInstruction`, the `ProcessingInstruction.target` and
//! `DocumentType` (`name` / `publicId` / `systemId`) reads, the
//! `document.doctype` read, and the clone family (`cloneNode` / `importNode` /
//! `adoptNode`) on the native [`NodeHandle`] / [`DocumentHandle`]. Like the M5
//! `html_api` and M6 `query_api` extensions it adds *new* native symbols to the
//! existing classes through second `#[napi] impl` blocks — napi merges class
//! properties registered for the same Rust type, so the classes keep their
//! audited surfaces with no duplicate export and no touch to the shared
//! `handle.rs` beyond the one `node_type_value` arm the new node type needs.
//!
//! # Frozen native contract (consumed by the T33 facade)
//!
//! Every entry delegates to the Core T33 contract through the stable seam
//! ([`with_document`](crate::handle::with_document),
//! [`DocumentHandle::shared`], [`NodeHandle::shared`], [`NodeHandle::id`]) and
//! maps lifecycle failures with the T21A error outlet. The *method names,
//! parameters and return values* below are the frozen contract the facade
//! depends on.
//!
//! ## Document surface (on the native `DocumentHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `document.createProcessingInstruction` | `createProcessingInstruction` | `(target, data) → NodeHandle` | a detached `ProcessingInstruction`; Core rejects a non-"Name" target and a `?>` in data with `ERR_MAD_DOM_INVALID_CHARACTER` |
//! | `document.importNode` | `importNode` | `(node, deep) → NodeHandle` | copies `node` (a whole subtree when `deep`) into this document under a brand-new handle; the source is never modified |
//! | `document.adoptNode` | `adoptNode` | `(node) → NodeHandle` | moves `node` and its subtree from its own document into this one; a same-document node is detached from its parent and returned unchanged |
//! | `document.doctype` | `doctype` | `() → NodeHandle \| null` | the document's parsed `DocumentType`, or `null`; a pure read that never materializes a skeleton |
//!
//! ## Node surface (on the native `NodeHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `CharacterData.data` | `data` | `() → String \| null` | the character data of a `Text`/`Comment`/`ProcessingInstruction` node; `null` for any other kind |
//! | `CharacterData.data` setter | `setData` | `(value) → ()` | atomic replacement; a no-op for non-character-data kinds; the value is stored verbatim, including NUL bytes (T48B) |
//! | `CharacterData.length` | `dataLength` | `() → number \| null` | the UTF-16 length of the data; `null` for non-character-data kinds |
//! | `Node.nodeValue` | `nodeValue` | `() → String \| null` | the data for character-data kinds, `null` otherwise |
//! | `Node.nodeValue` setter | `setNodeValue` | `(value) → ()` | same semantics as `setData` |
//! | `ProcessingInstruction.target` | `target` | `() → String \| null` | the PI target; `null` for other kinds |
//! | `DocumentType.name` | `name` | `() → String \| null` | the doctype name; `null` for other kinds |
//! | `DocumentType.publicId` | `publicId` | `() → String \| null` | the doctype public identifier; `null` for other kinds |
//! | `DocumentType.systemId` | `systemId` | `() → String \| null` | the doctype system identifier; `null` for other kinds |
//! | `CharacterData.substringData` | `substringData` | `(offset, count) → String` | the WHATWG substring (UTF-16 units, offset past the end yields `""`) |
//! | `CharacterData.appendData` | `appendData` | `(data) → ()` | appends; the combined value is stored verbatim, including NUL bytes |
//! | `CharacterData.insertData` | `insertData` | `(offset, data) → ()` | inserts at the UTF-16 offset; an out-of-range offset fails with `ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS` |
//! | `CharacterData.deleteData` | `deleteData` | `(offset, count) → ()` | deletes with clamped count |
//! | `CharacterData.replaceData` | `replaceData` | `(offset, count, data) → ()` | replaces with clamped count |
//! | `Text.splitText` | `splitText` | `(offset) → NodeHandle` | splits this `Text` and returns the new tail node; an out-of-range offset fails with `ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS`, a non-`Text` receiver with `ERR_MAD_DOM_HIERARCHY` |
//! | `Node.cloneNode` | `cloneNode` | `(deep) → NodeHandle` | a detached copy of this node (whole subtree when `deep`) under a fresh handle |
//!
//! The facade owns the WebIDL conversions (a `data = 42` write becomes
//! `setData("42")`, offsets are `>>> 0`-shaped to unsigned); this module
//! receives plain `u32` offsets and `String`s and forwards them verbatim, so
//! the Core "no string conversion" rule holds all the way to JavaScript.
//!
//! # Cross-document operations never reuse a NodeId
//!
//! `importNode` / `adoptNode` route every copied/moved node through the Core
//! clone family, which allocates a brand-new [`NodeId`] from *this* document's
//! arena for every node. A same-document `importNode` is Core `clone_node`; a
//! cross-document `importNode` / `adoptNode` locks the source document through
//! its own [`SharedDocument`] and delegates to the T17 `import_node` /
//! `adopt_node` contract. The adopted node's old source handle becomes stale
//! and can never be reused to reach the migrated node (the T17 handle
//! separation, pinned by `property_cross_document.rs`).
//!
//! # Single source of tree state
//!
//! All node state lives in exactly one place — the Core arena. This module
//! keeps no copy: reads are produced on demand from Core, writes route through
//! Core, and every node crossing back to JavaScript is minted through
//! [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node), so
//! wrapper identity stays the frozen per-document weak cache (T20).
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`,
//! a non-character-data receiver of a mutator with `ERR_MAD_DOM_HIERARCHY`, an
//! out-of-range offset with `ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS` and a NUL byte /
//! invalid target with `ERR_MAD_DOM_INVALID_CHARACTER`. Mutators validate
//! before touching Core state, so a failed call leaves the target unchanged.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T33**; like T29 and T31 there is no separate integration gate,
//! so T33 also wires the facade and the shared entry/type/ledger surfaces
//! itself. The seam metadata below is the Rust-side pin of the frozen surface;
//! `tests/bun/extended-nodes-api.test.js` and the `hc-diff-extended-nodes`
//! differential scenario carry the end-to-end evidence.

use napi::bindgen_prelude::Reference;
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;

use crate::error::BindingError;
use crate::extensions::mutation_observer_api::schedule_pending_observer_deliveries;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle};

/// Seam metadata for the M7 `character_data_api` boundary.
///
/// Like the M5 `html_api` / M6 `query_api` seams this constant is not
/// referenced by the frozen [`REGISTRY`](crate::extensions::REGISTRY) (T33
/// owns its own integration and there is no separate M7 gate), so it is
/// allowed to be otherwise unused.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "character_data_api",
    owner: "T33",
    gate: "T33",
    status: "implemented",
};

/// The frozen native extended-node surface on
/// [`DocumentHandle`](crate::handle::DocumentHandle).
#[allow(dead_code)]
pub(crate) const DOCUMENT_EXTENDED_NODES_CONTRACT: &[&str] = &[
    "createProcessingInstruction",
    "importNode",
    "adoptNode",
    "doctype",
];

/// The frozen native extended-node surface on
/// [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const NODE_EXTENDED_NODES_CONTRACT: &[&str] = &[
    "data",
    "setData",
    "dataLength",
    "nodeValue",
    "setNodeValue",
    "target",
    "name",
    "publicId",
    "systemId",
    "substringData",
    "appendData",
    "insertData",
    "deleteData",
    "replaceData",
    "splitText",
    "cloneNode",
];

/// Whether `node` belongs to the same document behind `shared`.
///
/// A [`NodeHandle`] clones the `Arc<SharedDocument>` of its own document, so
/// two handles compare equal (same allocation) exactly when they share a
/// document. Used to route `importNode` / `adoptNode` between the in-place
/// same-document paths and the T17 cross-document paths without ever
/// fabricating or comparing raw [`NodeId`]s.
fn same_document(
    shared: &std::sync::Arc<crate::handle::SharedDocument>,
    node: &NodeHandle,
) -> bool {
    std::sync::Arc::ptr_eq(shared, node.shared())
}

#[napi]
impl DocumentHandle {
    /// Returns the WHATWG `document.createProcessingInstruction`: a detached
    /// `ProcessingInstruction` node with `target` and `data`.
    #[napi(catch_unwind)]
    pub fn create_processing_instruction(
        &self,
        env: Env,
        target: String,
        data: String,
    ) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.create_processing_instruction(&target, &data)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        self.shared().wrap_node(env, id)
    }

    /// Returns the WHATWG `document.importNode`: a copy of `node` (and, when
    /// `deep`, its whole subtree) in this document.
    ///
    /// A same-document import is Core `clone_node`; a cross-document import
    /// delegates to the T17 `import_node` contract, leaving the source
    /// untouched and handing every copied node a brand-new handle from this
    /// document's arena.
    #[napi(catch_unwind)]
    pub fn import_node(
        &self,
        env: Env,
        node: &NodeHandle,
        deep: bool,
    ) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(self.shared(), &env)?;
        let id: NodeId = if same_document(self.shared(), node) {
            with_document(self.shared(), |doc| {
                doc.clone_node(node.id(), deep).map_err(BindingError::Core)
            })
        } else {
            with_document(node.shared(), |source| {
                with_document(self.shared(), |target| {
                    target
                        .import_node(source, node.id(), deep)
                        .map_err(BindingError::Core)
                })
            })
        }
        .map_err(|err| err.into_napi(&env))?;
        self.shared().wrap_node(env, id)
    }

    /// Returns the WHATWG `document.adoptNode`: `node` moved into this
    /// document.
    ///
    /// A same-document adopt detaches `node` from its parent (if any) and
    /// returns the same node; a cross-document adopt delegates to the T17
    /// `adopt_node` contract, which moves the subtree, frees the source slots
    /// (the old handle becomes stale) and re-homes it here under a fresh
    /// handle.
    #[napi(catch_unwind)]
    pub fn adopt_node(&self, env: Env, node: &NodeHandle) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(self.shared(), &env)?;
        let cross_document = !same_document(self.shared(), node);
        let id: NodeId = if !cross_document {
            with_document(self.shared(), |doc| {
                if let Some(parent) = doc.parent(node.id())? {
                    doc.remove_child(parent, node.id())?;
                }
                Ok(node.id())
            })
        } else {
            with_document(node.shared(), |source| {
                with_document(self.shared(), |target| {
                    target
                        .adopt_node(source, node.id())
                        .map_err(BindingError::Core)
                })
            })
        }
        .map_err(|err| err.into_napi(&env))?;
        // T41: a same-document adopt mutates only this document; a cross-document
        // adopt detaches in the source document (a removal record) and links in
        // this one (an addition record), so both documents' observer microtasks
        // are scheduled.
        schedule_pending_observer_deliveries(&env, self.shared());
        if cross_document {
            schedule_pending_observer_deliveries(&env, node.shared());
        }
        self.shared().wrap_node(env, id)
    }

    /// Returns the WHATWG `document.doctype`: the document's parsed
    /// `DocumentType` node, or `null`.
    ///
    /// A pure read of the existing tree — it never materializes the implied
    /// skeleton, so a fresh document returns `null` exactly like happy-dom's.
    #[napi(catch_unwind)]
    pub fn doctype(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let node = with_document(self.shared(), |doc| {
            doc.doctype().map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        match node {
            None => Ok(None),
            Some(id) => self.shared().wrap_node(env, id).map(Some),
        }
    }
}

#[napi]
impl NodeHandle {
    /// Returns the WHATWG `CharacterData.data`: the character data of this
    /// node, or `null` for a non-character-data kind.
    #[napi(catch_unwind)]
    pub fn data(&self, env: Env) -> napi::Result<Option<String>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.character_data(self.id())
                .map(|data| data.map(str::to_owned))
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets the WHATWG `CharacterData.data`; a no-op for non-character-data
    /// kinds.
    #[napi(catch_unwind)]
    pub fn set_data(&self, env: Env, value: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_data(self.id(), &value).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Returns the WHATWG `CharacterData.length`: the UTF-16 length of this
    /// node's character data, or `null` for a non-character-data kind.
    #[napi(catch_unwind)]
    pub fn data_length(&self, env: Env) -> napi::Result<Option<u32>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.character_data_length(self.id())
                .map(|length| length.map(|l| l as u32))
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Returns the WHATWG `Node.nodeValue`: the data for a character-data
    /// node, `null` otherwise.
    #[napi(catch_unwind)]
    pub fn node_value(&self, env: Env) -> napi::Result<Option<String>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.character_data(self.id())
                .map(|data| data.map(str::to_owned))
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets the WHATWG `Node.nodeValue`; a no-op for non-character-data kinds.
    #[napi(catch_unwind)]
    pub fn set_node_value(&self, env: Env, value: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_data(self.id(), &value).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Returns the WHATWG `ProcessingInstruction.target`, or `null` for a
    /// non-`ProcessingInstruction` node.
    #[napi(catch_unwind)]
    pub fn target(&self, env: Env) -> napi::Result<Option<String>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.processing_instruction_target(self.id())
                .map(|target| target.map(str::to_owned))
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Returns the WHATWG `DocumentType.name`, or `null` for a non-doctype
    /// node.
    #[napi(catch_unwind)]
    pub fn name(&self, env: Env) -> napi::Result<Option<String>> {
        self.doctype_field(&env, 0)
    }

    /// Returns the WHATWG `DocumentType.publicId`, or `null` for a
    /// non-doctype node.
    #[napi(catch_unwind)]
    pub fn public_id(&self, env: Env) -> napi::Result<Option<String>> {
        self.doctype_field(&env, 1)
    }

    /// Returns the WHATWG `DocumentType.systemId`, or `null` for a
    /// non-doctype node.
    #[napi(catch_unwind)]
    pub fn system_id(&self, env: Env) -> napi::Result<Option<String>> {
        self.doctype_field(&env, 2)
    }

    /// Shared read of one doctype payload field (`0` name, `1` public id,
    /// `2` system id); `null` for any non-doctype node.
    fn doctype_field(&self, env: &Env, index: usize) -> napi::Result<Option<String>> {
        check_affinity(self.shared(), env)?;
        with_document(self.shared(), |doc| {
            doc.doctype_payload(self.id())
                .map(|payload| match payload {
                    None => None,
                    Some((name, public_id, system_id)) => match index {
                        0 => Some(name),
                        1 => Some(public_id),
                        _ => Some(system_id),
                    },
                })
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(env))
    }

    /// Returns the WHATWG `CharacterData.substringData(offset, count)`.
    #[napi(catch_unwind)]
    pub fn substring_data(&self, env: Env, offset: u32, count: u32) -> napi::Result<String> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.substring_data(self.id(), offset as usize, count as usize)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Appends the WHATWG `CharacterData.appendData(data)`.
    #[napi(catch_unwind)]
    pub fn append_data(&self, env: Env, data: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.append_data(self.id(), &data)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Inserts the WHATWG `CharacterData.insertData(offset, data)`.
    #[napi(catch_unwind)]
    pub fn insert_data(&self, env: Env, offset: u32, data: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.insert_data(self.id(), offset as usize, &data)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Deletes the WHATWG `CharacterData.deleteData(offset, count)`.
    #[napi(catch_unwind)]
    pub fn delete_data(&self, env: Env, offset: u32, count: u32) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.delete_data(self.id(), offset as usize, count as usize)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Replaces the WHATWG `CharacterData.replaceData(offset, count, data)`.
    #[napi(catch_unwind)]
    pub fn replace_data(
        &self,
        env: Env,
        offset: u32,
        count: u32,
        data: String,
    ) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.replace_data(self.id(), offset as usize, count as usize, &data)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Returns the WHATWG `Text.splitText(offset)`: the new tail node.
    #[napi(catch_unwind)]
    pub fn split_text(&self, env: Env, offset: u32) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.split_text(self.id(), offset as usize)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        self.shared().wrap_node(env, id)
    }

    /// Returns the WHATWG `Node.cloneNode(deep)`: a detached copy of this node
    /// (whole subtree when `deep`) under a fresh handle.
    #[napi(catch_unwind)]
    pub fn clone_node(&self, env: Env, deep: bool) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.clone_node(self.id(), deep).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        self.shared().wrap_node(env, id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native surfaces are exactly the entries this module adds to
    /// `DocumentHandle` and `NodeHandle`. This is the Rust-side regression pin;
    /// `tests/bun/extended-nodes-api.test.js` re-checks the same names against
    /// the live module.
    #[test]
    fn frozen_contract_surfaces_are_the_extended_node_api() {
        assert_eq!(
            DOCUMENT_EXTENDED_NODES_CONTRACT,
            &[
                "createProcessingInstruction",
                "importNode",
                "adoptNode",
                "doctype",
            ],
            "native document extended-node contract must stay exactly the T33 surface"
        );
        assert_eq!(
            NODE_EXTENDED_NODES_CONTRACT,
            &[
                "data",
                "setData",
                "dataLength",
                "nodeValue",
                "setNodeValue",
                "target",
                "name",
                "publicId",
                "systemId",
                "substringData",
                "appendData",
                "insertData",
                "deleteData",
                "replaceData",
                "splitText",
                "cloneNode",
            ],
            "native node extended-node contract must stay exactly the T33 surface"
        );
    }

    /// The extended-node surface must never drift into the live collections,
    /// traversal iterators or events of later milestones (T34/T35/T37), nor
    /// duplicate a foreign seam's attribute/query/text surface.
    #[test]
    fn contract_has_no_live_collection_iterator_or_event_surface() {
        for name in NODE_EXTENDED_NODES_CONTRACT
            .iter()
            .chain(DOCUMENT_EXTENDED_NODES_CONTRACT.iter())
        {
            assert!(
                !name.contains("getElements")
                    && !name.contains("NamedNodeMap")
                    && !name.contains("Attr")
                    && !name.contains("Iterator")
                    && !name.contains("TreeWalker")
                    && !name.contains("Range")
                    && !name.contains("Event")
                    && !name.contains("Listener")
                    && *name != "childNodes",
                "character_data_api must not declare a later milestone's surface: {name}"
            );
        }
    }

    /// `name`/`publicId`/`systemId` are doctype reads and must stay distinct
    /// from the element attribute surface (which stays on `attributes_api`).
    #[test]
    fn doctype_reads_are_isolated_from_the_attribute_surface() {
        for name in NODE_EXTENDED_NODES_CONTRACT {
            assert!(
                !name.starts_with("getAttribute")
                    && !name.starts_with("setAttribute")
                    && !name.starts_with("removeAttribute")
                    && !name.starts_with("hasAttribute"),
                "character_data_api must not declare an attribute-surface name: {name}"
            );
        }
    }
}
