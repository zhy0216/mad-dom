//! Native Shadow DOM binding (T43).
//!
//! # Role
//!
//! This module is the M8 native extension that exposes the Core Shadow DOM
//! contract (`mad_dom_core::dom::shadow_root`) to JavaScript: `attachShadow`
//! (open/closed mode), the `shadowRoot` / `shadowRootMode` / `shadowHost` /
//! `isShadowRoot` reads behind the facade `ShadowRoot` surface, and the basic
//! `assignedNodes` / `assignedElements` slot reads. Like the M5/M6/M7/M8
//! extensions before it, it adds *new* native symbols to the existing
//! [`NodeHandle`](crate::handle::NodeHandle) class through a second
//! `#[napi] impl` block — napi merges class properties registered for the same
//! Rust type, so the class keeps its audited surface with no duplicate export
//! and no touch to the shared `handle.rs`.
//!
//! A shadow root is an ordinary Core node (a `NodeData::ShadowRoot` in the
//! arena), so every entry returns a [`NodeHandle`] minted through the frozen
//! [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node)
//! wrapper cache. The facade distinguishes a shadow root from a
//! `DocumentFragment` by re-parenting the wrapper onto its `ShadowRoot` class
//! at the minting points (`attachShadow` and the `shadowRoot` getter); this
//! module only reports the mode / host / root relationships the facade needs.
//!
//! # Closed roots never leak
//!
//! [`NodeHandle::shadow_root`] returns a root only when its mode is `open`
//! (Core rejects the `closed` case), so a public `host.shadowRoot` read can
//! never reach a closed tree. The crate-internal mode/host reads used by the
//! event path and the binding still inspect a closed root without exposing it.
//!
//! # Frozen native contract (consumed by the T43 facade)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `el.attachShadow({mode})` | `attachShadow` | `(mode: 0 open \| 1 closed) → NodeHandle` | creates the shadow root (Core rejects a non-Element host or a host that already owns a tree) |
//! | `el.shadowRoot` | `shadowRoot` | `() → NodeHandle \| null` | the open shadow root, or `null` (closed roots and no root) |
//! | `root.mode` | `shadowRootMode` | `() → 0 \| 1 \| null` | the mode of a shadow root, or `null` for other nodes |
//! | `root.host` | `shadowHost` | `() → NodeHandle \| null` | the host element of a shadow root, or `null` |
//! | (facade) | `isShadowRoot` | `() → bool` | whether this node is a shadow root |
//! | `slot.assignedNodes({flatten})` | `slotAssignedNodes` | `(flatten) → NodeHandle[]` | the host children assigned to the slot (named assignment) |
//! | `slot.assignedElements({flatten})` | `slotAssignedElements` | `(flatten) → NodeHandle[]` | the assigned element children |
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with
//! `ERR_MAD_DOM_STALE_HANDLE`, and an invalid `attachShadow` receiver or a
//! host that already owns a shadow tree with `ERR_MAD_DOM_HIERARCHY`.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T43**; like T29/T31/T37 there is no separate integration gate,
//! so T43 also wires the facade and the shared entry/type/ledger surfaces
//! itself. The seam metadata below is the Rust-side pin of the frozen surface;
//! `tests/bun/shadow-dom.test.js` and the `hc-diff-shadow-dom` differential
//! scenario carry the end-to-end evidence.

use napi::bindgen_prelude::Reference;
use napi::Env;
use napi_derive::napi;

use mad_dom_core::dom::ShadowRootMode;

use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, NodeHandle};

/// Seam metadata for the M8 `shadow_dom_api` boundary.
///
/// Like the M5-M7 seams this constant is not referenced by the frozen
/// [`REGISTRY`](crate::extensions::REGISTRY) (T43 owns its own integration), so
/// it is allowed to be otherwise unused.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "shadow_dom_api",
    owner: "T43",
    gate: "T43",
    status: "implemented",
};

/// The frozen native Shadow DOM surface on
/// [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const SHADOW_DOM_CONTRACT: &[&str] = &[
    "attachShadow",
    "shadowRoot",
    "shadowRootMode",
    "shadowHost",
    "isShadowRoot",
    "slotAssignedNodes",
    "slotAssignedElements",
];

#[napi]
impl NodeHandle {
    /// Creates a shadow root of the given mode (`0` = open, `1` = closed) for
    /// this element and returns its handle.
    ///
    /// The facade validates the WebIDL `ShadowRootInit.mode` enum beforehand
    /// and passes `0`/`1`; Core rejects a non-`Element` receiver or a host that
    /// already owns a shadow tree with `ERR_MAD_DOM_HIERARCHY`.
    #[napi(catch_unwind)]
    pub fn attach_shadow(&self, env: Env, mode: u32) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(self.shared(), &env)?;
        let root = with_document(self.shared(), |doc| {
            let mode = if mode == 0 {
                ShadowRootMode::Open
            } else {
                ShadowRootMode::Closed
            };
            doc.attach_shadow(self.id(), mode)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        self.shared().wrap_node(env, root)
    }

    /// Returns this element's `open` shadow root, or `null` when it has none
    /// or the root is `closed` (a closed root never leaks through a public
    /// read).
    #[napi(catch_unwind)]
    pub fn shadow_root(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let root = with_document(self.shared(), |doc| {
            doc.shadow_root(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        match root {
            None => Ok(None),
            Some(id) => self.shared().wrap_node(env, id).map(Some),
        }
    }

    /// Returns the mode of this node when it is a shadow root (`0` = open,
    /// `1` = closed), or `null` for any other node kind.
    #[napi(catch_unwind)]
    pub fn shadow_root_mode(&self, env: Env) -> napi::Result<Option<u32>> {
        check_affinity(self.shared(), &env)?;
        let mode = with_document(self.shared(), |doc| {
            doc.shadow_root_mode(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        Ok(mode.map(|mode| match mode {
            ShadowRootMode::Open => 0,
            ShadowRootMode::Closed => 1,
        }))
    }

    /// Returns the host element of this node when it is a shadow root, or
    /// `null` for any other node kind.
    #[napi(catch_unwind)]
    pub fn shadow_host(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let host = with_document(self.shared(), |doc| {
            doc.shadow_host(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        match host {
            None => Ok(None),
            Some(id) => self.shared().wrap_node(env, id).map(Some),
        }
    }

    /// Returns whether this node is a shadow root (the facade uses it to
    /// distinguish a shadow root from a `DocumentFragment` node with the same
    /// `nodeType`).
    #[napi(catch_unwind)]
    pub fn is_shadow_root(&self, env: Env) -> napi::Result<bool> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.is_shadow_root(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// The WHATWG `HTMLSlotElement.assignedNodes`: the host children assigned
    /// to this `<slot>` element under the default named assignment, in host
    /// document order, or the empty list when the node is not a slot inside a
    /// shadow tree.
    #[napi(catch_unwind)]
    pub fn slot_assigned_nodes(
        &self,
        env: Env,
        flatten: bool,
    ) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.slot_assigned_nodes(self.id(), flatten)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        ids.iter()
            .map(|id| self.shared().wrap_node(env, *id))
            .collect()
    }

    /// The WHATWG `HTMLSlotElement.assignedElements`: like
    /// `assignedNodes`, but only the element children.
    #[napi(catch_unwind)]
    pub fn slot_assigned_elements(
        &self,
        env: Env,
        flatten: bool,
    ) -> napi::Result<Vec<Reference<NodeHandle>>> {
        check_affinity(self.shared(), &env)?;
        let ids = with_document(self.shared(), |doc| {
            doc.slot_assigned_elements(self.id(), flatten)
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        ids.iter()
            .map(|id| self.shared().wrap_node(env, *id))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native surface is exactly the seven Shadow DOM entries this
    /// module adds to `NodeHandle`; `tests/bun/shadow-dom.test.js` re-checks
    /// the same names against the live module.
    #[test]
    fn frozen_contract_surface_is_the_shadow_dom_api() {
        assert_eq!(
            SHADOW_DOM_CONTRACT,
            &[
                "attachShadow",
                "shadowRoot",
                "shadowRootMode",
                "shadowHost",
                "isShadowRoot",
                "slotAssignedNodes",
                "slotAssignedElements",
            ],
            "native shadow-dom contract must stay exactly the T43 surface"
        );
    }

    /// The contract must never drift into a foreign seam's surface (query,
    /// mutation, event, attribute or html).
    #[test]
    fn contract_has_no_foreign_surface() {
        for name in SHADOW_DOM_CONTRACT {
            assert!(
                !name.contains("query")
                    && !name.contains("append")
                    && !name.contains("Event")
                    && !name.contains("Attribute")
                    && !name.contains("HTML")
                    && !name.contains("text")
                    && !name.contains("inner"),
                "shadow_dom_api must not declare a foreign seam's surface: {name}"
            );
        }
    }
}
