//! Native `innerHTML` / `outerHTML` and document-structure binding (T29).
//!
//! # Role
//!
//! This module is the M5 native extension that exposes the T26/T27 HTML
//! parsers and the T28 serializer to JavaScript: the WHATWG `innerHTML` /
//! `outerHTML` accessors on [`NodeHandle`] and the `documentElement` / `head` /
//! `body` document-structure accessors plus the full-document `parseHtml` load
//! on [`DocumentHandle`]. Like the M4 attribute/textContent extensions
//! (T25E), it adds the *new* native symbols to the existing classes through
//! second `#[napi] impl` blocks — napi merges class properties registered for
//! the same Rust type, so the class keeps its audited surface with no
//! duplicate export and no touch to the shared `handle.rs`.
//!
//! # Frozen native contract (consumed by the T29 facade)
//!
//! Every entry delegates to the Core T29 contract
//! ([`mad_dom_core::html::apply`]) through the stable seam
//! ([`with_document`](crate::handle::with_document),
//! [`DocumentHandle::shared`], [`NodeHandle::shared`], [`NodeHandle::id`]) and
//! maps lifecycle failures with the T21A error outlet.
//!
//! ## Document structure surface (on the native `DocumentHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `document.documentElement` | `documentElement` | `() → Option<NodeHandle>` | ensures the implied skeleton, then reads the first Element child of the document root |
//! | `document.head` | `head` | `() → Option<NodeHandle>` | the first `head` Element child of the document element |
//! | `document.body` | `body` | `() → Option<NodeHandle>` | the first `body` Element child of the document element |
//! | `document.parseHtml` | `parseHtml` | `(html: String) → ()` | replaces the document content with a freshly parsed full document |
//!
//! The skeleton is ensured idempotently inside `documentElement` / `head` /
//! `body`, so a fresh window reads as having the implied
//! `<html><head></head><body></body></html>` structure (happy-dom parity)
//! without a second DOM state.
//!
//! ## innerHTML / outerHTML surface (on the native `NodeHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `el.innerHTML` getter | `innerHTML` | `() → String` | the serialized children of an `Element` / `DocumentFragment`; other node kinds fail with `ERR_MAD_DOM_HIERARCHY` |
//! | `el.innerHTML` setter | `setInnerHTML` | `(html: String) → ()` | parses in the target's own context and atomically replaces its children |
//! | `el.outerHTML` getter | `outerHTML` | `() → String` | the serialized node itself; non-Element kinds fail with `ERR_MAD_DOM_HIERARCHY` |
//! | `el.outerHTML` setter | `setOuterHTML` | `(html: String) → ()` | parses in the parent's context and atomically replaces the node; a detached target is a no-op |
//!
//! The facade owns the WebIDL `DOMString` conversion of the setter value
//! (`el.innerHTML = 42` becomes `setInnerHTML("42")` before it crosses the
//! boundary); this module receives plain Rust `String`s and forwards them
//! verbatim, so the Core "no string conversion" rule holds all the way to
//! JavaScript.
//!
//! # Single source of tree state
//!
//! The tree lives in exactly one place — the Core arena. This module keeps no
//! copy: reads are produced on demand from Core and writes route through Core,
//! so a change through `innerHTML` / `outerHTML` / `parseHtml` is immediately
//! visible to the navigation, `childNodes`, attribute and `textContent` reads,
//! and vice versa.
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`,
//! and a non-eligible node kind on the `innerHTML` / `outerHTML` accessors
//! with `ERR_MAD_DOM_HIERARCHY`. The setters parse and adopt *before* mutating,
//! so a failed setter leaves the target byte-for-byte unchanged (failure
//! atomicity — see [`mad_dom_core::html::apply`]).
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T29**; there is no separate M5 integration gate, so T29 also
//! wires the facade and the shared entry/type/ledger surfaces itself. The
//! seam metadata below is the Rust-side pin of the frozen surface;
//! `tests/bun/html-api.test.js` and the `hc-diff-inner-outer-html` differential
//! scenario carry the end-to-end evidence.

use napi::bindgen_prelude::Reference;
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;

use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle, SharedDocument};

/// Seam metadata for the M5 `html_api` boundary.
///
/// Unlike the M4 seams this constant is not referenced by the frozen
/// [`REGISTRY`](crate::extensions::REGISTRY) (T29 owns its own integration and
/// there is no separate M5 gate), so it is allowed to be otherwise unused.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "html_api",
    owner: "T29",
    gate: "T29",
    status: "implemented",
};

/// The frozen native document-structure surface on
/// [`DocumentHandle`](crate::handle::DocumentHandle).
#[allow(dead_code)]
pub(crate) const DOCUMENT_STRUCTURE_CONTRACT: &[&str] =
    &["documentElement", "head", "body", "parseHtml"];

/// The frozen native `innerHTML` / `outerHTML` surface on
/// [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const INNER_OUTER_HTML_CONTRACT: &[&str] =
    &["innerHTML", "setInnerHTML", "outerHTML", "setOuterHTML"];

/// Maps an `Option<NodeId>` from a Core navigation read into a wrapped JS node
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
    /// Returns the WHATWG `documentElement`: the first `Element` child of the
    /// document root, building the implied skeleton first so a fresh document
    /// reads as having `<html>`. `null` when the document has no root element.
    #[napi(catch_unwind)]
    pub fn document_element(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.ensure_html_skeleton()
                .map_err(crate::error::BindingError::Core)?;
            doc.document_element()
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), id)
    }

    /// Returns the WHATWG `head` element (first `head` child of the document
    /// element), building the implied skeleton first; `null` when there is none.
    #[napi(catch_unwind)]
    pub fn head(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.ensure_html_skeleton()
                .map_err(crate::error::BindingError::Core)?;
            doc.document_head()
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), id)
    }

    /// Returns the WHATWG `body` element (first `body` child of the document
    /// element), building the implied skeleton first; `null` when there is none.
    #[napi(catch_unwind)]
    pub fn body(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.ensure_html_skeleton()
                .map_err(crate::error::BindingError::Core)?;
            doc.document_body()
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), id)
    }

    /// Replaces the document content with a freshly parsed full HTML document.
    ///
    /// The parsed doctype / `<html>` element are adopted into this document's
    /// arena atomically; `documentElement` / `head` / `body` reflect the parsed
    /// structure immediately.
    #[napi(catch_unwind)]
    pub fn parse_html(&self, env: Env, html: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.load_html(&html)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }
}

#[napi]
impl NodeHandle {
    /// Returns the WHATWG `innerHTML` of this node: the serialized children of
    /// an `Element` / `DocumentFragment`. Other node kinds fail with
    /// `ERR_MAD_DOM_HIERARCHY`.
    #[napi(catch_unwind, js_name = "innerHTML")]
    pub fn inner_html(&self, env: Env) -> napi::Result<String> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.inner_html(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets the WHATWG `innerHTML` of this node, parsing in the target's own
    /// context and atomically replacing its children. A failed setter leaves
    /// the node byte-for-byte unchanged.
    #[napi(catch_unwind, js_name = "setInnerHTML")]
    pub fn set_inner_html(&self, env: Env, html: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_inner_html(self.id(), &html)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Returns the WHATWG `outerHTML` of this node: the serialized node itself.
    /// Non-Element kinds fail with `ERR_MAD_DOM_HIERARCHY`.
    #[napi(catch_unwind, js_name = "outerHTML")]
    pub fn outer_html(&self, env: Env) -> napi::Result<String> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.outer_html(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets the WHATWG `outerHTML` of this node, parsing in the parent's
    /// context and atomically replacing the node. A detached target is a no-op.
    #[napi(catch_unwind, js_name = "setOuterHTML")]
    pub fn set_outer_html(&self, env: Env, html: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_outer_html(self.id(), &html)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen document-structure surface is exactly the four entries this
    /// module adds to `DocumentHandle`; the `innerHTML`/`outerHTML` surface
    /// stays on the node side. This is the Rust-side regression pin;
    /// `tests/bun/html-api.test.js` re-checks the same names against the live
    /// module.
    #[test]
    fn frozen_document_structure_surface() {
        assert_eq!(
            DOCUMENT_STRUCTURE_CONTRACT,
            &["documentElement", "head", "body", "parseHtml"],
            "native document-structure contract must stay exactly the T29 surface"
        );
        assert_eq!(
            INNER_OUTER_HTML_CONTRACT,
            &["innerHTML", "setInnerHTML", "outerHTML", "setOuterHTML"],
            "native inner/outerHTML contract must stay exactly the T29 surface"
        );
    }

    /// The T29 contract must never drift into selector, query, event or
    /// element-specific surface (the boundary of this todo).
    #[test]
    fn contract_has_no_foreign_surface() {
        for name in DOCUMENT_STRUCTURE_CONTRACT
            .iter()
            .chain(INNER_OUTER_HTML_CONTRACT.iter())
        {
            assert!(
                !name.contains("query")
                    && !name.contains("getElements")
                    && !name.contains("EventListener")
                    && !name.contains("Selector"),
                "html_api must not declare a foreign seam's surface: {name}"
            );
        }
    }
}
