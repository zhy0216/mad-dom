//! Native attribute-node and token-list binding (T34).
//!
//! # Role
//!
//! This module is the M7 native extension that exposes the T34 Core contract
//! (crates/mad-dom-core/src/dom/attribute_nodes.rs) to JavaScript: the
//! `NamedNodeMap`/`Attr` reads behind `element.attributes` (the ordered
//! attribute list), the `Element.namespaceURI` read, the
//! `Document.createAttribute` qualified-name check and the `DOMTokenList`
//! surface behind `Element.classList` (token set reads and the
//! add/remove/toggle/replace/contains mutators). Like the M5/M6/M7 extensions
//! before it, it adds *new* native symbols to the existing
//! [`NodeHandle`](crate::handle::NodeHandle) / [`DocumentHandle`](crate::handle::DocumentHandle)
//! classes through second `#[napi] impl` blocks — napi merges class properties
//! registered for the same Rust type, so the classes keep their audited
//! surfaces with no duplicate export and no touch to the shared `handle.rs`.
//!
//! # Frozen native contract (consumed by the T34 facade)
//!
//! Every entry delegates to the Core T34 contract through the stable seam
//! ([`with_document`](crate::handle::with_document), `NodeHandle::shared`,
//! `NodeHandle::id`) and maps lifecycle failures with the T21A error outlet.
//! The *method names, parameters and return values* below are the frozen
//! contract the facade depends on.
//!
//! ## Document surface (on the native `DocumentHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `document.createAttribute` | `validateAttributeName` | `(name) → ()` | validates the WHATWG "Name"; an invalid qualified name fails with `ERR_MAD_DOM_INVALID_CHARACTER` |
//!
//! ## Node surface (on the native `NodeHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `Element.attributes` (NamedNodeMap) | `getAttributes` | `() → [[name, value], …]` | the ordered attribute list, produced on demand from Core |
//! | `Element.namespaceURI` | `namespaceUri` | `() → String \| null` | the element namespace URI, `null` for non-elements |
//! | `DOMTokenList` token set | `tokenList` | `(name) → [token, …]` | the ordered de-duplicated token set of the named attribute |
//! | `DOMTokenList.contains` | `tokenListContains` | `(name, token) → bool` | membership; never throws |
//! | `DOMTokenList.add` | `tokenListAdd` | `(name, tokens) → ()` | appends missing tokens; empty/whitespace tokens fail with `ERR_MAD_DOM_SYNTAX` / `ERR_MAD_DOM_INVALID_CHARACTER` |
//! | `DOMTokenList.remove` | `tokenListRemove` | `(name, tokens) → ()` | removes tokens; the same validation applies |
//! | `DOMTokenList.toggle` | `tokenListToggle` | `(name, token, force?) → bool` | adds/removes and returns the resulting presence |
//! | `DOMTokenList.replace` | `tokenListReplace` | `(name, old, new) → bool` | replaces and returns `true`, or `false` when `old` is absent |
//!
//! The facade owns the WebIDL conversions (`add("x", 1)` coerces to `"x"`,
//! `"1"`, `toggle`'s `force` is shaped with `Boolean`, tokens arrive as a
//! `Vec<String>`); this module receives plain `String`s and forwards them
//! verbatim, so the Core "no string conversion" rule holds all the way to
//! JavaScript.
//!
//! # Single source of attribute state
//!
//! Attribute state lives in exactly one place — the ordered `(name, value)`
//! list in the element's Core arena slot. Every read is produced on demand from
//! that storage and every `DOMTokenList` mutation funnels back through the Core
//! attribute write entries, so a `classList.add` and an `element.setAttribute`
//! write update the same storage and the T32 query index stays in lock step.
//! This module keeps no copy.
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`,
//! a non-element node with `ERR_MAD_DOM_HIERARCHY`, an empty `DOMTokenList`
//! token with `ERR_MAD_DOM_SYNTAX` and a whitespace token (or an invalid
//! `createAttribute` name) with `ERR_MAD_DOM_INVALID_CHARACTER`. Token mutators
//! validate before touching Core state, so a failed call leaves the attribute
//! unchanged.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T34**; like T29/T31/T32/T33 there is no separate integration
//! gate, so T34 also wires the facade and the shared entry/type/ledger
//! surfaces itself. The seam metadata below is the Rust-side pin of the frozen
//! surface; `tests/bun/attributes-token.test.js` and the
//! `hc-diff-attributes-token` differential scenario carry the end-to-end
//! evidence.

use napi::Env;
use napi_derive::napi;

use crate::error::BindingError;
use crate::extensions::mutation_observer_api::schedule_pending_observer_deliveries;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle};

/// Seam metadata for the M7 `attribute_nodes_api` boundary.
///
/// Like the M5/M6/M7 seams this constant is not referenced by the frozen
/// [`REGISTRY`](crate::extensions::REGISTRY) (T34 owns its own integration), so
/// it is allowed to be otherwise unused.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "attribute_nodes_api",
    owner: "T34",
    gate: "T34",
    status: "implemented",
};

/// The frozen native attribute-node/token surface on
/// [`DocumentHandle`](crate::handle::DocumentHandle).
#[allow(dead_code)]
pub(crate) const DOCUMENT_ATTRIBUTE_NODES_CONTRACT: &[&str] = &["validateAttributeName"];

/// The frozen native attribute-node/token surface on
/// [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const NODE_ATTRIBUTE_NODES_CONTRACT: &[&str] = &[
    "getAttributes",
    "namespaceUri",
    "tokenList",
    "tokenListContains",
    "tokenListAdd",
    "tokenListRemove",
    "tokenListToggle",
    "tokenListReplace",
];

#[napi]
impl DocumentHandle {
    /// Validates a WHATWG "Name" for `document.createAttribute`.
    ///
    /// Delegates verbatim to Core
    /// ([`Document::validate_attribute_name`](mad_dom_core::dom::Document::validate_attribute_name));
    /// an invalid qualified name fails with `ERR_MAD_DOM_INVALID_CHARACTER`.
    /// The facade builds the detached `Attr` wrapper itself — a detached
    /// attribute carries no Core node — so this is the only native entry for
    /// `createAttribute`.
    #[napi(catch_unwind)]
    pub fn validate_attribute_name(&self, env: Env, name: String) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.validate_attribute_name(&name)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }
}

#[napi]
impl NodeHandle {
    /// Returns the ordered attribute list of this element as `[[name, value],
    /// …]`, produced on demand from Core.
    ///
    /// This single read backs the whole `NamedNodeMap` surface (`length`,
    /// `item`, `getNamedItem`, indexed and named access, iteration); a
    /// non-element node fails with `ERR_MAD_DOM_HIERARCHY`.
    #[napi(catch_unwind)]
    pub fn get_attributes(&self, env: Env) -> napi::Result<Vec<(String, String)>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.attribute_pairs(self.id()).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Returns the namespace URI of this element, or `null` for a non-element
    /// node (the read behind `Element.namespaceURI`).
    #[napi(catch_unwind)]
    pub fn namespace_uri(&self, env: Env) -> napi::Result<Option<String>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.element_namespace_uri(self.id())
                .map(|uri| uri.map(str::to_owned))
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Returns the ordered de-duplicated token set of the attribute with
    /// `name`, produced on demand from Core (the read behind a `DOMTokenList`'s
    /// `length` / `item` / iteration surface).
    #[napi(catch_unwind)]
    pub fn token_list(&self, env: Env, name: String) -> napi::Result<Vec<String>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.attribute_token_set(self.id(), &name)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Returns whether the token set of the attribute with `name` contains
    /// `token`; never throws.
    #[napi(catch_unwind)]
    pub fn token_list_contains(&self, env: Env, name: String, token: String) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.attribute_token_contains(self.id(), &name, &token)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Appends missing `tokens` to the token set of the attribute with `name`
    /// (the `DOMTokenList.add` mutator). An empty or whitespace token fails
    /// with `ERR_MAD_DOM_SYNTAX` / `ERR_MAD_DOM_INVALID_CHARACTER` and leaves
    /// the attribute unchanged.
    #[napi(catch_unwind)]
    pub fn token_list_add(&self, env: Env, name: String, tokens: Vec<String>) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        let tokens: Vec<&str> = tokens.iter().map(String::as_str).collect();
        with_document(self.shared(), |doc| {
            doc.attribute_token_add(self.id(), &name, &tokens)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Removes `tokens` from the token set of the attribute with `name` (the
    /// `DOMTokenList.remove` mutator); the same validation applies.
    #[napi(catch_unwind)]
    pub fn token_list_remove(
        &self,
        env: Env,
        name: String,
        tokens: Vec<String>,
    ) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        let tokens: Vec<&str> = tokens.iter().map(String::as_str).collect();
        with_document(self.shared(), |doc| {
            doc.attribute_token_remove(self.id(), &name, &tokens)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(())
    }

    /// Toggles `token` in the token set of the attribute with `name` and
    /// returns whether it is present afterwards (the `DOMTokenList.toggle`
    /// mutator; `force` makes the operation one-way).
    #[napi(catch_unwind)]
    pub fn token_list_toggle(
        &self,
        env: Env,
        name: String,
        token: String,
        force: Option<bool>,
    ) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        let result = with_document(self.shared(), |doc| {
            doc.attribute_token_toggle(self.id(), &name, &token, force)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(result)
    }

    /// Replaces `old_token` with `new_token` in the token set of the attribute
    /// with `name`, returning `false` when `old_token` is absent (the
    /// `DOMTokenList.replace` mutator).
    #[napi(catch_unwind)]
    pub fn token_list_replace(
        &self,
        env: Env,
        name: String,
        old_token: String,
        new_token: String,
    ) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        let result = with_document(self.shared(), |doc| {
            doc.attribute_token_replace(self.id(), &name, &old_token, &new_token)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        // T41: schedule the observer microtasks queued by this mutation.
        schedule_pending_observer_deliveries(&env, self.shared());
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native T34 surface is exactly the entries this module adds:
    /// one document entry and the attribute-node/token entries on the node
    /// class — never a foreign seam's surface.
    #[test]
    fn frozen_contract_surface_is_the_attribute_node_api() {
        assert_eq!(
            DOCUMENT_ATTRIBUTE_NODES_CONTRACT,
            &["validateAttributeName"],
            "native document contract must stay exactly the T34 createAttribute surface"
        );
        assert_eq!(
            NODE_ATTRIBUTE_NODES_CONTRACT,
            &[
                "getAttributes",
                "namespaceUri",
                "tokenList",
                "tokenListContains",
                "tokenListAdd",
                "tokenListRemove",
                "tokenListToggle",
                "tokenListReplace",
            ],
            "native node contract must stay exactly the T34 attribute-node/token surface"
        );
    }

    /// The attribute-node contract owns only the T34 entries: it must never
    /// grow into the T25E attribute read/write symbols, textContent, a query
    /// index or the T24 mutation surface (those stay on their own seams).
    #[test]
    fn contract_has_no_foreign_surface() {
        for name in DOCUMENT_ATTRIBUTE_NODES_CONTRACT
            .iter()
            .chain(NODE_ATTRIBUTE_NODES_CONTRACT)
        {
            assert!(
                *name != "getAttribute"
                    && *name != "setAttribute"
                    && *name != "removeAttribute"
                    && *name != "hasAttribute"
                    && !name.starts_with("text")
                    && !name.contains("query")
                    && !name.contains("getElements")
                    && *name != "appendChild"
                    && *name != "insertBefore"
                    && *name != "removeChild"
                    && *name != "replaceChild",
                "attribute_nodes_api must not declare a foreign seam's surface: {name}"
            );
        }
    }
}
