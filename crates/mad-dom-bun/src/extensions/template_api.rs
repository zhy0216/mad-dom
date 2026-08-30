//! Native `HTMLTemplateElement.content` binding (T40).
//!
//! # Role
//!
//! This module is the M7 native extension that exposes the Core template
//! contract (`mad_dom_core::dom::template`) to JavaScript: the single
//! `templateContent()` read behind `HTMLTemplateElement.content`. Everything
//! else the template surface needs — `innerHTML` / `outerHTML` (which the Core
//! routes through the template-contents fragment), serialization, clone/import/
//! adopt of the content — is already handled inside Core, so the facade's
//! template slice is a thin accessor over this one native entry plus the
//! existing T29 surface.
//!
//! Like the M5/M6/M7 extensions before it, this module adds *new* native
//! symbols to the existing [`NodeHandle`](crate::handle::NodeHandle) class
//! through a second `#[napi] impl` block — napi merges class properties
//! registered for the same Rust type, so the class keeps its audited surface
//! with no duplicate export and no touch to the shared `handle.rs`.
//!
//! # Frozen native contract (consumed by the T40 facade)
//!
//! | WHATWG name (facade) | native method | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `template.content` | `templateContent` | `() → NodeHandle` | the template-contents `DocumentFragment`, created on first access (a non-template target fails with `ERR_MAD_DOM_HIERARCHY`) |
//!
//! # Single source of tree state
//!
//! The content fragment lives in the Core arena and the association in Core's
//! per-document map; this module keeps no copy and builds no second state.
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign handle with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`
//! and a non-`<template>` element with `ERR_MAD_DOM_HIERARCHY`.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard first, matching the crate safety model. This module writes no
//! `unsafe`; FFI/unsafe stays inside the `napi` crates.
//!
//! # Ownership
//!
//! Owned by **T40**; like the other M7 extensions there is no separate
//! integration gate, so T40 also wires the facade and the shared
//! entry/type/ledger surfaces itself. The seam metadata below is the Rust-side
//! pin of the frozen surface; `tests/bun/template-form.test.js` and the
//! `hc-diff-template` differential scenario carry the end-to-end evidence.

use napi::bindgen_prelude::Reference;
use napi::Env;
use napi_derive::napi;

use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, NodeHandle};

/// Seam metadata for the M7 `template_api` boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "template_api",
    owner: "T40",
    gate: "T40",
    status: "implemented",
};

/// The frozen native template surface on [`NodeHandle`](crate::handle::NodeHandle).
#[allow(dead_code)]
pub(crate) const TEMPLATE_CONTRACT: &[&str] = &["templateContent"];

#[napi]
impl NodeHandle {
    /// Returns the WHATWG `template.content`: the template-contents
    /// `DocumentFragment` of a `<template>` element, creating it on first
    /// access. A non-`<template>` element fails with `ERR_MAD_DOM_HIERARCHY`.
    #[napi(catch_unwind)]
    pub fn template_content(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(self.shared(), &env)?;
        let id = with_document(self.shared(), |doc| {
            doc.template_content(self.id())
                .map_err(crate::error::BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        self.shared().wrap_node(env, id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native T40 template surface is exactly the one content entry
    /// this module adds — never a foreign seam's surface (the innerHTML /
    /// outerHTML / clone surface stays in Core and the existing T29 / T33
    /// entries).
    #[test]
    fn frozen_template_contract_surface() {
        assert_eq!(
            TEMPLATE_CONTRACT,
            &["templateContent"],
            "native template contract must stay exactly the T40 content entry"
        );
    }
}
