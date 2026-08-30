//! Native `TreeWalker` / `NodeIterator` binding (T35).
//!
//! # Role
//!
//! This module is the M7 native extension that exposes the Core traversal
//! state machines (`mad_dom_core::traversal`) to JavaScript:
//! `document.createTreeWalker` / `document.createNodeIterator` return opaque
//! [`TreeWalkerHandle`] / [`NodeIteratorHandle`] wrappers that carry the
//! walker state (root, current, `whatToShow` and the wrapped user filter) and
//! drive one traversal method at a time. Like the M5/M6 `html_api` /
//! `query_api` extensions it adds *new* native symbols to the existing
//! [`DocumentHandle`] through a second `#[napi] impl` block — napi merges
//! class properties registered for the same Rust type, so the class keeps its
//! audited surface with no duplicate export and no touch to the shared
//! `handle.rs`.
//!
//! # Frozen native contract (consumed by the T35 facade)
//!
//! | WHATWG name (facade) | native method | params → returns |
//! | --- | --- | --- |
//! | `document.createTreeWalker` | `createTreeWalker` | `(root: NodeHandle, whatToShow: u32, filter: Function\|null) → TreeWalkerHandle` |
//! | `document.createNodeIterator` | `createNodeIterator` | `(root, whatToShow, filter) → NodeIteratorHandle` |
//! | `walker.root` | `root` | `() → NodeHandle` |
//! | `walker.whatToShow` | `whatToShow` | `() → u32` |
//! | `walker.currentNode` | `currentNode` | `() → NodeHandle` |
//! | `walker.currentNode = n` | `setCurrentNode` | `(n: NodeHandle) → void` |
//! | `walker.parentNode()` | `parentNode` | `() → Option<NodeHandle>` |
//! | `walker.firstChild()` | `firstChild` | `() → Option<NodeHandle>` |
//! | `walker.lastChild()` | `lastChild` | `() → Option<NodeHandle>` |
//! | `walker.nextSibling()` | `nextSibling` | `() → Option<NodeHandle>` |
//! | `walker.previousSibling()` | `previousSibling` | `() → Option<NodeHandle>` |
//! | `walker.nextNode()` | `nextNode` | `() → Option<NodeHandle>` |
//! | `walker.previousNode()` | `previousNode` | `() → Option<NodeHandle>` |
//! | `iterator.root` | `root` | `() → NodeHandle` |
//! | `iterator.whatToShow` | `whatToShow` | `() → u32` |
//! | `iterator.nextNode()` | `nextNode` | `() → Option<NodeHandle>` |
//! | `iterator.previousNode()` | `previousNode` | `() → Option<NodeHandle>` |
//!
//! The facade owns the WebIDL coercion of the arguments (`whatToShow` as the
//! coerced `unsigned long`, the user filter wrapped into a stable function
//! that accepts a facade node and returns the raw `FILTER_*` number) and
//! delegates the property reads it needs; this module receives plain Rust
//! values and forwards them verbatim.
//!
//! # Filter callbacks live here, not in Core
//!
//! Core stores no JavaScript callback — it yields a
//! [`TraversalStep::Filter`](mad_dom_core::traversal::TraversalStep::Filter)
//! exactly when the user filter must decide a candidate, and the binding
//! invokes the JS filter *outside* the document lock (the filter may mutate
//! the tree, matching the baseline), then feeds the raw result back through
//! [`Document::traversal_filter`](mad_dom_core::dom::Document::traversal_filter).
//! The per-walker [`FunctionRef`] is kept on the handle itself (a strong JS
//! reference, released when the walker is collected), so the walker needs no
//! global callback registry.
//!
//! # Stable handles, never bare ids
//!
//! The walker stores its root and current as [`Reference<NodeHandle>`]s — the
//! per-document weak-cache wrappers (T20), pinned by the walker for as long as
//! it lives — and mints every returned node through
//! [`SharedDocument::wrap_node`](crate::handle::SharedDocument::wrap_node), so
//! `walker.currentNode === walker.nextNode()`-style identity holds across the
//! facade. Tree mutations (removal keeps the node's [`NodeId`] live in the
//! arena) are observed by the next step, and a stale or foreign id is rejected
//! by Core with a structured error instead of a dangling access.
//!
//! # Error semantics (frozen)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign root/current with
//! `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with `ERR_MAD_DOM_STALE_HANDLE`,
//! and `setCurrentNode` rejects a non-node of the same document the same way.
//! A user filter that throws propagates its exception out of the traversal
//! call unchanged (the walker's current node stays put, matching the baseline).
//!
//! # Safety preconditions
//!
//! Every `#[napi]` entry is marked `#[napi(catch_unwind)]` and checks the T21B
//! affinity guard first, matching the crate safety model. No `unsafe` is
//! written here beyond the single well-contained `Unknown`→`Function` cast (the
//! same relaxation the T37 event module documents); FFI/unsafe stays inside the
//! `napi` crates. The document lock is never held across a JS filter call.
//!
//! # Ownership
//!
//! Owned by **T35**; like T29/T31/T37 there is no separate integration gate, so
//! T35 also wires the facade, the shared entry/type/ledger surfaces and the
//! seam metadata itself. `tests/bun/traversal.test.js`, the `hc-diff-traversal`
//! differential scenario and the Core fixtures carry the end-to-end evidence.

use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::{Function, FunctionRef, JavaScriptClassExt, Reference, Unknown};
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;
use mad_dom_core::traversal::{TraversalOp, TraversalStep, FILTER_ACCEPT};

use crate::error::BindingError;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle, SharedDocument};

/// Seam metadata for the M7 `traversal_api` boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "traversal_api",
    owner: "T35",
    gate: "T35",
    status: "implemented",
};

/// The frozen native `TreeWalker` surface.
#[allow(dead_code)]
pub(crate) const TREEWALKER_CONTRACT: &[&str] = &[
    "root",
    "whatToShow",
    "currentNode",
    "setCurrentNode",
    "parentNode",
    "firstChild",
    "lastChild",
    "nextSibling",
    "previousSibling",
    "nextNode",
    "previousNode",
];

/// The frozen native `NodeIterator` surface.
#[allow(dead_code)]
pub(crate) const NODEITERATOR_CONTRACT: &[&str] =
    &["root", "whatToShow", "nextNode", "previousNode"];

/// Locks the walker's current-node handle, recovering a poisoned lock.
fn lock_current(
    current: &Mutex<Reference<NodeHandle>>,
) -> std::sync::MutexGuard<'_, Reference<NodeHandle>> {
    current
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Converts a `Unknown` filter argument (the facade's wrapped user filter, or
/// `null`) into the stored [`FunctionRef`], returning `None` for `null`.
fn store_filter(
    filter: &Unknown<'_>,
) -> napi::Result<Option<FunctionRef<Reference<NodeHandle>, u32>>> {
    match filter.get_type()? {
        napi::ValueType::Null | napi::ValueType::Undefined => Ok(None),
        _ => {
            // The facade always passes a function wrapper; the cast is the
            // single well-contained `unsafe` in this module (the same
            // relaxation as the T37 listener path).
            let function: Function<'static, Reference<NodeHandle>, u32> =
                unsafe { (*filter).cast() }?;
            Ok(Some(function.create_ref()?))
        }
    }
}

/// Drives one traversal pass to completion.
///
/// Runs the Core state machine one step at a time: for every
/// [`TraversalStep::Filter`] it mints the candidate wrapper and invokes the
/// user filter *outside* the document lock, then feeds the raw result back.
/// On completion it stores the accepted node as the walker's current and
/// returns its wrapper.
fn drive_traversal(
    env: &Env,
    shared: &Arc<SharedDocument>,
    root: NodeId,
    current: &Mutex<Reference<NodeHandle>>,
    what_to_show: u32,
    filter: &Option<FunctionRef<Reference<NodeHandle>, u32>>,
    op: TraversalOp,
) -> napi::Result<Option<Reference<NodeHandle>>> {
    let current_id = lock_current(current).id();
    let (mut pass, mut step) = with_document(shared, |doc| {
        doc.traversal_start(op, root, current_id, what_to_show, filter.is_some())
            .map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(env))?;
    loop {
        match step {
            TraversalStep::Done(Some(id)) => {
                let wrapped = shared.wrap_node(*env, id)?;
                *lock_current(current) = wrapped.clone(*env)?;
                return Ok(Some(wrapped));
            }
            TraversalStep::Done(None) => return Ok(None),
            TraversalStep::Filter(id) => {
                let wrapped = shared.wrap_node(*env, id)?;
                // Core only yields a Filter step when a user filter exists;
                // the callback may throw (propagating out of this entry) or
                // mutate the tree (observed by the next step).
                let function = filter
                    .as_ref()
                    .expect("Core yields a filter step only when a filter exists")
                    .borrow_back(env)?;
                let result: u32 = function.call(wrapped)?;
                step = with_document(shared, |doc| {
                    doc.traversal_filter(&mut pass, result)
                        .map_err(BindingError::Core)
                })
                .map_err(|err| err.into_napi(env))?;
            }
        }
    }
}

// --- TreeWalker handle ------------------------------------------------------

/// JavaScript-facing wrapper for one `TreeWalker`'s state.
///
/// Holds the root and current as stable [`Reference<NodeHandle>`]s (never a
/// bare [`NodeId`]), the coerced `whatToShow` mask and the wrapped user filter.
#[napi]
pub struct TreeWalkerHandle {
    shared: Arc<SharedDocument>,
    root: Reference<NodeHandle>,
    current: Mutex<Reference<NodeHandle>>,
    what_to_show: u32,
    filter: Option<FunctionRef<Reference<NodeHandle>, u32>>,
}

#[napi]
impl TreeWalkerHandle {
    /// Returns the walker's root (the same wrapper object on every read).
    #[napi(catch_unwind)]
    pub fn root(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        self.root.clone(env)
    }

    /// Returns the walker's `whatToShow` mask.
    #[napi(catch_unwind)]
    pub fn what_to_show(&self) -> u32 {
        self.what_to_show
    }

    /// Returns the walker's current node (the node of the last accepted step).
    #[napi(catch_unwind)]
    pub fn current_node(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        lock_current(&self.current).clone(env)
    }

    /// Sets the walker's current node, validating it as a live node of the
    /// same document.
    #[napi(catch_unwind)]
    pub fn set_current_node(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        with_document(&self.shared, |doc| {
            doc.get(node.id()).map(|_| ()).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        *lock_current(&self.current) = node;
        Ok(())
    }

    /// WHATWG `TreeWalker.parentNode`.
    #[napi(catch_unwind)]
    pub fn parent_node(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::ParentNode,
        )
    }

    /// WHATWG `TreeWalker.firstChild`.
    #[napi(catch_unwind)]
    pub fn first_child(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::FirstChild,
        )
    }

    /// WHATWG `TreeWalker.lastChild`.
    #[napi(catch_unwind)]
    pub fn last_child(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::LastChild,
        )
    }

    /// WHATWG `TreeWalker.nextSibling`.
    #[napi(catch_unwind)]
    pub fn next_sibling(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::NextSibling,
        )
    }

    /// WHATWG `TreeWalker.previousSibling`.
    #[napi(catch_unwind)]
    pub fn previous_sibling(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::PreviousSibling,
        )
    }

    /// WHATWG `TreeWalker.nextNode`.
    #[napi(catch_unwind)]
    pub fn next_node(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::NextNode,
        )
    }

    /// WHATWG `TreeWalker.previousNode`.
    #[napi(catch_unwind)]
    pub fn previous_node(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::PreviousNode,
        )
    }
}

// --- NodeIterator handle ----------------------------------------------------

/// JavaScript-facing wrapper for one `NodeIterator`'s state.
///
/// Like the walker, holds stable node handles plus the `whatToShow` mask and
/// the wrapped filter; `at_root` records whether the next `nextNode()` call is
/// the first one (which filters the root itself).
#[napi]
pub struct NodeIteratorHandle {
    shared: Arc<SharedDocument>,
    root: Reference<NodeHandle>,
    current: Mutex<Reference<NodeHandle>>,
    what_to_show: u32,
    filter: Option<FunctionRef<Reference<NodeHandle>, u32>>,
    at_root: Mutex<bool>,
}

#[napi]
impl NodeIteratorHandle {
    /// Returns the iterator's root (the same wrapper object on every read).
    #[napi(catch_unwind)]
    pub fn root(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        self.root.clone(env)
    }

    /// Returns the iterator's `whatToShow` mask.
    #[napi(catch_unwind)]
    pub fn what_to_show(&self) -> u32 {
        self.what_to_show
    }

    /// WHATWG `NodeIterator.nextNode`.
    ///
    /// The first call filters the root itself (mask + user filter) and returns
    /// it when accepted; afterwards the walk behaves like the walker's
    /// `nextNode` from the current node.
    #[napi(catch_unwind)]
    pub fn next_node(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        if *self
            .at_root
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
        {
            *self
                .at_root
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
            let root_id = self.root.id();
            let masked = with_document(&self.shared, |doc| {
                doc.traversal_mask_skips(root_id, self.what_to_show)
                    .map_err(BindingError::Core)
            })
            .map_err(|err| err.into_napi(&env))?;
            let accepted = if masked {
                false
            } else if self.filter.is_none() {
                true
            } else {
                let wrapped = self.shared.wrap_node(env, root_id)?;
                let function = self
                    .filter
                    .as_ref()
                    .expect("mask did not skip, so a filter must exist")
                    .borrow_back(&env)?;
                function.call(wrapped)? == FILTER_ACCEPT
            };
            if accepted {
                *lock_current(&self.current) = self.root.clone(env)?;
                return Ok(Some(self.root.clone(env)?));
            }
        }
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::NextNode,
        )
    }

    /// WHATWG `NodeIterator.previousNode` (the walker's reverse walk).
    #[napi(catch_unwind)]
    pub fn previous_node(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        drive_traversal(
            &env,
            &self.shared,
            self.root.id(),
            &self.current,
            self.what_to_show,
            &self.filter,
            TraversalOp::PreviousNode,
        )
    }
}

// --- Document surface -------------------------------------------------------

#[napi]
impl DocumentHandle {
    /// Creates a `TreeWalker` over the subtree rooted at `root`.
    ///
    /// The facade has coerced `whatToShow` to its unsigned value and wrapped
    /// the user filter (or passed `null`); this method validates `root` and
    /// stores the stable handles.
    #[napi(catch_unwind)]
    pub fn create_tree_walker(
        &self,
        env: Env,
        root: Reference<NodeHandle>,
        what_to_show: u32,
        filter: Unknown<'_>,
    ) -> napi::Result<Reference<TreeWalkerHandle>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.get(root.id()).map(|_| ()).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let stored = store_filter(&filter)?;
        let handle = TreeWalkerHandle {
            shared: Arc::clone(self.shared()),
            root: root.clone(env)?,
            current: Mutex::new(root),
            what_to_show,
            filter: stored,
        };
        handle.into_reference(env)
    }

    /// Creates a `NodeIterator` over the subtree rooted at `root`.
    #[napi(catch_unwind)]
    pub fn create_node_iterator(
        &self,
        env: Env,
        root: Reference<NodeHandle>,
        what_to_show: u32,
        filter: Unknown<'_>,
    ) -> napi::Result<Reference<NodeIteratorHandle>> {
        check_affinity(self.shared(), &env)?;
        with_document(self.shared(), |doc| {
            doc.get(root.id()).map(|_| ()).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let stored = store_filter(&filter)?;
        let handle = NodeIteratorHandle {
            shared: Arc::clone(self.shared()),
            root: root.clone(env)?,
            current: Mutex::new(root),
            what_to_show,
            filter: stored,
            at_root: Mutex::new(true),
        };
        handle.into_reference(env)
    }
}

// --- unit tests -------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native surface is exactly the walker/iterator entries this
    /// module adds; `tests/bun/traversal.test.js` re-checks the same names
    /// against the live module.
    #[test]
    fn frozen_contract_surfaces_are_the_traversal_api() {
        assert_eq!(
            TREEWALKER_CONTRACT,
            &[
                "root",
                "whatToShow",
                "currentNode",
                "setCurrentNode",
                "parentNode",
                "firstChild",
                "lastChild",
                "nextSibling",
                "previousSibling",
                "nextNode",
                "previousNode",
            ],
            "native TreeWalker contract must stay exactly the T35 surface"
        );
        assert_eq!(
            NODEITERATOR_CONTRACT,
            &["root", "whatToShow", "nextNode", "previousNode"],
            "native NodeIterator contract must stay exactly the T35 surface"
        );
    }

    /// The traversal surface must never drift into the Range or Selection
    /// surfaces (the T36 boundary), nor into the mutation/attribute/event
    /// seams of other tasks.
    #[test]
    fn contract_has_no_range_selection_or_foreign_seam_surface() {
        for name in TREEWALKER_CONTRACT
            .iter()
            .chain(NODEITERATOR_CONTRACT.iter())
        {
            assert!(
                !name.starts_with("setRange")
                    && !name.starts_with("collapse")
                    && *name != "deleteContents"
                    && *name != "getSelection",
                "traversal_api must not declare a Range/Selection surface: {name}"
            );
            assert!(
                !name.starts_with("append")
                    && !name.starts_with("remove")
                    && !name.contains("Attribute")
                    && !name.starts_with("addEvent"),
                "traversal_api must not declare a foreign seam's surface: {name}"
            );
        }
    }
}
