//! Native live collection binding (T32).
//!
//! # Role
//!
//! This module is the M6 native extension that exposes the Core live element
//! collections to JavaScript: `getElementsByTagName` and
//! `getElementsByClassName` on the native [`DocumentHandle`] and the native
//! [`NodeHandle`]. Like the M5 `html_api` (T29) and M6 `query_api` (T31)
//! extensions it adds *new* native symbols to the existing classes through
//! second `#[napi] impl` blocks — napi merges class properties registered for
//! the same Rust type, so the classes keep their audited surfaces with no
//! duplicate export and no touch to the shared `handle.rs`.
//!
//! # Frozen native contract (consumed by the T32 facade)
//!
//! Every entry delegates to the Core T32 contract
//! ([`mad_dom_core::selectors::live`]) through the stable seam
//! ([`with_document`](crate::handle::with_document),
//! [`DocumentHandle::shared`], [`NodeHandle::shared`], [`NodeHandle::id`]) and
//! maps lifecycle failures with the T21A error outlet. The *method names,
//! parameters and return values* below are the frozen contract the facade's
//! live `HTMLCollection` depends on.
//!
//! ## Document surface (on the native `DocumentHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `document.getElementsByTagName` | `getElementsByTagName` | `(tagName: String) → Vec<NodeHandle>` | every descendant element matching the tag (ASCII case-insensitive, `"*"` matches all), in document order |
//! | `document.getElementsByClassName` | `getElementsByClassName` | `(className: String) → Vec<NodeHandle>` | every descendant element whose `class` attribute contains every whitespace token of the argument, in document order |
//!
//! The document entries build the implied HTML skeleton first
//! (`ensure_html_skeleton`), so a fresh window's `getElementsByTagName("html")`
//! finds the implied `<html>` exactly like happy-dom's eagerly-built document.
//!
//! ## Node surface (on the native `NodeHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `el.getElementsByTagName` | `getElementsByTagName` | `(tagName: String) → Vec<NodeHandle>` | the node's descendant elements matching the tag, in document order |
//! | `el.getElementsByClassName` | `getElementsByClassName` | `(className: String) → Vec<NodeHandle>` | the node's descendant elements matching every class token, in document order |
//!
//! The facade owns the WebIDL `DOMString` conversion of the arguments
//! (`el.getElementsByTagName(42)` becomes `getElementsByTagName("42")` before
//! it crosses the boundary); this module receives plain Rust `String`s and
//! forwards them verbatim.
//!
//! # Live collection semantics
//!
//! Each call re-runs a fresh Core read of the current arena, so the result is
//! *live by construction*: the facade's `HTMLCollection` re-reads this native
//! contract on every access (length, index, namedItem, iteration) and therefore
//! reflects any tree or attribute change immediately, while keeping no second
//! DOM state. Every returned node is minted through
//! [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node), so
//! wrapper identity stays the frozen per-document weak cache (T20).
//!
//! # Single source of tree state
//!
//! The tree lives in exactly one place — the Core arena (plus, when the T32
//! Core query index is enabled, the index that Core keeps in lock step with
//! it). This module keeps no copy and builds no second state: it forwards the
//! scope and the argument verbatim and returns whatever Core computed.
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`
//! and a non-`ParentNode` scope (e.g. `getElementsByTagName` on a `Text` node)
//! with `ERR_MAD_DOM_HIERARCHY`.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T32**; like T29/T31 there is no separate integration gate, so
//! T32 also wires the facade and the shared entry/type/ledger surfaces itself.
//! The seam metadata below is the Rust-side pin of the frozen surface;
//! `tests/bun/live-collections.test.js` and the `hc-diff-live-collections`
//! differential scenario carry the end-to-end evidence.

use napi::bindgen_prelude::Reference;
use napi::Env;
use napi_derive::napi;

use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle, SharedDocument};

/// Seam metadata for the M6 `live_collections` boundary.
///
/// Like the M5 `html_api` and M6 `query_api` seams this constant is not
/// referenced by the frozen [`REGISTRY`](crate::extensions::REGISTRY) (T32
/// owns its own integration and there is no separate M6 gate), so it is
/// allowed to be otherwise unused.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "live_collections",
    owner: "T32",
    gate: "T32",
    status: "implemented",
};

/// The frozen native live-collection surface on
/// [`DocumentHandle`](crate::handle::DocumentHandle) and
/// [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const LIVE_COLLECTION_CONTRACT: &[&str] =
    &["getElementsByTagName", "getElementsByClassName"];

/// Wraps every `NodeId` Core returned into a JS node wrapper through the
/// single per-document weak cache.
fn wrap_all(
    env: Env,
    shared: &std::sync::Arc<SharedDocument>,
    ids: Vec<mad_dom_core::arena::NodeId>,
) -> napi::Result<Vec<Reference<NodeHandle>>> {
    ids.iter().map(|id| shared.wrap_node(env, *id)).collect()
}

#[napi]
impl DocumentHandle {
    /// Returns the WHATWG `document.getElementsByTagName`: every descendant
    /// element matching `tagName` (ASCII case-insensitive, `"*"` matches all),
    /// in document order.
    ///
    /// The implied HTML skeleton is materialized first, so a fresh window
    /// answers like happy-dom's.
    #[napi(catch_unwind)]
    pub fn get_elements_by_tag_name(
        &self,
        env: Env,
        tag_name: String,
    ) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.ensure_html_skeleton()
                .map_err(crate::error::BindingError::Core)?;
            let root = doc.document_root();
            doc.get_elements_by_tag_name(root, &tag_name)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_all(env, self.shared(), ids)
    }

    /// Returns the WHATWG `document.getElementsByClassName`: every descendant
    /// element whose `class` attribute contains every whitespace token of
    /// `class_name`, in document order.
    #[napi(catch_unwind)]
    pub fn get_elements_by_class_name(
        &self,
        env: Env,
        class_name: String,
    ) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.ensure_html_skeleton()
                .map_err(crate::error::BindingError::Core)?;
            let root = doc.document_root();
            doc.get_elements_by_class_name(root, &class_name)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_all(env, self.shared(), ids)
    }
}

#[napi]
impl NodeHandle {
    /// Returns the WHATWG `element.getElementsByTagName`: the descendant
    /// elements of this node matching `tagName` (ASCII case-insensitive,
    /// `"*"` matches all), in document order. The node itself is never a
    /// candidate.
    #[napi(catch_unwind)]
    pub fn get_elements_by_tag_name(
        &self,
        env: Env,
        tag_name: String,
    ) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.get_elements_by_tag_name(self.id(), &tag_name)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_all(env, self.shared(), ids)
    }

    /// Returns the WHATWG `element.getElementsByClassName`: the descendant
    /// elements of this node whose `class` attribute contains every whitespace
    /// token of `class_name`, in document order.
    #[napi(catch_unwind)]
    pub fn get_elements_by_class_name(
        &self,
        env: Env,
        class_name: String,
    ) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.get_elements_by_class_name(self.id(), &class_name)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_all(env, self.shared(), ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen live-collection surface is exactly the two entries this
    /// module adds to each handle class. This is the Rust-side regression pin;
    /// `tests/bun/live-collections.test.js` re-checks the same names against
    /// the live module.
    #[test]
    fn frozen_live_collection_surface_is_exactly_the_two_entries() {
        assert_eq!(
            LIVE_COLLECTION_CONTRACT,
            &["getElementsByTagName", "getElementsByClassName"],
            "native live collection contract must stay exactly the T32 surface"
        );
    }

    /// The live collection surface must never grow into a selector-query or
    /// childNodes surface (those belong to T31 / T25D).
    #[test]
    fn live_collection_surface_does_not_own_foreign_seams() {
        for name in LIVE_COLLECTION_CONTRACT {
            assert!(
                !name.contains("querySelector")
                    && *name != "childNodes"
                    && !name.starts_with("append")
                    && !name.starts_with("remove"),
                "live_collections must not declare a foreign seam's surface: {name}"
            );
        }
    }
}
