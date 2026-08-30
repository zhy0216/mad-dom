//! Native `textContent` binding (T25E).
//!
//! # Role
//!
//! This module is the M4 native extension that takes over its T20A seam for the
//! `Node.textContent` getter/setter. Like its sibling
//! [`crate::extensions::attributes_api`] (T25E), it adds the *new* native
//! symbols to the existing [`NodeHandle`] class through a second `#[napi] impl`
//! block — napi merges class properties registered for the same Rust type, so
//! the class keeps the audited T19/T20 surface and gains `textContent` /
//! `setTextContent` with no duplicate export and no touch to the shared
//! `handle.rs`.
//!
//! # Frozen native contract (consumed by the T25E facade)
//!
//! Every entry delegates to the T25C Core `textContent` contract through the
//! stable seam ([`with_document`], [`NodeHandle::shared`], [`NodeHandle::id`])
//! and maps lifecycle failures with the T21A error outlet.
//!
//! ## textContent surface (on the native `NodeHandle` from [`crate::handle`])
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `textContent` getter | `textContent` | `() → Option<String>` | `null` for a `Document` node; a `Text`/`Comment` node's own data; the tree-order concatenation of every descendant `Text` node's data for an `Element`/`DocumentFragment` |
//! | `textContent` setter | `setTextContent` | `(value: String) → ()` | a `Document` node is a no-op; a `Text`/`Comment` node replaces its data atomically; an `Element`/`DocumentFragment` replaces all children with a single text node (empty value clears) |
//!
//! The facade owns the WebIDL string conversion of the setter value (the WHATWG
//! steps act as if `null` were the empty string); this module receives a plain
//! Rust `String` and forwards it verbatim, so the Core's setter semantics hold
//! all the way to JavaScript.
//!
//! # Single source of text state
//!
//! Text state lives in exactly one place — the Core arena. This module keeps no
//! copy: reads are produced on demand from Core and writes route through Core,
//! so a change made through any entry point is immediately visible to every
//! reader (including the existing navigation and `childNodes` reads).
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`,
//! and a NUL byte in the setter value with `ERR_MAD_DOM_INVALID_CHARACTER`
//! while leaving the target unchanged (Core validates before mutating, so the
//! replacement is all-or-nothing).
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T25E**; integration gate: **T25**. Do not write to this file from
//! any other task. Registry wiring and the `status` flip to `"implemented"`
//! belong to the T25 gate; the seam metadata below stays `"placeholder"` until
//! then. The constant in this module is the Rust-side pin of the frozen
//! surface; `tests/bun/attributes-text.test.js` and
//! `tests/compat/scenarios/dom/dom-text-content.js` carry the end-to-end
//! evidence.

use napi::Env;
use napi_derive::napi;

use crate::error::BindingError;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, NodeHandle};

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "text_api",
    owner: "T25E",
    gate: "T25",
    status: "placeholder",
};

/// The frozen native `textContent` surface on [`NodeHandle`].
///
/// Exactly the two `#[napi]` entries this module adds to the class — the JS
/// names the facade depends on. Attributes are deliberately absent: they belong
/// to T25E's sibling `attributes_api` module.
#[allow(dead_code)]
pub(crate) const TEXT_CONTENT_CONTRACT: &[&str] = &["textContent", "setTextContent"];

#[napi]
impl NodeHandle {
    /// Returns the `textContent` of this node per the WHATWG getter.
    ///
    /// Delegates verbatim to Core ([`mad_dom_core::dom::Document::text_content`]);
    /// a `Document` node reads as `null`.
    #[napi(catch_unwind)]
    pub fn text_content(&self, env: Env) -> napi::Result<Option<String>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.text_content(self.id()).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets the `textContent` of this node per the WHATWG setter.
    ///
    /// Delegates verbatim to Core ([`mad_dom_core::dom::Document::set_text_content`]);
    /// a NUL byte in `value` fails with `ERR_MAD_DOM_INVALID_CHARACTER` and
    /// leaves the node unchanged.
    #[napi(catch_unwind)]
    pub fn set_text_content(&self, env: Env, value: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_text_content(self.id(), &value)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen textContent surface is exactly the getter/setter pair this
    /// module adds to `NodeHandle`; attributes and the T24 mutation symbols
    /// stay on their own seams. This is the Rust-side regression pin;
    /// `tests/bun/attributes-text.test.js` re-checks the same names against the
    /// live module.
    #[test]
    fn frozen_contract_surface_is_the_text_content_pair() {
        assert_eq!(
            TEXT_CONTENT_CONTRACT,
            &["textContent", "setTextContent"],
            "native textContent contract must stay exactly the T25E surface"
        );
    }

    /// The textContent contract owns only the getter/setter pair: it must never
    /// grow into attribute, query, collection or mutation surface.
    #[test]
    fn contract_has_no_attribute_query_collection_or_mutation_surface() {
        for name in TEXT_CONTENT_CONTRACT {
            assert!(
                !name.starts_with("getAttribute")
                    && !name.starts_with("setAttribute")
                    && !name.starts_with("removeAttribute")
                    && !name.starts_with("hasAttribute")
                    && !name.contains("query")
                    && !name.contains("getElements")
                    && !name.contains("HTMLCollection")
                    && !name.contains("Child")
                    && !name.contains("Append")
                    && !name.contains("Insert")
                    && !name.contains("Replace"),
                "text_api must not declare a foreign seam's surface: {name}"
            );
        }
    }

    /// The textContent surface is exactly two entries: the WHATWG getter and
    /// setter pair, nothing more.
    #[test]
    fn contract_entries_are_exactly_the_getter_setter_pair() {
        assert_eq!(TEXT_CONTENT_CONTRACT.len(), 2);
        assert_eq!(TEXT_CONTENT_CONTRACT[0], "textContent");
        assert_eq!(TEXT_CONTENT_CONTRACT[1], "setTextContent");
    }
}
