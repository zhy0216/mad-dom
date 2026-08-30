//! Native HTMLElement interaction binding (T39).
//!
//! # Role
//!
//! This module is the M7 native extension that exposes the T39 Core contract
//! (`mad_dom_core::dom::html_element`) to JavaScript: the connectivity and
//! inertness reads behind the `focus`/`blur` no-op rules, the per-document
//! active-element reads/writes behind `document.activeElement`, and the
//! `isConnected` read. The *reflected attribute accessors* (`id` / `title` /
//! `dir` / `hidden` / `tabIndex` / `dataset`, ...) need **no native surface**:
//! they are pure facade reads/writes over the existing T25E attribute contract,
//! so the arena stays the single source of attribute truth and the reflection
//! is two-way for free.
//!
//! Like the M5/M6/M7 extensions before it, this module adds *new* native
//! symbols to the existing [`NodeHandle`](crate::handle::NodeHandle) /
//! [`DocumentHandle`](crate::handle::DocumentHandle) classes through second
//! `#[napi] impl` blocks — napi merges class properties registered for the same
//! Rust type, so the classes keep their audited surfaces with no duplicate
//! export and no touch to the shared `handle.rs`.
//!
//! # Focus / blur orchestration (facade-driven, happy-dom sequence)
//!
//! The `focus`/`blur` *events* are dispatched by the T39 facade on top of the
//! T37 propagation engine (the facade owns the `Event` construction and the
//! per-node `dispatchEvent`). This module only provides the atomic state
//! transitions the facade sequences through, mirroring
//! `HTMLElementUtility.focus` / `blur` exactly:
//!
//! | facade step | native method | Core behavior |
//! | --- | --- | --- |
//! | `focus()` | `canFocus` | connected && not inert && not already active → bool |
//! | `focus()` | `previousActive` | the current active element (for the prior `blur`), or `null` |
//! | `focus()` / `blur()` | `clearActiveElement` | forgets the active element |
//! | `focus()` | `setActiveElement` | records this node as active |
//! | `blur()` | `isActive` | this node is the active element and is connected → bool |
//!
//! The order is: `canFocus` → `previousActive` → `clearActiveElement` →
//! dispatch `blur`/`focusout` on the previous (when present) →
//! `setActiveElement` → dispatch `focus`/`focusin` on the target — the exact
//! happy-dom sequence, with the document lock released between every native
//! call so a listener can re-enter freely.
//!
//! # Frozen native contract (consumed by the T39 facade)
//!
//! ## Node surface (on the native `NodeHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `Node.isConnected` | `isConnected` | `() → bool` | whether the node's root ancestor is the `Document` node |
//! | `focus()` predicate | `canFocus` | `() → bool` | connected, not inert, not already active |
//! | `focus()` previous | `previousActive` | `() → NodeHandle \| null` | the current active element before this focus |
//! | `blur()` predicate | `isActive` | `() → bool` | this node is the connected active element |
//! | `focus()`/`blur()` state | `clearActiveElement` | `() → ()` | forgets the active element |
//! | `focus()` state | `setActiveElement` | `() → ()` | records this node as active |
//!
//! ## Document surface (on the native `DocumentHandle`)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `document.activeElement` | `activeElement` | `() → NodeHandle \| null` | the stored active element (stale-cleared), or `null` |
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates. The document lock is
//! never held across a JS call — each entry acquires it, completes a pure Core
//! transition and releases it before returning.
//!
//! # Ownership
//!
//! Owned by **T39**; like T29/T31/T32/T33/T34/T37 there is no separate
//! integration gate, so T39 also wires the facade and the shared entry/type/
//! ledger surfaces itself. The seam metadata below is the Rust-side pin of the
//! frozen surface; `tests/bun/html-element.test.js` and the
//! `hc-diff-html-element` differential scenario carry the end-to-end evidence.

use napi::bindgen_prelude::Reference;
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;

use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle, SharedDocument};

/// Seam metadata for the M7 `html_element_api` boundary.
///
/// Like the M5/M6/M7 seams this constant is not referenced by the frozen
/// [`REGISTRY`](crate::extensions::REGISTRY) (T39 owns its own integration), so
/// it is allowed to be otherwise unused.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "html_element_api",
    owner: "T39",
    gate: "T39",
    status: "implemented",
};

/// The frozen native interaction surface on
/// [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const NODE_HTML_ELEMENT_CONTRACT: &[&str] = &[
    "isConnected",
    "canFocus",
    "previousActive",
    "isActive",
    "clearActiveElement",
    "setActiveElement",
];

/// The frozen native interaction surface on
/// [`DocumentHandle`](crate::handle::DocumentHandle).
#[allow(dead_code)]
pub(crate) const DOCUMENT_HTML_ELEMENT_CONTRACT: &[&str] = &["activeElement"];

/// Maps an `Option<NodeId>` from a Core active-element read into a wrapped JS
/// node (or `null`), minting the wrapper through the single per-document weak
/// cache.
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

/// Runs `f` against the live document, mapping lifecycle failures with the
/// T21A error outlet.
fn run_document<T>(
    shared: &std::sync::Arc<SharedDocument>,
    f: impl FnOnce(
        &mut mad_dom_core::dom::Document,
    ) -> std::result::Result<T, crate::error::BindingError>,
) -> std::result::Result<T, crate::error::BindingError> {
    with_document(shared, f)
}

#[napi]
impl DocumentHandle {
    /// Returns the stored `document.activeElement` (stale-cleared by Core), or
    /// `null` when nothing is focused.
    #[napi(catch_unwind)]
    pub fn active_element(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = run_document(self.shared(), |doc| {
            doc.active_element()
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), id)
    }
}

#[napi]
impl NodeHandle {
    /// Returns whether this node is connected to its document (its root
    /// ancestor is the `Document` node) — the read behind `Node.isConnected`.
    #[napi(catch_unwind)]
    pub fn is_connected(&self, env: Env) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        run_document(self.shared(), |doc| {
            doc.is_connected(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The happy-dom `focus()` no-op predicate: connected, not inert and not
    /// already the active element. Does **not** change the active element.
    #[napi(catch_unwind)]
    pub fn can_focus(&self, env: Env) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        run_document(self.shared(), |doc| {
            if !doc.is_connected(self.id())? {
                return Ok(false);
            }
            if doc.is_inert(self.id())? {
                return Ok(false);
            }
            if doc.active_element()? == Some(self.id()) {
                return Ok(false);
            }
            Ok(true)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The current active element before this `focus()` proceeds (the prior
    /// target of the happy-dom `blur`), or `null` when nothing was focused.
    #[napi(catch_unwind)]
    pub fn previous_active(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let id = run_document(self.shared(), |doc| {
            doc.active_element()
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        wrap_optional(env, self.shared(), id)
    }

    /// The happy-dom `blur()` no-op predicate: this node is the active element
    /// and is still connected. Does **not** change the active element.
    #[napi(catch_unwind)]
    pub fn is_active(&self, env: Env) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        run_document(self.shared(), |doc| {
            if !doc.is_connected(self.id())? {
                return Ok(false);
            }
            Ok(doc.active_element()? == Some(self.id()))
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Forgets the document's active element (the `blur`/`focus` transition).
    #[napi(catch_unwind)]
    pub fn clear_active_element(&self, env: Env) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        run_document(self.shared(), |doc| {
            doc.set_active_element(None);
            Ok(())
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// Records this node as the document's active element (the `focus`
    /// transition).
    #[napi(catch_unwind)]
    pub fn set_active_element(&self, env: Env) -> napi::Result<()> {
        check_affinity(self.shared(), &env)?;
        run_document(self.shared(), |doc| {
            doc.set_active_element(Some(self.id()));
            Ok(())
        })
        .map_err(|err| err.into_napi(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native T39 surface is exactly the interaction entries this
    /// module adds: the six node transitions plus the one document read —
    /// never a foreign seam's surface and never a reflected-attribute symbol
    /// (those stay facade-only over the T25E attribute contract).
    #[test]
    fn frozen_contract_surface_is_the_html_element_api() {
        assert_eq!(
            NODE_HTML_ELEMENT_CONTRACT,
            &[
                "isConnected",
                "canFocus",
                "previousActive",
                "isActive",
                "clearActiveElement",
                "setActiveElement",
            ],
            "native node contract must stay exactly the T39 interaction surface"
        );
        assert_eq!(
            DOCUMENT_HTML_ELEMENT_CONTRACT,
            &["activeElement"],
            "native document contract must stay exactly the T39 activeElement read"
        );
    }

    /// The interaction contract must never drift into the reflected attribute
    /// symbols (those are facade-only over the T25E attribute contract), the
    /// attribute read/write surface, textContent, inner/outerHTML or the
    /// T24/T31/T34/T37 surfaces.
    #[test]
    fn contract_has_no_foreign_surface() {
        for name in NODE_HTML_ELEMENT_CONTRACT
            .iter()
            .chain(DOCUMENT_HTML_ELEMENT_CONTRACT.iter())
        {
            assert!(
                !name.starts_with("getAttribute")
                    && !name.starts_with("setAttribute")
                    && !name.starts_with("removeAttribute")
                    && !name.starts_with("hasAttribute")
                    && !name.contains("text")
                    && !name.contains("html")
                    && !name.contains("query")
                    && !name.contains("getElements")
                    && *name != "appendChild"
                    && *name != "dispatchEvent"
                    && *name != "addEventListener"
                    && !name.starts_with("dataset"),
                "html_element_api must not declare a foreign seam's surface: {name}"
            );
        }
    }
}
