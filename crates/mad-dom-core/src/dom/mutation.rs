//! Unified tree mutation API (T15/T16).
//!
//! [`Document::append_child`], [`Document::insert_before`],
//! [`Document::remove_child`] and [`Document::replace_child`] are the only
//! public entry points that write the tree relations stored on
//! [`Node`](super::node::Node) while mutating an existing tree. The clone
//! family in the sibling `cross_document` module ([`Document::clone_node`],
//! [`Document::import_node`], [`Document::adopt_node`]) also writes relations
//! while building its freshly allocated trees. Every other way into the tree —
//! the [`Document`](super::Document) navigation API and
//! [`Document::check_invariants`] — is read-only, and the relation fields
//! themselves are `pub(crate)`, so callers outside this crate cannot bypass
//! the mutation API to corrupt the tree.
//!
//! # Detached nodes, arena slots and wrapper-observable behavior
//!
//! [`Document::remove_child`] and [`Document::replace_child`] *detach* a node
//! from the tree: they clear its `parent`, `previous_sibling` and
//! `next_sibling` fields (relinking the surviving siblings around the gap) but
//! leave the node itself live in the arena. A detached node's [`NodeId`] stays
//! valid — navigation reads return `None` for its parent and siblings — and it
//! can be re-inserted at any time with `append_child`/`insert_before`,
//! carrying its subtree with it.
//!
//! Detaching never releases the node's arena slot, and no Core API in this
//! milestone destroys nodes, so a removed node can never be replaced by a
//! different node in its slot. Slot release and reuse are reserved for a
//! future destroy/GC path; [`Arena`](crate::arena::Arena) already guarantees
//! that if a slot is ever released and reused, the generation bump makes any
//! older handle stale instead of aliasing the new occupant. A future wrapper
//! layer can rely on these rules: the JS `Node` wrapper for a detached node
//! stays valid (it is merely disconnected from the tree), and no wrapper can
//! ever be retroactively rebound to a different node.
//!
//! # Which nodes may be parents and children
//!
//! Pragmatic rules for the first batch of node types:
//!
//! * a parent may be an [`Element`](super::node::NodeType::Element), a
//!   [`DocumentFragment`](super::node::NodeType::DocumentFragment) or a
//!   [`ShadowRoot`](super::node::NodeType::ShadowRoot) (T43). A `Document`,
//!   `Text` or `Comment` node cannot have children;
//! * a child argument may be an `Element`, `Text` or `Comment` node, which is
//!   moved as a single node, or a `DocumentFragment` / `ShadowRoot` (T43),
//!   whose children are spliced into the target position — the fragment / root
//!   itself is emptied and never becomes a child;
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

/// What [`Document::validate_replace_child`] computes for the mutation phase:
/// the sibling anchors the replacement will sit between, and (for a fragment
/// replacement) the fragment's live children.
type ReplaceAnchors = (Option<NodeId>, Option<NodeId>, Option<Vec<NodeId>>);

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

    /// Removes `child` from `parent`'s child list and returns the removed
    /// child.
    ///
    /// The removed node becomes detached: its `parent`, `previous_sibling`
    /// and `next_sibling` fields are cleared, its subtree stays attached to
    /// it, and its [`NodeId`] remains live and valid in this document's arena
    /// (see the module docs for the full semantics). A detached node can be
    /// re-inserted later with [`Document::append_child`] or
    /// [`Document::insert_before`].
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `parent` or `child` belongs to
    ///   another document.
    /// * [`CoreError::Arena`] when `parent` or `child` is a stale or invalid
    ///   handle.
    /// * [`CoreError::Hierarchy`] when `child` is not a child of `parent`
    ///   (a detached node or a child of a different parent).
    pub fn remove_child(&mut self, parent: NodeId, child: NodeId) -> Result<NodeId, CoreError> {
        self.validate_remove_child(parent, child)?;
        self.detach(child);
        self.verify_invariants(parent);
        self.verify_detached(child);
        Ok(child)
    }

    /// Validates that `child` is a live child of `parent` without touching
    /// the tree, so [`Document::remove_child`] can fail atomically.
    fn validate_remove_child(&self, parent: NodeId, child: NodeId) -> Result<(), CoreError> {
        self.get(parent)?;
        if self.get(child)?.parent() != Some(parent) {
            return Err(hierarchy("node is not a child of the given parent"));
        }
        Ok(())
    }

    /// Replaces `child` with `node` within `parent` and returns the removed
    /// child.
    ///
    /// `node` is moved (or, for a `DocumentFragment`, its children are
    /// spliced) into the position `child` occupied; `child` becomes detached
    /// with the same validity semantics as [`Document::remove_child`]. The
    /// replacement is validated against the same rules as an insertion:
    /// `node` may not be a `Document` node, may not be `parent` itself or an
    /// ancestor of it, and a fragment's children must not include `parent` or
    /// an ancestor of it. Replacing a node with itself is a no-op, and so is
    /// replacing it with an empty `DocumentFragment` (which merely removes
    /// `child`).
    ///
    /// # Errors
    ///
    /// As for [`Document::remove_child`], plus:
    ///
    /// * [`CoreError::WrongDocument`] when `node` belongs to another
    ///   document.
    /// * [`CoreError::Hierarchy`] when `node` is a `Document` node, is
    ///   `parent` itself or an ancestor of it, or a fragment child would
    ///   become an ancestor of `parent`.
    pub fn replace_child(
        &mut self,
        parent: NodeId,
        child: NodeId,
        node: NodeId,
    ) -> Result<NodeId, CoreError> {
        let (anchor_prev, anchor_next, fragment_children) =
            self.validate_replace_child(parent, child, node)?;

        // Replacing a node with itself never changes the tree (WHATWG
        // `replace`).
        if node == child {
            return Ok(child);
        }

        // Capture the pre-mutation relations the observer records need (they
        // must be read before the relink clears them).
        let node_relations = (
            self.get(node)?.parent(),
            self.get(node)?.previous_sibling(),
            self.get(node)?.next_sibling(),
        );
        let child_prev = self.get(child)?.previous_sibling();
        let child_next = self.get(child)?.next_sibling();

        // T42: capture the pre-mutation connectivity the custom element
        // reactions need — `child` is a child of `parent`, so its connectivity
        // is the parent's, while `node` may live anywhere.
        let parent_connected =
            self.custom_elements.has_definitions() && self.is_connected(parent)?;
        let node_was_connected =
            self.custom_elements.has_definitions() && self.is_connected(node)?;

        // Mutation phase: every precondition was checked above, so from here
        // on the operation cannot fail. `anchor_prev`/`anchor_next` were
        // computed so that they never point at `node` itself even when `node`
        // is one of `child`'s neighbours. The primitives run with observer
        // records suppressed so `replace` can queue them in the baseline
        // (WHATWG `replace` = insert then remove) order below; the T42 custom
        // element reactions are suppressed the same way and enqueued manually
        // in the happy-dom order after the records.
        self.with_custom_element_reactions_suppressed(|doc| {
            doc.with_observer_records_suppressed(|doc| {
                doc.detach(child);
                if let Some(children) = &fragment_children {
                    if !children.is_empty() {
                        for &c in children {
                            doc.detach(c);
                        }
                        doc.link_detached_chain_between(parent, children, anchor_prev, anchor_next);
                    }
                    // An empty fragment has nothing to insert; replacing with it just
                    // removes `child` (WHATWG `replace`).
                } else {
                    doc.detach(node);
                    doc.link_detached_chain_between(parent, &[node], anchor_prev, anchor_next);
                }
            });
        });

        // Observer records, in the baseline order: the insert (removal from the
        // replacement's old parent, then the addition to this parent) happens
        // before the removal of the old child. For a fragment replacement each
        // fragment child is first removed from the fragment (its previous
        // sibling is `None` once the earlier children are gone) and then added
        // here, one record per child.
        match &fragment_children {
            Some(children) => {
                for (index, &fragment_child) in children.iter().enumerate() {
                    self.queue_child_list_removed(
                        node,
                        fragment_child,
                        None,
                        children.get(index + 1).copied(),
                    );
                    self.queue_child_list_added(parent, fragment_child);
                }
            }
            None => {
                if let Some(old_parent) = node_relations.0 {
                    self.queue_child_list_removed(
                        old_parent,
                        node,
                        node_relations.1,
                        node_relations.2,
                    );
                }
                self.queue_child_list_added(parent, node);
            }
        }
        // The old child is removed last; at that point the replacement sits
        // immediately before it, so the removal record's previous sibling is the
        // last inserted node (the replacement, or the last fragment child) —
        // matching the baseline `replace` (insert then remove). Its next sibling
        // is the old child's original next, except when the replacement came
        // from exactly that position (the adjacent-next case): then the node
        // that followed the replacement becomes the old child's next sibling.
        let (removal_prev, removal_next) = match &fragment_children {
            Some(children) if !children.is_empty() => (children.last().copied(), child_next),
            Some(_) => (child_prev, child_next), // empty fragment: nothing was inserted
            None => {
                let moved_from_after_child =
                    node_relations.0 == Some(parent) && Some(node) == child_next;
                (
                    Some(node),
                    if moved_from_after_child {
                        node_relations.2
                    } else {
                        child_next
                    },
                )
            }
        };
        self.queue_child_list_removed(parent, child, removal_prev, removal_next);

        // T42: the happy-dom `replace` reaction order — insert then remove. A
        // connected replacement is first disconnected from its old parent, then
        // re-connected here, and finally the old child is disconnected.
        if self.custom_elements.has_definitions() {
            match &fragment_children {
                Some(children) => {
                    if parent_connected {
                        for &c in children {
                            let _ = self.enqueue_connected_subtree(c);
                        }
                    }
                }
                None => {
                    if node_was_connected {
                        let _ = self.enqueue_disconnected_subtree(node);
                    }
                    if parent_connected {
                        let _ = self.enqueue_connected_subtree(node);
                    }
                }
            }
            if parent_connected {
                let _ = self.enqueue_disconnected_subtree(child);
            }
        }

        self.verify_invariants(parent);
        self.verify_detached(child);
        Ok(child)
    }

    /// Validates the arguments of [`Document::replace_child`] and computes
    /// everything the mutation phase needs: the sibling anchors the
    /// replacement will sit between, and (for a fragment replacement) the
    /// fragment's live children.
    ///
    /// Returns a [`ReplaceAnchors`]. The anchors are `child`'s neighbours,
    /// except when `node` is itself one of those neighbours — then the anchors
    /// are taken from `node`'s own relations, so the mutation phase can detach
    /// `node` and still know where to link it back.
    fn validate_replace_child(
        &self,
        parent: NodeId,
        child: NodeId,
        node: NodeId,
    ) -> Result<ReplaceAnchors, CoreError> {
        // Establish document ownership of every handle before any structural
        // check, so a replacement from another document fails with
        // `WrongDocument` even when `child` is not a valid child of `parent`.
        self.get(parent)?;
        self.get(child)?;
        self.get(node)?;

        if self.get(child)?.parent() != Some(parent) {
            return Err(hierarchy("child is not a child of the given parent"));
        }
        if self.get(node)?.node_type() == NodeType::Document {
            return Err(hierarchy("a Document node cannot be inserted as a child"));
        }

        // Reject cycles: `node` may not be `parent` itself or one of its
        // ancestors.
        if node == parent || self.is_descendant_of(parent, node)? {
            return Err(hierarchy(
                "cannot replace a child with an ancestor of its parent",
            ));
        }

        let prev = self.get(child)?.previous_sibling();
        let next = self.get(child)?.next_sibling();

        let fragment_children = if self.get(node)?.node_type() == NodeType::DocumentFragment
            || self.get(node)?.node_type() == NodeType::ShadowRoot
        {
            Some(self.validate_fragment_children(parent, node)?)
        } else {
            None
        };

        // Adjacent-replacement handling: when `node` is currently one of
        // `child`'s immediate siblings, the anchors must be taken from
        // `node`'s own relations, otherwise after detaching `node` the anchors
        // would point at a node that is no longer in the chain.
        let (anchor_prev, anchor_next) = if Some(node) == prev {
            (self.get(node)?.previous_sibling(), next)
        } else if Some(node) == next {
            (prev, self.get(node)?.next_sibling())
        } else {
            (prev, next)
        };

        Ok((anchor_prev, anchor_next, fragment_children))
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
        // A shadow root spliced as a child behaves like a fragment (its
        // children move, the root itself is emptied), matching happy-dom.
        let fragment_children =
            if child_type == NodeType::DocumentFragment || child_type == NodeType::ShadowRoot {
                self.validate_fragment_children(parent, child)?
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
        if (child_type == NodeType::DocumentFragment || child_type == NodeType::ShadowRoot)
            && fragment_children.is_empty()
        {
            return Ok(());
        }

        // --- Mutation phase: every precondition has been validated. ---

        if child_type == NodeType::DocumentFragment || child_type == NodeType::ShadowRoot {
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
            NodeType::Element | NodeType::DocumentFragment | NodeType::ShadowRoot => Ok(()),
            NodeType::Document => Err(hierarchy("a Document node cannot be a parent")),
            NodeType::DocumentType => Err(hierarchy("a DocumentType node cannot be a parent")),
            NodeType::Text => Err(hierarchy("a Text node cannot be a parent")),
            NodeType::Comment => Err(hierarchy("a Comment node cannot be a parent")),
            NodeType::ProcessingInstruction => {
                Err(hierarchy("a ProcessingInstruction node cannot be a parent"))
            }
        }
    }

    /// Validates that none of `fragment`'s children is `parent` or an ancestor
    /// of it (which would create a cycle), and returns the fragment's live
    /// children.
    ///
    /// Shared by the fragment paths of `pre-insert` and `replace`; both pass
    /// the same rule so insert and replace treat fragments identically.
    fn validate_fragment_children(
        &self,
        parent: NodeId,
        fragment: NodeId,
    ) -> Result<Vec<NodeId>, CoreError> {
        let children = self.children(fragment)?;
        for &c in &children {
            if c == parent || self.is_descendant_of(parent, c)? {
                return Err(hierarchy(
                    "cannot insert a DocumentFragment into one of its own descendants",
                ));
            }
        }
        Ok(children)
    }

    /// Removes `node` from its current parent's child list and clears its own
    /// relation fields. `node` must be live and must belong to this document.
    ///
    /// `pub(crate)` because the cross-document adoption path
    /// ([`Document::adopt_node`]) uses it to free a migrated node from its
    /// source tree before moving the node's data out of the source arena.
    ///
    /// T32: the detached subtree is removed from the optional query index
    /// first (a no-op when the index is disabled), so the index stays in lock
    /// step with the arena no matter which mutation path reaches this
    /// primitive.
    ///
    /// T41: this primitive is the single removal chokepoint, so it queues the
    /// `childList` removal record (with the previous/next siblings captured
    /// before the relink) for the node's old parent — every removal path —
    /// `remove_child`, `replace_child`, the T29 apply path, the T17 adoption
    /// detach and the fragment-children detach of `pre-insert` — funnels
    /// through it and can never bypass the observer records.
    pub(crate) fn detach(&mut self, node: NodeId) {
        // Structural generation: the single removal chokepoint is a
        // relation-write site (see `Document::structure_generation`).
        self.bump_structure_generation();
        // T42: capture the pre-removal connectivity so the disconnected
        // reactions fire for a connected subtree (and only for it).
        let was_connected =
            self.custom_elements.has_definitions() && self.is_connected(node).unwrap_or(false);
        let _ = self.index_subtree_detached(node);
        let old_parent = self.get(node).expect("detaching a live node").parent();
        let prev = self
            .get(node)
            .expect("detaching a live node")
            .previous_sibling();
        let next = self
            .get(node)
            .expect("detaching a live node")
            .next_sibling();

        if let Some(op) = old_parent {
            self.queue_child_list_removed(op, node, prev, next);
        }

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

        // T42: a connected subtree leaving the document fires
        // `disconnectedCallback` for every custom element in it (the happy-dom
        // disconnect reaction, enqueued at the single removal chokepoint).
        if was_connected {
            let _ = self.enqueue_disconnected_subtree(node);
        }
    }

    /// Splices the already-detached `nodes` (in document order) into `parent`'s
    /// child list before `reference`, or at the end when `reference` is `None`.
    fn insert_detached_chain(
        &mut self,
        parent: NodeId,
        nodes: &[NodeId],
        reference: Option<NodeId>,
    ) {
        let prev = match reference {
            Some(r) => self.get(r).expect("live reference").previous_sibling(),
            None => self.get(parent).expect("live parent").last_child(),
        };
        self.link_detached_chain_between(parent, nodes, prev, reference);
    }

    /// Splices the already-detached `nodes` (in document order) into `parent`'s
    /// child list between `prev` and `next_`, either of which may be `None` to
    /// denote the start or end of the child list. `nodes` must be non-empty.
    ///
    /// This is the shared relinking primitive for every insertion point used by
    /// the mutation API: `insert_detached_chain` (before a reference / at the
    /// end) and `replace` (between two explicit sibling anchors).
    ///
    /// `pub(crate)` so the T29 HTML apply path
    /// ([`crate::html::apply`]) reuses the same O(1) primitive when it
    /// atomically splices freshly parsed nodes into a live tree (the
    /// `innerHTML`/`outerHTML` setters), keeping one relink implementation.
    pub(crate) fn link_detached_chain_between(
        &mut self,
        parent: NodeId,
        nodes: &[NodeId],
        prev: Option<NodeId>,
        next_: Option<NodeId>,
    ) {
        debug_assert!(
            !nodes.is_empty(),
            "empty chains are short-circuited before reaching this point"
        );
        // Structural generation: the single insertion chokepoint is a
        // relation-write site (see `Document::structure_generation`).
        self.bump_structure_generation();
        let first = nodes[0];
        let last = nodes[nodes.len() - 1];

        for pair in nodes.windows(2) {
            self.node_mut(pair[0]).expect("live node").next_sibling = Some(pair[1]);
            self.node_mut(pair[1]).expect("live node").previous_sibling = Some(pair[0]);
        }
        self.node_mut(first).expect("live node").previous_sibling = prev;
        self.node_mut(last).expect("live node").next_sibling = next_;
        for &c in nodes {
            self.node_mut(c).expect("live node").parent = Some(parent);
        }

        if let Some(p) = prev {
            self.node_mut(p)
                .expect("live previous sibling")
                .next_sibling = Some(first);
        }
        if let Some(n) = next_ {
            self.node_mut(n)
                .expect("live next sibling")
                .previous_sibling = Some(last);
        }
        if prev.is_none() {
            self.node_mut(parent).expect("live parent").first_child = Some(first);
        }
        if next_.is_none() {
            self.node_mut(parent).expect("live parent").last_child = Some(last);
        }

        // T32: the freshly attached subtrees are indexed now that they are
        // linked into the tree (a no-op when the query index is disabled), so
        // every mutation path — append/insert/replace and the T29 apply path —
        // funnels index maintenance through this single primitive.
        if self.query_index.is_enabled() {
            let _ = self.index_subtree_attached(nodes);
        }

        // T41: this primitive is the single insertion chokepoint, so it queues
        // one `childList` addition record per inserted node for the receiving
        // parent — every insertion path (append/insert, the fragment splice,
        // `replace_child` under suppression, the T29 apply path and the T17
        // adoption attach) funnels through it and can never bypass the
        // observer records. The baseline emits one record per inserted node.
        for &c in nodes {
            self.queue_child_list_added(parent, c);
        }

        // T42: the single insertion chokepoint fires `connectedCallback` for
        // every custom element in an inserted subtree when the receiving
        // parent is connected (a move within the document therefore fires
        // `Disconnected` at the preceding `detach` and `Connected` here,
        // matching the happy-dom remove-then-insert baseline). Suppressed by
        // `replace_child`, which enqueues the reactions in its own order.
        if self.custom_elements.has_definitions() && self.is_connected(parent).unwrap_or(false) {
            for &c in nodes {
                let _ = self.enqueue_connected_subtree(c);
            }
        }
    }

    /// In debug builds, re-checks the tree invariants over the subtree rooted
    /// at `node`'s top-level ancestor, so a relinking bug surfaces in tests.
    /// The parent walk is capped at the number of live nodes so a (buggy)
    /// cyclic tree cannot hang the check.
    pub(crate) fn verify_invariants(&self, node: NodeId) {
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

    /// In debug builds, verifies that a node just detached by a mutation really
    /// is detached (no parent) and that its subtree still satisfies the tree
    /// invariants.
    pub(crate) fn verify_detached(&self, node: NodeId) {
        #[cfg(debug_assertions)]
        {
            debug_assert_eq!(
                self.get(node).ok().and_then(|n| n.parent()),
                None,
                "mutation left a detached node with a parent"
            );
            debug_assert_eq!(
                self.check_invariants(node),
                Ok(()),
                "mutation left a detached subtree inconsistent"
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

    // ---- remove_child ----

    #[test]
    fn remove_child_middle_detaches_and_relinks_siblings() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        assert_eq!(doc.remove_child(parent, b).unwrap(), b);
        assert_eq!(children(&doc, parent), vec![a, c]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(a));
        assert_eq!(doc.last_child(parent).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(a).unwrap(), None);
        assert_eq!(doc.next_sibling(a).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(c).unwrap(), None);
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.previous_sibling(b).unwrap(), None);
        assert_eq!(doc.next_sibling(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn remove_child_first_updates_first_child() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();

        doc.remove_child(parent, a).unwrap();
        assert_eq!(children(&doc, parent), vec![b]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(b));
        assert_eq!(doc.last_child(parent).unwrap(), Some(b));
        assert_eq!(doc.previous_sibling(b).unwrap(), None);
        assert_eq!(doc.next_sibling(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn remove_child_last_updates_last_child() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();

        doc.remove_child(parent, b).unwrap();
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(a));
        assert_eq!(doc.last_child(parent).unwrap(), Some(a));
        assert_eq!(doc.previous_sibling(a).unwrap(), None);
        assert_eq!(doc.next_sibling(a).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn remove_child_only_child_leaves_parent_empty() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let only = doc.create_element("only").unwrap();
        doc.append_child(parent, only).unwrap();

        doc.remove_child(parent, only).unwrap();
        assert_eq!(children(&doc, parent), Vec::<NodeId>::new());
        assert_eq!(doc.first_child(parent).unwrap(), None);
        assert_eq!(doc.last_child(parent).unwrap(), None);
        assert_eq!(doc.parent(only).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn remove_child_keeps_subtree_with_the_node() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(b, c).unwrap();

        doc.remove_child(parent, b).unwrap();
        assert_eq!(children(&doc, parent), Vec::<NodeId>::new());
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.parent(c).unwrap(), Some(b));
        assert_eq!(doc.first_child(b).unwrap(), Some(c));
        assert_eq!(doc.last_child(b).unwrap(), Some(c));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
        assert_eq!(doc.check_invariants(b).unwrap(), ());
    }

    #[test]
    fn removed_handle_stays_live_and_can_be_reinserted() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.remove_child(parent, a).unwrap();
        assert!(doc.get(a).is_ok(), "removed handle stays live");
        assert_eq!(doc.parent(a).unwrap(), None);

        doc.append_child(parent, a).unwrap();
        assert_eq!(children(&doc, parent), vec![b, c, a]);
        assert_eq!(doc.parent(a).unwrap(), Some(parent));
        assert_eq!(doc.previous_sibling(a).unwrap(), Some(c));
        assert_eq!(doc.next_sibling(a).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn remove_does_not_release_the_arena_slot() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();

        doc.remove_child(parent, a).unwrap();
        let fresh = doc.create_element("fresh").unwrap();
        assert_ne!(fresh.slot(), a.slot(), "removal never releases the slot");
        assert_eq!(doc.node_name(a).unwrap(), "a");
        assert_eq!(doc.node_name(fresh).unwrap(), "fresh");
        assert_eq!(doc.parent(a).unwrap(), None);
        assert_eq!(doc.parent(fresh).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- remove_child: rejected operations (tree unchanged) ----

    #[test]
    fn remove_child_detached_node_rejected() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(parent, a).unwrap();
        let detached = doc.create_element("x").unwrap();

        assert_hierarchy(doc.remove_child(parent, detached).unwrap_err());
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.parent(detached).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn remove_child_child_of_another_parent_rejected() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let other = doc.create_element("other").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(p, a).unwrap();

        assert_hierarchy(doc.remove_child(other, a).unwrap_err());
        assert_eq!(children(&doc, p), vec![a]);
        assert_eq!(children(&doc, other), Vec::<NodeId>::new());
        assert_eq!(doc.parent(a).unwrap(), Some(p));
        assert_eq!(doc.check_invariants(p).unwrap(), ());
    }

    #[test]
    fn remove_child_wrong_document_rejected() {
        let mut a = Document::new();
        let mut b = Document::new();
        let parent = a.create_element("div").unwrap();
        let child = b.create_element("c").unwrap();

        assert!(matches!(
            a.remove_child(parent, child),
            Err(CoreError::WrongDocument { .. })
        ));
        assert_eq!(a.first_child(parent).unwrap(), None);
        assert_eq!(b.parent(child).unwrap(), None);
        assert_eq!(a.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn remove_child_invalid_handle_rejected() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let bogus = NodeId::new(doc.id(), u32::MAX, 0);

        assert!(matches!(
            doc.remove_child(parent, bogus),
            Err(CoreError::Arena(_))
        ));
        assert_eq!(doc.first_child(parent).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- replace_child: basic replacement ----

    #[test]
    fn replace_child_with_detached_node() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        let d = doc.create_element("d").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        assert_eq!(doc.replace_child(parent, b, d).unwrap(), b);
        assert_eq!(children(&doc, parent), vec![a, d, c]);
        assert_eq!(doc.parent(d).unwrap(), Some(parent));
        assert_eq!(doc.previous_sibling(d).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(d).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(d));
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.previous_sibling(b).unwrap(), None);
        assert_eq!(doc.next_sibling(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_first_and_last_positions() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        let d = doc.create_element("d").unwrap();
        let e = doc.create_element("e").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.replace_child(parent, a, d).unwrap();
        assert_eq!(children(&doc, parent), vec![d, b, c]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(d));
        assert_eq!(doc.previous_sibling(d).unwrap(), None);
        doc.replace_child(parent, c, e).unwrap();
        assert_eq!(children(&doc, parent), vec![d, b, e]);
        assert_eq!(doc.last_child(parent).unwrap(), Some(e));
        assert_eq!(doc.next_sibling(e).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_only_child() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let only = doc.create_element("only").unwrap();
        let d = doc.create_element("d").unwrap();
        doc.append_child(parent, only).unwrap();

        doc.replace_child(parent, only, d).unwrap();
        assert_eq!(children(&doc, parent), vec![d]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(d));
        assert_eq!(doc.last_child(parent).unwrap(), Some(d));
        assert_eq!(doc.parent(only).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- replace_child: self and adjacent replacement ----

    #[test]
    fn replace_child_self_is_no_op() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        assert_eq!(doc.replace_child(parent, b, b).unwrap(), b);
        assert_eq!(children(&doc, parent), vec![a, b, c]);
        assert_eq!(doc.parent(b).unwrap(), Some(parent));
        assert_eq!(doc.previous_sibling(b).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(b).unwrap(), Some(c));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_with_previous_sibling() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.replace_child(parent, b, a).unwrap();
        assert_eq!(children(&doc, parent), vec![a, c]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(a));
        assert_eq!(doc.previous_sibling(a).unwrap(), None);
        assert_eq!(doc.next_sibling(a).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(c).unwrap(), None);
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_with_next_sibling() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.replace_child(parent, b, c).unwrap();
        assert_eq!(children(&doc, parent), vec![a, c]);
        assert_eq!(doc.last_child(parent).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(a));
        assert_eq!(doc.next_sibling(c).unwrap(), None);
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_adjacent_at_head() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();

        doc.replace_child(parent, a, b).unwrap();
        assert_eq!(children(&doc, parent), vec![b]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(b));
        assert_eq!(doc.last_child(parent).unwrap(), Some(b));
        assert_eq!(doc.parent(a).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_adjacent_at_tail() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();

        doc.replace_child(parent, b, a).unwrap();
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.first_child(parent).unwrap(), Some(a));
        assert_eq!(doc.last_child(parent).unwrap(), Some(a));
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- replace_child: moving and subtree cases ----

    #[test]
    fn replace_child_moves_node_from_other_parent() {
        let mut doc = Document::new();
        let p1 = doc.create_element("p1").unwrap();
        let p2 = doc.create_element("p2").unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(p1, x).unwrap();
        doc.append_child(p1, y).unwrap();
        doc.append_child(p2, a).unwrap();
        doc.append_child(p2, b).unwrap();

        doc.replace_child(p2, a, y).unwrap();
        assert_eq!(children(&doc, p2), vec![y, b]);
        assert_eq!(children(&doc, p1), vec![x]);
        assert_eq!(doc.parent(y).unwrap(), Some(p2));
        assert_eq!(doc.previous_sibling(y).unwrap(), None);
        assert_eq!(doc.next_sibling(y).unwrap(), Some(b));
        assert_eq!(doc.parent(a).unwrap(), None);
        assert_eq!(doc.check_invariants(p2).unwrap(), ());
        assert_eq!(doc.check_invariants(p1).unwrap(), ());
    }

    #[test]
    fn replace_child_with_descendant_of_child() {
        let mut doc = Document::new();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(a, b).unwrap();
        doc.append_child(b, c).unwrap();

        doc.replace_child(a, b, c).unwrap();
        assert_eq!(children(&doc, a), vec![c]);
        assert_eq!(doc.parent(c).unwrap(), Some(a));
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.first_child(b).unwrap(), None);
        assert_eq!(doc.last_child(b).unwrap(), None);
        assert_eq!(doc.check_invariants(a).unwrap(), ());
    }

    #[test]
    fn replace_child_with_fragment() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();
        let frag = doc.create_document_fragment().unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        doc.append_child(frag, x).unwrap();
        doc.append_child(frag, y).unwrap();

        doc.replace_child(parent, b, frag).unwrap();
        assert_eq!(children(&doc, parent), vec![a, x, y, c]);
        assert_eq!(children(&doc, frag), Vec::<NodeId>::new());
        assert_eq!(doc.parent(x).unwrap(), Some(parent));
        assert_eq!(doc.next_sibling(x).unwrap(), Some(y));
        assert_eq!(doc.previous_sibling(y).unwrap(), Some(x));
        assert_eq!(doc.next_sibling(y).unwrap(), Some(c));
        assert_eq!(doc.previous_sibling(c).unwrap(), Some(y));
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_with_empty_fragment_removes_child() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        let frag = doc.create_document_fragment().unwrap();

        doc.replace_child(parent, b, frag).unwrap();
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.last_child(parent).unwrap(), Some(a));
        assert_eq!(doc.parent(b).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replaced_child_handle_stays_live_and_can_be_reinserted() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        let d = doc.create_element("d").unwrap();
        doc.append_child(parent, a).unwrap();
        doc.append_child(parent, b).unwrap();
        doc.append_child(parent, c).unwrap();

        doc.replace_child(parent, b, d).unwrap();
        assert!(doc.get(b).is_ok(), "replaced handle stays live");

        doc.insert_before(parent, b, c).unwrap();
        assert_eq!(children(&doc, parent), vec![a, d, b, c]);
        assert_eq!(doc.parent(b).unwrap(), Some(parent));
        assert_eq!(doc.previous_sibling(b).unwrap(), Some(d));
        assert_eq!(doc.next_sibling(b).unwrap(), Some(c));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- replace_child: rejected operations (tree unchanged) ----

    #[test]
    fn replace_child_rejects_detached_child() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(parent, a).unwrap();
        let detached = doc.create_element("x").unwrap();
        let node = doc.create_element("n").unwrap();

        assert_hierarchy(doc.replace_child(parent, detached, node).unwrap_err());
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.parent(detached).unwrap(), None);
        assert_eq!(doc.parent(node).unwrap(), None);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_rejects_child_of_another_parent() {
        let mut doc = Document::new();
        let p = doc.create_element("p").unwrap();
        let other = doc.create_element("other").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(p, a).unwrap();
        let node = doc.create_element("n").unwrap();

        assert_hierarchy(doc.replace_child(other, a, node).unwrap_err());
        assert_eq!(children(&doc, p), vec![a]);
        assert_eq!(children(&doc, other), Vec::<NodeId>::new());
        assert_eq!(doc.parent(a).unwrap(), Some(p));
        assert_eq!(doc.parent(node).unwrap(), None);
        assert_eq!(doc.check_invariants(p).unwrap(), ());
    }

    #[test]
    fn replace_child_rejects_parent_as_replacement() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(parent, a).unwrap();

        assert_hierarchy(doc.replace_child(parent, a, parent).unwrap_err());
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.parent(a).unwrap(), Some(parent));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_rejects_ancestor_as_replacement() {
        let mut doc = Document::new();
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        let c = doc.create_element("c").unwrap();
        doc.append_child(a, b).unwrap();
        doc.append_child(b, c).unwrap();
        let leaf = doc.create_element("leaf").unwrap();
        doc.append_child(c, leaf).unwrap();

        assert_hierarchy(doc.replace_child(c, leaf, a).unwrap_err());
        assert_eq!(children(&doc, a), vec![b]);
        assert_eq!(children(&doc, b), vec![c]);
        assert_eq!(children(&doc, c), vec![leaf]);
        assert_eq!(doc.parent(leaf).unwrap(), Some(c));
        assert_eq!(doc.check_invariants(a).unwrap(), ());
    }

    #[test]
    fn replace_child_rejects_document_replacement() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(parent, a).unwrap();
        let doc_node = doc.create_document_node_for_test();

        assert_hierarchy(doc.replace_child(parent, a, doc_node).unwrap_err());
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_rejects_fragment_with_ancestor_child() {
        let mut doc = Document::new();
        let frag = doc.create_document_fragment().unwrap();
        let div = doc.create_element("div").unwrap();
        let p = doc.create_element("p").unwrap();
        doc.append_child(frag, div).unwrap();
        doc.append_child(div, p).unwrap();
        let leaf = doc.create_element("leaf").unwrap();
        doc.append_child(p, leaf).unwrap();

        assert_hierarchy(doc.replace_child(p, leaf, frag).unwrap_err());
        assert_eq!(children(&doc, frag), vec![div]);
        assert_eq!(children(&doc, p), vec![leaf]);
        assert_eq!(doc.parent(div).unwrap(), Some(frag));
        assert_eq!(doc.check_invariants(frag).unwrap(), ());
    }

    #[test]
    fn replace_child_wrong_document_rejected() {
        let mut a = Document::new();
        let mut b = Document::new();
        let parent = a.create_element("div").unwrap();
        let child = a.create_element("c").unwrap();
        a.append_child(parent, child).unwrap();
        let foreign = b.create_element("f").unwrap();

        assert!(matches!(
            a.replace_child(parent, child, foreign),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            b.replace_child(foreign, foreign, child),
            Err(CoreError::WrongDocument { .. })
        ));
        assert_eq!(children(&a, parent), vec![child]);
        assert_eq!(a.parent(child).unwrap(), Some(parent));
        assert_eq!(b.parent(foreign).unwrap(), None);
        assert_eq!(a.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn replace_child_invalid_handle_rejected() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(parent, a).unwrap();
        let bogus = NodeId::new(doc.id(), u32::MAX, 0);

        assert!(matches!(
            doc.replace_child(parent, a, bogus),
            Err(CoreError::Arena(_))
        ));
        assert_eq!(children(&doc, parent), vec![a]);
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    // ---- sequences keep invariants ----

    #[test]
    fn a_sequence_of_removes_and_replaces_keeps_invariants() {
        let mut doc = Document::new();
        let parent = doc.create_element("div").unwrap();
        let ids: Vec<NodeId> = (0..6).map(|_| doc.create_element("n").unwrap()).collect();
        for &c in &ids {
            doc.append_child(parent, c).unwrap();
        }

        doc.remove_child(parent, ids[1]).unwrap();
        doc.check_invariants(parent).unwrap();
        doc.replace_child(parent, ids[3], ids[5]).unwrap();
        doc.check_invariants(parent).unwrap();
        doc.replace_child(parent, ids[0], ids[2]).unwrap();
        doc.check_invariants(parent).unwrap();
        doc.remove_child(parent, ids[4]).unwrap();
        doc.check_invariants(parent).unwrap();
        doc.append_child(parent, ids[1]).unwrap();
        doc.check_invariants(parent).unwrap();

        assert_eq!(children(&doc, parent), vec![ids[2], ids[5], ids[1]]);
    }

    /// Walks from `node` to the top of its tree and returns that root.
    fn top_of(doc: &Document, mut node: NodeId) -> NodeId {
        while let Some(p) = doc.parent(node).unwrap() {
            node = p;
        }
        node
    }

    /// Tiny deterministic PRNG (LCG) for the property-style test below.
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0 >> 33
        }

        fn idx(&mut self, n: usize) -> usize {
            assert!(n > 0);
            (self.next() % n as u64) as usize
        }
    }

    /// Property-style check that the invariant checker the property suite
    /// relies on really can fail: a randomly built tree passes
    /// `check_invariants`, but deliberately corrupting one relation makes it
    /// fail. A real relinking bug in the mutation API can therefore never hide
    /// from the property tests.
    #[test]
    fn random_tree_then_injected_relation_defect_fails_invariants() {
        for seed in 0..8u64 {
            let mut rng = Lcg(0xC0FF_EE00_0000_0000 ^ seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
            let mut doc = Document::new();
            let mut pool: Vec<NodeId> = Vec::new();

            // 1. Build a random tree through the public mutation API.
            for _ in 0..64 {
                let node = doc.create_element("n").unwrap();
                pool.push(node);
                if pool.len() > 1 {
                    let parent = pool[rng.idx(pool.len())];
                    if parent != node {
                        doc.append_child(parent, node).unwrap();
                    }
                }
            }
            let roots: Vec<NodeId> = pool
                .iter()
                .copied()
                .filter(|n| doc.parent(*n).unwrap().is_none())
                .collect();
            assert!(!roots.is_empty(), "seed {seed}: expected at least one root");
            for r in &roots {
                assert!(
                    doc.check_invariants(*r).is_ok(),
                    "seed {seed}: valid tree failed the checker"
                );
            }

            // 2. Inject one guaranteed-detectable relation defect.
            let parent_kinds: Vec<NodeId> = pool
                .iter()
                .copied()
                .filter(|n| doc.first_child(*n).unwrap().is_some())
                .collect();
            let non_roots: Vec<NodeId> = pool
                .iter()
                .copied()
                .filter(|n| doc.parent(*n).unwrap().is_some())
                .collect();
            match rng.idx(3) {
                0 => {
                    // Break a child's parent back-pointer.
                    assert!(!non_roots.is_empty(), "seed {seed}: tree too shallow");
                    let victim = non_roots[rng.idx(non_roots.len())];
                    let root = top_of(&doc, victim);
                    let old_parent = doc.parent(victim).unwrap().unwrap();
                    let other = pool
                        .iter()
                        .copied()
                        .find(|o| *o != victim && *o != old_parent)
                        .expect("pool has enough distinct nodes");
                    doc.node_mut(victim).unwrap().parent = Some(other);
                    assert!(
                        doc.check_invariants(root).is_err(),
                        "seed {seed}: broken parent back-pointer not detected"
                    );
                }
                1 => {
                    // Drop last_child on a node that has children.
                    assert!(!parent_kinds.is_empty(), "seed {seed}: tree too shallow");
                    let victim = parent_kinds[rng.idx(parent_kinds.len())];
                    let root = top_of(&doc, victim);
                    doc.node_mut(victim).unwrap().last_child = None;
                    assert!(
                        doc.check_invariants(root).is_err(),
                        "seed {seed}: broken last_child not detected"
                    );
                }
                _ => {
                    // Drop first_child on a node that has children.
                    assert!(!parent_kinds.is_empty(), "seed {seed}: tree too shallow");
                    let victim = parent_kinds[rng.idx(parent_kinds.len())];
                    let root = top_of(&doc, victim);
                    doc.node_mut(victim).unwrap().first_child = None;
                    assert!(
                        doc.check_invariants(root).is_err(),
                        "seed {seed}: broken first_child not detected"
                    );
                }
            }
        }
    }
}
