//! Native `Range` / `Selection` binding (T36).
//!
//! # Role
//!
//! This module is the M7 native extension that exposes the T36 Core contract
//! (`mad_dom_core::dom::range`) to JavaScript: `document.createRange` /
//! `document.getSelection` mint opaque [`RangeHandle`] / [`SelectionHandle`]
//! wrappers, and the facade installs the WHATWG `Range` / `Selection` surface
//! on top. Like the M7 `traversal_api` extension it adds *new* native symbols
//! to the existing [`DocumentHandle`] through a second `#[napi] impl` block —
//! napi merges class properties registered for the same Rust type, so the
//! class keeps its audited surface with no duplicate export and no touch to
//! the shared `handle.rs`.
//!
//! # Range state lives here, algorithms live in Core
//!
//! A [`RangeHandle`] stores the two boundary points as stable
//! [`Reference<NodeHandle>`]s plus their offsets — never a bare [`NodeId`], so
//! a range pins its containers' wrappers and identity is stable (T36 handle
//! rule, mirroring the TreeWalker cursor). Every algorithm — boundary
//! validation and ordering, `cloneContents` / `extractContents` /
//! `deleteContents` / `insertNode` / `surroundContents`, the stringifier and
//! the comparisons — is delegated verbatim to Core, which reads the live arena
//! through the boundary [`NodeId`]s. The binding only carries the position
//! state and converts values; Core stays the single authoritative tree state.
//!
//! # Selection state and direction
//!
//! A [`SelectionHandle`] holds the associated [`RangeHandle`] (strong
//! reference, so `selection.getRangeAt(0) === addedRange` holds) plus the
//! selection direction. Direction arithmetic (which boundary is the anchor vs
//! the focus, forwards/backwards decisions) is computed here from Core's
//! boundary comparison; the `selectionchange` event is dispatched by the
//! facade when a mutator reports that the associated range changed.
//!
//! # Mutation safety (no dangling handles)
//!
//! Node removal detaches but never frees (the unified mutation API keeps every
//! removed [`NodeId`] live), so a boundary container that is removed from the
//! tree stays readable and never dangles. Character-data mutations are
//! observed lazily: the offset getters clamp the stored offset to the
//! container's current length (the baseline's adjustment), and the content
//! operations collapse / move the range exactly like the baseline.
//!
//! # Frozen native contract (consumed by the T36 facade)
//!
//! Every entry checks the T21B affinity guard before touching Core state, then
//! propagates the frozen error table: a destroyed document fails with
//! `ERR_MAD_DOM_DOCUMENT_DESTROYED`, a foreign boundary node / source range
//! with `ERR_MAD_DOM_WRONG_DOCUMENT`, a stale handle with
//! `ERR_MAD_DOM_STALE_HANDLE`, an oversized offset with
//! `ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS` and a node-kind violation (doctype
//! boundary, parentless `selectNode`, invalid `insertNode` start,
//! `surroundContents` parent type or partial non-`Text`) with
//! `ERR_MAD_DOM_HIERARCHY`. The facade owns the WebIDL coercions (`>>> 0`
//! offsets, the `null` collapse argument, the `Range`/`Selection`
//! instanceof checks).
//!
//! # Safety preconditions
//!
//! Every `#[napi]` entry is marked `#[napi(catch_unwind)]` and checks the T21B
//! affinity guard first, matching the crate safety model. This module writes
//! no `unsafe`; FFI/unsafe stays inside the `napi` crates. The document lock
//! is never held while locking a handle's own mutexes in the opposite order.
//!
//! # Ownership
//!
//! Owned by **T36**; like T35 there is no separate integration gate, so T36
//! also wires the facade, the shared entry/type/ledger surfaces and the seam
//! metadata itself. `tests/bun/range-selection.test.js`, the
//! `hc-diff-range-selection` differential scenario and the Core fixtures carry
//! the end-to-end evidence.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use napi::bindgen_prelude::{JavaScriptClassExt, Reference};
use napi::Env;
use napi_derive::napi;

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{BoundaryPoint, SelectionDirection};

use crate::error::BindingError;
use crate::extensions::ExtensionSeam;
use crate::handle::{check_affinity, with_document, DocumentHandle, NodeHandle, SharedDocument};

/// Seam metadata for the M7 `range_api` boundary.
#[allow(dead_code)]
pub(crate) const SEAM: ExtensionSeam = ExtensionSeam {
    id: "range_api",
    owner: "T36",
    gate: "T36",
    status: "implemented",
};

/// The frozen native `Range` surface.
#[allow(dead_code)]
pub(crate) const RANGE_CONTRACT: &[&str] = &[
    "startContainer",
    "startOffset",
    "endContainer",
    "endOffset",
    "collapsed",
    "commonAncestorContainer",
    "setStart",
    "setEnd",
    "setStartBefore",
    "setStartAfter",
    "setEndBefore",
    "setEndAfter",
    "selectNode",
    "selectNodeContents",
    "collapse",
    "compareBoundaryPoints",
    "comparePoint",
    "isPointInRange",
    "intersectsNode",
    "cloneContents",
    "extractContents",
    "deleteContents",
    "insertNode",
    "surroundContents",
    "cloneRange",
    "detach",
    "toString",
];

/// The frozen native `Selection` surface.
#[allow(dead_code)]
pub(crate) const SELECTION_CONTRACT: &[&str] = &[
    "rangeCount",
    "isCollapsed",
    "type",
    "anchorNode",
    "anchorOffset",
    "focusNode",
    "focusOffset",
    "addRange",
    "getRangeAt",
    "removeRange",
    "removeAllRanges",
    "empty",
    "collapse",
    "setPosition",
    "collapseToStart",
    "collapseToEnd",
    "extend",
    "setBaseAndExtent",
    "selectAllChildren",
    "containsNode",
    "deleteFromDocument",
    "toString",
];

/// Global counter assigning each range a unique id, used for range identity
/// comparisons inside a selection (a `Reference` cannot be pointer-compared).
static NEXT_RANGE_ID: AtomicU64 = AtomicU64::new(0);

fn next_range_id() -> u64 {
    NEXT_RANGE_ID.fetch_add(1, Ordering::Relaxed)
}

/// Locks a handle mutex, recovering a poisoned lock.
fn lock_b<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// One boundary point of a range: a stable node wrapper plus its offset.
///
/// The offset is clamped lazily to the container's current length by the
/// offset getters and the operation reads, mirroring the baseline's lazy
/// adjustment after character-data mutations.
struct RangeBoundary {
    node: Reference<NodeHandle>,
    offset: u32,
}

impl RangeBoundary {
    fn point(&self) -> BoundaryPoint {
        BoundaryPoint::new(self.node.id(), self.offset as usize)
    }
}

/// Whether `handle` belongs to the document behind `shared`.
fn same_document(shared: &Arc<SharedDocument>, handle: &NodeHandle) -> bool {
    Arc::ptr_eq(shared, handle.shared())
}

/// JavaScript-facing wrapper for one `Range`'s boundary-point state.
///
/// Holds the two boundaries as stable [`Reference<NodeHandle>`]s (never a bare
/// [`NodeId`]); all algorithms delegate to Core through the boundary ids.
#[napi]
pub struct RangeHandle {
    shared: Arc<SharedDocument>,
    id: u64,
    start: Mutex<RangeBoundary>,
    end: Mutex<RangeBoundary>,
}

/// Reads a boundary point, clamping its offset to the container's current
/// length (persisting the clamp like the baseline's offset getters).
fn read_clamped(
    shared: &Arc<SharedDocument>,
    env: &Env,
    slot: &Mutex<RangeBoundary>,
) -> napi::Result<BoundaryPoint> {
    let mut guard = lock_b(slot);
    let node = guard.node.id();
    let length = with_document(shared, |doc| {
        doc.node_length(node).map_err(BindingError::Core)
    })
    .map_err(|err| err.into_napi(env))? as u32;
    if guard.offset > length {
        guard.offset = length;
    }
    Ok(guard.point())
}

/// Sets a boundary point to `(node, offset)`, minting the stable wrapper.
fn set_boundary(
    shared: &Arc<SharedDocument>,
    env: &Env,
    slot: &Mutex<RangeBoundary>,
    node: NodeId,
    offset: u32,
) -> napi::Result<()> {
    let wrapped = shared.wrap_node(*env, node)?;
    *lock_b(slot) = RangeBoundary {
        node: wrapped,
        offset,
    };
    Ok(())
}

/// Sets both boundary points to `(node, offset)` (the collapsed move a
/// delete/extract/surround computes).
fn set_both(
    shared: &Arc<SharedDocument>,
    env: &Env,
    range: &RangeHandle,
    node: NodeId,
    offset: u32,
) -> napi::Result<()> {
    set_boundary(shared, env, &range.start, node, offset)?;
    set_boundary(shared, env, &range.end, node, offset)
}

#[napi]
impl RangeHandle {
    /// Returns the start container (the same wrapper object on every read).
    #[napi(catch_unwind)]
    pub fn start_container(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        lock_b(&self.start).node.clone(env)
    }

    /// Returns the start offset, clamped to the container's current length.
    #[napi(catch_unwind)]
    pub fn start_offset(&self, env: Env) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        Ok(read_clamped(&self.shared, &env, &self.start)?.offset as u32)
    }

    /// Returns the end container.
    #[napi(catch_unwind)]
    pub fn end_container(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        lock_b(&self.end).node.clone(env)
    }

    /// Returns the end offset, clamped to the container's current length.
    #[napi(catch_unwind)]
    pub fn end_offset(&self, env: Env) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        Ok(read_clamped(&self.shared, &env, &self.end)?.offset as u32)
    }

    /// Whether both boundary points are at the same position (clamped).
    #[napi(catch_unwind)]
    pub fn collapsed(&self, env: Env) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        Ok(start.node == end.node && start.offset == end.offset)
    }

    /// Returns the deepest node containing both boundary containers.
    #[napi(catch_unwind)]
    pub fn common_ancestor_container(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let id = with_document(&self.shared, |doc| {
            doc.range_common_ancestor(start, end)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node(env, id)
    }

    /// WHATWG `Range.setStart(node, offset)`.
    #[napi(catch_unwind)]
    pub fn set_start(
        &self,
        env: Env,
        node: Reference<NodeHandle>,
        offset: u32,
    ) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let new_point = BoundaryPoint::new(node.id(), offset as usize);
        with_document(&self.shared, |doc| {
            doc.boundary_validate(node.id(), offset as usize)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let after_end = with_document(&self.shared, |doc| {
            doc.boundary_compare(new_point, end)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?
            == 1;
        if after_end {
            set_boundary(&self.shared, &env, &self.end, node.id(), offset)?;
        }
        set_boundary(&self.shared, &env, &self.start, node.id(), offset)
    }

    /// WHATWG `Range.setEnd(node, offset)`.
    #[napi(catch_unwind)]
    pub fn set_end(&self, env: Env, node: Reference<NodeHandle>, offset: u32) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let new_point = BoundaryPoint::new(node.id(), offset as usize);
        with_document(&self.shared, |doc| {
            doc.boundary_validate(node.id(), offset as usize)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let before_start = with_document(&self.shared, |doc| {
            doc.boundary_compare(new_point, start)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?
            == -1;
        if before_start {
            set_boundary(&self.shared, &env, &self.start, node.id(), offset)?;
        }
        set_boundary(&self.shared, &env, &self.end, node.id(), offset)
    }

    /// Sets the start before `node` (WHATWG `Range.setStartBefore`).
    #[napi(catch_unwind)]
    pub fn set_start_before(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let (parent, index) = self.node_parent_index(&env, &node)?;
        let wrapped = self.shared.wrap_node(env, parent)?;
        self.set_start(env, wrapped, index)
    }

    /// Sets the start after `node` (WHATWG `Range.setStartAfter`).
    #[napi(catch_unwind)]
    pub fn set_start_after(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let (parent, index) = self.node_parent_index(&env, &node)?;
        let wrapped = self.shared.wrap_node(env, parent)?;
        self.set_start(env, wrapped, index + 1)
    }

    /// Sets the end before `node` (WHATWG `Range.setEndBefore`).
    #[napi(catch_unwind)]
    pub fn set_end_before(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let (parent, index) = self.node_parent_index(&env, &node)?;
        let wrapped = self.shared.wrap_node(env, parent)?;
        self.set_end(env, wrapped, index)
    }

    /// Sets the end after `node` (WHATWG `Range.setEndAfter`).
    #[napi(catch_unwind)]
    pub fn set_end_after(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let (parent, index) = self.node_parent_index(&env, &node)?;
        let wrapped = self.shared.wrap_node(env, parent)?;
        self.set_end(env, wrapped, index + 1)
    }

    /// Returns the parent of `node` and its child index, rejecting a
    /// parentless node (the baseline's `InvalidNodeTypeError`).
    fn node_parent_index(&self, env: &Env, node: &NodeHandle) -> napi::Result<(NodeId, u32)> {
        with_document(&self.shared, |doc| {
            let parent = doc.parent(node.id())?.ok_or_else(|| {
                mad_dom_core::error::CoreError::Hierarchy {
                    message: "The given Node has no parent.".to_string(),
                }
            })?;
            let index = doc.node_child_index(parent, node.id())?;
            Ok((parent, index as u32))
        })
        .map_err(|err| err.into_napi(env))
    }

    /// WHATWG `Range.selectNode(node)`.
    #[napi(catch_unwind)]
    pub fn select_node(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let (parent, index) = self.node_parent_index(&env, &node)?;
        set_boundary(&self.shared, &env, &self.start, parent, index)?;
        set_boundary(&self.shared, &env, &self.end, parent, index + 1)
    }

    /// WHATWG `Range.selectNodeContents(node)`.
    #[napi(catch_unwind)]
    pub fn select_node_contents(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        with_document(&self.shared, |doc| {
            doc.boundary_validate(node.id(), 0)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let length = with_document(&self.shared, |doc| {
            doc.node_length(node.id()).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))? as u32;
        set_boundary(&self.shared, &env, &self.start, node.id(), 0)?;
        set_boundary(&self.shared, &env, &self.end, node.id(), length)
    }

    /// WHATWG `Range.collapse(toStart)`.
    #[napi(catch_unwind)]
    pub fn collapse(&self, env: Env, to_start: bool) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        if to_start {
            let start = lock_b(&self.start).node.clone(env)?;
            let offset = lock_b(&self.start).offset;
            *lock_b(&self.end) = RangeBoundary {
                node: start,
                offset,
            };
        } else {
            let end = lock_b(&self.end).node.clone(env)?;
            let offset = lock_b(&self.end).offset;
            *lock_b(&self.start) = RangeBoundary { node: end, offset };
        }
        Ok(())
    }

    /// WHATWG `Range.compareBoundaryPoints(how, sourceRange)`.
    #[napi(catch_unwind)]
    pub fn compare_boundary_points(
        &self,
        env: Env,
        how: u32,
        source_range: &RangeHandle,
    ) -> napi::Result<i32> {
        check_affinity(&self.shared, &env)?;
        if how > 3 {
            return Err(
                BindingError::Core(mad_dom_core::error::CoreError::Hierarchy {
                    message: "The comparison method provided must be one of the four constants."
                        .to_string(),
                })
                .into_napi(&env),
            );
        }
        if !Arc::ptr_eq(&self.shared, &source_range.shared) {
            // A foreign range: probe one of its boundary nodes through this
            // document so Core raises the frozen WrongDocument error.
            let foreign_node = lock_b(&source_range.start).node.id();
            let expected = with_document(&self.shared, |doc| Ok(doc.id()))
                .map_err(|err| err.into_napi(&env))?;
            return Err(
                BindingError::Core(mad_dom_core::error::CoreError::WrongDocument {
                    id: foreign_node,
                    expected_document: expected,
                })
                .into_napi(&env),
            );
        }
        let this_start = read_clamped(&self.shared, &env, &self.start)?;
        let this_end = read_clamped(&self.shared, &env, &self.end)?;
        let source_start = read_clamped(&source_range.shared, &env, &source_range.start)?;
        let source_end = read_clamped(&source_range.shared, &env, &source_range.end)?;
        let (this_point, source_point) = match how {
            0 => (this_start, source_start),
            1 => (this_end, source_start),
            2 => (this_end, source_end),
            _ => (this_start, source_end),
        };
        with_document(&self.shared, |doc| {
            doc.boundary_compare(this_point, source_point)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// WHATWG `Range.comparePoint(node, offset)`.
    #[napi(catch_unwind)]
    pub fn compare_point(
        &self,
        env: Env,
        node: Reference<NodeHandle>,
        offset: u32,
    ) -> napi::Result<i32> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let point = BoundaryPoint::new(node.id(), offset as usize);
        with_document(&self.shared, |doc| {
            doc.boundary_validate(node.id(), offset as usize)?;
            let before = doc.boundary_compare(point, start)?;
            let after = doc.boundary_compare(point, end)?;
            Ok(if before == -1 {
                -1
            } else if after == 1 {
                1
            } else {
                0
            })
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// WHATWG `Range.isPointInRange(node, offset)`.
    #[napi(catch_unwind)]
    pub fn is_point_in_range(
        &self,
        env: Env,
        node: Reference<NodeHandle>,
        offset: u32,
    ) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        if !same_document(&self.shared, &node) {
            return Ok(false);
        }
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let point = BoundaryPoint::new(node.id(), offset as usize);
        with_document(&self.shared, |doc| {
            doc.boundary_validate(node.id(), offset as usize)?;
            let before = doc.boundary_compare(point, start)?;
            let after = doc.boundary_compare(point, end)?;
            Ok(!(before == -1 || after == 1))
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// WHATWG `Range.intersectsNode(node)`.
    #[napi(catch_unwind)]
    pub fn intersects_node(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        if !same_document(&self.shared, &node) {
            return Ok(false);
        }
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        with_document(&self.shared, |doc| {
            let Some(parent) = doc.parent(node.id())? else {
                return Ok(true);
            };
            let index = doc.node_child_index(parent, node.id())?;
            let before_end = doc.boundary_compare(BoundaryPoint::new(parent, index), end)? == -1;
            let after_start =
                doc.boundary_compare(BoundaryPoint::new(parent, index + 1), start)? == 1;
            Ok(before_end && after_start)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// WHATWG `Range.cloneContents()`.
    #[napi(catch_unwind)]
    pub fn clone_contents(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let fragment = with_document(&self.shared, |doc| {
            doc.range_clone_contents(start, end)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        self.shared.wrap_node(env, fragment)
    }

    /// WHATWG `Range.extractContents()`.
    #[napi(catch_unwind)]
    pub fn extract_contents(&self, env: Env) -> napi::Result<Reference<NodeHandle>> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let (fragment, position) = with_document(&self.shared, |doc| {
            doc.range_extract_contents(start, end)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        if let Some(pos) = position {
            set_both(&self.shared, &env, self, pos.node, pos.offset as u32)?;
        }
        self.shared.wrap_node(env, fragment)
    }

    /// WHATWG `Range.deleteContents()`.
    #[napi(catch_unwind)]
    pub fn delete_contents(&self, env: Env) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let position = with_document(&self.shared, |doc| {
            doc.range_delete_contents(start, end)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        if let Some(pos) = position {
            set_both(&self.shared, &env, self, pos.node, pos.offset as u32)?;
        }
        Ok(())
    }

    /// WHATWG `Range.insertNode(newNode)`.
    #[napi(catch_unwind)]
    pub fn insert_node(&self, env: Env, new_node: Reference<NodeHandle>) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let new_end = with_document(&self.shared, |doc| {
            doc.range_insert_node(start, end, new_node.id())
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        if let Some(pos) = new_end {
            set_boundary(&self.shared, &env, &self.end, pos.node, pos.offset as u32)?;
        }
        Ok(())
    }

    /// WHATWG `Range.surroundContents(newParent)`.
    #[napi(catch_unwind)]
    pub fn surround_contents(
        &self,
        env: Env,
        new_parent: Reference<NodeHandle>,
    ) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        let (new_start, new_end) = with_document(&self.shared, |doc| {
            doc.range_surround_contents(start, end, new_parent.id())
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        set_boundary(
            &self.shared,
            &env,
            &self.start,
            new_start.node,
            new_start.offset as u32,
        )?;
        set_boundary(
            &self.shared,
            &env,
            &self.end,
            new_end.node,
            new_end.offset as u32,
        )
    }

    /// WHATWG `Range.cloneRange()`.
    #[napi(catch_unwind)]
    pub fn clone_range(&self, env: Env) -> napi::Result<Reference<RangeHandle>> {
        check_affinity(&self.shared, &env)?;
        let start_node = lock_b(&self.start).node.clone(env)?;
        let start_offset = lock_b(&self.start).offset;
        let end_node = lock_b(&self.end).node.clone(env)?;
        let end_offset = lock_b(&self.end).offset;
        let handle = RangeHandle {
            shared: Arc::clone(&self.shared),
            id: next_range_id(),
            start: Mutex::new(RangeBoundary {
                node: start_node,
                offset: start_offset,
            }),
            end: Mutex::new(RangeBoundary {
                node: end_node,
                offset: end_offset,
            }),
        };
        handle.into_reference(env)
    }

    /// WHATWG `Range.detach()`: a historical no-op.
    #[napi(catch_unwind)]
    pub fn detach(&self) -> napi::Result<()> {
        Ok(())
    }

    /// WHATWG `Range.toString()` (the stringifier).
    #[napi(catch_unwind)]
    pub fn to_string(&self, env: Env) -> napi::Result<String> {
        check_affinity(&self.shared, &env)?;
        let start = read_clamped(&self.shared, &env, &self.start)?;
        let end = read_clamped(&self.shared, &env, &self.end)?;
        with_document(&self.shared, |doc| {
            doc.range_to_string(start, end).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }
}

// --- Selection handle -------------------------------------------------------

/// JavaScript-facing wrapper for one `Selection`'s state.
///
/// Holds the associated range as a strong [`Reference<RangeHandle>`] (so
/// `getRangeAt(0)` returns the same object that was added) plus the selection
/// direction.
#[napi]
pub struct SelectionHandle {
    shared: Arc<SharedDocument>,
    range: Mutex<Option<Reference<RangeHandle>>>,
    direction: Mutex<SelectionDirection>,
}

impl SelectionHandle {
    /// Associates `range` with the selection, resetting the direction to
    /// forwards (or directionless for `None`), and reports whether the
    /// associated range changed (drives the facade's `selectionchange`).
    fn associate_range(&self, range: Option<Reference<RangeHandle>>) -> bool {
        let mut slot = lock_b(&self.range);
        let changed = match (slot.as_ref(), range.as_ref()) {
            (Some(a), Some(b)) => a.id != b.id,
            (None, None) => false,
            _ => true,
        };
        *slot = range;
        *lock_b(&self.direction) = match slot.as_ref() {
            None => SelectionDirection::Directionless,
            Some(_) => SelectionDirection::Forwards,
        };
        changed
    }

    /// Mints a fresh range handle with the given boundary points.
    fn mint_range(
        &self,
        env: &Env,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> napi::Result<Reference<RangeHandle>> {
        let start_node = self.shared.wrap_node(*env, start.node)?;
        let end_node = self.shared.wrap_node(*env, end.node)?;
        let handle = RangeHandle {
            shared: Arc::clone(&self.shared),
            id: next_range_id(),
            start: Mutex::new(RangeBoundary {
                node: start_node,
                offset: start.offset as u32,
            }),
            end: Mutex::new(RangeBoundary {
                node: end_node,
                offset: end.offset as u32,
            }),
        };
        handle.into_reference(*env)
    }

    /// Whether `node` belongs to this selection's document.
    fn same_document(&self, node: &NodeHandle) -> bool {
        same_document(&self.shared, node)
    }

    /// Returns an owned copy of the associated range (if any), releasing the
    /// lock so a subsequent re-association cannot deadlock.
    fn current_range(&self, env: &Env) -> napi::Result<Option<Reference<RangeHandle>>> {
        match lock_b(&self.range).as_ref() {
            None => Ok(None),
            Some(range) => range.clone(*env).map(Some),
        }
    }
}

#[napi]
impl SelectionHandle {
    /// Returns the number of ranges (0 or 1).
    #[napi(catch_unwind)]
    pub fn range_count(&self) -> u32 {
        if lock_b(&self.range).is_some() {
            1
        } else {
            0
        }
    }

    /// Whether the selection is collapsed (no range, or a collapsed range).
    #[napi(catch_unwind)]
    pub fn is_collapsed(&self, env: Env) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        match self.current_range(&env)? {
            None => Ok(true),
            Some(range) => range.collapsed(env),
        }
    }

    /// Returns the selection type: `None`, `Caret` or `Range`.
    #[napi(catch_unwind)]
    pub fn selection_type(&self, env: Env) -> napi::Result<String> {
        check_affinity(&self.shared, &env)?;
        match self.current_range(&env)? {
            None => Ok("None".to_string()),
            Some(range) => {
                if range.collapsed(env)? {
                    Ok("Caret".to_string())
                } else {
                    Ok("Range".to_string())
                }
            }
        }
    }

    /// Returns the anchor node (start for a forwards selection, end otherwise).
    #[napi(catch_unwind)]
    pub fn anchor_node(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        let forwards = *lock_b(&self.direction) == SelectionDirection::Forwards;
        match self.current_range(&env)? {
            None => Ok(None),
            Some(range) => {
                if forwards {
                    range.start_container(env).map(Some)
                } else {
                    range.end_container(env).map(Some)
                }
            }
        }
    }

    /// Returns the anchor offset.
    #[napi(catch_unwind)]
    pub fn anchor_offset(&self, env: Env) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        let forwards = *lock_b(&self.direction) == SelectionDirection::Forwards;
        match self.current_range(&env)? {
            None => Ok(0),
            Some(range) => {
                if forwards {
                    range.start_offset(env)
                } else {
                    range.end_offset(env)
                }
            }
        }
    }

    /// Returns the focus node (end for a forwards selection, start otherwise).
    #[napi(catch_unwind)]
    pub fn focus_node(&self, env: Env) -> napi::Result<Option<Reference<NodeHandle>>> {
        check_affinity(&self.shared, &env)?;
        let forwards = *lock_b(&self.direction) == SelectionDirection::Forwards;
        match self.current_range(&env)? {
            None => Ok(None),
            Some(range) => {
                if forwards {
                    range.end_container(env).map(Some)
                } else {
                    range.start_container(env).map(Some)
                }
            }
        }
    }

    /// Returns the focus offset.
    #[napi(catch_unwind)]
    pub fn focus_offset(&self, env: Env) -> napi::Result<u32> {
        check_affinity(&self.shared, &env)?;
        let forwards = *lock_b(&self.direction) == SelectionDirection::Forwards;
        match self.current_range(&env)? {
            None => Ok(0),
            Some(range) => {
                if forwards {
                    range.end_offset(env)
                } else {
                    range.start_offset(env)
                }
            }
        }
    }

    /// WHATWG `Selection.addRange(newRange)`; returns whether the range became
    /// the selection's range (drives `selectionchange`).
    #[napi(catch_unwind)]
    pub fn add_range(&self, env: Env, new_range: Reference<RangeHandle>) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        if lock_b(&self.range).is_some() {
            return Ok(false);
        }
        if !Arc::ptr_eq(&self.shared, &new_range.shared) {
            return Ok(false);
        }
        Ok(self.associate_range(Some(new_range)))
    }

    /// WHATWG `Selection.getRangeAt(index)`.
    #[napi(catch_unwind)]
    pub fn get_range_at(&self, env: Env, index: u32) -> napi::Result<Reference<RangeHandle>> {
        check_affinity(&self.shared, &env)?;
        match self.current_range(&env)? {
            Some(range) if index == 0 => range.clone(env),
            _ => Err(
                BindingError::Core(mad_dom_core::error::CoreError::IndexOutOfBounds {
                    index: index as usize,
                    len: if lock_b(&self.range).is_some() { 1 } else { 0 },
                })
                .into_napi(&env),
            ),
        }
    }

    /// WHATWG `Selection.removeRange(range)`; returns whether the range was
    /// removed.
    #[napi(catch_unwind)]
    pub fn remove_range(&self, env: Env, range: Reference<RangeHandle>) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        let current = self.current_range(&env)?;
        match current {
            Some(current) if current.id == range.id => Ok(self.associate_range(None)),
            Some(_) => Err(
                BindingError::Core(mad_dom_core::error::CoreError::Hierarchy {
                    message: "Invalid range.".to_string(),
                })
                .into_napi(&env),
            ),
            None => Err(
                BindingError::Core(mad_dom_core::error::CoreError::Hierarchy {
                    message: "Invalid range.".to_string(),
                })
                .into_napi(&env),
            ),
        }
    }

    /// WHATWG `Selection.removeAllRanges()`; returns whether a range existed.
    #[napi(catch_unwind)]
    pub fn remove_all_ranges(&self, env: Env) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        Ok(self.associate_range(None))
    }

    /// WHATWG `Selection.empty()` (an alias of `removeAllRanges`).
    #[napi(catch_unwind)]
    pub fn empty(&self, env: Env) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        Ok(self.associate_range(None))
    }

    /// WHATWG `Selection.collapse(node, offset)`; `node == null` clears the
    /// selection. Returns whether the selection changed.
    #[napi(catch_unwind)]
    pub fn collapse(
        &self,
        env: Env,
        node: Option<Reference<NodeHandle>>,
        offset: u32,
    ) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        let Some(node) = node else {
            return Ok(self.associate_range(None));
        };
        if !self.same_document(&node) {
            return Ok(false);
        }
        with_document(&self.shared, |doc| {
            doc.boundary_validate(node.id(), offset as usize)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let point = BoundaryPoint::new(node.id(), offset as usize);
        let range = self.mint_range(&env, point, point)?;
        Ok(self.associate_range(Some(range)))
    }

    /// WHATWG `Selection.setPosition(node, offset)` (an alias of `collapse`).
    #[napi(catch_unwind)]
    pub fn set_position(
        &self,
        env: Env,
        node: Option<Reference<NodeHandle>>,
        offset: u32,
    ) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        self.collapse(env, node, offset)
    }

    /// WHATWG `Selection.collapseToStart()`.
    #[napi(catch_unwind)]
    pub fn collapse_to_start(&self, env: Env) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        let Some(range) = self.current_range(&env)? else {
            return Err(self.no_selection_error(&env));
        };
        let start = read_clamped(&self.shared, &env, &range.start)?;
        let new_range = self.mint_range(&env, start, start)?;
        Ok(self.associate_range(Some(new_range)))
    }

    /// WHATWG `Selection.collapseToEnd()`.
    #[napi(catch_unwind)]
    pub fn collapse_to_end(&self, env: Env) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        let Some(range) = self.current_range(&env)? else {
            return Err(self.no_selection_error(&env));
        };
        let end = read_clamped(&self.shared, &env, &range.end)?;
        let new_range = self.mint_range(&env, end, end)?;
        Ok(self.associate_range(Some(new_range)))
    }

    /// WHATWG `Selection.extend(node, offset)`.
    #[napi(catch_unwind)]
    pub fn extend(&self, env: Env, node: Reference<NodeHandle>, offset: u32) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        if !self.same_document(&node) {
            return Ok(false);
        }
        let Some(range) = self.current_range(&env)? else {
            return Err(self.no_selection_error(&env));
        };
        let forwards = *lock_b(&self.direction) == SelectionDirection::Forwards;
        let anchor = if forwards {
            read_clamped(&self.shared, &env, &range.start)?
        } else {
            read_clamped(&self.shared, &env, &range.end)?
        };
        let anchor = BoundaryPoint::new(anchor.node, anchor.offset);
        let focus = BoundaryPoint::new(node.id(), offset as usize);
        let (new_start, new_end) = with_document(&self.shared, |doc| {
            let order = doc
                .boundary_compare(anchor, focus)
                .map_err(BindingError::Core)?;
            if order <= 0 {
                Ok((anchor, focus))
            } else {
                Ok((focus, anchor))
            }
        })
        .map_err(|err| err.into_napi(&env))?;
        let new_range = self.mint_range(&env, new_start, new_end)?;
        let changed = self.associate_range(Some(new_range));
        let backwards = with_document(&self.shared, |doc| {
            doc.boundary_compare(focus, anchor)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?
            == -1;
        *lock_b(&self.direction) = if backwards {
            SelectionDirection::Backwards
        } else {
            SelectionDirection::Forwards
        };
        Ok(changed)
    }

    /// WHATWG `Selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode,
    /// focusOffset)`.
    #[napi(catch_unwind)]
    pub fn set_base_and_extent(
        &self,
        env: Env,
        anchor_node: Reference<NodeHandle>,
        anchor_offset: u32,
        focus_node: Reference<NodeHandle>,
        focus_offset: u32,
    ) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        if !self.same_document(&anchor_node) || !self.same_document(&focus_node) {
            return Ok(false);
        }
        let anchor = BoundaryPoint::new(anchor_node.id(), anchor_offset as usize);
        let focus = BoundaryPoint::new(focus_node.id(), focus_offset as usize);
        with_document(&self.shared, |doc| {
            doc.boundary_validate(anchor_node.id(), anchor_offset as usize)?;
            doc.boundary_validate(focus_node.id(), focus_offset as usize)?;
            Ok(())
        })
        .map_err(|err| err.into_napi(&env))?;
        let (new_start, new_end) = with_document(&self.shared, |doc| {
            let order = doc
                .boundary_compare(anchor, focus)
                .map_err(BindingError::Core)?;
            if order == -1 {
                Ok((anchor, focus))
            } else {
                Ok((focus, anchor))
            }
        })
        .map_err(|err| err.into_napi(&env))?;
        let new_range = self.mint_range(&env, new_start, new_end)?;
        let changed = self.associate_range(Some(new_range));
        let backwards = with_document(&self.shared, |doc| {
            doc.boundary_compare(focus, anchor)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?
            == -1;
        *lock_b(&self.direction) = if backwards {
            SelectionDirection::Backwards
        } else {
            SelectionDirection::Forwards
        };
        Ok(changed)
    }

    /// WHATWG `Selection.selectAllChildren(node)`.
    #[napi(catch_unwind)]
    pub fn select_all_children(&self, env: Env, node: Reference<NodeHandle>) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        if !self.same_document(&node) {
            return Ok(false);
        }
        with_document(&self.shared, |doc| {
            doc.boundary_validate(node.id(), 0)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))?;
        let length = with_document(&self.shared, |doc| {
            doc.node_length(node.id()).map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))? as u32;
        let start = BoundaryPoint::new(node.id(), 0);
        let end = BoundaryPoint::new(node.id(), length as usize);
        let range = self.mint_range(&env, start, end)?;
        Ok(self.associate_range(Some(range)))
    }

    /// WHATWG `Selection.containsNode(node, allowPartialContainment)`.
    #[napi(catch_unwind)]
    pub fn contains_node(
        &self,
        env: Env,
        node: Reference<NodeHandle>,
        allow_partial: bool,
    ) -> napi::Result<bool> {
        check_affinity(&self.shared, &env)?;
        let Some(range) = self.current_range(&env)? else {
            return Ok(false);
        };
        if !self.same_document(&node) {
            return Ok(false);
        }
        // Each boundary mutex is locked in its own statement (two locks of the
        // same mutex inside one expression would deadlock: std Mutex is not
        // reentrant).
        let start_node = lock_b(&range.start).node.id();
        let start_offset = lock_b(&range.start).offset as usize;
        let end_node = lock_b(&range.end).node.id();
        let end_offset = lock_b(&range.end).offset as usize;
        let start = BoundaryPoint::new(start_node, start_offset);
        let end = BoundaryPoint::new(end_node, end_offset);
        with_document(&self.shared, |doc| {
            doc.selection_contains_node(start, end, node.id(), allow_partial)
                .map_err(BindingError::Core)
        })
        .map_err(|err| err.into_napi(&env))
    }

    /// WHATWG `Selection.deleteFromDocument()`.
    #[napi(catch_unwind)]
    pub fn delete_from_document(&self, env: Env) -> napi::Result<()> {
        check_affinity(&self.shared, &env)?;
        if let Some(range) = self.current_range(&env)? {
            range.delete_contents(env)?;
        }
        Ok(())
    }

    /// WHATWG `Selection.toString()`.
    #[napi(catch_unwind)]
    pub fn to_string(&self, env: Env) -> napi::Result<String> {
        check_affinity(&self.shared, &env)?;
        match self.current_range(&env)? {
            None => Ok(String::new()),
            Some(range) => range.to_string(env),
        }
    }

    /// Builds the frozen "no selection" error (the baseline's
    /// `InvalidStateError`).
    fn no_selection_error(&self, env: &Env) -> napi::Error {
        BindingError::Core(mad_dom_core::error::CoreError::Hierarchy {
            message: "There is no selection to collapse.".to_string(),
        })
        .into_napi(env)
    }
}

// --- Document surface -------------------------------------------------------

#[napi]
impl DocumentHandle {
    /// Creates a `Range` collapsed at the document's root node.
    #[napi(catch_unwind)]
    pub fn create_range(&self, env: Env) -> napi::Result<Reference<RangeHandle>> {
        check_affinity(self.shared(), &env)?;
        let root = with_document(self.shared(), |doc| Ok(doc.document_root()))
            .map_err(|err: BindingError| err.into_napi(&env))?;
        let wrapped = self.shared().wrap_node(env, root)?;
        let handle = RangeHandle {
            shared: Arc::clone(self.shared()),
            id: next_range_id(),
            start: Mutex::new(RangeBoundary {
                node: wrapped.clone(env)?,
                offset: 0,
            }),
            end: Mutex::new(RangeBoundary {
                node: wrapped,
                offset: 0,
            }),
        };
        handle.into_reference(env)
    }

    /// Returns a fresh native selection handle for this document.
    ///
    /// The facade caches the resulting wrapper per native document handle, so
    /// `document.getSelection()` / `window.getSelection()` hand back one and
    /// the same facade `Selection` for the document's lifetime — matching the
    /// baseline's per-document selection identity.
    #[napi(catch_unwind)]
    pub fn get_selection(&self, env: Env) -> napi::Result<Reference<SelectionHandle>> {
        check_affinity(self.shared(), &env)?;
        let handle = SelectionHandle {
            shared: Arc::clone(self.shared()),
            range: Mutex::new(None),
            direction: Mutex::new(SelectionDirection::Directionless),
        };
        handle.into_reference(env)
    }
}

// --- unit tests -------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen native surfaces are exactly the entries this module adds to
    /// `RangeHandle`, `SelectionHandle` and `DocumentHandle`.
    #[test]
    fn frozen_contract_surfaces_are_the_range_selection_api() {
        assert_eq!(
            RANGE_CONTRACT,
            &[
                "startContainer",
                "startOffset",
                "endContainer",
                "endOffset",
                "collapsed",
                "commonAncestorContainer",
                "setStart",
                "setEnd",
                "setStartBefore",
                "setStartAfter",
                "setEndBefore",
                "setEndAfter",
                "selectNode",
                "selectNodeContents",
                "collapse",
                "compareBoundaryPoints",
                "comparePoint",
                "isPointInRange",
                "intersectsNode",
                "cloneContents",
                "extractContents",
                "deleteContents",
                "insertNode",
                "surroundContents",
                "cloneRange",
                "detach",
                "toString",
            ],
            "native Range contract must stay exactly the T36 surface"
        );
        assert_eq!(
            SELECTION_CONTRACT,
            &[
                "rangeCount",
                "isCollapsed",
                "type",
                "anchorNode",
                "anchorOffset",
                "focusNode",
                "focusOffset",
                "addRange",
                "getRangeAt",
                "removeRange",
                "removeAllRanges",
                "empty",
                "collapse",
                "setPosition",
                "collapseToStart",
                "collapseToEnd",
                "extend",
                "setBaseAndExtent",
                "selectAllChildren",
                "containsNode",
                "deleteFromDocument",
                "toString",
            ],
            "native Selection contract must stay exactly the T36 surface"
        );
    }

    /// The Range/Selection surface must never drift into the traversal,
    /// mutation, attribute or event seams of other tasks.
    #[test]
    fn contract_has_no_traversal_mutation_or_event_surface() {
        for name in RANGE_CONTRACT.iter().chain(SELECTION_CONTRACT.iter()) {
            assert!(
                !name.contains("TreeWalker")
                    && !name.contains("NodeIterator")
                    && !name.starts_with("append")
                    && !name.starts_with("removeChild")
                    && !name.contains("Attribute")
                    && !name.starts_with("addEvent"),
                "range_api must not declare a foreign seam's surface: {name}"
            );
        }
    }

    /// The `get_selection` entry mints a native selection whose facade wrapper
    /// the facade caches per native document handle (the per-document identity
    /// rule). The range id counter is monotonic, so two ranges never collide.
    #[test]
    fn range_ids_are_unique() {
        let a = next_range_id();
        let b = next_range_id();
        assert_ne!(a, b);
    }
}
