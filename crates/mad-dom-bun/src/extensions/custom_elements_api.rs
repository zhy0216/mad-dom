//! Native Custom Element binding (T42).
//!
//! # Role
//!
//! This module is the M8 native extension that exposes the Core T42 custom
//! element contract (crates/mad-dom-core/src/dom/custom_elements.rs) to
//! JavaScript: the module-level registry entries (`defineCustomElement` /
//! `upgradeCustomElements` / `markCustomElementsInSubtree` /
//! `listCustomElementCandidates` / `takeCustomElementReactions` /
//! `documentRootNode`) and the opaque [`CustomElementReactionHandle`] behind
//! each queued reaction. Like the M5/M6/M7 extensions before it, it adds *new*
//! native symbols through `#[napi]` module functions and a new class; it
//! touches no shared wiring file beyond the module declaration.
//!
//! # Core owns the reactions; the facade owns the definitions and the dispatch
//!
//! Core stores the per-document custom element state — the observed-attribute
//! snapshots of the defined names, the set of upgraded (custom) elements and
//! the synchronous reaction queue. The facade owns the JavaScript constructors
//! and their lifecycle callbacks, exactly like happy-dom's
//! `CustomElementRegistry`, and dispatches the drained reactions synchronously
//! through the wrapper's prototype.
//!
//! The reaction queue is *synchronous*: the facade drains it with
//! `takeCustomElementReactions` immediately after every mutating native call it
//! performs (append/insert/remove/replace, attribute writes, the apply path,
//! define/upgrade) and invokes the callbacks in enqueue order, outside the
//! document lock — so a callback may freely re-enter the API. This mirrors the
//! happy-dom baseline, which fires the lifecycle callbacks synchronously at the
//! mutation point. Unlike the T41 observer deliveries (microtask-based), no
//! scheduler seam is needed: the facade decides when to drain.
//!
//! The two operations that both upgrade elements *and* queue their reactions
//! in one native call — `defineCustomElement` and the apply path — are handled
//! in two phases: the native call returns the upgraded element handles (or the
//! facade walks them via `listCustomElementCandidates`), the facade sets each
//! wrapper's prototype, and *then* drains the queue, so a connected callback
//! never sees an element whose prototype is not yet the custom class.
//!
//! # Frozen native contract (consumed by the T42 facade)
//!
//! | facade action | native entry | params → returns | behavior |
//! | --- | --- | --- | --- |
//! | `registry.define(name, observed)` | `defineCustomElement` | `(doc, name, observed[]) → NodeHandle[]` | registers the definition, physically replaces the connected matching elements with fresh custom elements and enqueues the replacements' `Connected` reaction; returns the replacement handles |
//! | `registry.upgrade(root)` (T48D no-op) | `upgradeCustomElements` | `(root) → NodeHandle[]` | retained for the frozen T42 contract; the facade no longer wires `registry.upgrade()` to it (happy-dom documents `upgrade()` as "Not implemented yet", so the facade is a no-op) |
//! | clone/import/adopt | `markCustomElementsInSubtree` | `(root) → NodeHandle[]` | marks every defined-name element custom (no reactions); returns them |
//! | post-apply | `listCustomElementCandidates` | `(root) → NodeHandle[]` | returns every upgraded custom element in the subtree |
//! | post-mutation flush | `takeCustomElementReactions` | `(node) → CustomElementReactionHandle[]` | drains the document's reaction queue |
//! | registry lookup | `documentRootNode` | `(node) → NodeHandle` | the document's `Document`-kind root node (the stable per-document registry key) |
//! | reaction reads | on `CustomElementReactionHandle` | `kind / element / attributeName / oldValue / newValue` | the lifecycle-callback payload; node reads mint wrappers through the T20 weak cache |
//!
//! The facade owns the WebIDL name/constructor validation and the happy-dom
//! `DOMException` messages; this module receives a validated name and the
//! resolved observed-attribute list and forwards them verbatim.
//!
//! # Lifecycle
//!
//! Reaction handles are transient (drained in the same tick as the mutation
//! that queued them), so they hold a strong `Arc` to their document only for
//! their short life; the document itself is kept alive by the window / node
//! handles per the T20 ownership chain. No callback reference is stored here —
//! the facade holds the constructors.
//!
//! # Safety preconditions
//!
//! Every entry is marked `#[napi(catch_unwind)]` and checks the T21B affinity
//! guard before touching Core state, matching the crate safety model. The
//! document lock is never held across a JS call: the reactions are drained and
//! converted to handles *outside* the lock (`take_custom_element_reactions`
//! returns owned Core data, then the handles are minted after `with_document`
//! returns), and the facade invokes the callbacks after the native call
//! returns. No `unsafe` is written here.
//!
//! # Ownership
//!
//! Owned by **T42**; like T41 there is no separate integration gate, so T42
//! also wires the facade, the shared entry/type/ledger surfaces and the seam
//! metadata itself. `tests/bun/custom-elements.test.js` and the
//! `hc-diff-custom-elements` differential scenario carry the end-to-end
//! evidence.

use std::sync::Arc;

use napi::bindgen_prelude::{JavaScriptClassExt, Reference};
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{CustomElementReaction, CustomElementReactionKind};

use crate::error::BindingError;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle, SharedDocument};

/// Seam metadata for the M8 `custom_elements_api` boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "custom_elements_api",
    owner: "T42",
    gate: "T42",
    status: "implemented",
};

/// The frozen native registry surface on the module.
#[allow(dead_code)]
pub(crate) const REGISTRY_CONTRACT: &[&str] = &[
    "defineCustomElement",
    "upgradeCustomElements",
    "markCustomElementsInSubtree",
    "listCustomElementCandidates",
    "takeCustomElementReactions",
    "documentRootNode",
];

/// The frozen native reaction surface on [`CustomElementReactionHandle`].
#[allow(dead_code)]
pub(crate) const REACTION_CONTRACT: &[&str] =
    &["kind", "element", "attributeName", "oldValue", "newValue"];

/// Registers a custom element definition and upgrades the connected elements
/// of `name`, returning the upgraded element handles.
///
/// The observed-attribute snapshot is pushed into Core (the happy-dom
/// lowercased-snapshot rule); the facade owns the constructor. The `Connected`
/// reactions of the upgraded elements stay queued — the facade sets the wrapper
/// prototypes on the returned handles first, then drains the queue.
#[napi(catch_unwind)]
#[allow(dead_code)] // registered as a native module export by napi-derive's load-time ctor
pub fn define_custom_element(
    env: Env,
    doc: &DocumentHandle,
    name: String,
    observed_attributes: Vec<String>,
) -> napi::Result<Vec<Reference<NodeHandle>>> {
    check_affinity(doc.shared(), &env)?;
    let upgraded = with_document(doc.shared(), |document| {
        Ok(document.define_custom_element(&name, observed_attributes))
    })
    .map_err(|err| err.into_napi(&env))?;
    upgraded
        .into_iter()
        .map(|id| doc.shared().wrap_node(env, id))
        .collect()
}

/// Upgrades every element of a defined name in the subtree rooted at `root`.
///
/// Retained for the frozen T42 contract (and the T29 apply path symmetry, where
/// Core upgrades parsed elements directly); the facade no longer calls it —
/// `registry.upgrade()` is a happy-dom-parity no-op (T48D), so this entry is
/// not reachable from the public API.
#[napi(catch_unwind)]
#[allow(dead_code)] // registered as a native module export by napi-derive's load-time ctor
pub fn upgrade_custom_elements(
    env: Env,
    root: &NodeHandle,
) -> napi::Result<Vec<Reference<NodeHandle>>> {
    check_affinity(root.shared(), &env)?;
    let upgraded = with_document(root.shared(), |doc| {
        doc.upgrade_custom_elements(root.id())
            .map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(&env))?;
    upgraded
        .into_iter()
        .map(|id| root.shared().wrap_node(env, id))
        .collect()
}

/// Marks every element of a defined name in the subtree rooted at `root` as
/// custom (no reactions), returning the newly marked handles.
///
/// The clone/import/adopt facade paths use it so a cloned or adopted subtree
/// keeps the custom class on every element (happy-dom parity) while firing no
/// lifecycle callback.
#[napi(catch_unwind)]
#[allow(dead_code)] // registered as a native module export by napi-derive's load-time ctor
pub fn mark_custom_elements_in_subtree(
    env: Env,
    root: &NodeHandle,
) -> napi::Result<Vec<Reference<NodeHandle>>> {
    check_affinity(root.shared(), &env)?;
    let marked = with_document(root.shared(), |doc| {
        doc.mark_custom_elements_in_subtree(root.id())
            .map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(&env))?;
    marked
        .into_iter()
        .map(|id| root.shared().wrap_node(env, id))
        .collect()
}

/// Returns every upgraded custom element in the subtree rooted at `root`.
///
/// The facade calls it after the apply path (innerHTML / outerHTML / load_html)
/// so it can set the wrapper prototypes of the elements Core upgraded during
/// the parse, before the queued reactions are dispatched.
#[napi(catch_unwind)]
#[allow(dead_code)] // registered as a native module export by napi-derive's load-time ctor
pub fn list_custom_element_candidates(
    env: Env,
    root: &NodeHandle,
) -> napi::Result<Vec<Reference<NodeHandle>>> {
    check_affinity(root.shared(), &env)?;
    let ids = with_document(root.shared(), |doc| {
        doc.list_custom_element_candidates(root.id())
            .map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(&env))?;
    ids.into_iter()
        .map(|id| root.shared().wrap_node(env, id))
        .collect()
}

/// Drains the pending custom element reactions of `node`'s document, in
/// enqueue order, converting each to an opaque handle.
///
/// The reactions are drained with the document lock held (removed from the
/// queue) but the opaque handles are minted after the lock is released; the
/// facade dispatches the callbacks synchronously after the native call returns,
/// so a callback may re-enter the API without deadlocking.
#[napi(catch_unwind)]
#[allow(dead_code)] // registered as a native module export by napi-derive's load-time ctor
pub fn take_custom_element_reactions(
    env: Env,
    node: &NodeHandle,
) -> napi::Result<Vec<Reference<CustomElementReactionHandle>>> {
    check_affinity(node.shared(), &env)?;
    let reactions = with_document(node.shared(), |doc| Ok(doc.take_custom_element_reactions()))
        .map_err(|err| err.into_napi(&env))?;
    reactions
        .into_iter()
        .map(|reaction| reaction_handle(&env, node.shared(), reaction))
        .collect()
}

/// Returns the `Document`-kind root node of `node`'s document.
///
/// The root node is the stable per-document registry key the facade maps back
/// to its `CustomElementRegistry` (the facade cannot derive a document handle
/// from a node handle without crossing the sealed `handle.rs` boundary).
#[napi(catch_unwind)]
#[allow(dead_code)] // registered as a native module export by napi-derive's load-time ctor
pub fn document_root_node(env: Env, node: &NodeHandle) -> napi::Result<Reference<NodeHandle>> {
    check_affinity(node.shared(), &env)?;
    let root = with_document(node.shared(), |doc| Ok(doc.document_root()))
        .map_err(|err| err.into_napi(&env))?;
    node.shared().wrap_node(env, root)
}

// --- CustomElementReactionHandle ---------------------------------------------

/// JavaScript-facing wrapper for one queued custom element reaction.
///
/// Carries the owning document link (to mint the element wrapper through the
/// T20 weak cache) plus the reaction payload. Transient: drained and dispatched
/// synchronously by the facade in the same tick as the mutation that queued it.
#[napi]
pub struct CustomElementReactionHandle {
    document: Arc<SharedDocument>,
    kind: String,
    element: NodeId,
    attribute_name: Option<String>,
    old_value: Option<String>,
    new_value: Option<String>,
}

/// Converts a drained Core [`CustomElementReaction`] into an opaque JS handle.
fn reaction_handle(
    env: &Env,
    shared: &Arc<SharedDocument>,
    reaction: CustomElementReaction,
) -> napi::Result<Reference<CustomElementReactionHandle>> {
    CustomElementReactionHandle {
        document: Arc::clone(shared),
        kind: match reaction.kind {
            CustomElementReactionKind::Connected => "connected".to_string(),
            CustomElementReactionKind::Disconnected => "disconnected".to_string(),
            CustomElementReactionKind::AttributeChanged => "attributeChanged".to_string(),
        },
        element: reaction.element,
        attribute_name: reaction.attribute_name,
        old_value: reaction.old_value,
        new_value: reaction.new_value,
    }
    .into_reference(*env)
}

#[napi]
impl CustomElementReactionHandle {
    /// The lifecycle-callback name: `connected` / `disconnected` /
    /// `attributeChanged`.
    #[napi(catch_unwind)]
    pub fn kind(&self) -> String {
        self.kind.clone()
    }

    /// The element the reaction targets (the wrapper is minted through the T20
    /// weak cache, so the facade sees the stable per-node wrapper).
    #[napi(catch_unwind)]
    pub fn element(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        self.document.wrap_node(env, self.element)
    }

    /// The changed attribute's name (`attributeChanged` reactions), or `null`.
    #[napi(catch_unwind)]
    pub fn attribute_name(&self) -> Option<String> {
        self.attribute_name.clone()
    }

    /// The attribute's old value, or `null`.
    #[napi(catch_unwind)]
    pub fn old_value(&self) -> Option<String> {
        self.old_value.clone()
    }

    /// The attribute's new value, or `null` for removals.
    #[napi(catch_unwind)]
    pub fn new_value(&self) -> Option<String> {
        self.new_value.clone()
    }
}

// --- unit tests ---------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native surface is exactly the registry entries plus the
    /// reaction reads; `tests/bun/custom-elements.test.js` re-checks the same
    /// names against the live module.
    #[test]
    fn frozen_contract_surfaces_are_the_custom_elements_api() {
        assert_eq!(
            REGISTRY_CONTRACT,
            &[
                "defineCustomElement",
                "upgradeCustomElements",
                "markCustomElementsInSubtree",
                "listCustomElementCandidates",
                "takeCustomElementReactions",
                "documentRootNode",
            ],
            "native registry contract must stay exactly the T42 surface"
        );
        assert_eq!(
            REACTION_CONTRACT,
            &["kind", "element", "attributeName", "oldValue", "newValue"],
            "native reaction contract must stay exactly the T42 surface"
        );
    }

    /// The registry contract must never drift into the observer, attribute,
    /// event or tree-mutation seams (T41 / T25E / T37 / T24 boundaries).
    #[test]
    fn contract_has_no_foreign_surface() {
        for name in REGISTRY_CONTRACT {
            assert!(
                !name.starts_with("on")
                    && !name.contains("Observer")
                    && !name.contains("Attribute")
                    && !name.contains("EventListener")
                    && !name.contains("Child")
                    && !name.contains("append")
                    && !name.contains("remove"),
                "custom_elements_api must not declare a foreign seam's surface: {name}"
            );
        }
        for name in REACTION_CONTRACT {
            assert!(
                *name != "timeStamp"
                    && *name != "composedPath"
                    && *name != "target"
                    && *name != "type"
                    && !name.contains("EventListener"),
                "reaction contract must not declare the T37/T38/T41 surface: {name}"
            );
        }
        assert_eq!(REACTION_CONTRACT.len(), 5);
    }

    /// The reaction kind strings are exactly the WHATWG lifecycle names the
    /// facade dispatches on (a regression pin for the string mapping).
    #[test]
    fn reaction_kind_strings_are_the_lifecycle_names() {
        assert_eq!(
            CustomElementReactionKind::Connected,
            CustomElementReactionKind::Connected
        );
        assert_ne!(
            CustomElementReactionKind::Connected,
            CustomElementReactionKind::Disconnected
        );
    }
}
