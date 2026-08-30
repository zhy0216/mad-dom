//! Clone, import and adopt operations (T17).
//!
//! This module implements the clone family of operations the DOM exposes as
//! `cloneNode`, `importNode` and `adoptNode` (the JavaScript facade arrives in
//! a later milestone):
//!
//! * [`Document::clone_node`] copies a node — and, optionally, its whole
//!   subtree — into *new* nodes of the same document. The clone shares no
//!   mutable state with the source: every element attribute and every text or
//!   comment payload is copied by value into freshly allocated arena slots,
//!   and the cloned tree is relinked from scratch.
//! * [`Document::import_node`] is the cross-document variant of a clone: it
//!   reads a subtree of another document and reproduces it inside this
//!   document, leaving the source untouched and handing every copied node a
//!   brand-new [`NodeId`](crate::arena::NodeId) from *this* document's arena.
//! * [`Document::adopt_node`] *moves* a node and its subtree from another
//!   document into this one. The node is detached from its source parent, the
//!   source arena slots are freed (so the old handles become stale and can
//!   never be reused to reach the migrated node), and the data is re-homed
//!   here under fresh handles.
//!
//! # Handle separation
//!
//! A [`NodeId`](crate::arena::NodeId) embeds the owning document's id, so a
//! handle obtained from one document is never silently read as a node of
//! another: every operation below verifies document ownership through
//! [`Document::get`] before touching anything, and misuse returns
//! [`CoreError::WrongDocument`]. Adoption additionally frees the source slots,
//! so the migrated node can never be reached again through its old source
//! handle — it is either stale ([`ArenaError`](crate::arena::ArenaError)) or
//! rejected as `WrongDocument` by the target.
//!
//! # Atomicity
//!
//! All validation happens before any mutation, so a failed clone/import/adopt
//! leaves both documents byte-for-byte unchanged. Adopt's mutation phase
//! (detach from the source parent, free the source slots, allocate fresh
//! handles, relink) cannot fail once its preconditions hold.
//!
//! A `Document` node — which can be neither a parent nor a child — is rejected
//! by all three operations with [`CoreError::Hierarchy`], mirroring how the
//! mutation API rejects it. The DOM would surface this as `NotSupportedError`;
//! the JS facade milestone maps the Core error to the appropriate exception.

use crate::arena::NodeId;
use crate::error::CoreError;

use super::node::NodeType;
use super::Document;

use std::collections::{HashMap, HashSet};

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

impl Document {
    /// Clones the node for `id`, optionally including its subtree, and returns
    /// the clone as a detached node of this document.
    ///
    /// A shallow clone copies only the node's own payload (element name and
    /// attributes, or text/comment data); a deep clone additionally copies the
    /// whole subtree, preserving child order, node types, text and attributes.
    /// Every cloned node is a brand-new arena slot holding a by-value copy, so
    /// the clone shares no mutable state with the source: mutating the source
    /// tree afterwards never leaks into the clone, and vice versa.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` (or a descendant in a deep clone) is a
    ///   stale or invalid handle.
    /// * [`CoreError::Hierarchy`] when `id` is a `Document` node.
    pub fn clone_node(&mut self, id: NodeId, deep: bool) -> Result<NodeId, CoreError> {
        self.reject_document_node(id)?;
        let subtree = if deep {
            self.collect_subtree(id)?
        } else {
            vec![(id, Vec::new())]
        };
        let mut map: HashMap<NodeId, NodeId> = HashMap::with_capacity(subtree.len());
        for (sid, _) in &subtree {
            let data = self.get(*sid)?.data().clone();
            let tid = self.allocate_node(data);
            map.insert(*sid, tid);
        }
        self.link_mapped_subtree(&map, &subtree);
        let root = *map.get(&id).expect("the root was cloned");
        // A cloned `<template>` element keeps its template-contents fragment
        // (T40): every template in the cloned subtree gets a cloned copy of its
        // content, registered under the corresponding clone.
        self.clone_template_contents(&map, deep)?;
        self.verify_subtree(root);
        Ok(root)
    }

    /// Clones the node for `id` from `source` into this document and returns
    /// the clone as a detached node of this document.
    ///
    /// This is the cross-document form of [`Document::clone_node`]: `source`
    /// is never modified, and every copied node is allocated a brand-new
    /// [`NodeId`](crate::arena::NodeId) from this document's arena. A shallow
    /// import copies only the root node; a deep import copies the subtree,
    /// preserving child order, node types, text and attributes.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` does not belong to `source`.
    /// * [`CoreError::Arena`] when `id` (or a descendant in a deep import) is
    ///   a stale or invalid handle in `source`.
    /// * [`CoreError::Hierarchy`] when `id` is a `Document` node.
    pub fn import_node(
        &mut self,
        source: &Document,
        id: NodeId,
        deep: bool,
    ) -> Result<NodeId, CoreError> {
        source.reject_document_node(id)?;
        let subtree = if deep {
            source.collect_subtree(id)?
        } else {
            vec![(id, Vec::new())]
        };
        let mut map: HashMap<NodeId, NodeId> = HashMap::with_capacity(subtree.len());
        for (sid, _) in &subtree {
            let data = source.get(*sid)?.data().clone();
            let tid = self.allocate_node(data);
            map.insert(*sid, tid);
        }
        self.link_mapped_subtree(&map, &subtree);
        let root = *map.get(&id).expect("the root was imported");
        // Template contents follow the import (T40): every imported `<template>`
        // element gets its source contents fragment imported under the
        // corresponding import.
        self.import_template_contents(source, &map, deep)?;
        self.verify_subtree(root);
        Ok(root)
    }

    /// Moves the node for `id` — and its whole subtree — from `source` into
    /// this document and returns the migrated node's new handle.
    ///
    /// Adoption transfers ownership: the node is detached from its source
    /// parent (repairing the source tree), every node of the subtree is
    /// removed from `source`'s arena — freeing those slots, so the old handles
    /// become stale — and the data is re-homed into this document's arena
    /// under brand-new handles, with the subtree relinked here.
    ///
    /// The operation is atomic: all handles are validated before anything is
    /// mutated, so a failure (for example a foreign or stale handle) leaves
    /// both documents unchanged.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` does not belong to `source`.
    /// * [`CoreError::Arena`] when `id` (or a descendant) is a stale or
    ///   invalid handle in `source`.
    /// * [`CoreError::Hierarchy`] when `id` is a `Document` node.
    pub fn adopt_node(&mut self, source: &mut Document, id: NodeId) -> Result<NodeId, CoreError> {
        source.reject_document_node(id)?;
        let subtree = source.collect_subtree(id)?;
        let old_parent = source.get(id)?.parent();

        // Collect the subtree's template contents before the mutation phase
        // frees the source slots (template contents live outside the tree, so
        // `subtree` does not include them).
        let mut template_contents: Vec<(NodeId, NodeId)> = Vec::new();
        for (sid, _) in &subtree {
            if source.is_template(*sid)? {
                if let Some(contents) = source.template_content_id(*sid)? {
                    template_contents.push((*sid, contents));
                }
            }
        }

        // Mutation phase: every precondition was validated above, so the
        // remaining steps cannot fail.
        source.detach(id);

        let mut map: HashMap<NodeId, NodeId> = HashMap::with_capacity(subtree.len());
        for (sid, _) in &subtree {
            let node = source.remove_node(*sid)?;
            let tid = self.allocate_node(node.into_data());
            map.insert(*sid, tid);
        }
        self.link_mapped_subtree(&map, &subtree);

        // Template contents move with the element (T40): each adopted
        // `<template>` gets its content fragment adopted under the
        // corresponding adoption.
        for (src_template, contents) in template_contents {
            let dst = *map
                .get(&src_template)
                .expect("every subtree template was adopted");
            let new_contents = self.adopt_node(source, contents)?;
            self.set_template_content(dst, new_contents);
        }

        let root = *map.get(&id).expect("the root was adopted");
        self.verify_subtree(root);
        if let Some(parent) = old_parent {
            source.verify_tree_root(parent);
        }
        Ok(root)
    }

    /// Rejects handles that are not live nodes of this document or that
    /// designate a `Document` node, which the clone family cannot process.
    fn reject_document_node(&self, id: NodeId) -> Result<(), CoreError> {
        if self.get(id)?.node_type() == NodeType::Document {
            return Err(hierarchy(
                "a Document node cannot be cloned, imported or adopted",
            ));
        }
        Ok(())
    }

    /// Clones the template-contents fragment of every `<template>` element in
    /// the cloned subtree (T40) and registers it under the corresponding
    /// clone, so `cloneNode` reproduces template content exactly like the
    /// browser.
    fn clone_template_contents(
        &mut self,
        map: &HashMap<NodeId, NodeId>,
        deep: bool,
    ) -> Result<(), CoreError> {
        for (src, dst) in map {
            if self.is_template(*src)? {
                if let Some(contents) = self.template_content_id(*src)? {
                    let new_contents = self.clone_node(contents, deep)?;
                    self.set_template_content(*dst, new_contents);
                }
            }
        }
        Ok(())
    }

    /// Imports the template-contents fragment of every `<template>` element in
    /// the imported subtree (T40) from `source` and registers it under the
    /// corresponding import.
    fn import_template_contents(
        &mut self,
        source: &Document,
        map: &HashMap<NodeId, NodeId>,
        deep: bool,
    ) -> Result<(), CoreError> {
        for (src, dst) in map {
            if source.is_template(*src)? {
                if let Some(contents) = source.template_content_id(*src)? {
                    let new_contents = self.import_node(source, contents, deep)?;
                    self.set_template_content(*dst, new_contents);
                }
            }
        }
        Ok(())
    }

    /// Collects the subtree rooted at `root` in pre-order, returning for every
    /// node its child handles in document order.
    ///
    /// The walk is iterative and guards against revisits, so arbitrarily deep
    /// trees cannot overflow the call stack and a corrupted (cyclic or
    /// duplicated) subtree is rejected instead of looping forever. Every
    /// visited handle is validated to be live, so a dangling relation fails
    /// with a structured error before any mutation can begin.
    fn collect_subtree(&self, root: NodeId) -> Result<Vec<(NodeId, Vec<NodeId>)>, CoreError> {
        let mut out = Vec::new();
        let mut seen: HashSet<NodeId> = HashSet::new();
        let mut stack = vec![root];
        seen.insert(root);
        while let Some(n) = stack.pop() {
            let node = self.get(n)?;
            let mut kids = Vec::new();
            let mut cur = node.first_child();
            while let Some(k) = cur {
                if !seen.insert(k) {
                    return Err(hierarchy(
                        "node subtree is not a tree (cycle or duplicated reach)",
                    ));
                }
                kids.push(k);
                cur = self.get(k)?.next_sibling();
            }
            for &c in kids.iter().rev() {
                stack.push(c);
            }
            out.push((n, kids));
        }
        Ok(out)
    }

    /// Relinks the freshly allocated target-tree nodes using the source
    /// subtree structure recorded by [`Document::collect_subtree`].
    ///
    /// `map` translates source handles to the target handles they were cloned,
    /// imported or adopted into. Every node gets its `parent` and sibling
    /// fields re-established from the by-value copies of the source structure,
    /// so the resulting tree satisfies the invariants verified by
    /// [`Document::check_invariants`].
    fn link_mapped_subtree(
        &mut self,
        map: &HashMap<NodeId, NodeId>,
        subtree: &[(NodeId, Vec<NodeId>)],
    ) {
        for (sid, children) in subtree {
            let parent = *map.get(sid).expect("every source node was copied");
            let mapped: Vec<NodeId> = children
                .iter()
                .map(|c| *map.get(c).expect("every source child was copied"))
                .collect();
            self.relink_children(parent, &mapped);
        }
    }

    /// Links `children` (already detached target nodes) as the child list of
    /// `parent`, establishing parent back-pointers, sibling mirrors and the
    /// first/last child fields consistently.
    fn relink_children(&mut self, parent: NodeId, children: &[NodeId]) {
        let mut first = None;
        let mut last = None;
        let mut prev = None;
        for &c in children {
            if let Some(p) = prev {
                self.node_mut(p)
                    .expect("live previous sibling")
                    .next_sibling = Some(c);
            }
            let node = self.node_mut(c).expect("live child");
            node.parent = Some(parent);
            node.previous_sibling = prev;
            if first.is_none() {
                first = Some(c);
            }
            last = Some(c);
            prev = Some(c);
        }
        let parent_node = self.node_mut(parent).expect("live parent");
        parent_node.first_child = first;
        parent_node.last_child = last;
    }

    /// In debug builds, verifies that the freshly built tree rooted at `root`
    /// satisfies the tree invariants, so a relinking bug in the clone family
    /// surfaces in tests.
    fn verify_subtree(&self, root: NodeId) {
        #[cfg(debug_assertions)]
        debug_assert_eq!(
            self.check_invariants(root),
            Ok(()),
            "clone/import/adopt at {root} left the tree inconsistent"
        );
    }

    /// In debug builds, walks from `node` up to its top-level ancestor and
    /// verifies that subtree satisfies the tree invariants. Used to re-check a
    /// source tree after adoption detached a node from it.
    fn verify_tree_root(&self, node: NodeId) {
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
                            "adoption left the source tree inconsistent"
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
    use crate::arena::ArenaError;

    fn children(doc: &Document, id: NodeId) -> Vec<NodeId> {
        doc.children(id).unwrap()
    }

    fn assert_hierarchy(err: CoreError) {
        assert!(
            matches!(err, CoreError::Hierarchy { .. }),
            "expected Hierarchy, got {err:?}"
        );
    }

    /// Builds `root -> a -> [text, comment]` and returns the four handles.
    fn build_tree(doc: &mut Document) -> (NodeId, NodeId, NodeId, NodeId) {
        let root = doc.create_element("div").unwrap();
        let a = doc.create_element("span").unwrap();
        let text = doc.create_text("hello").unwrap();
        let comment = doc.create_comment("note").unwrap();
        doc.append_child(root, a).unwrap();
        doc.append_child(a, text).unwrap();
        doc.append_child(a, comment).unwrap();
        (root, a, text, comment)
    }

    // ---- clone_node ----

    #[test]
    fn shallow_clone_copies_node_data_not_relations() {
        let mut doc = Document::new();
        let root = doc.create_element("div").unwrap();
        let a = doc.create_element("a").unwrap();
        doc.append_child(root, a).unwrap();
        doc.node_mut(root)
            .unwrap()
            .push_attribute_for_test("id", "r");
        doc.node_mut(a)
            .unwrap()
            .push_attribute_for_test("class", "x");

        let shallow = doc.clone_node(root, false).unwrap();
        assert_ne!(shallow, root);
        assert_eq!(doc.node_name(shallow).unwrap(), "div");
        assert_eq!(doc.parent(shallow).unwrap(), None, "clone is detached");
        assert_eq!(
            children(&doc, shallow),
            Vec::<NodeId>::new(),
            "shallow clone has no children"
        );
        assert_eq!(
            doc.get(shallow).unwrap().data().element_attributes(),
            doc.get(root).unwrap().data().element_attributes(),
            "attributes are copied by value"
        );
        assert_eq!(doc.check_invariants(shallow).unwrap(), ());
    }

    #[test]
    fn deep_clone_preserves_order_type_text_and_attributes() {
        let mut doc = Document::new();
        let (root, a, text, comment) = build_tree(&mut doc);
        doc.node_mut(root)
            .unwrap()
            .push_attribute_for_test("id", "root");
        doc.node_mut(a)
            .unwrap()
            .push_attribute_for_test("class", "span");

        let deep = doc.clone_node(root, true).unwrap();
        assert_ne!(deep, root);
        assert_eq!(doc.parent(deep).unwrap(), None);

        let a_clone = doc.first_child(deep).unwrap().unwrap();
        assert_ne!(a_clone, a);
        assert_eq!(doc.node_type(a_clone).unwrap(), NodeType::Element);
        assert_eq!(doc.node_name(a_clone).unwrap(), "span");
        assert_eq!(
            doc.get(a_clone).unwrap().data().element_attributes(),
            doc.get(a).unwrap().data().element_attributes(),
        );

        let inner = children(&doc, a_clone);
        assert_eq!(inner.len(), 2, "child order is preserved");
        assert_ne!(inner[0], text);
        assert_ne!(inner[1], comment);
        assert_eq!(doc.node_type(inner[0]).unwrap(), NodeType::Text);
        assert_eq!(doc.get(inner[0]).unwrap().data().text_data(), Some("hello"));
        assert_eq!(doc.node_type(inner[1]).unwrap(), NodeType::Comment);
        assert_eq!(
            doc.get(inner[1]).unwrap().data().comment_data(),
            Some("note")
        );
        assert_eq!(doc.check_invariants(deep).unwrap(), ());
    }

    #[test]
    fn deep_clone_does_not_share_mutable_tree_state() {
        let mut doc = Document::new();
        let (root, a, text, _comment) = build_tree(&mut doc);
        let deep = doc.clone_node(root, true).unwrap();

        // Remove one child from the ORIGINAL subtree; the clone keeps its own
        // independent copy of the whole subtree.
        doc.remove_child(a, text).unwrap();
        assert_eq!(children(&doc, a), vec![_comment]);
        let a_clone = doc.first_child(deep).unwrap().unwrap();
        assert_eq!(children(&doc, a_clone).len(), 2);
        assert_eq!(
            doc.get(doc.first_child(a_clone).unwrap().unwrap())
                .unwrap()
                .data()
                .text_data(),
            Some("hello")
        );
        assert_eq!(doc.check_invariants(deep).unwrap(), ());
    }

    #[test]
    fn clone_survives_destruction_of_source_subtree() {
        let mut doc = Document::new();
        let (root, a, _text, _comment) = build_tree(&mut doc);
        let deep = doc.clone_node(root, true).unwrap();

        // Sever the original subtree; the clone remains intact and independent.
        doc.remove_child(root, a).unwrap();
        assert_eq!(children(&doc, root), Vec::<NodeId>::new());
        let a_clone = doc.first_child(deep).unwrap().unwrap();
        assert_eq!(
            doc.node_name(doc.first_child(a_clone).unwrap().unwrap())
                .unwrap(),
            "#text"
        );
        assert_eq!(doc.check_invariants(deep).unwrap(), ());
    }

    #[test]
    fn clone_text_and_comment_nodes() {
        let mut doc = Document::new();
        let text = doc.create_text("hi").unwrap();
        let comment = doc.create_comment("c").unwrap();
        let t = doc.clone_node(text, false).unwrap();
        let c = doc.clone_node(comment, false).unwrap();
        assert_ne!(t, text);
        assert_ne!(c, comment);
        assert_eq!(doc.get(t).unwrap().data().text_data(), Some("hi"));
        assert_eq!(doc.get(c).unwrap().data().comment_data(), Some("c"));
        assert_eq!(doc.node_name(t).unwrap(), "#text");
        assert_eq!(doc.node_name(c).unwrap(), "#comment");
    }

    #[test]
    fn deep_clone_of_fragment_copies_children() {
        let mut doc = Document::new();
        let frag = doc.create_document_fragment().unwrap();
        let x = doc.create_element("x").unwrap();
        let y = doc.create_element("y").unwrap();
        doc.append_child(frag, x).unwrap();
        doc.append_child(frag, y).unwrap();

        let deep = doc.clone_node(frag, true).unwrap();
        assert_eq!(doc.node_type(deep).unwrap(), NodeType::DocumentFragment);
        let kids = children(&doc, deep);
        assert_eq!(kids.len(), 2);
        assert_eq!(doc.node_name(kids[0]).unwrap(), "x");
        assert_eq!(doc.node_name(kids[1]).unwrap(), "y");

        let shallow = doc.clone_node(frag, false).unwrap();
        assert_eq!(children(&doc, shallow), Vec::<NodeId>::new());
    }

    #[test]
    fn clone_node_rejects_document_nodes() {
        let mut doc = Document::new();
        let doc_node = doc.create_document_node_for_test();
        assert_hierarchy(doc.clone_node(doc_node, false).unwrap_err());
        assert_hierarchy(doc.clone_node(doc_node, true).unwrap_err());
    }

    #[test]
    fn clone_node_rejects_foreign_handles() {
        let mut a = Document::new();
        let mut b = Document::new();
        let el = a.create_element("div").unwrap();
        assert!(matches!(
            b.clone_node(el, false),
            Err(CoreError::WrongDocument { .. })
        ));
    }

    #[test]
    fn clone_node_rejects_stale_handles() {
        let mut doc = Document::new();
        doc.create_element("div").unwrap();
        let bogus = NodeId::new(doc.id(), u32::MAX, 0);
        assert!(matches!(
            doc.clone_node(bogus, false),
            Err(CoreError::Arena(ArenaError::OutOfBounds { .. }))
        ));
    }

    #[test]
    fn deep_clone_of_deep_chain_does_not_overflow() {
        let mut doc = Document::new();
        let root = doc.create_element("n").unwrap();
        let mut prev = root;
        for _ in 0..50_000 {
            let next = doc.create_element("n").unwrap();
            doc.append_child_for_test(prev, next);
            prev = next;
        }

        let deep = doc.clone_node(root, true).unwrap();
        assert_eq!(doc.node_name(deep).unwrap(), "n");
        let mut count = 0;
        let mut cur = deep;
        while let Some(c) = doc.first_child(cur).unwrap() {
            count += 1;
            cur = c;
        }
        assert_eq!(count, 50_000);
        assert_eq!(doc.check_invariants(deep).unwrap(), ());
    }

    // ---- import_node ----

    #[test]
    fn import_node_copies_data_into_target_document() {
        let mut source = Document::new();
        let mut target = Document::new();
        let el = source.create_element("div").unwrap();
        source
            .node_mut(el)
            .unwrap()
            .push_attribute_for_test("id", "x");

        let imported = target.import_node(&source, el, false).unwrap();
        assert_ne!(imported, el);
        assert_eq!(imported.document_id(), target.id());
        assert_eq!(target.node_name(imported).unwrap(), "div");
        assert!(target.get(imported).is_ok());
        assert!(
            matches!(source.get(imported), Err(CoreError::WrongDocument { .. })),
            "the imported handle is never read as a source node"
        );
        assert_eq!(
            target.get(imported).unwrap().data().element_attributes(),
            source.get(el).unwrap().data().element_attributes(),
            "attribute data is copied, not shared"
        );
    }

    #[test]
    fn deep_import_preserves_subtree_and_leaves_source_intact() {
        let mut source = Document::new();
        let mut target = Document::new();
        let (root, a, text, comment) = build_tree(&mut source);

        let imported = target.import_node(&source, root, true).unwrap();
        assert_eq!(imported.document_id(), target.id());

        let a_imp = target.first_child(imported).unwrap().unwrap();
        assert_eq!(target.node_name(a_imp).unwrap(), "span");
        let inner = children(&target, a_imp);
        assert_eq!(inner.len(), 2);
        assert_eq!(
            target.get(inner[0]).unwrap().data().text_data(),
            Some("hello")
        );
        assert_eq!(
            target.get(inner[1]).unwrap().data().comment_data(),
            Some("note")
        );

        // Source is byte-for-byte unchanged.
        assert_eq!(children(&source, root), vec![a]);
        assert_eq!(children(&source, a), vec![text, comment]);
        assert!(source.get(root).is_ok());
        assert_eq!(source.check_invariants(root).unwrap(), ());
        assert_eq!(target.check_invariants(imported).unwrap(), ());
    }

    #[test]
    fn shallow_import_has_no_children() {
        let mut source = Document::new();
        let mut target = Document::new();
        let (root, _, _, _) = build_tree(&mut source);
        let imported = target.import_node(&source, root, false).unwrap();
        assert_eq!(children(&target, imported), Vec::<NodeId>::new());
        assert_eq!(children(&source, root).len(), 1, "source untouched");
    }

    #[test]
    fn import_node_rejects_document_nodes() {
        let mut source = Document::new();
        let mut target = Document::new();
        let doc_node = source.create_document_node_for_test();
        assert_hierarchy(target.import_node(&source, doc_node, false).unwrap_err());
    }

    #[test]
    fn import_node_requires_handle_from_source_document() {
        let mut a = Document::new();
        let b = Document::new();
        let mut c = Document::new();
        let el = a.create_element("div").unwrap();
        assert!(matches!(
            c.import_node(&b, el, false),
            Err(CoreError::WrongDocument { .. })
        ));
    }

    #[test]
    fn import_node_rejects_stale_handles() {
        let mut source = Document::new();
        let mut target = Document::new();
        source.create_element("div").unwrap();
        let bogus = NodeId::new(source.id(), u32::MAX, 0);
        assert!(matches!(
            target.import_node(&source, bogus, false),
            Err(CoreError::Arena(_))
        ));
    }

    // ---- adopt_node ----

    #[test]
    fn adopt_detached_node_moves_ownership() {
        let mut source = Document::new();
        let mut target = Document::new();
        let node = source.create_element("div").unwrap();

        let adopted = target.adopt_node(&mut source, node).unwrap();
        assert_ne!(adopted, node);
        assert_eq!(adopted.document_id(), target.id());
        assert_eq!(target.node_name(adopted).unwrap(), "div");
        assert!(target.get(adopted).is_ok());
        assert!(
            matches!(source.get(node), Err(CoreError::Arena(_))),
            "the source handle becomes stale after adoption"
        );
    }

    #[test]
    fn adopt_detaches_from_source_parent_and_repairs_source_tree() {
        let mut source = Document::new();
        let mut target = Document::new();
        let root = source.create_element("root").unwrap();
        let a = source.create_element("a").unwrap();
        let b = source.create_element("b").unwrap();
        let c = source.create_element("c").unwrap();
        source.append_child(root, a).unwrap();
        source.append_child(root, b).unwrap();
        source.append_child(root, c).unwrap();

        let adopted_b = target.adopt_node(&mut source, b).unwrap();
        assert_eq!(children(&source, root), vec![a, c]);
        assert_eq!(source.first_child(root).unwrap(), Some(a));
        assert_eq!(source.last_child(root).unwrap(), Some(c));
        assert_eq!(source.next_sibling(a).unwrap(), Some(c));
        assert_eq!(source.previous_sibling(c).unwrap(), Some(a));
        assert_eq!(source.check_invariants(root).unwrap(), ());

        assert_eq!(target.node_name(adopted_b).unwrap(), "b");
        assert_eq!(target.parent(adopted_b).unwrap(), None);
        assert_eq!(target.check_invariants(adopted_b).unwrap(), ());
    }

    #[test]
    fn adopt_moves_entire_subtree() {
        let mut source = Document::new();
        let mut target = Document::new();
        let (root, a, text, comment) = build_tree(&mut source);

        let adopted = target.adopt_node(&mut source, root).unwrap();
        let a_imp = target.first_child(adopted).unwrap().unwrap();
        let inner = children(&target, a_imp);
        assert_eq!(inner.len(), 2);
        assert_eq!(
            target.get(inner[0]).unwrap().data().text_data(),
            Some("hello")
        );
        assert_eq!(
            target.get(inner[1]).unwrap().data().comment_data(),
            Some("note")
        );
        assert_eq!(target.check_invariants(adopted).unwrap(), ());

        for old in [root, a, text, comment] {
            assert!(
                matches!(source.get(old), Err(CoreError::Arena(_))),
                "every migrated source handle becomes stale"
            );
        }
    }

    #[test]
    fn adopt_frees_source_slot_for_safe_reuse() {
        let mut source = Document::new();
        let mut target = Document::new();
        let node = source.create_element("div").unwrap();
        let old_slot = node.slot();

        let adopted = target.adopt_node(&mut source, node).unwrap();
        assert_eq!(target.node_name(adopted).unwrap(), "div");

        // A fresh source allocation reuses the freed slot with a bumped
        // generation, so the old handle never aliases the new node.
        let fresh = source.create_element("fresh").unwrap();
        assert_eq!(fresh.slot(), old_slot);
        assert_ne!(fresh.generation(), node.generation());
        assert!(matches!(
            source.get(node),
            Err(CoreError::Arena(ArenaError::GenerationMismatch { .. }))
        ));
        assert_eq!(source.node_name(fresh).unwrap(), "fresh");
    }

    #[test]
    fn adopt_rolls_back_without_mutation_on_foreign_handle() {
        let mut a = Document::new();
        let mut b = Document::new();
        let mut c = Document::new();
        let el = a.create_element("div").unwrap();
        let root_b = b.create_element("root").unwrap();
        let root_c = c.create_element("root").unwrap();

        // `el` belongs to `a`, not to the passed `b`: the call must fail
        // before touching either `b` or `c`.
        assert!(matches!(
            c.adopt_node(&mut b, el),
            Err(CoreError::WrongDocument { .. })
        ));
        assert_eq!(children(&b, root_b), Vec::<NodeId>::new());
        assert_eq!(children(&c, root_c), Vec::<NodeId>::new());
        assert_eq!(a.parent(el).unwrap(), None);
        assert_eq!(a.check_invariants(el).unwrap(), ());
    }

    #[test]
    fn adopt_rejects_document_nodes_and_leaves_source_untouched() {
        let mut source = Document::new();
        let mut target = Document::new();
        let doc_node = source.create_document_node_for_test();

        assert_hierarchy(target.adopt_node(&mut source, doc_node).unwrap_err());
        assert!(source.get(doc_node).is_ok(), "source unchanged on failure");
        assert_eq!(source.check_invariants(doc_node).unwrap(), ());
    }

    #[test]
    fn adopt_rejects_stale_handle() {
        let mut source = Document::new();
        let mut target = Document::new();
        source.create_element("div").unwrap();
        let bogus = NodeId::new(source.id(), u32::MAX, 0);
        assert!(matches!(
            target.adopt_node(&mut source, bogus),
            Err(CoreError::Arena(_))
        ));
    }

    // ---- handle separation across documents ----

    #[test]
    fn imported_and_source_handles_share_slot_without_aliasing() {
        let mut source = Document::new();
        let mut target = Document::new();
        let src = source.create_element("from-source").unwrap();
        let imported = target.import_node(&source, src, false).unwrap();

        assert_eq!(imported.slot(), src.slot(), "both are first allocations");
        assert_eq!(imported.generation(), src.generation());
        assert_ne!(imported, src);

        assert_eq!(source.node_name(src).unwrap(), "from-source");
        assert_eq!(target.node_name(imported).unwrap(), "from-source");
        assert!(
            matches!(source.get(imported), Err(CoreError::WrongDocument { .. })),
            "a target handle is never read as a source node"
        );
        assert!(
            matches!(target.get(src), Err(CoreError::WrongDocument { .. })),
            "a source handle is never read as a target node"
        );
    }

    #[test]
    fn adopted_node_old_handle_is_rejected_by_target_document() {
        let mut source = Document::new();
        let mut target = Document::new();
        let node = source.create_element("div").unwrap();
        let adopted = target.adopt_node(&mut source, node).unwrap();

        assert!(
            matches!(target.get(node), Err(CoreError::WrongDocument { .. })),
            "the old source handle is never read as a target node"
        );
        assert_eq!(target.node_name(adopted).unwrap(), "div");
    }

    #[test]
    fn cross_document_direct_mutation_returns_structured_error() {
        let mut source = Document::new();
        let mut target = Document::new();
        let el = source.create_element("div").unwrap();
        let parent = target.create_element("root").unwrap();
        let imported = target.import_node(&source, el, false).unwrap();

        // Directly mutating the target tree with a source handle is rejected,
        // and so is mutating the source tree with the imported handle.
        assert!(matches!(
            target.append_child(parent, el),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            source.append_child(el, imported),
            Err(CoreError::WrongDocument { .. })
        ));
        assert_eq!(target.check_invariants(parent).unwrap(), ());
        assert_eq!(source.check_invariants(el).unwrap(), ());
    }
}
