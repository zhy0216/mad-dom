//! Unified tree mutation API (T15).
//!
//! [`Document::append_child`] and [`Document::insert_before`] are the only
//! public entry points that write the tree relations stored on
//! [`Node`](super::node::Node). Every other way into the tree — the
//! [`Document`](super::Document) navigation API and
//! [`Document::check_invariants`] — is read-only, and the relation fields
//! themselves are `pub(crate)`, so callers outside this crate cannot bypass
//! the mutation API to corrupt the tree. T16 adds `remove`/`replace` in this
//! module with the same validation-then-mutation discipline.
//!
//! # Which nodes may be parents and children
//!
//! Pragmatic rules for the first batch of node types:
//!
//! * a parent may be an [`Element`](super::node::NodeType::Element) or a
//!   [`DocumentFragment`](super::node::NodeType::DocumentFragment). A
//!   `Document`, `Text` or `Comment` node cannot have children;
//! * a child argument may be an `Element`, `Text` or `Comment` node, which is
//!   moved as a single node, or a `DocumentFragment`, whose children are
//!   spliced into the target position — the fragment itself is emptied and
//!   never becomes a child;
//! * a `Document` node can be neither a parent nor a child.
//!
//! # References, no-ops and error selection
//!
//! [`Document::insert_before`] requires a reference node that must already be
//! a child of the parent; any other live node (or a detached node) is rejected
//! with [`CoreError::Hierarchy`]. This crate's error taxonomy has no
//! `NotFound` variant, and a live-but-misplaced reference is closest to a
//! hierarchy violation. Inserting a node before itself is a no-op that
//! succeeds without changing the tree, as is inserting it immediately before
//! its current next sibling (both mirror the WHATWG `pre-insert` early
//! returns); appending a node that is already the parent's last child is a
//! no-op as well. Appending a `DocumentFragment` with no children is also a
//! no-op.
//!
//! # Atomicity and invariant verification
//!
//! Every operation validates *all* preconditions (document ownership, node
//! kinds, ancestor cycles, reference membership) before touching a single
//! relation field, so a failed operation leaves the tree byte-for-byte
//! unchanged. After a successful mutation the affected tree root is re-checked
//! against [`Document::check_invariants`] in debug builds, so a relinking bug
//! fails loudly in tests instead of silently corrupting the tree.

use crate::arena::NodeId;
use crate::error::CoreError;

use super::node::NodeType;
use super::Document;

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

impl Document {
    /// Inserts `child` as the last child of `parent`.
    ///
    /// If `child` already has a parent it is first detached from that parent
    /// and then re-attached (the WHATWG `append`/`pre-insert` behavior), so the
    /// call also reorders children within the same parent or moves a subtree
    /// between parents. When `child` is a `DocumentFragment`, all of its
    /// children are moved to the end of `parent` and the fragment is left
    /// empty.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `parent` or `child` belongs to
    ///   another document.
    /// * [`CoreError::Arena`] when `parent` or `child` is a stale or invalid
    ///   handle.
    /// * [`CoreError::Hierarchy`] when `parent` is not a valid parent node
    ///   kind, `child` is a `Document` node, `child` is `parent` itself or an
    ///   ancestor of it, or a fragment child would become an ancestor of
    ///   `parent`.
    pub fn append_child(&mut self, parent: NodeId, child: NodeId) -> Result<(), CoreError> {
        self.pre_insert(parent, child, None)
    }

    /// Inserts `child` before `reference` within `parent`.
    ///
    /// Moving, reordering and `DocumentFragment` handling behave exactly as in
    /// [`Document::append_child`], with the insertion point taken from
    /// `reference` instead of the end of `parent`'s child list.
    ///
    /// # Errors
    ///
    /// As for [`Document::append_child`], plus:
    ///
    /// * [`CoreError::Hierarchy`] when `reference` is not a child of `parent`
    ///   (a live node in the wrong position, or a detached node).
    /// * [`CoreError::WrongDocument`] when `reference` belongs to another
    ///   document.
    ///
    /// Inserting `child` before itself is a no-op that succeeds without
    /// changing the tree.
    pub fn insert_before(
        &mut self,
        parent: NodeId,
        child: NodeId,
        reference: NodeId,
    ) -> Result<(), CoreError> {
        self.pre_insert(parent, child, Some(reference))
    }

    /// Shared implementation of the WHATWG `pre-insert` algorithm for
    /// `append_child` (`reference` = `None`) and `insert_before`
    /// (`reference` = `Some`).
    ///
    /// The method is split into a read-only validation phase and a mutation
    /// phase. Every precondition is checked in the first phase, so all error
    /// paths return before any relation field is written: a failed operation
    /// never leaves a partial modification.
    fn pre_insert(
        &mut self,
        parent: NodeId,
        child: NodeId,
        reference: Option<NodeId>,
    ) -> Result<(), CoreError> {
        // --- Validation phase: read-only, must not mutate the tree. ---

        self.validate_insert_parent(parent)?;
        let child_type = self.get(child)?.node_type();
        if child_type == NodeType::Document {
            return Err(hierarchy("a Document node cannot be inserted as a child"));
        }

        // Reject cycles: a node may not become a child of itself or of one of
        // its own descendants.
        if parent == child {
            return Err(hierarchy("cannot insert a node into itself"));
        }
        if self.is_descendant_of(parent, child)? {
            return Err(hierarchy(
                "cannot insert an ancestor into its own descendant",
            ));
        }

        // For a fragment child, every one of its children is about to become a
        // child of `parent`; none of them may be `parent` or an ancestor of it.
        let fragment_children = if child_type == NodeType::DocumentFragment {
            let children = self.children(child)?;
            for &c in &children {
                if c == parent || self.is_descendant_of(parent, c)? {
                    return Err(hierarchy(
                        "cannot insert a DocumentFragment into one of its own descendants",
                    ));
                }
            }
            children
        } else {
            Vec::new()
        };

        // WHATWG pre-insert step 3: inserting a node before itself is a no-op,
        // even when the node is not a child of `parent`.
        if reference == Some(child) {
            return Ok(());
        }

        if let Some(r) = reference {
            if self.get(r)?.parent() != Some(parent) {
                return Err(hierarchy(
                    "reference node is not a child of the insertion parent",
                ));
            }
            // WHATWG pre-insert step 6: already immediately before `reference`.
            if self.get(child)?.parent() == Some(parent)
                && self.get(child)?.next_sibling() == Some(r)
            {
                return Ok(());
            }
        } else {
            // Appending a node that is already the parent's last child is a
            // no-op.
            if self.get(child)?.parent() == Some(parent)
                && self.get(parent)?.last_child() == Some(child)
            {
                return Ok(());
            }
        }

        // An empty fragment has nothing to move; its children are never
        // inserted, so this is a no-op (validation above already ran).
        if child_type == NodeType::DocumentFragment && fragment_children.is_empty() {
            return Ok(());
        }

        // --- Mutation phase: every precondition has been validated. ---

        if child_type == NodeType::DocumentFragment {
            for &c in &fragment_children {
                self.detach(c);
            }
            self.insert_detached_chain(parent, &fragment_children, reference);
        } else {
            self.detach(child);
            self.insert_detached_chain(parent, &[child], reference);
        }

        self.verify_invariants(parent);
        Ok(())
    }

    /// Validates that `parent` is a live node of this document whose kind may
    /// have children.
    fn validate_insert_parent(&self, parent: NodeId) -> Result<(), CoreError> {
        match self.get(parent)?.node_type() {
            NodeType::Element | NodeType::DocumentFragment => Ok(()),
            NodeType::Document => Err(hierarchy("a Document node cannot be a parent")),
            NodeType::Text => Err(hierarchy("a Text node cannot be a parent")),
            NodeType::Comment => Err(hierarchy("a Comment node cannot be a parent")),
        }
    }

    /// Removes `node` from its current parent's child list and clears its own
    /// relation fields. `node` must be live and must belong to this document.
    fn detach(&mut self, node: NodeId) {
        let old_parent = self.get(node).expect("detaching a live node").parent();
        let prev = self
            .get(node)
            .expect("detaching a live node")
            .previous_sibling();
        let next = self
            .get(node)
            .expect("detaching a live node")
            .next_sibling();

        if let Some(p) = prev {
            self.node_mut(p)
                .expect("live previous sibling")
                .next_sibling = next;
        }
        if let Some(n) = next {
            self.node_mut(n)
                .expect("live next sibling")
                .previous_sibling = prev;
        }
        if let Some(op) = old_parent {
            let first = self.get(op).expect("live old parent").first_child();
            let last = self.get(op).expect("live old parent").last_child();
            if first == Some(node) {
                self.node_mut(op).expect("live old parent").first_child = next;
            }
            if last == Some(node) {
                self.node_mut(op).expect("live old parent").last_child = prev;
            }
        }
        let node_mut = self.node_mut(node).expect("detaching a live node");
        node_mut.parent = None;
        node_mut.previous_sibling = None;
        node_mut.next_sibling = None;
    }

    /// Splices the already-detached `nodes` (in document order) into `parent`'s
    /// child list before `reference`, or at the end when `reference` is `None`.
    fn insert_detached_chain(
        &mut self,
        parent: NodeId,
        nodes: &[NodeId],
        reference: Option<NodeId>,
    ) {
        debug_assert!(
            !nodes.is_empty(),
            "empty chains are short-circuited before reaching this point"
        );
        let first = nodes[0];
        let last = nodes[nodes.len() - 1];
        let prev = match reference {
            Some(r) => self.get(r).expect("live reference").previous_sibling(),
            None => self.get(parent).expect("live parent").last_child(),
        };

        for pair in nodes.windows(2) {
            self.node_mut(pair[0]).expect("live node").next_sibling = Some(pair[1]);
            self.node_mut(pair[1]).expect("live node").previous_sibling = Some(pair[0]);
        }
        self.node_mut(first).expect("live node").previous_sibling = prev;
        self.node_mut(last).expect("live node").next_sibling = reference;
        for &c in nodes {
            self.node_mut(c).expect("live node").parent = Some(parent);
        }

        if let Some(p) = prev {
            self.node_mut(p)
                .expect("live previous sibling")
                .next_sibling = Some(first);
        }
        if let Some(r) = reference {
            self.node_mut(r).expect("live reference").previous_sibling = Some(last);
        }

        match reference {
            Some(_) => {
                if prev.is_none() {
                    self.node_mut(parent).expect("live parent").first_child = Some(first);
                }
            }
            None => {
                if prev.is_none() {
                    self.node_mut(parent).expect("live parent").first_child = Some(first);
                }
                self.node_mut(parent).expect("live parent").last_child = Some(last);
            }
        }
    }

    /// In debug builds, re-checks the tree invariants over the subtree rooted
    /// at `node`'s top-level ancestor, so a relinking bug surfaces in tests.
    /// The parent walk is capped at the number of live nodes so a (buggy)
    /// cyclic tree cannot hang the check.
    fn verify_invariants(&self, node: NodeId) {
        #[cfg(debug_assertions)]
        {
            let mut root = node;
            for _ in 0..=self.live_node_count() {
                let parent = self.get(root).ok().and_then(|n| n.parent());
                match parent {
                    None => {
                        debug_assert_eq!(
                            self.check_invariants(root),
                            Ok(()),
                            "mutation at {node} left the tree inconsistent"
                        );
                        return;
                    }
                    Some(p) => root = p,
                }
            }
            unreachable!(
                "parent chain from {node} exceeds the live node count; the tree is cyclic"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arena::NodeId;
    use crate::error::CoreError;

    fn children(doc: &Document, id: NodeId) -> Vec<NodeId> {
        doc.children(id).unwrap()
    }

    fn assert_hierarchy(err: CoreError) {
        assert!(
            matches!(err, CoreError::Hierarchy { .. }),
            "expected Hierarchy, got {err:?}"
        );
    }

    // ---- append ----

    #[test]
    fn append_to_empty_parent_sets_first_and_last() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(parent, a).unwrap();

        assert_eq!(doc.parent(a).unwrap(), Some(parent));
        assert_eq!(doc.first_child(parent).unwrap(), Some(a));
        assert_eq!(doc.last_child(parent).unwrap(), Some(a));
        assert_eq!(doc.previous_sibling(a).unwrap(), None);
        assert_eq!(doc.next_sibling(a).unwrap(), None);
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn append_builds_chain_with_full_linkage() {
        let mut doc = Document::new();
        let parent = doc.create_element("ul").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        assert_eq!(children(&doc, parent), vec![a, b, c]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(a));
        assert_eq!(doc.last_child(parent).unwrap(), Some(c));
        assert_eq!(doc.parent(a).unwrap(), Some(parent));
        assert_eq!(doc.previous_sibling(a).unwrap(), None);
        assert_eq!(doc.next_sibling(a).unwrap(), Some(b));
        assert_eq!(doc.previous_sibling(b).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(b).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(b));
        assert_eq!(doc.next_sibling(c).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn append_to_parent_that_is_itself_a_child() {
        let mut doc = Document::new();
        let root = doc.create_element("root").unwrap();
        let mid = doc.create_element("mid").unwrap();
        doc.append_child(root, mid).unwrap();
        let leaf = doc.create_element("leaf").unwrap();
        doc.append_child(mid, leaf).unwrap();

        assert_eq!(children(&doc, mid), vec![leaf]);
        assert_eq!(doc.parent(leaf).unwrap(), Some(mid));
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }

    #[test]
    fn append_existing_last_child_is_no_op() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();

        doc.append_child(parent, b).unwrap();
        assert_eq!(children(&doc, parent), vec![a, b]);
        assert_eq!(doc.last_child(parent).unwrap(), Some(b));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- insert_before: first / middle / last positions ----

    #[test]
    fn insert_before_at_first_position() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();
        let a = doc.create_element("a").unwrap();

        doc.insert_before(parent, a, b).unwrap();
        assert_eq!(children(&doc, parent), vec![a, b, c]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(a));
        assert_eq!(doc.previous_sibling(a).unwrap(), None);
        assert_eq!(doc.next_sibling(a).unwrap(), Some(b));
        assert_eq!(doc.previous_sibling(b).unwrap(), Some(a));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn insert_before_at_middle_position() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, c).unwrap();
        let b = doc.create_element("b").unwrap();

        doc.insert_before(parent, b, c).unwrap();
        assert_eq!(children(&doc, parent), vec![a, b, c]);
        assert_eq!(doc.previous_sibling(b).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(b).unwrap(), Some(c));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn insert_before_at_last_position() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        let c = doc.create_element("c").unwrap();

        doc.insert_before(parent, c, b).unwrap();
        assert_eq!(children(&doc, parent), vec![a, c, b]);
        assert_eq!(doc.last_child(parent).unwrap(), Some(b));
        assert_eq!(doc.previous_sibling(b).unwrap(), Some(c));
        assert_eq!(doc.next_sibling(c).unwrap(), Some(b));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn insert_before_self_is_no_op() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();

        doc.insert_before(parent, b, b).unwrap();
        assert_eq!(children(&doc, parent), vec![a, b]);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn insert_before_already_in_place_is_no_op() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.insert_before(parent, b, c).unwrap();
        assert_eq!(children(&doc, parent), vec![a, b, c]);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- reordering and moving ----

    #[test]
    fn insert_before_moves_existing_child_to_front() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.insert_before(parent, c, a).unwrap();
        assert_eq!(children(&doc, parent), vec![c, a, b]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(c).unwrap(), None);
        assert_eq!(doc.previous_sibling(a).unwrap(), Some(c));
        assert_eq!(doc.next_sibling(c).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn insert_before_moves_existing_child_to_middle() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.insert_before(parent, c, b).unwrap();
        assert_eq!(children(&doc, parent), vec![a, c, b]);
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(c).unwrap(), Some(b));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn append_moves_existing_child_to_end() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.append_child(parent, a).unwrap();
        assert_eq!(children(&doc, parent), vec![b, c, a]);
        assert_eq!(doc.last_child(parent).unwrap(), Some(a));
        assert_eq!(doc.previous_sibling(a).unwrap(), Some(c));
        assert_eq!(doc.next_sibling(a).unwrap(), None);
        assert_eq!(doc.next_sibling(b).unwrap(), Some(c));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn moving_only_child_leaves_old_parent_empty() {
        let mut doc = Document::new();
        let p1 = doc.create_element("p1").unwrap();
        let p2 = doc.create_element("p2").unwrap();
        let only = doc.create_element("only").unwrap();
        doc.append_child(p1, only).unwrap();

        doc.append_child(p2, only).unwrap();
        assert_eq!(children(&doc, p1), Vec::<NodeId>::new());
        assert_eq!(doc.first_child(p1).unwrap(), None);
        assert_eq!(doc.last_child(p1).unwrap(), None);
        assert_eq!(children(&doc, p2), vec![only]);
        assert_eq!(doc.parent(only).unwrap(), Some(p2));
        assert_eq!(doc.previous_sibling(only).unwrap(), None);
        assert_eq!(doc.next_sibling(only).unwrap(), None);
        assert_eq!(doc.check_invariants(p2).unwrap(), ());
    }

    #[test]
    fn moving_first_child_off_parent_updates_first_and_last() {
        let mut doc = Document::new();
        let p1 = doc.create_element("p1").unwrap();
        let p2 = doc.create_element("p2").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(p1, a).unwrap();
        doc.append_child(p1, b).unwrap();
        doc.append_child(p1, c).unwrap();

        doc.append_child(p2, a).unwrap();
        assert_eq!(children(&doc, p1), vec![b, c]);
        assert_eq!(doc.first_child(p1).unwrap(), Some(b));
        assert_eq!(doc.last_child(p1).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(b).unwrap(), None);
        assert_eq!(children(&doc, p2), vec![a]);
        assert_eq!(doc.check_invariants(p1).unwrap(), ());
    }

    #[test]
    fn moving_last_child_off_parent_updates_first_and_last() {
        let mut doc = Document::new();
        let p1 = doc.create_element("p1").unwrap();
        let p2 = doc.create_element("p2").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(p1, a).unwrap();
        doc.append_child(p1, b).unwrap();
        doc.append_child(p1, c).unwrap();

        doc.append_child(p2, c).unwrap();
        assert_eq!(children(&doc, p1), vec![a, b]);
        assert_eq!(doc.first_child(p1).unwrap(), Some(a));
        assert_eq!(doc.last_child(p1).unwrap(), Some(b));
        assert_eq!(doc.next_sibling(b).unwrap(), None);
        assert_eq!(children(&doc, p2), vec![c]);
        assert_eq!(doc.check_invariants(p1).unwrap(), ());
    }

    #[test]
    fn moving_node_between_parents_repairs_both_lists() {
        let mut doc = Document::new();
        let p1 = doc.create_element("p1").unwrap();
        let p2 = doc.create_element("p2").unwrap();
        let a1 = doc.create_element("a1").unwrap();
        let a2 = doc.create_element("a2").unwrap();
        let b1 = doc.create_element("b1").unwrap();
        doc.append_child(p1, a1).unwrap();
        doc.append_child(p1, a2).unwrap();
        doc.append_child(p2, b1).unwrap();

        doc.insert_before(p2, a1, b1).unwrap();
        assert_eq!(children(&doc, p1), vec![a2]);
        assert_eq!(children(&doc, p2), vec![a1, b1]);
        assert_eq!(doc.parent(a1).unwrap(), Some(p2));
        assert_eq!(doc.previous_sibling(a1).unwrap(), None);
        assert_eq!(doc.next_sibling(a1).unwrap(), Some(b1));
        assert_eq!(doc.previous_sibling(b1).unwrap(), Some(a1));
        assert_eq!(doc.check_invariants(p2).unwrap(), ());
        assert_eq!(doc.check_invariants(p1).unwrap(), ());
    }

    #[test]
    fn moving_subtree_keeps_descendants_intact() {
        let mut doc = Document::new();
        let p1 = doc.create_element("p1").unwrap();
        let p2 = doc.create_element("p2").unwrap();
        let sub = doc.create_element("sub").unwrap();
        let s1 = doc.create_element("s1").unwrap();
        let s2 = doc.create_element("s2").unwrap();
        doc.append_child(p1, sub).unwrap();
        doc.append_child(sub, s1).unwrap();
        doc.append_child(sub, s2).unwrap();

        doc.append_child(p2, sub).unwrap();
        assert_eq!(children(&doc, p1), Vec::<NodeId>::new());
        assert_eq!(children(&doc, p2), vec![sub]);
        assert_eq!(children(&doc, sub), vec![s1, s2]);
        assert_eq!(doc.parent(sub).unwrap(), Some(p2));
        assert_eq!(doc.parent(s1).unwrap(), Some(sub));
        assert_eq!(doc.check_invariants(p2).unwrap(), ());
    }

    #[test]
    fn a_sequence_of_reorders_keeps_invariants() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let ids: Vec<NodeId> = (0..8).map(|_| doc.create_element("n").unwrap()).collect();
        for &c in &ids {
            doc.append_child(parent, c).unwrap();
            doc.check_invariants(parent).unwrap();
        }

        doc.insert_before(parent, ids[7], ids[1]).unwrap();
        doc.check_invariants(parent).unwrap();
        doc.insert_before(parent, ids[0], ids[6]).unwrap();
        doc.check_invariants(parent).unwrap();
        doc.append_child(parent, ids[1]).unwrap();
        doc.check_invariants(parent).unwrap();
        assert_eq!(
            children(&doc, parent),
            vec![ids[7], ids[2], ids[3], ids[4], ids[5], ids[0], ids[6], ids[1]]
        );
    }

    // ---- DocumentFragment insertion ----

    #[test]
    fn append_document_fragment_splices_children_and_empties_fragment() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let frag = doc.create_document_fragment().unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        let z = doc.create_element("z").unwrap();
        doc.append_child(frag, x).unwrap();
        doc.append_child(frag, y).unwrap();
        doc.append_child(frag, z).unwrap();

        doc.append_child(parent, frag).unwrap();
        assert_eq!(children(&doc, parent), vec![x, y, z]);
        assert_eq!(children(&doc, frag), Vec::<NodeId>::new());
        assert_eq!(doc.first_child(frag).unwrap(), None);
        assert_eq!(doc.last_child(frag).unwrap(), None);
        assert!(doc.get(frag).is_ok(), "fragment node itself stays live");
        assert_eq!(doc.parent(x).unwrap(), Some(parent));
        assert_eq!(doc.previous_sibling(y).unwrap(), Some(x));
        assert_eq!(doc.next_sibling(y).unwrap(), Some(z));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn insert_document_fragment_before_reference() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let frag = doc.create_document_fragment().unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        doc.append_child(frag, x).unwrap();
        doc.append_child(frag, y).unwrap();
        let m = doc.create_element("m").unwrap();
        doc.append_child(parent, m).unwrap();

        doc.insert_before(parent, frag, m).unwrap();
        assert_eq!(children(&doc, parent), vec![x, y, m]);
        assert_eq!(children(&doc, frag), Vec::<NodeId>::new());
        assert_eq!(doc.parent(y).unwrap(), Some(parent));
        assert_eq!(doc.next_sibling(y).unwrap(), Some(m));
        assert_eq!(doc.previous_sibling(m).unwrap(), Some(y));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn insert_document_fragment_in_middle() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let m = doc.create_element("m").unwrap();
        let z = doc.create_element("z").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, m).unwrap();
        doc.append_child(parent, z).unwrap();
        let frag = doc.create_document_fragment().unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        doc.append_child(frag, x).unwrap();
        doc.append_child(frag, y).unwrap();

        doc.insert_before(parent, frag, m).unwrap();
        assert_eq!(children(&doc, parent), vec![a, x, y, m, z]);
        assert_eq!(children(&doc, frag), Vec::<NodeId>::new());
        assert_eq!(doc.next_sibling(a).unwrap(), Some(x));
        assert_eq!(doc.previous_sibling(x).unwrap(), Some(a));
        assert_eq!(doc.previous_sibling(m).unwrap(), Some(y));
        assert_eq!(doc.next_sibling(y).unwrap(), Some(m));
        assert_eq!(doc.next_sibling(m).unwrap(), Some(z));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn append_empty_fragment_is_no_op() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(parent, a).unwrap();
        let frag = doc.create_document_fragment().unwrap();

        doc.append_child(parent, frag).unwrap();
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(children(&doc, frag), Vec::<NodeId>::new());
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn fragment_as_parent_and_nested_fragment_insertion() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let frag = doc.create_document_fragment().unwrap();
        let inner = doc.create_document_fragment().unwrap();
        let x = doc.create_element("x").unwrap();
        doc.append_child(inner, x).unwrap();
        doc.append_child(frag, inner).unwrap();
        assert_eq!(children(&doc, frag), vec![x]);
        assert_eq!(children(&doc, inner), Vec::<NodeId>::new());

        doc.append_child(parent, frag).unwrap();
        assert_eq!(children(&doc, parent), vec![x]);
        assert_eq!(children(&doc, frag), Vec::<NodeId>::new());
        assert_eq!(doc.parent(x).unwrap(), Some(parent));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- rejected operations: hierarchy (each asserts tree unchanged) ----

    #[test]
    fn append_ancestor_into_descendant_rejected() {
        let mut doc = Document::new();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(a, b).unwrap();
        doc.append_child(b, c).unwrap();
        let before = children(&doc, c);

        assert_hierarchy(doc.append_child(c, a).unwrap_err());
        assert_hierarchy(doc.append_child(c, b).unwrap_err());
        assert_eq!(children(&doc, c), before);
        assert_eq!(children(&doc, b), vec![c]);
        assert_eq!(doc.parent(c).unwrap(), Some(b));
        assert_eq!(doc.parent(b).unwrap(), Some(a));
        assert_eq!(doc.parent(a).unwrap(), None);
        assert_eq!(doc.check_invariants(a).unwrap(), ());
    }

    #[test]
    fn insert_before_ancestor_into_descendant_rejected() {
        let mut doc = Document::new();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(a, b).unwrap();
        doc.append_child(b, c).unwrap();
        let before = children(&doc, b);

        assert_hierarchy(doc.insert_before(b, a, c).unwrap_err());
        assert_eq!(children(&doc, b), before);
        assert_eq!(doc.parent(c).unwrap(), Some(b));
        assert_eq!(doc.check_invariants(a).unwrap(), ());
    }

    #[test]
    fn append_node_into_itself_rejected() {
        let mut doc = Document::new();
        let a = doc.create_element("a").unwrap();
        assert_hierarchy(doc.append_child(a, a).unwrap_err());
        assert_eq!(doc.parent(a).unwrap(), None);
        assert_eq!(children(&doc, a), Vec::<NodeId>::new());
        assert_eq!(doc.check_invariants(a).unwrap(), ());
    }

    #[test]
    fn insert_before_node_into_itself_rejected() {
        let mut doc = Document::new();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(a, b).unwrap();
        assert_hierarchy(doc.insert_before(a, a, b).unwrap_err());
        assert_eq!(children(&doc, a), vec![b]);
        assert_eq!(doc.check_invariants(a).unwrap(), ());
    }

    #[test]
    fn fragment_insertion_into_own_descendant_rejected() {
        let mut doc = Document::new();
        let frag = doc.create_document_fragment().unwrap();
        let div = doc.create_element("div").unwrap();
        let p = doc.create_element("p").unwrap();
        doc.append_child(frag, div).unwrap();
        doc.append_child(div, p).unwrap();
        let frag_before = children(&doc, frag);
        let p_before = children(&doc, p);

        assert_hierarchy(doc.append_child(p, frag).unwrap_err());
        assert_eq!(children(&doc, frag), frag_before);
        assert_eq!(children(&doc, p), p_before);
        assert_eq!(doc.parent(div).unwrap(), Some(frag));
        assert_eq!(doc.check_invariants(frag).unwrap(), ());
    }

    #[test]
    fn fragment_insertion_where_fragment_child_is_parent_rejected() {
        let mut doc = Document::new();
        let frag = doc.create_document_fragment().unwrap();
        let p = doc.create_element("p").unwrap();
        doc.append_child(frag, p).unwrap();
        let frag_before = children(&doc, frag);

        assert_hierarchy(doc.append_child(p, frag).unwrap_err());
        assert_eq!(children(&doc, frag), frag_before);
        assert_eq!(children(&doc, p), Vec::<NodeId>::new());
        assert_eq!(doc.check_invariants(frag).unwrap(), ());
    }

    #[test]
    fn document_node_cannot_be_parent_or_child() {
        let mut doc = Document::new();
        let doc_node = doc.create_document_node_for_test();
        let el = doc.create_element("div").unwrap();
        let frag = doc.create_document_fragment().unwrap();

        assert_hierarchy(doc.append_child(doc_node, el).unwrap_err());
        assert_hierarchy(doc.append_child(frag, doc_node).unwrap_err());
        assert_hierarchy(doc.insert_before(frag, doc_node, el).unwrap_err());
        assert_eq!(children(&doc, frag), Vec::<NodeId>::new());
        assert_eq!(doc.parent(el).unwrap(), None);
        assert_eq!(doc.check_invariants(frag).unwrap(), ());
    }

    #[test]
    fn text_and_comment_nodes_cannot_be_parents() {
        let mut doc = Document::new();
        let text = doc.create_text("hello").unwrap();
        let comment = doc.create_comment("note").unwrap();
        let el = doc.create_element("div").unwrap();

        assert_hierarchy(doc.append_child(text, el).unwrap_err());
        assert_hierarchy(doc.append_child(comment, el).unwrap_err());
        assert_hierarchy(doc.insert_before(text, el, el).unwrap_err());
        assert_eq!(doc.parent(el).unwrap(), None);
        assert_eq!(doc.first_child(text).unwrap(), None);
        assert_eq!(doc.first_child(comment).unwrap(), None);
        assert_eq!(doc.check_invariants(text).unwrap(), ());
    }

    // ---- rejected operations: invalid reference (tree unchanged) ----

    #[test]
    fn detached_reference_node_rejected() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(parent, a).unwrap();
        let detached = doc.create_element("x").unwrap();
        let child = doc.create_element("y").unwrap();
        let before = children(&doc, parent);

        assert_hierarchy(doc.insert_before(parent, child, detached).unwrap_err());
        assert_eq!(children(&doc, parent), before);
        assert_eq!(doc.parent(child).unwrap(), None);
        assert_eq!(doc.parent(detached).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn reference_child_of_another_parent_rejected() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let other = doc.create_element("other").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(p, a).unwrap();
        let r = doc.create_element("r").unwrap();
        doc.append_child(other, r).unwrap();
        let child = doc.create_element("c").unwrap();
        let before = children(&doc, p);

        assert_hierarchy(doc.insert_before(p, child, r).unwrap_err());
        assert_eq!(children(&doc, p), before);
        assert_eq!(children(&doc, other), vec![r]);
        assert_eq!(doc.parent(child).unwrap(), None);
        assert_eq!(doc.check_invariants(p).unwrap(), ());
    }

    // ---- rejected operations: wrong document / invalid handle (unchanged) ----

    #[test]
    fn wrong_document_parent_rejected() {
        let mut a = Document::new();
        let mut b = Document::new();
        let parent = b.create_element("div").unwrap();
        let child = a.create_element("c").unwrap();

        assert!(matches!(
            a.append_child(parent, child),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            a.insert_before(parent, child, child),
            Err(CoreError::WrongDocument { .. })
        ));
        assert_eq!(a.parent(child).unwrap(), None);
        assert_eq!(b.first_child(parent).unwrap(), None);
        assert_eq!(a.check_invariants(child).unwrap(), ());
    }

    #[test]
    fn wrong_document_child_rejected() {
        let mut a = Document::new();
        let mut b = Document::new();
        let parent = a.create_element("div").unwrap();
        let child = b.create_element("c").unwrap();

        assert!(matches!(
            a.append_child(parent, child),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            a.insert_before(parent, child, parent),
            Err(CoreError::WrongDocument { .. })
        ));
        assert_eq!(a.first_child(parent).unwrap(), None);
        assert_eq!(b.parent(child).unwrap(), None);
        assert_eq!(a.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn wrong_document_reference_rejected() {
        let mut a = Document::new();
        let mut b = Document::new();
        let parent = a.create_element("div").unwrap();
        let child = a.create_element("c").unwrap();
        let reference = b.create_element("r").unwrap();

        assert!(matches!(
            a.insert_before(parent, child, reference),
            Err(CoreError::WrongDocument { .. })
        ));
        assert_eq!(a.first_child(parent).unwrap(), None);
        assert_eq!(a.parent(child).unwrap(), None);
        assert_eq!(a.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn invalid_handle_returns_arena_error() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let bogus = NodeId::new(doc.id(), u32::MAX, 0);

        assert!(matches!(
            doc.append_child(parent, bogus),
            Err(CoreError::Arena(_))
        ));
        assert!(matches!(
            doc.append_child(bogus, parent),
            Err(CoreError::Arena(_))
        ));
        assert_eq!(doc.first_child(parent).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- mutation keeps text and comment children ----

    #[test]
    fn text_and_comment_can_be_children() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let text = doc.create_text("hi").unwrap();
        let comment = doc.create_comment("note").unwrap();
        let el = doc.create_element("span").unwrap();
        doc.append_child(parent, text).unwrap();
        doc.append_child(parent, comment).unwrap();
        doc.insert_before(parent, el, comment).unwrap();

        assert_eq!(children(&doc, parent), vec![text, el, comment]);
        assert_eq!(doc.parent(text).unwrap(), Some(parent));
        assert_eq!(doc.parent(el).unwrap(), Some(parent));
        assert_eq!(doc.parent(comment).unwrap(), Some(parent));
        assert_eq!(doc.next_sibling(text).unwrap(), Some(el));
        assert_eq!(doc.previous_sibling(comment).unwrap(), Some(el));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }
}
