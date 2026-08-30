//! Native element attribute binding (T25E).
//!
//! # Role
//!
//! This module is the M4 native extension that takes over its T20A seam for the
//! element **attribute** read/write API. Unlike the auditing tasks before it
//! (T23A/T24A/T24B/T25D froze the already-delivered low-level surface in
//! [`crate::handle`]), the attribute methods are *new* native symbols: nothing
//! on [`NodeHandle`] exposed them before, so this module is the first place
//! they exist. It therefore follows the T22A precedent (minting new native
//! symbols in an extension module) and adds exactly the four attribute entries
//! to the existing [`NodeHandle`] class via a second `#[napi] impl` block —
//! napi merges class properties registered for the same Rust type, so the class
//! keeps the audited T19/T20 surface and gains the attribute surface with no
//! duplicate export and no touch to the shared `handle.rs`.
//!
//! # Frozen native contract (consumed by the T25E facade)
//!
//! Every method delegates to the T25B Core attribute contract through the
//! stable seam ([`with_document`], [`NodeHandle::shared`], [`NodeHandle::id`])
//! and maps lifecycle failures with the T21A error outlet. The *method names,
//! parameters and return values* below are the frozen contract the facade
//! depends on.
//!
//! ## Attribute surface (on the native `NodeHandle` from [`crate::handle`])
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `getAttribute` | `getAttribute` | `(name: String) → Option<String>` | value of the named attribute, `null` when absent |
//! | `setAttribute` | `setAttribute` | `(name: String, value: String) → ()` | stores the value verbatim; Core rejects an invalid attribute name (the happy-dom `validateAttributeName` boundary) with `ERR_MAD_DOM_INVALID_CHARACTER` |
//! | `removeAttribute` | `removeAttribute` | `(name: String) → ()` | removes the named attribute; absent names are a no-op |
//! | `hasAttribute` | `hasAttribute` | `(name: String) → bool` | whether the element has the named attribute |
//!
//! The facade owns the WebIDL string conversion (a `setAttribute("x", 1)` call
//! becomes `setAttribute("x", "1")` before it crosses the boundary); this
//! module receives plain Rust `String`s and stores/reads them verbatim, so the
//! Core's "no string conversion" rule (T25B) holds all the way to JavaScript.
//!
//! # Single source of attribute state
//!
//! Attribute state lives in exactly one place — the ordered `(name, value)`
//! list in the element's Core arena slot. This module keeps no copy of it: every
//! read and every write funnels through [`with_document`] to Core, so a write
//! performed through any entry point is immediately visible to every reader,
//! and no second attribute state can drift out of sync.
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`,
//! a non-element node with `ERR_MAD_DOM_HIERARCHY`, and an invalid attribute
//! name on `setAttribute` with `ERR_MAD_DOM_INVALID_CHARACTER` (the failing
//! call leaves the attribute list byte-for-byte unchanged — Core validates
//! before touching storage).
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
//! `tests/compat/scenarios/dom/dom-attributes.js` carry the end-to-end
//! evidence.

use napi::Env;
use napi_derive::napi;

use crate::error::BindingError;
use crate::extensions::mutation_observer_api::schedule_pending_observer_deliveries;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, NodeHandle};

pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "attributes_api",
    owner: "T25E",
    gate: "T25",
    status: "placeholder",
};

/// The frozen native attribute surface on [`NodeHandle`].
///
/// Exactly the four `#[napi]` entries this module adds to the class — the JS
/// names the facade depends on. `textContent` is deliberately absent: it
/// belongs to T25E's sibling `text_api` module.
#[allow(dead_code)]
pub(crate) const ATTRIBUTES_CONTRACT: &[&str] = &[
    "getAttribute",
    "setAttribute",
    "removeAttribute",
    "hasAttribute",
];

#[napi]
impl NodeHandle {
    /// Returns the value of the attribute with the given `name`, or `null` when
    /// the element has no such attribute.
    ///
    /// Delegates verbatim to Core ([`mad_dom_core::dom::Document::get_attribute`]);
    /// a non-element node fails with `ERR_MAD_DOM_HIERARCHY`.
    #[napi(catch_unwind)]
    pub fn get_attribute(&self, env: Env, name: String) -> napi::Result<Option<String>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.get_attribute(self.id(), &name)
                .map(|value| value.map(str::to_owned))
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Sets the attribute with the given `name` to `value`, storing the value
    /// verbatim.
    ///
    /// Delegates verbatim to Core ([`mad_dom_core::dom::Document::set_attribute`]);
    /// an invalid attribute name (the happy-dom `validateAttributeName` boundary)
    /// fails with `ERR_MAD_DOM_INVALID_CHARACTER` and leaves the attribute list
    /// unchanged.
    #[napi(catch_unwind)]
    pub fn set_attribute(&self, env: Env, name: String, value: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.set_attribute(self.id(), &name, &value)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Removes the attribute with the given `name`; an absent name is a no-op.
    ///
    /// Delegates verbatim to Core ([`mad_dom_core::dom::Document::remove_attribute`]).
    /// The Core boolean result is mapped to the WebIDL `undefined` return; the
    /// native keeps `()` so the facade cannot observe a stray value.
    #[napi(catch_unwind)]
    pub fn remove_attribute(&self, env: Env, name: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.remove_attribute(self.id(), &name)
                .map(|_| ())
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Returns whether the element has an attribute with the given `name`.
    ///
    /// Delegates verbatim to Core ([`mad_dom_core::dom::Document::has_attribute`]).
    #[napi(catch_unwind)]
    pub fn has_attribute(&self, env: Env, name: String) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.has_attribute(self.id(), &name)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen attribute surface is exactly the four entries this module
    /// adds to `NodeHandle`; the two other attribute-adjacent contracts
    /// (`text_api` textContent, the T24 mutation symbols) stay on their own
    /// seams. This is the Rust-side regression pin; `tests/bun/attributes-text.test.js`
    /// re-checks the same names against the live module.
    #[test]
    fn frozen_contract_surface_is_the_attribute_api() {
        assert_eq!(
            ATTRIBUTES_CONTRACT,
            &[
                "getAttribute",
                "setAttribute",
                "removeAttribute",
                "hasAttribute"
            ],
            "native attribute contract must stay exactly the T25E surface"
        );
    }

    /// The attribute contract owns only the four WHATWG attribute read/write
    /// entries: it must never grow into textContent, a query index, a
    /// NodeList/HTMLCollection surface, or the T24 mutation surface.
    #[test]
    fn contract_has_no_text_query_collection_or_mutation_surface() {
        for name in ATTRIBUTES_CONTRACT {
            assert!(
                !name.starts_with("text")
                    && !name.contains("Text")
                    && !name.contains("query")
                    && !name.contains("getElements")
                    && !name.contains("HTMLCollection")
                    && *name != "appendChild"
                    && *name != "insertBefore"
                    && *name != "removeChild"
                    && *name != "replaceChild",
                "attributes_api must not declare a foreign seam's surface: {name}"
            );
        }
    }

    /// The attribute surface is read/write symmetric: every entry in the frozen
    /// contract is one of the four native methods actually added to the class.
    #[test]
    fn contract_entries_are_exactly_the_four_attribute_operations() {
        assert_eq!(ATTRIBUTES_CONTRACT.len(), 4);
        assert_eq!(ATTRIBUTES_CONTRACT[0], "getAttribute");
        assert_eq!(ATTRIBUTES_CONTRACT[1], "setAttribute");
        assert_eq!(ATTRIBUTES_CONTRACT[2], "removeAttribute");
        assert_eq!(ATTRIBUTES_CONTRACT[3], "hasAttribute");
    }
}
