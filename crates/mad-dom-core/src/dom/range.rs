//! `Range` / `Selection` Core module (T36).
//!
//! Implements the Core half of the WHATWG Range and Selection surfaces on top
//! of the existing navigation, mutation, character-data and clone seams:
//!
//! * boundary-point validation (`setStart` / `setEnd` and the before/after
//!   variants, `selectNode`, `selectNodeContents`);
//! * the position comparison contract (`compareBoundaryPoints`, `comparePoint`,
//!   `isPointInRange`, `intersectsNode`);
//! * the content operations (`cloneContents`, `extractContents`,
//!   `deleteContents`, `insertNode`, `surroundContents`) and the stringifier
//!   (`toString`);
//! * `cloneRange`-style boundary copying, the `commonAncestorContainer` read
//!   and the `collapse` mutation.
//!
//! The binding owns the *range state* (the two boundary points as stable
//! [`Reference`](crate::handle)-style node handles plus the offsets) and the
//! Selection state (the associated range and its direction), exactly like the
//! TreeWalker binding owns the walker cursor; every algorithm below is a pure
//! function of boundary points and delegates to Core's arena so no second DOM
//! state exists outside the arena.
//!
//! # Boundary points never dangle
//!
//! A boundary point is `(NodeId, offset)`. Node removal detaches but never
//! frees a node (the unified mutation API keeps the removed [`NodeId`] live),
//! so a boundary point that names a removed node stays valid and readable —
//! matching the baseline, which keeps its containers after a removal. Offsets
//! are clamped to the node's current length on every read, which is the
//! baseline's observable adjustment for character-data mutations. Content
//! operations that remove contents (`deleteContents` / `extractContents`)
//! collapse the range to the computed position and `insertNode` moves a
//! collapsed range's end, exactly like the baseline.
//!
//! # Error mapping (frozen taxonomy)
//!
//! The crate error taxonomy is frozen (T21A), so this module maps the DOM
//! exceptions happy-dom raises onto the existing variants:
//!
//! * `IndexSizeError` (an offset past the node's length) →
//!   [`CoreError::IndexOutOfBounds`];
//! * `InvalidNodeTypeError` (a `DocumentType` boundary point, `selectNode` on
//!   a parentless node, a `Document`/`DocumentType`/`DocumentFragment`
//!   `surroundContents` parent) → [`CoreError::Hierarchy`];
//! * `InvalidStateError` (`surroundContents` over a partially contained
//!   non-`Text` node, `insertNode` at an invalid start) →
//!   [`CoreError::Hierarchy`];
//! * `WrongDocumentError` (a boundary point or source range from another
//!   document) → [`CoreError::WrongDocument`].
//!
//! The differential scenarios observe only the *fact* that a call throws, never
//! the error name/message (the T21A napi4 degradation), so the frozen mapping
//! keeps the observable behavior in lock step.

use crate::arena::NodeId;
use crate::error::CoreError;

use super::node::{NodeData, NodeType};
use super::Document;

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

/// A WHATWG boundary point: a node plus an offset into it.
///
/// `offset` is measured in UTF-16 code units for character-data nodes and in
/// children for every other node, matching the DOM length unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoundaryPoint {
    /// The boundary container node.
    pub node: NodeId,
    /// The offset (UTF-16 units or child index).
    pub offset: usize,
}

impl BoundaryPoint {
    /// Creates a boundary point.
    pub fn new(node: NodeId, offset: usize) -> Self {
        Self { node, offset }
    }
}

/// The observable direction of a `Selection` (mirrors happy-dom's
/// `SelectionDirectionEnum`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionDirection {
    /// No range is associated with the selection.
    Directionless,
    /// The selection was made forwards (anchor before focus).
    Forwards,
    /// The selection was made backwards (anchor after focus).
    Backwards,
}

impl SelectionDirection {
    /// The numeric value the baseline exposes.
    pub fn value(self) -> i8 {
        match self {
            Self::Directionless => 0,
            Self::Forwards => 1,
            Self::Backwards => -1,
        }
    }
}

/// Returns the number of UTF-16 code units in `s` (the DOM `length` unit).
fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

impl Document {
    /// Returns the WHATWG length of the node for `id`: the UTF-16 length for a
    /// `Text`/`Comment`/`ProcessingInstruction` node, the number of children
    /// for every other node, and `0` for a `DocumentType`.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale handle.
    pub fn node_length(&self, id: NodeId) -> Result<usize, CoreError> {
        match self.get(id)?.data() {
            NodeData::Text { data }
            | NodeData::Comment { data }
            | NodeData::ProcessingInstruction { data, .. } => Ok(utf16_len(data)),
            NodeData::DocumentType { .. } => Ok(0),
            _ => Ok(self.children(id)?.len()),
        }
    }

    /// Validates a boundary point: the node must not be a `DocumentType` and
    /// the offset must not exceed the node's length.
    ///
    /// Mirrors happy-dom's `RangeUtility.validateBoundaryPoint`; a doctype
    /// maps to a hierarchy error (the baseline's `InvalidNodeTypeError`) and an
    /// oversized offset to [`CoreError::IndexOutOfBounds`] (the baseline's
    /// `IndexSizeError`).
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `node` is a `DocumentType`.
    /// * [`CoreError::IndexOutOfBounds`] when `offset` exceeds the node length.
    pub fn boundary_validate(&self, node: NodeId, offset: usize) -> Result<(), CoreError> {
        if self.get(node)?.data().node_type() == NodeType::DocumentType {
            return Err(hierarchy(
                "DocumentType Node can't be used as boundary point.",
            ));
        }
        let length = self.node_length(node)?;
        if offset > length {
            return Err(CoreError::IndexOutOfBounds {
                index: offset,
                len: length,
            });
        }
        Ok(())
    }

    /// Returns the clamped form of `(node, offset)`: an offset past the node's
    /// current length is clamped to it, which is the baseline's observable
    /// adjustment after a character-data mutation.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale handle.
    pub fn boundary_clamp(&self, node: NodeId, offset: usize) -> Result<usize, CoreError> {
        Ok(offset.min(self.node_length(node)?))
    }

    /// Compares two boundary points, returning `-1`, `0` or `1` depending on
    /// whether `a` is before, equal to, or after `b`.
    ///
    /// This is the WHATWG boundary-point position algorithm as implemented by
    /// the baseline: same-node offsets compare directly; otherwise `a` follows
    /// `b` negates the reversed comparison; otherwise, when `a` is an inclusive
    /// ancestor of `b`, the child of `a` that is an ancestor of `b` decides by
    /// its index against `a`'s offset; otherwise `a` is before `b`.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale handle.
    pub fn boundary_compare(&self, a: BoundaryPoint, b: BoundaryPoint) -> Result<i32, CoreError> {
        if a.node == b.node {
            return Ok(if a.offset < b.offset {
                -1
            } else if a.offset > b.offset {
                1
            } else {
                0
            });
        }
        if self.node_is_following(a.node, b.node)? {
            // `a` follows `b`: negate the reversed comparison.
            return Ok(match self.boundary_compare(b, a)? {
                -1 => 1,
                1 => -1,
                _ => 0,
            });
        }
        if self.node_is_inclusive_ancestor(a.node, b.node)? {
            let mut child = b.node;
            while self.get(child)?.parent() != Some(a.node) {
                let Some(parent) = self.get(child)?.parent() else {
                    return Err(hierarchy(
                        "boundary-point ancestor walk escaped the ancestor node",
                    ));
                };
                child = parent;
            }
            let index = self.child_index(a.node, child)?;
            if index < a.offset {
                return Ok(1);
            }
        }
        Ok(-1)
    }

    /// Returns the index of `child` among the children of `parent`.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale handle, [`CoreError::Hierarchy`] when `child` is not a child of
    /// `parent`.
    pub fn node_child_index(&self, parent: NodeId, child: NodeId) -> Result<usize, CoreError> {
        self.child_index(parent, child)
    }

    /// Whether `node` is part of a selection spanning `range_start` /
    /// `range_end` (the baseline `Selection.containsNode`): the range starts
    /// strictly before the node and ends strictly after it, or — when
    /// `allow_partial` — either condition alone.
    ///
    /// Uses the raw boundary offsets (no clamping), matching the baseline.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale handle.
    pub fn selection_contains_node(
        &self,
        range_start: BoundaryPoint,
        range_end: BoundaryPoint,
        node: NodeId,
        allow_partial: bool,
    ) -> Result<bool, CoreError> {
        let start_before = self.boundary_compare(range_start, BoundaryPoint::new(node, 0))? == -1;
        let end_after = self
            .boundary_compare(range_end, BoundaryPoint::new(node, self.node_length(node)?))?
            == 1;
        Ok(if allow_partial {
            start_before || end_after
        } else {
            start_before && end_after
        })
    }

    /// Returns the index of `child` among the children of `parent`.
    ///
    /// `child` must be a live child of `parent`; the caller guarantees this.
    fn child_index(&self, parent: NodeId, child: NodeId) -> Result<usize, CoreError> {
        let children = self.children(parent)?;
        children
            .iter()
            .position(|&c| c == child)
            .ok_or_else(|| hierarchy("boundary-point child is not a child of its parent"))
    }

    /// Returns the next node in pre-order tree order after `node` (the first
    /// child, else the next sibling, else climbing to an ancestor's next
    /// sibling), or `None` at the end of the tree.
    fn following_node(&self, node: NodeId) -> Result<Option<NodeId>, CoreError> {
        if let Some(first) = self.get(node)?.first_child() {
            return Ok(Some(first));
        }
        let mut current = node;
        loop {
            if let Some(next) = self.get(current)?.next_sibling() {
                return Ok(Some(next));
            }
            let Some(parent) = self.get(current)?.parent() else {
                return Ok(None);
            };
            current = parent;
        }
    }

    /// Returns the node immediately after `node`'s whole subtree (its next
    /// sibling, or the nearest ancestor's next sibling), or `None`.
    fn next_descendant_node(&self, node: NodeId) -> Result<Option<NodeId>, CoreError> {
        let mut current = Some(node);
        while let Some(n) = current {
            if let Some(next) = self.get(n)?.next_sibling() {
                return Ok(Some(next));
            }
            current = self.get(n)?.parent();
        }
        Ok(None)
    }

    /// Whether `a` is *following* `b` in tree order (the baseline
    /// `NodeUtility.isFollowing`): walking the pre-order successor chain from
    /// `b` reaches `a`.
    fn node_is_following(&self, a: NodeId, b: NodeId) -> Result<bool, CoreError> {
        if a == b {
            return Ok(false);
        }
        let mut current = b;
        while let Some(next) = self.following_node(current)? {
            if next == a {
                return Ok(true);
            }
            current = next;
        }
        Ok(false)
    }

    /// Whether `a` is `b` or an ancestor of `b`.
    fn node_is_inclusive_ancestor(&self, a: NodeId, b: NodeId) -> Result<bool, CoreError> {
        if a == b {
            return Ok(true);
        }
        self.is_descendant_of(b, a)
    }

    /// Whether `node` is fully contained in the range spanned by `start` and
    /// `end` (the baseline `RangeUtility.isContained`).
    fn is_contained(
        &self,
        node: NodeId,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<bool, CoreError> {
        let start_compare = self.boundary_compare(
            BoundaryPoint::new(node, 0),
            BoundaryPoint::new(start.node, self.boundary_clamp(start.node, start.offset)?),
        )?;
        let end_compare = self.boundary_compare(
            BoundaryPoint::new(node, self.node_length(node)?),
            BoundaryPoint::new(end.node, self.boundary_clamp(end.node, end.offset)?),
        )?;
        Ok(start_compare == 1 && end_compare == -1)
    }

    /// Whether `node` partially contains the range (the baseline
    /// `RangeUtility.isPartiallyContained`): it is an inclusive ancestor of
    /// exactly one of the two boundary containers.
    fn is_partially_contained(
        &self,
        node: NodeId,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<bool, CoreError> {
        let starts = self.node_is_inclusive_ancestor(node, start.node)?;
        let ends = self.node_is_inclusive_ancestor(node, end.node)?;
        Ok(starts != ends)
    }

    /// Returns the deepest node that is an inclusive ancestor of both boundary
    /// containers (WHATWG `commonAncestorContainer`).
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when the two containers share no common
    ///   ancestor (two unrelated detached subtrees).
    pub fn range_common_ancestor(
        &self,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<NodeId, CoreError> {
        let mut container = start.node;
        loop {
            if self.node_is_inclusive_ancestor(container, end.node)? {
                return Ok(container);
            }
            let Some(parent) = self.get(container)?.parent() else {
                return Err(hierarchy("the two boundary points have no common ancestor"));
            };
            container = parent;
        }
    }

    /// Returns the text of the range (WHATWG `Range.toString`), following the
    /// baseline's stringifier exactly.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale handle.
    pub fn range_to_string(
        &self,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<String, CoreError> {
        let start_offset = self.boundary_clamp(start.node, start.offset)?;
        let end_offset = self.boundary_clamp(end.node, end.offset)?;
        let start_is_text = matches!(self.get(start.node)?.data().node_type(), NodeType::Text);
        let end_is_text = matches!(self.get(end.node)?.data().node_type(), NodeType::Text);
        if start.node == end.node && start_is_text {
            return self.substring_data(start.node, start_offset, end_offset - start_offset);
        }
        let mut string = String::new();
        if start_is_text {
            let data = self.get(start.node)?.data().text_data().unwrap_or_default();
            string.push_str(&utf16_slice_from(data, start_offset));
        }
        let end_node = self.next_descendant_node(end.node)?;
        let mut current_node = Some(start.node);
        while let Some(current) = current_node {
            if Some(current) == end_node {
                break;
            }
            if matches!(self.get(current)?.data().node_type(), NodeType::Text)
                && self.is_contained(
                    current,
                    BoundaryPoint::new(start.node, start_offset),
                    BoundaryPoint::new(end.node, end_offset),
                )?
            {
                let data = self.get(current)?.data().text_data().unwrap_or_default();
                string.push_str(data);
            }
            current_node = self.following_node(current)?;
        }
        if end_is_text {
            let data = self.get(end.node)?.data().text_data().unwrap_or_default();
            string.push_str(&utf16_slice_to(data, end_offset));
        }
        Ok(string)
    }

    /// Clones the contents of the range into a freshly allocated
    /// `DocumentFragment` (WHATWG `cloneContents`).
    ///
    /// The source tree is left untouched. A collapsed range yields an empty
    /// fragment.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when the range contains a `DocumentType`
    ///   node (the baseline's `HierarchyRequestError`).
    pub fn range_clone_contents(
        &mut self,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<NodeId, CoreError> {
        let start_offset = self.boundary_clamp(start.node, start.offset)?;
        let end_offset = self.boundary_clamp(end.node, end.offset)?;
        let fragment = self.create_document_fragment()?;
        if start.node == end.node && start_offset == end_offset {
            return Ok(fragment);
        }
        let start_kind = self.get(start.node)?.data().node_type();

        // A range wholly inside one character-data node.
        if start.node == end.node && is_character_data_kind(start_kind) {
            let clone = self.clone_node(start.node, false)?;
            let data = self.substring_data(start.node, start_offset, end_offset - start_offset)?;
            self.set_character_data(clone, &data)?;
            self.append_child(fragment, clone)?;
            return Ok(fragment);
        }

        let common = self.range_common_ancestor(start, end)?;
        let first_partial = if !self.node_is_inclusive_ancestor(start.node, end.node)? {
            self.first_partially_contained_child(common, start, end)?
        } else {
            None
        };
        let last_partial = if !self.node_is_inclusive_ancestor(end.node, start.node)? {
            self.last_partially_contained_child(common, start, end)?
        } else {
            None
        };

        let mut contained: Vec<NodeId> = Vec::new();
        for node in self.children(common)? {
            if self.is_contained(node, start, end)? {
                if self.get(node)?.data().node_type() == NodeType::DocumentType {
                    return Err(hierarchy("Invalid document type element."));
                }
                contained.push(node);
            }
        }

        if let Some(first) = first_partial {
            self.clone_partial_boundary(fragment, first, start, start_offset, true)?;
        }
        for &child in &contained {
            let clone = self.clone_node(child, true)?;
            self.append_child(fragment, clone)?;
        }
        if let Some(last) = last_partial {
            self.clone_partial_boundary(fragment, last, end, end_offset, false)?;
        }
        Ok(fragment)
    }

    /// Appends a clone of one partially contained boundary child to `fragment`.
    ///
    /// `at_start` selects the boundary side: for a character-data node the data
    /// slice is `[offset, length)` (start) or `[0, offset)` (end); for an
    /// element the shallow clone is filled with a recursively cloned sub-range.
    fn clone_partial_boundary(
        &mut self,
        fragment: NodeId,
        node: NodeId,
        boundary: BoundaryPoint,
        offset: usize,
        at_start: bool,
    ) -> Result<(), CoreError> {
        let kind = self.get(node)?.data().node_type();
        if is_character_data_kind(kind) {
            let clone = self.clone_node(boundary.node, false)?;
            let data = if at_start {
                self.substring_data(
                    boundary.node,
                    offset,
                    self.node_length(boundary.node)? - offset,
                )?
            } else {
                self.substring_data(boundary.node, 0, offset)?
            };
            self.set_character_data(clone, &data)?;
            self.append_child(fragment, clone)
        } else {
            let clone = self.clone_node(node, false)?;
            self.append_child(fragment, clone)?;
            let sub_range = if at_start {
                (
                    BoundaryPoint::new(boundary.node, offset),
                    BoundaryPoint::new(node, self.node_length(node)?),
                )
            } else {
                (
                    BoundaryPoint::new(node, 0),
                    BoundaryPoint::new(boundary.node, offset),
                )
            };
            let sub_fragment = self.range_clone_contents(sub_range.0, sub_range.1)?;
            self.append_child(clone, sub_fragment)
        }
    }

    /// Extracts the contents of the range into a freshly allocated
    /// `DocumentFragment`, removing them from the tree (WHATWG
    /// `extractContents`).
    ///
    /// Returns the fragment root plus the position the range collapses to:
    /// `Some` for the cross-node case (both boundaries move there), `None` for
    /// a range wholly inside one character-data node, whose boundaries stay
    /// put (matching the baseline, which only truncates the node).
    ///
    /// # Errors
    ///
    /// As for [`Document::range_clone_contents`].
    pub fn range_extract_contents(
        &mut self,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<(NodeId, Option<BoundaryPoint>), CoreError> {
        let start_offset = self.boundary_clamp(start.node, start.offset)?;
        let end_offset = self.boundary_clamp(end.node, end.offset)?;
        let fragment = self.create_document_fragment()?;
        if start.node == end.node && start_offset == end_offset {
            return Ok((fragment, None));
        }
        let start_kind = self.get(start.node)?.data().node_type();

        // A range wholly inside one character-data node: clone the substring,
        // truncate the node, leave the boundaries untouched.
        if start.node == end.node && is_character_data_kind(start_kind) {
            let clone = self.clone_node(start.node, false)?;
            let data = self.substring_data(start.node, start_offset, end_offset - start_offset)?;
            self.set_character_data(clone, &data)?;
            self.append_child(fragment, clone)?;
            self.replace_data(start.node, start_offset, end_offset - start_offset, "")?;
            return Ok((fragment, None));
        }

        let common = self.range_common_ancestor(start, end)?;
        let first_partial = if !self.node_is_inclusive_ancestor(start.node, end.node)? {
            self.first_partially_contained_child(common, start, end)?
        } else {
            None
        };
        let last_partial = if !self.node_is_inclusive_ancestor(end.node, start.node)? {
            self.last_partially_contained_child(common, start, end)?
        } else {
            None
        };

        let mut contained: Vec<NodeId> = Vec::new();
        for node in self.children(common)? {
            if self.is_contained(node, start, end)? {
                if self.get(node)?.data().node_type() == NodeType::DocumentType {
                    return Err(hierarchy("Invalid document type element."));
                }
                contained.push(node);
            }
        }

        let new_position = self.range_collapse_position(start, end, start_offset)?;

        if let Some(first) = first_partial {
            self.extract_partial_boundary(fragment, first, start, start_offset, true)?;
        }
        for &child in &contained {
            self.append_child(fragment, child)?;
        }
        if let Some(last) = last_partial {
            self.extract_partial_boundary(fragment, last, end, end_offset, false)?;
        }

        Ok((fragment, new_position))
    }

    /// Removes the contents of the range from the tree (WHATWG
    /// `deleteContents`).
    ///
    /// Returns the position the range collapses to: `Some` for the cross-node
    /// case, `None` for a range wholly inside one character-data node.
    ///
    /// # Errors
    ///
    /// As for [`Document::range_clone_contents`].
    pub fn range_delete_contents(
        &mut self,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<Option<BoundaryPoint>, CoreError> {
        let start_offset = self.boundary_clamp(start.node, start.offset)?;
        let end_offset = self.boundary_clamp(end.node, end.offset)?;
        if start.node == end.node && start_offset == end_offset {
            return Ok(None);
        }
        let start_kind = self.get(start.node)?.data().node_type();

        // A range wholly inside one character-data node: truncate only.
        if start.node == end.node && is_character_data_kind(start_kind) {
            self.replace_data(start.node, start_offset, end_offset - start_offset, "")?;
            return Ok(None);
        }

        // Collect the top-most fully contained nodes (a contained node whose
        // parent is not contained).
        let mut nodes_to_remove: Vec<NodeId> = Vec::new();
        let mut current_node = Some(start.node);
        let end_node = self.next_descendant_node(end.node)?;
        while let Some(current) = current_node {
            if Some(current) == end_node {
                break;
            }
            if self.is_contained(current, start, end)? {
                let parent = self.get(current)?.parent();
                let parent_contained = match parent {
                    Some(p) => self.is_contained(p, start, end)?,
                    None => false,
                };
                if !parent_contained {
                    nodes_to_remove.push(current);
                }
            }
            current_node = self.following_node(current)?;
        }

        let new_position = self.range_collapse_position(start, end, start_offset)?;

        if is_character_data_kind(start_kind) {
            self.replace_data(
                start.node,
                start_offset,
                self.node_length(start.node)? - start_offset,
                "",
            )?;
        }
        for &node in &nodes_to_remove {
            let parent = self
                .get(node)?
                .parent()
                .expect("a contained node has a parent");
            self.remove_child(parent, node)?;
        }
        let end_kind = self.get(end.node)?.data().node_type();
        if is_character_data_kind(end_kind) {
            self.replace_data(end.node, 0, end_offset, "")?;
        }

        Ok(new_position)
    }

    /// Computes the collapsed position a cross-node delete/extract leaves the
    /// range at (the baseline's `newNode` / `newOffset` computation).
    fn range_collapse_position(
        &self,
        start: BoundaryPoint,
        end: BoundaryPoint,
        start_offset: usize,
    ) -> Result<Option<BoundaryPoint>, CoreError> {
        if self.node_is_inclusive_ancestor(start.node, end.node)? {
            return Ok(Some(BoundaryPoint::new(start.node, start_offset)));
        }
        let mut reference_node = start.node;
        loop {
            let Some(parent) = self.get(reference_node)?.parent() else {
                return Err(hierarchy("the two boundary points have no common ancestor"));
            };
            if self.node_is_inclusive_ancestor(parent, end.node)? {
                let index = self.child_index(parent, reference_node)? + 1;
                return Ok(Some(BoundaryPoint::new(parent, index)));
            }
            reference_node = parent;
        }
    }

    /// Applies one partially contained boundary side of `extractContents`:
    /// character-data nodes are truncated after cloning the kept slice, and
    /// element boundaries are shallow-cloned and recursively extracted.
    fn extract_partial_boundary(
        &mut self,
        fragment: NodeId,
        node: NodeId,
        boundary: BoundaryPoint,
        offset: usize,
        at_start: bool,
    ) -> Result<(), CoreError> {
        let kind = self.get(node)?.data().node_type();
        if is_character_data_kind(kind) {
            let clone = self.clone_node(boundary.node, false)?;
            let data = if at_start {
                self.substring_data(
                    boundary.node,
                    offset,
                    self.node_length(boundary.node)? - offset,
                )?
            } else {
                self.substring_data(boundary.node, 0, offset)?
            };
            self.set_character_data(clone, &data)?;
            self.append_child(fragment, clone)?;
            if at_start {
                self.replace_data(
                    boundary.node,
                    offset,
                    self.node_length(boundary.node)? - offset,
                    "",
                )?;
            } else {
                self.replace_data(boundary.node, 0, offset, "")?;
            }
            Ok(())
        } else {
            let clone = self.clone_node(node, false)?;
            self.append_child(fragment, clone)?;
            let sub_range = if at_start {
                (
                    BoundaryPoint::new(boundary.node, offset),
                    BoundaryPoint::new(node, self.node_length(node)?),
                )
            } else {
                (
                    BoundaryPoint::new(node, 0),
                    BoundaryPoint::new(boundary.node, offset),
                )
            };
            let (sub_fragment, _) = self.range_extract_contents(sub_range.0, sub_range.1)?;
            self.append_child(clone, sub_fragment)
        }
    }

    /// Inserts `new_node` at the start of the range (WHATWG `insertNode`),
    /// returning the new end position for a collapsed range (`None` otherwise).
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when the start boundary is invalid (a
    ///   `ProcessingInstruction`/`Comment` container, a parentless `Text`
    ///   container, or the node being inserted is the container itself) or the
    ///   underlying insertion fails (the baseline's `HierarchyRequestError`).
    pub fn range_insert_node(
        &mut self,
        start: BoundaryPoint,
        end: BoundaryPoint,
        new_node: NodeId,
    ) -> Result<Option<BoundaryPoint>, CoreError> {
        let start_offset = self.boundary_clamp(start.node, start.offset)?;
        let end_offset = self.boundary_clamp(end.node, end.offset)?;
        let start_kind = self.get(start.node)?.data().node_type();
        if start_kind == NodeType::ProcessingInstruction
            || start_kind == NodeType::Comment
            || (start_kind == NodeType::Text && self.get(start.node)?.parent().is_none())
            || new_node == start.node
        {
            return Err(hierarchy("Invalid start node."));
        }

        let mut reference_node = if start_kind == NodeType::Text {
            Some(start.node)
        } else {
            self.children(start.node)?.get(start_offset).copied()
        };
        let parent = match reference_node {
            Some(r) => self
                .get(r)?
                .parent()
                .expect("a child of the start node has a parent"),
            None => start.node,
        };

        if start_kind == NodeType::Text {
            reference_node = Some(self.split_text(start.node, start_offset)?);
        }
        if Some(new_node) == reference_node {
            reference_node = self
                .get(reference_node.expect("the reference node was just set"))?
                .next_sibling();
        }
        if let Some(old_parent) = self.get(new_node)?.parent() {
            self.remove_child(old_parent, new_node)?;
        }

        let mut new_offset = match reference_node {
            Some(r) => self.child_index(
                self.get(r)?
                    .parent()
                    .expect("the reference node has a parent"),
                r,
            )?,
            None => self.node_length(parent)?,
        };
        new_offset += if self.get(new_node)?.data().node_type() == NodeType::DocumentFragment {
            self.node_length(new_node)?
        } else {
            1
        };

        match reference_node {
            Some(r) => self.insert_before(parent, new_node, r)?,
            None => self.append_child(parent, new_node)?,
        }

        let collapsed = start.node == end.node && start_offset == end_offset;
        if collapsed {
            Ok(Some(BoundaryPoint::new(parent, new_offset)))
        } else {
            Ok(None)
        }
    }

    /// Surrounds the range's contents with `new_parent` (WHATWG
    /// `surroundContents`): extracts the contents, clears `new_parent`, inserts
    /// it at the collapsed range, moves the contents into it, then selects the
    /// whole `new_parent`.
    ///
    /// Returns the boundary points of the final `selectNode(new_parent)`.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `new_parent` is a `Document`,
    ///   `DocumentType` or `DocumentFragment` (the baseline's
    ///   `InvalidNodeTypeError`), when the range partially contains a
    ///   non-`Text` node (the baseline's `InvalidStateError`), or when an
    ///   underlying operation fails.
    pub fn range_surround_contents(
        &mut self,
        start: BoundaryPoint,
        end: BoundaryPoint,
        new_parent: NodeId,
    ) -> Result<(BoundaryPoint, BoundaryPoint), CoreError> {
        let new_parent_kind = self.get(new_parent)?.data().node_type();
        if matches!(
            new_parent_kind,
            NodeType::Document | NodeType::DocumentType | NodeType::DocumentFragment
        ) {
            return Err(hierarchy("Invalid element type."));
        }

        let common = self.range_common_ancestor(start, end)?;
        let end_node = self.next_descendant_node(common)?;
        let mut node = Some(common);
        while let Some(current) = node {
            if Some(current) == end_node {
                break;
            }
            if self.get(current)?.data().node_type() != NodeType::Text
                && self.is_partially_contained(current, start, end)?
            {
                return Err(hierarchy(
                    "The Range has partially contains a non-Text node.",
                ));
            }
            node = self.following_node(current)?;
        }

        let (fragment, new_position) = self.range_extract_contents(start, end)?;
        let (cur_start, cur_end) = match new_position {
            Some(pos) => (pos, pos),
            None => (start, end),
        };

        while let Some(child) = self.get(new_parent)?.first_child() {
            self.remove_child(new_parent, child)?;
        }
        self.range_insert_node(cur_start, cur_end, new_parent)?;
        self.append_child(new_parent, fragment)?;

        let parent = self
            .get(new_parent)?
            .parent()
            .ok_or_else(|| hierarchy("surroundContents left the new parent detached"))?;
        let index = self.child_index(parent, new_parent)?;
        Ok((
            BoundaryPoint::new(parent, index),
            BoundaryPoint::new(parent, index + 1),
        ))
    }

    /// Finds the first child of `common` (in document order) that partially
    /// contains the range, if any.
    fn first_partially_contained_child(
        &self,
        common: NodeId,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<Option<NodeId>, CoreError> {
        let mut candidate = self.get(common)?.first_child();
        while let Some(c) = candidate {
            if self.is_partially_contained(c, start, end)? {
                return Ok(Some(c));
            }
            candidate = self.get(c)?.next_sibling();
        }
        Ok(None)
    }

    /// Finds the last child of `common` (in reverse document order) that
    /// partially contains the range, if any.
    fn last_partially_contained_child(
        &self,
        common: NodeId,
        start: BoundaryPoint,
        end: BoundaryPoint,
    ) -> Result<Option<NodeId>, CoreError> {
        let mut candidate = self.get(common)?.last_child();
        while let Some(c) = candidate {
            if self.is_partially_contained(c, start, end)? {
                return Ok(Some(c));
            }
            candidate = self.get(c)?.previous_sibling();
        }
        Ok(None)
    }
}

/// Whether `kind` is a character-data node kind that participates in the
/// substring / replace-data boundary handling.
fn is_character_data_kind(kind: NodeType) -> bool {
    matches!(
        kind,
        NodeType::Text | NodeType::ProcessingInstruction | NodeType::Comment
    )
}

/// Returns `s[offset..]` measured in UTF-16 code units (lossy when the offset
/// splits a surrogate pair, never a panic).
fn utf16_slice_from(s: &str, offset: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    String::from_utf16_lossy(&units[offset.min(units.len())..])
}

/// Returns `s[..offset]` measured in UTF-16 code units (lossy when the offset
/// splits a surrogate pair, never a panic).
fn utf16_slice_to(s: &str, offset: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    String::from_utf16_lossy(&units[..offset.min(units.len())])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds `body > (div#a > span#a1, div#b > (p#b1, p#b2))` plus text
    /// nodes `"Hello "` before `div#a` and `" foo"` after `div#b`.
    fn build_tree() -> (
        Document,
        NodeId,
        NodeId,
        NodeId,
        NodeId,
        NodeId,
        NodeId,
        NodeId,
        NodeId,
    ) {
        let mut doc = Document::new();
        let body = doc.create_element("body").unwrap();
        let hello = doc.create_text("Hello ").unwrap();
        let a = doc.create_element("div").unwrap();
        let a1 = doc.create_element("span").unwrap();
        let b = doc.create_element("div").unwrap();
        let b1 = doc.create_element("p").unwrap();
        let b2 = doc.create_element("p").unwrap();
        let foo = doc.create_text(" foo").unwrap();
        doc.append_child(a, a1).unwrap();
        doc.append_child(b, b1).unwrap();
        doc.append_child(b, b2).unwrap();
        doc.append_child(body, hello).unwrap();
        doc.append_child(body, a).unwrap();
        doc.append_child(body, b).unwrap();
        doc.append_child(body, foo).unwrap();
        (doc, body, hello, a, a1, b, b1, b2, foo)
    }

    fn text_node(doc: &mut Document, data: &str) -> NodeId {
        doc.create_text(data).unwrap()
    }

    #[test]
    fn node_length_matches_dom_units() {
        let mut doc = Document::new();
        let text = text_node(&mut doc, "中文😀");
        assert_eq!(doc.node_length(text).unwrap(), 4);
        let div = doc.create_element("div").unwrap();
        assert_eq!(doc.node_length(div).unwrap(), 0);
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(div, a).unwrap();
        doc.append_child(div, b).unwrap();
        assert_eq!(doc.node_length(div).unwrap(), 2);
        let comment = doc.create_comment("x").unwrap();
        assert_eq!(doc.node_length(comment).unwrap(), 1);
    }

    #[test]
    fn boundary_validate_rejects_doctype_and_oversized_offset() {
        let mut doc = Document::new();
        let text = text_node(&mut doc, "abc");
        assert!(doc.boundary_validate(text, 3).is_ok());
        assert!(matches!(
            doc.boundary_validate(text, 4),
            Err(CoreError::IndexOutOfBounds { index: 4, len: 3 })
        ));
        doc.load_html("<!DOCTYPE html><html><body></body></html>")
            .unwrap();
        let dt = doc.doctype().unwrap().expect("parsed a doctype");
        assert!(matches!(
            doc.boundary_validate(dt, 0),
            Err(CoreError::Hierarchy { .. })
        ));
    }

    #[test]
    fn boundary_compare_orders_same_node_and_ancestors() {
        let (doc, _body, hello, _a, _a1, _b, _b1, _b2, _foo) = build_tree();
        let compare = |a: (NodeId, usize), b: (NodeId, usize)| {
            doc.boundary_compare(BoundaryPoint::new(a.0, a.1), BoundaryPoint::new(b.0, b.1))
                .unwrap()
        };
        // Same node offsets.
        assert_eq!(compare((hello, 1), (hello, 3)), -1);
        assert_eq!(compare((hello, 3), (hello, 3)), 0);
        assert_eq!(compare((hello, 3), (hello, 1)), 1);
        // hello at offset 1 vs body at offset 0: hello is after body@0.
        assert_eq!(compare((hello, 1), (_body, 0)), 1);
        // hello@1 vs body@1: hello's child index (0) < 1, so before.
        assert_eq!(compare((hello, 1), (_body, 1)), -1);
        // hello@1 vs hello@2 — same node.
        assert_eq!(compare((hello, 2), (hello, 1)), 1);
        // a1 (inside div#a, the second child of body) vs body@2: a1 is before
        // the boundary after div#a (negation of body@2 vs a1@0, whose child
        // index 1 is not < 2).
        assert_eq!(compare((_a1, 0), (_body, 2)), -1);
        // a1 vs body@3: a1 is inside child index 1, which is < 3 → after.
        assert_eq!(compare((_a1, 0), (_body, 3)), -1);
    }

    #[test]
    fn boundary_compare_handles_following_via_siblings() {
        let (doc, _body, _hello, _a, _a1, _b, b1, _b2, _foo) = build_tree();
        let compare = |a: (NodeId, usize), b: (NodeId, usize)| {
            doc.boundary_compare(BoundaryPoint::new(a.0, a.1), BoundaryPoint::new(b.0, b.1))
                .unwrap()
        };
        // body@3 is after b1 (b1 sits inside child index 2, and 2 < 3).
        assert_eq!(compare((_body, 3), (b1, 0)), 1);
        // b1 is inside div#b (index 2), so (b1,0) is after the boundary
        // (body,2) that precedes div#b.
        assert_eq!(compare((b1, 0), (_body, 2)), 1);
    }

    #[test]
    fn boundary_compare_element_contents_vs_child() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let t1 = doc.create_text("Hello ").unwrap();
        let b = doc.create_element("b").unwrap();
        let bt = doc.create_text("world").unwrap();
        let t2 = doc.create_text(" foo").unwrap();
        doc.append_child(b, bt).unwrap();
        doc.append_child(p, t1).unwrap();
        doc.append_child(p, b).unwrap();
        doc.append_child(p, t2).unwrap();
        // (p, 0) is before (b, 0): b is p's child at index 1, not < 0.
        assert_eq!(
            doc.boundary_compare(BoundaryPoint::new(p, 0), BoundaryPoint::new(b, 0))
                .unwrap(),
            -1
        );
        // (p, 3) is after (b, 1): b's child index 1 < 3.
        assert_eq!(
            doc.boundary_compare(BoundaryPoint::new(p, 3), BoundaryPoint::new(b, 1))
                .unwrap(),
            1
        );
    }

    #[test]
    fn range_to_string_over_text_and_mixed_trees() {
        let (doc, _body, hello, _a, _a1, _b, _b1, _b2, foo) = build_tree();
        // Whole text node: "Hello " sliced [1, 4) is "ell".
        assert_eq!(
            doc.range_to_string(BoundaryPoint::new(hello, 1), BoundaryPoint::new(hello, 4))
                .unwrap(),
            "ell"
        );
        // Across the tree: hello[2..] = "llo ", then the trailing " foo" text
        // contributes its first 2 units " f".
        assert_eq!(
            doc.range_to_string(BoundaryPoint::new(hello, 2), BoundaryPoint::new(foo, 2))
                .unwrap(),
            "llo  f"
        );
    }

    #[test]
    fn range_to_string_matches_expected_text() {
        let (doc, _body, hello, _a, _a1, _b, b1, _b2, foo) = build_tree();
        // selectNodeContents of body: all text concatenated in tree order.
        let start = BoundaryPoint::new(_body, 0);
        let end = BoundaryPoint::new(_body, doc.node_length(_body).unwrap());
        assert_eq!(doc.range_to_string(start, end).unwrap(), "Hello  foo");
        // From hello[0] to b1[0]: the leading text node contributes all of it.
        let s = doc
            .range_to_string(BoundaryPoint::new(hello, 0), BoundaryPoint::new(b1, 0))
            .unwrap();
        assert_eq!(s, "Hello ");
        let _ = foo;
    }

    #[test]
    fn range_common_ancestor_finds_deepest_common() {
        let (doc, _body, hello, a, _a1, _b, b1, _b2, _foo) = build_tree();
        assert_eq!(
            doc.range_common_ancestor(BoundaryPoint::new(hello, 0), BoundaryPoint::new(hello, 2),)
                .unwrap(),
            hello
        );
        assert_eq!(
            doc.range_common_ancestor(BoundaryPoint::new(hello, 0), BoundaryPoint::new(_a1, 0),)
                .unwrap(),
            _body
        );
        assert_eq!(
            doc.range_common_ancestor(BoundaryPoint::new(b1, 0), BoundaryPoint::new(_b2, 0),)
                .unwrap(),
            _b
        );
        let _ = (a, _b);
    }

    #[test]
    fn delete_contents_removes_and_collapses_cross_node() {
        let mut doc = Document::new();
        let body = doc.create_element("body").unwrap();
        let p = doc.create_element("p").unwrap();
        let t1 = doc.create_text("abc").unwrap();
        let t2 = doc.create_text("def").unwrap();
        doc.append_child(p, t1).unwrap();
        doc.append_child(p, t2).unwrap();
        doc.append_child(body, p).unwrap();

        let position = doc
            .range_delete_contents(BoundaryPoint::new(p, 0), BoundaryPoint::new(p, 2))
            .unwrap()
            .expect("cross-node delete collapses");
        assert_eq!(position.node, p);
        assert_eq!(position.offset, 0);
        assert_eq!(doc.children(p).unwrap(), Vec::<NodeId>::new());
        assert!(doc.get(t1).is_ok(), "removed text nodes stay live");
        assert!(doc.get(t2).is_ok(), "removed text nodes stay live");
        assert!(doc.check_invariants(body).is_ok());
    }

    #[test]
    fn delete_contents_same_text_node_truncates_without_collapse() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let t = doc.create_text("abcdef").unwrap();
        doc.append_child(p, t).unwrap();

        let position = doc
            .range_delete_contents(BoundaryPoint::new(t, 1), BoundaryPoint::new(t, 4))
            .unwrap();
        assert_eq!(
            position, None,
            "same-node delete leaves the range unchanged"
        );
        assert_eq!(doc.get(t).unwrap().data().text_data(), Some("aef"));
        assert!(doc.check_invariants(p).is_ok());
    }

    #[test]
    fn extract_contents_same_text_node_returns_clone_and_truncates() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let t = doc.create_text("abcdef").unwrap();
        doc.append_child(p, t).unwrap();

        let (fragment, position) = doc
            .range_extract_contents(BoundaryPoint::new(t, 1), BoundaryPoint::new(t, 4))
            .unwrap();
        assert_eq!(position, None);
        assert_eq!(doc.children(fragment).unwrap().len(), 1);
        let child = doc.children(fragment).unwrap()[0];
        assert_eq!(doc.get(child).unwrap().data().text_data(), Some("bcd"));
        assert_eq!(doc.get(t).unwrap().data().text_data(), Some("aef"));
        assert!(doc.check_invariants(p).is_ok());
        assert!(doc.check_invariants(fragment).is_ok());
    }

    #[test]
    fn extract_contents_cross_node_moves_children_and_collapses() {
        let mut doc = Document::new();
        let body = doc.create_element("body").unwrap();
        let p = doc.create_element("p").unwrap();
        let t1 = doc.create_text("abc").unwrap();
        let t2 = doc.create_text("def").unwrap();
        doc.append_child(p, t1).unwrap();
        doc.append_child(p, t2).unwrap();
        doc.append_child(body, p).unwrap();

        let (fragment, position) = doc
            .range_extract_contents(BoundaryPoint::new(p, 0), BoundaryPoint::new(p, 2))
            .unwrap();
        let Some(position) = position else {
            panic!("cross-node extract collapses");
        };
        assert_eq!(position.node, p);
        assert_eq!(position.offset, 0);
        assert_eq!(doc.children(p).unwrap(), Vec::<NodeId>::new());
        assert_eq!(doc.children(fragment).unwrap().len(), 2);
        assert!(doc.check_invariants(body).is_ok());
        assert!(doc.check_invariants(fragment).is_ok());
    }

    #[test]
    fn clone_contents_copies_without_mutating() {
        let mut doc = Document::new();
        let body = doc.create_element("body").unwrap();
        let p = doc.create_element("p").unwrap();
        let t1 = doc.create_text("abc").unwrap();
        let t2 = doc.create_text("def").unwrap();
        doc.append_child(p, t1).unwrap();
        doc.append_child(p, t2).unwrap();
        doc.append_child(body, p).unwrap();

        let fragment = doc
            .range_clone_contents(BoundaryPoint::new(p, 0), BoundaryPoint::new(p, 2))
            .unwrap();
        assert_eq!(doc.children(fragment).unwrap().len(), 2);
        assert_eq!(doc.children(p).unwrap().len(), 2, "source untouched");
        assert_eq!(
            doc.get(doc.children(fragment).unwrap()[0])
                .unwrap()
                .data()
                .text_data(),
            Some("abc")
        );
        assert!(doc.check_invariants(body).is_ok());
        assert!(doc.check_invariants(fragment).is_ok());
    }

    #[test]
    fn insert_node_moves_collapsed_end() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let t = doc.create_text("abc").unwrap();
        doc.append_child(p, t).unwrap();
        let em = doc.create_element("em").unwrap();

        let new_end = doc
            .range_insert_node(BoundaryPoint::new(t, 2), BoundaryPoint::new(t, 2), em)
            .unwrap()
            .expect("a collapsed range reports its new end");
        assert_eq!(new_end.node, p);
        assert_eq!(new_end.offset, 2);
        let children = doc.children(p).unwrap();
        assert_eq!(children.len(), 3);
        assert_eq!(children[1], em, "em is inserted between the split halves");
        assert_eq!(doc.get(children[0]).unwrap().data().text_data(), Some("ab"));
        assert_eq!(doc.get(children[2]).unwrap().data().text_data(), Some("c"));
        assert!(doc.check_invariants(p).is_ok());
    }

    #[test]
    fn insert_node_rejects_invalid_start() {
        let mut doc = Document::new();
        let comment = doc.create_comment("x").unwrap();
        let em = doc.create_element("em").unwrap();
        assert!(matches!(
            doc.range_insert_node(
                BoundaryPoint::new(comment, 0),
                BoundaryPoint::new(comment, 0),
                em,
            ),
            Err(CoreError::Hierarchy { .. })
        ));
    }

    #[test]
    fn surround_contents_wraps_and_selects_new_parent() {
        let mut doc = Document::new();
        let body = doc.create_element("body").unwrap();
        let p = doc.create_element("p").unwrap();
        let b = doc.create_element("b").unwrap();
        let t = doc.create_text("world").unwrap();
        doc.append_child(b, t).unwrap();
        doc.append_child(p, b).unwrap();
        doc.append_child(body, p).unwrap();
        let em = doc.create_element("em").unwrap();

        let (start, end) = doc
            .range_surround_contents(BoundaryPoint::new(b, 0), BoundaryPoint::new(b, 1), em)
            .unwrap();
        // The final selectNode(em) selects em inside b.
        assert_eq!(start.node, b);
        assert_eq!(start.offset, 0);
        assert_eq!(end.node, b);
        assert_eq!(end.offset, 1);
        assert_eq!(doc.children(b).unwrap()[0], em);
        assert_eq!(
            doc.get(doc.children(em).unwrap()[0])
                .unwrap()
                .data()
                .text_data(),
            Some("world")
        );
        assert!(doc.check_invariants(body).is_ok());
    }

    #[test]
    fn surround_contents_rejects_document_parent() {
        let mut doc = Document::new();
        let b = doc.create_element("b").unwrap();
        let t = doc.create_text("x").unwrap();
        doc.append_child(b, t).unwrap();
        let doc_node = doc.create_document_node_for_test();
        assert!(matches!(
            doc.range_surround_contents(
                BoundaryPoint::new(b, 0),
                BoundaryPoint::new(b, 1),
                doc_node,
            ),
            Err(CoreError::Hierarchy { .. })
        ));
    }

    #[test]
    fn offsets_clamp_after_character_data_mutation() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let t = doc.create_text("abcdef").unwrap();
        doc.append_child(p, t).unwrap();
        assert_eq!(doc.boundary_clamp(t, 4).unwrap(), 4);
        doc.set_character_data(t, "a").unwrap();
        assert_eq!(
            doc.boundary_clamp(t, 4).unwrap(),
            1,
            "clamped to new length"
        );
    }

    #[test]
    fn selection_contains_node_matches_baseline() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let t1 = doc.create_text("Hello ").unwrap();
        let b = doc.create_element("b").unwrap();
        let bt = doc.create_text("world").unwrap();
        doc.append_child(b, bt).unwrap();
        doc.append_child(p, t1).unwrap();
        doc.append_child(p, b).unwrap();
        // A range strictly inside the text node never contains the text node
        // itself (its boundaries are neither before nor after it).
        assert!(!doc
            .selection_contains_node(
                BoundaryPoint::new(t1, 1),
                BoundaryPoint::new(t1, 3),
                t1,
                false,
            )
            .unwrap());
        assert!(!doc
            .selection_contains_node(
                BoundaryPoint::new(t1, 1),
                BoundaryPoint::new(t1, 3),
                t1,
                true,
            )
            .unwrap());
        // A fully contained child b is covered both strictly and partially.
        assert!(doc
            .selection_contains_node(BoundaryPoint::new(p, 0), BoundaryPoint::new(p, 2), b, true,)
            .unwrap());
        assert!(doc
            .selection_contains_node(BoundaryPoint::new(p, 0), BoundaryPoint::new(p, 2), b, false,)
            .unwrap());
        // A detached node of the same document sits before every position, so
        // it is partially (but never strictly) contained — matching the
        // baseline's containsNode.
        let detached = doc.create_element("x").unwrap();
        assert!(doc
            .selection_contains_node(
                BoundaryPoint::new(t1, 0),
                BoundaryPoint::new(t1, 6),
                detached,
                true,
            )
            .unwrap());
        assert!(!doc
            .selection_contains_node(
                BoundaryPoint::new(t1, 0),
                BoundaryPoint::new(t1, 6),
                detached,
                false,
            )
            .unwrap());
    }

    #[test]
    fn removed_container_stays_readable() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let t = doc.create_text("abc").unwrap();
        doc.append_child(p, t).unwrap();
        doc.remove_child(p, t).unwrap();
        // The detached text node is still live: a boundary point on it reads.
        assert_eq!(doc.node_length(t).unwrap(), 3);
        assert!(doc.get(t).is_ok());
    }
}
