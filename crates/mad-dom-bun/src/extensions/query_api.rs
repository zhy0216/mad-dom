//! Native selector query binding (T31).
//!
//! # Role
//!
//! This module is the M6 native extension that exposes the Core document-order
//! selector queries to JavaScript: `querySelector` / `querySelectorAll` /
//! `getElementById` on the native [`DocumentHandle`] and `querySelector` /
//! `querySelectorAll` / `matches` / `closest` on the native [`NodeHandle`].
//! Like the M5 `html_api` extension (T29), it adds *new* native symbols to the
//! existing classes through second `#[napi] impl` blocks — napi merges class
//! properties registered for the same Rust type, so the classes keep their
//! audited surfaces with no duplicate export and no touch to the shared
//! `handle.rs`.
//!
//! # Frozen native contract (consumed by the T31 facade)
//!
//! Every entry delegates to the Core T31 contract
//! ([`mad_dom_core::selectors::query`]) through the stable seam
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
//! | `document.querySelector` | `querySelector` | `(selector: String) → Option<NodeHandle>` | the first descendant element of the document (implied skeleton first), in document order, that matches; `null` when none |
//! | `document.querySelectorAll` | `querySelectorAll` | `(selector: String) → Vec<NodeHandle>` | every matching descendant element, in document order; a static snapshot of the query |
//! | `document.getElementById` | `getElementById` | `(id: String) → Option<NodeHandle>` | the first element in the document whose `id` attribute equals `id`; `null` when none |
//!
//! The document selector queries build the implied HTML skeleton first
//! (`ensure_html_skeleton`), so a fresh window reads exactly like happy-dom's
//! (`document.querySelector("body")` finds the implied body). `getElementById`
//! deliberately does not materialize that skeleton. Core's query operations
//! themselves stay side-effect free; the binding only asks Core to prepare its
//! private adaptive id index before eligible document reads.
//!
//! ## Node surface (on the native `NodeHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `el.querySelector` | `querySelector` | `(selector: String) → Option<NodeHandle>` | the first descendant element of the node that matches; `null` when none |
//! | `el.querySelectorAll` | `querySelectorAll` | `(selector: String) → Vec<NodeHandle>` | every matching descendant element, in document order; a static snapshot |
//! | `el.matches` | `matches` | `(selector: String) → bool` | whether the element itself matches |
//! | `el.closest` | `closest` | `(selector: String) → Option<NodeHandle>` | the closest ancestor (itself included) that matches; `null` when none |
//!
//! The facade owns the WebIDL `DOMString` conversion of the selector / id
//! argument (`el.matches(42)` becomes `matches("42")` before it crosses the
//! boundary); this module receives plain Rust `String`s and forwards them
//! verbatim, so the Core "no string conversion" rule holds all the way to
//! JavaScript.
//!
//! # Static NodeList semantics
//!
//! `querySelectorAll` returns the matched handles of one Core traversal as a
//! plain JS array of node wrappers. The array is a *snapshot*: it is computed
//! once and never updates, so a later mutation of the tree does not change an
//! already-returned result. The facade wraps the array into the static
//! `NodeList` object; this operation builds neither a live collection nor an
//! index (the T31 boundary).
//!
//! # Single source of tree state
//!
//! The tree lives in exactly one place — the Core arena. This module keeps no
//! copy. General and scoped selector queries are fresh read-only traversals;
//! for a document-scoped plain `#id` or `getElementById`, Core may lazily build
//! and maintain a private `by_id` acceleration map. It is derived exclusively
//! from the arena and updated at Core mutation chokepoints, so it is not a
//! second tree state. Every returned node is minted through
//! [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node), so
//! wrapper identity stays the frozen per-document weak cache (T20).
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`,
//! an invalid selector with `ERR_MAD_DOM_SYNTAX`, a non-element receiver
//! (`matches` / `closest`) with `ERR_MAD_DOM_HIERARCHY`, and a non-`ParentNode`
//! scope (`querySelector` / `querySelectorAll` on a `Text`/`Comment` node) with
//! `ERR_MAD_DOM_HIERARCHY`.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T31**; like T29 there is no separate integration gate, so T31
//! also wires the facade and the shared entry/type/ledger surfaces itself. The
//! seam metadata below is the Rust-side pin of the frozen surface;
//! `tests/bun/query-api.test.js` and the `hc-diff-selector-query` differential
//! scenario carry the end-to-end evidence.

use napi::bindgen_prelude::{Reference, Uint32Array};
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;

use crate::extensions::ExtensionSeam;
use crate::handle::{
    check_affinity, node_snapshot_descriptor, with_document, DocumentHandle, NodeHandle,
    SharedDocument,
};

/// Seam metadata for the M6 `query_api` boundary.
///
/// Like the M5 `html_api` seam this constant is not referenced by the frozen
/// [`REGISTRY`](crate::extensions::REGISTRY) (T31 owns its own integration and
/// there is no separate M6 gate), so it is allowed to be otherwise unused.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "query_api",
    owner: "T31",
    gate: "T31",
    status: "implemented",
};

/// The frozen native selector-query surface on
/// [`DocumentHandle`](crate::handle::DocumentHandle).
#[allow(dead_code)]
pub(crate) const DOCUMENT_QUERY_CONTRACT: &[&str] =
    &["querySelector", "querySelectorAll", "getElementById"];

/// The frozen native selector-query surface on
/// [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const NODE_QUERY_CONTRACT: &[&str] =
    &["querySelector", "querySelectorAll", "matches", "closest"];

/// Maps an `Option<NodeId>` from a Core query read into a wrapped JS node
/// (or `null`), minting the wrapper through the single per-document weak cache.
fn wrap_optional(
    env: Env,
    shared: &std::sync::Arc<SharedDocument>,
    id: Option<NodeId>,
) -> napi::Result<Option<Reference<NodeHandle>>> {
    match id {
        None => Ok(None),
        Some(id) => shared.wrap_node(env, id).map(Some),
    }
}

#[napi]
impl DocumentHandle {
    /// Returns the WHATWG `document.querySelector`: the first descendant
    /// element of the document, in document order, that matches `selector`.
    ///
    /// The implied HTML skeleton is materialized first, so a fresh window
    /// answers like happy-dom's. `null` when no element matches.
    #[napi(catch_unwind)]
    pub fn query_selector(
        &self,
        env: Env,
        selector: String,
    ) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.ensure_html_skeleton()
                .map_err(crate::error::BindingError::Core)?;
            doc.prepare_adaptive_document_query_selector(&selector)
                .map_err(crate::error::BindingError::Core)?;
            let root = doc.document_root();
            doc.query_selector(root, &selector)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), id)
    }

    /// Returns the WHATWG `document.querySelectorAll`: every descendant
    /// element of the document that matches `selector`, in document order, as
    /// a static snapshot of the query.
    #[napi(catch_unwind)]
    pub fn query_selector_all(
        &self,
        env: Env,
        selector: String,
    ) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.ensure_html_skeleton()
                .map_err(crate::error::BindingError::Core)?;
            let root = doc.document_root();
            doc.query_selector_all(root, &selector)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        ids.iter()
            .map(|id| self.shared().wrap_node(env, *id))
            .collect()
    }

    /// Returns the WHATWG `document.getElementById`: the first element in the
    /// document whose `id` attribute equals `id`, or `null`.
    ///
    /// Unlike the selector queries this is a pure read of the existing tree —
    /// it never materializes the implied skeleton, so a fresh document returns
    /// `null` exactly like happy-dom's empty document.
    #[napi(catch_unwind)]
    pub fn get_element_by_id(
        &self,
        env: Env,
        id: String,
    ) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let node = with_document(self.shared(), |doc| {
            doc.prepare_adaptive_get_element_by_id()
                .map_err(crate::error::BindingError::Core)?;
            doc.get_element_by_id(&id)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), node)
    }
}

#[napi]
impl NodeHandle {
    /// Returns the same static query result using document-scoped tokens and
    /// immutable type descriptors. Facades can create canonical lazy wrappers
    /// without allocating a Node-API object for every match.
    #[napi(catch_unwind)]
    pub fn query_selector_all_tokens(
        &self,
        env: Env,
        selector: String,
    ) -> napi::Result<Uint32Array> {
        check_affinity(self.shared(), &env)?;
        let nodes = with_document(self.shared(), |doc| {
            doc.query_selector_all(self.id(), &selector)
                .map_err(crate::error::BindingError::Core)?
                .into_iter()
                .map(|id| node_snapshot_descriptor(doc, id).map(|kind| (id, kind << 16)))
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|err| err.into_napi(&env))?;
        Ok(self.shared().token_snapshot(&nodes, None).into())
    }

    /// Returns the WHATWG `element.querySelector`: the first descendant
    /// element of this node that matches `selector`, or `null`.
    ///
    /// The node itself is never a candidate (the WHATWG "descendant" rule).
    #[napi(catch_unwind)]
    pub fn query_selector(
        &self,
        env: Env,
        selector: String,
    ) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.query_selector(self.id(), &selector)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), id)
    }

    /// Returns the WHATWG `element.querySelectorAll`: every descendant element
    /// of this node that matches `selector`, in document order, as a static
    /// snapshot of the query.
    #[napi(catch_unwind)]
    pub fn query_selector_all(
        &self,
        env: Env,
        selector: String,
    ) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.query_selector_all(self.id(), &selector)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        ids.iter()
            .map(|id| self.shared().wrap_node(env, *id))
            .collect()
    }

    /// Returns the WHATWG `element.matches`: whether this element matches
    /// `selector`.
    ///
    /// A non-element receiver fails with `ERR_MAD_DOM_HIERARCHY`.
    #[napi(catch_unwind)]
    pub fn matches(&self, env: Env, selector: String) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.matches(self.id(), &selector)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Returns the WHATWG `element.closest`: the closest ancestor of this
    /// element — itself included — that matches `selector`, or `null`.
    ///
    /// A non-element receiver fails with `ERR_MAD_DOM_HIERARCHY`.
    #[napi(catch_unwind)]
    pub fn closest(
        &self,
        env: Env,
        selector: String,
    ) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.closest(self.id(), &selector)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen document surface is exactly the three entries this module
    /// adds to `DocumentHandle`; the node surface stays the four entries on
    /// `NodeHandle`. This is the Rust-side regression pin;
    /// `tests/bun/query-api.test.js` re-checks the same names against the live
    /// module.
    #[test]
    fn frozen_contract_surfaces_are_the_selector_query_api() {
        assert_eq!(
            DOCUMENT_QUERY_CONTRACT,
            &["querySelector", "querySelectorAll", "getElementById"],
            "native document query contract must stay exactly the T31 surface"
        );
        assert_eq!(
            NODE_QUERY_CONTRACT,
            &["querySelector", "querySelectorAll", "matches", "closest"],
            "native node query contract must stay exactly the T31 surface"
        );
    }

    /// The selector-query surface must never expose live getElementsBy*
    /// collections or an index-control method (the T31 boundary), nor the T25
    /// live childNodes surface. Core's private adaptive id map is not a native
    /// contract entry.
    #[test]
    fn contract_has_no_live_collection_or_index_surface() {
        for name in DOCUMENT_QUERY_CONTRACT
            .iter()
            .chain(NODE_QUERY_CONTRACT.iter())
        {
            assert!(
                !name.contains("getElements") && *name != "childNodes",
                "query_api must not declare a live collection surface: {name}"
            );
        }
    }

    /// The node query contract must stay orthogonal to the mutation, attribute
    /// and text surfaces: only the four selector-query entries belong here.
    #[test]
    fn node_contract_owns_only_the_four_query_entries() {
        for name in NODE_QUERY_CONTRACT {
            assert!(
                !name.starts_with("append")
                    && !name.starts_with("insert")
                    && !name.starts_with("remove")
                    && !name.starts_with("replace")
                    && !name.contains("Attribute")
                    && !name.contains("text"),
                "query_api must not declare a foreign seam's surface: {name}"
            );
        }
    }
}
