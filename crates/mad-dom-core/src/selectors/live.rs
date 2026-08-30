//! Live element collections and the optional id/class/tag query index (T32).
//!
//! Implements the Core half of the WHATWG live collection surface —
//! `Document` / `Element` `getElementsByTagName` and `getElementsByClassName`
//! — as document-order walks of the arena that are *re-run on every call*, so
//! an already-returned result set is never a snapshot: the live collection
//! facade re-reads this contract on every access and therefore reflects any
//! tree or attribute change immediately, with no second tree state anywhere.
//!
//! # The optional query index
//!
//! The same queries can be served from a per-document [`QueryIndex`] of
//! `id` / `class` / `tag` keys instead of a fresh traversal. The index is
//! **opt-in and benchmark-driven** (the T32 boundary: no index without
//! measurement): it is off by default and enabled per document with
//! [`Document::set_query_index_enabled`]. Every write that can change a query
//! result is funnelled through the single mutation/attribute maintenance
//! surface in this module ([`Document::index_subtree_attached`],
//! [`Document::index_subtree_detached`], [`Document::index_attribute_changed`]),
//! which the unified tree mutation API and the attribute write API call; the
//! index is therefore kept in lock-step with the arena, and the two query
//! paths produce byte-for-byte identical results (the T32 acceptance "启用或
//! 禁用索引时结果完全一致").
//!
//! Because every maintenance entry re-derives a node's keys from the arena
//! attributes on the fly and inserts into document-ordered key lists, the
//! index can never quietly serve stale data: the mutation API updates it on
//! detach/attach, the attribute API on id/class writes, and the property tests
//! in this module and in `tests/t32_live_collections.rs` cross-check the index
//! against a fresh traversal after random mutation sequences — a maintenance
//! bug therefore fails loudly instead of drifting silently.
//!
//! # Scope rules
//!
//! Both collections run on a `ParentNode` scope — an `Element`, the
//! `Document` root or a `DocumentFragment` — and match the scope's
//! *descendants* only (the context object itself is never a candidate), the
//! same rule the T31 selector queries follow. Any other node kind fails with
//! [`CoreError::Hierarchy`], matching the single-class facade model where a
//! `Text`/`Comment` node reaches Core for every method.

use std::collections::{HashMap, HashSet};

use crate::arena::NodeId;
use crate::dom::{Document, NodeType};
use crate::error::CoreError;

/// Whether a node kind may act as a `ParentNode` collection scope.
fn is_query_scope(node_type: NodeType) -> bool {
    matches!(
        node_type,
        NodeType::Element | NodeType::Document | NodeType::DocumentFragment | NodeType::ShadowRoot
    )
}

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

/// The optional id/class/tag query index of one [`Document`].
///
/// Each key maps to the matching elements of the document **in document
/// (pre) order**, plus a flat `all_elements` list used by `getElementsByTagName("*")`.
/// The lists are maintained by the mutation and attribute maintenance entries
/// of this module, so they always mirror the arena; queries serve from them in
/// `O(key size)` instead of walking the whole tree. The `enabled` flag is the
/// T32 switch: when off, every query is a fresh traversal and the structure
/// stays empty.
///
/// `id` / `class` / `tag` are the only indexed keys: `id` is the `id`
/// attribute value, `class` is one token of the `class` attribute per entry
/// (so `getElementsByClassName` intersects token lists), and `tag` is the
/// element's local name lowercased (so `getElementsByTagName` matches
/// ASCII case-insensitively like the WHATWG HTML-document rule).
#[derive(Debug, Default)]
pub(crate) struct QueryIndex {
    /// Whether queries are served from the index instead of a traversal.
    enabled: bool,
    /// `id` attribute value → matching elements, in document order.
    by_id: HashMap<String, Vec<NodeId>>,
    /// One `class` attribute token → matching elements, in document order.
    by_class: HashMap<String, Vec<NodeId>>,
    /// Lowercased element local name → matching elements, in document order.
    by_tag: HashMap<String, Vec<NodeId>>,
    /// Every attached element of the document, in document order.
    all_elements: Vec<NodeId>,
}

impl QueryIndex {
    /// Whether the index is currently enabled (serving queries).
    pub(crate) fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// The first element matching `id` in document order, if any — the indexed
    /// `getElementById` read. The key lists are maintained in document order,
    /// so the first entry is the WHATWG first-document-order match.
    pub(crate) fn first_for_id(&self, id: &str) -> Option<NodeId> {
        self.by_id
            .get(id)
            .and_then(|matches| matches.first())
            .copied()
    }

    /// Drops all cached entries but keeps the `enabled` flag.
    fn clear(&mut self) {
        self.by_id.clear();
        self.by_class.clear();
        self.by_tag.clear();
        self.all_elements.clear();
    }

    /// Returns the key list (kind, value) the query uses for one key, as a
    /// slice; a missing key reads as an empty slice.
    fn vec_for(&self, kind: &str, value: &str) -> &[NodeId] {
        match kind {
            "id" => self.by_id.get(value).map_or(&[], |v| v.as_slice()),
            "class" => self.by_class.get(value).map_or(&[], |v| v.as_slice()),
            "tag" => self.by_tag.get(value).map_or(&[], |v| v.as_slice()),
            _ => unreachable!("unknown index key kind"),
        }
    }

    /// Returns the mutable key list, creating it when absent.
    fn vec_mut_for(&mut self, kind: &str, value: &str) -> &mut Vec<NodeId> {
        match kind {
            "id" => self.by_id.entry(value.to_string()).or_default(),
            "class" => self.by_class.entry(value.to_string()).or_default(),
            "tag" => self.by_tag.entry(value.to_string()).or_default(),
            _ => unreachable!("unknown index key kind"),
        }
    }

    /// Appends `el` to a key list (caller guarantees it is last in document
    /// order), and removes the entry when the key list becomes empty.
    fn push_key(&mut self, kind: &str, value: &str, el: NodeId) {
        let vec = self.vec_mut_for(kind, value);
        vec.push(el);
    }

    /// Inserts `el` into a key list at `pos` (document order).
    fn insert_key(&mut self, kind: &str, value: &str, el: NodeId, pos: usize) {
        self.vec_mut_for(kind, value).insert(pos, el);
    }

    /// Removes `el` from a key list, dropping empty lists.
    fn remove_key(&mut self, kind: &str, value: &str, el: NodeId) {
        let empty = {
            let vec = self.vec_mut_for(kind, value);
            vec.retain(|&n| n != el);
            vec.is_empty()
        };
        if empty {
            match kind {
                "id" => {
                    self.by_id.remove(value);
                }
                "class" => {
                    self.by_class.remove(value);
                }
                "tag" => {
                    self.by_tag.remove(value);
                }
                _ => unreachable!("unknown index key kind"),
            }
        }
    }
}

impl Document {
    // ------------------------------------------------------------------
    // Public Core contract (consumed by the T32 native binding, the Core
    // integration tests and the query benchmark).
    // ------------------------------------------------------------------

    /// Returns every descendant element of `scope`, in document order, whose
    /// local name matches `name` (WHATWG `getElementsByTagName`).
    ///
    /// `"*"` matches every descendant element. The name is matched ASCII
    /// case-insensitively, the WHATWG HTML-document rule. The result is
    /// recomputed on every call — it is a live read, never a snapshot, so the
    /// facade re-reading this contract on each access sees every mutation
    /// immediately. With the query index enabled the result is served from the
    /// index; with it disabled, from a fresh traversal; the two are identical.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale `scope`.
    /// * [`CoreError::Hierarchy`] when `scope` is not a `ParentNode` kind.
    pub fn get_elements_by_tag_name(
        &self,
        scope: NodeId,
        name: &str,
    ) -> Result<Vec<NodeId>, CoreError> {
        self.expect_collection_scope(scope)?;
        if self.query_index.enabled {
            let key = name.to_ascii_lowercase();
            let candidates = if name == "*" {
                self.index_all_in_scope(scope)?
            } else {
                self.index_candidates_in_scope(scope, |idx| idx.by_tag.get(&key))?
            };
            Ok(candidates)
        } else {
            self.traverse_by_tag(scope, name)
        }
    }

    /// Returns every descendant element of `scope`, in document order, whose
    /// `class` attribute contains every whitespace-separated token of `name`
    /// (WHATWG `getElementsByClassName`).
    ///
    /// An argument that is empty or consists only of ASCII whitespace yields
    /// an empty collection (the WHATWG rule; happy-dom instead throws on such
    /// inputs, which the T32 Bun tests pin as our documented behaviour). Token
    /// matching is case-sensitive and each token is matched against the
    /// whitespace-separated token set of the element's `class` attribute.
    ///
    /// # Errors
    ///
    /// As for [`Document::get_elements_by_tag_name`].
    pub fn get_elements_by_class_name(
        &self,
        scope: NodeId,
        name: &str,
    ) -> Result<Vec<NodeId>, CoreError> {
        self.expect_collection_scope(scope)?;
        let tokens: Vec<&str> = name.split_ascii_whitespace().collect();
        if tokens.is_empty() {
            return Ok(Vec::new());
        }
        if self.query_index.enabled {
            self.indexed_by_class(scope, &tokens)
        } else {
            self.traverse_by_class(scope, &tokens)
        }
    }

    /// Enables or disables the optional id/class/tag query index.
    ///
    /// Enabling builds the index from the current tree in one document-order
    /// pass; from then on every mutation and attribute write keeps it in lock
    /// step through the maintenance entries of this module. Disabling drops
    /// the cached lists and restores the pure-traversal query path. The two
    /// paths are interchangeable — indexed and traversal queries return the
    /// same result for any tree state (the T32 acceptance).
    ///
    /// This is a Core diagnostic/benchmark surface; the native binding and the
    /// facade deliberately do not expose it.
    pub fn set_query_index_enabled(&mut self, enabled: bool) -> Result<(), CoreError> {
        if self.query_index.enabled == enabled {
            return Ok(());
        }
        self.query_index.enabled = enabled;
        if enabled {
            self.rebuild_query_index()?;
        } else {
            self.query_index.clear();
        }
        Ok(())
    }

    /// Returns whether the query index is currently enabled.
    pub fn query_index_enabled(&self) -> bool {
        self.query_index.enabled
    }

    // ------------------------------------------------------------------
    // Traversal query paths (the no-index baseline).
    // ------------------------------------------------------------------

    /// Walks `scope`'s descendants in document order and keeps every element
    /// whose local name matches `name` (or every element for `"*"`).
    fn traverse_by_tag(&self, scope: NodeId, name: &str) -> Result<Vec<NodeId>, CoreError> {
        let mut out = Vec::new();
        self.walk_collection_descendants(scope, |doc, node| {
            if doc.node_type(node)? != NodeType::Element {
                return Ok(true);
            }
            if name == "*" || doc.node_name(node)?.eq_ignore_ascii_case(name) {
                out.push(node);
            }
            Ok(true)
        })?;
        Ok(out)
    }

    /// Walks `scope`'s descendants in document order and keeps every element
    /// whose `class` attribute contains all of `tokens`.
    fn traverse_by_class(&self, scope: NodeId, tokens: &[&str]) -> Result<Vec<NodeId>, CoreError> {
        let mut out = Vec::new();
        self.walk_collection_descendants(scope, |doc, node| {
            if doc.node_type(node)? != NodeType::Element {
                return Ok(true);
            }
            if element_has_all_classes(doc, node, tokens)? {
                out.push(node);
            }
            Ok(true)
        })?;
        Ok(out)
    }

    // ------------------------------------------------------------------
    // Indexed query paths.
    // ------------------------------------------------------------------

    /// Every element of the document inside `scope` (used for `"*"`), by
    /// filtering the document-wide index list through the scope check.
    fn index_all_in_scope(&self, scope: NodeId) -> Result<Vec<NodeId>, CoreError> {
        Ok(self
            .query_index
            .all_elements
            .iter()
            .copied()
            .filter(|&el| self.in_scope(el, scope))
            .collect())
    }

    /// The elements of one index key that live inside `scope`.
    fn index_candidates_in_scope(
        &self,
        scope: NodeId,
        take: impl Fn(&QueryIndex) -> Option<&Vec<NodeId>>,
    ) -> Result<Vec<NodeId>, CoreError> {
        Ok(take(&self.query_index)
            .map(|vec| {
                vec.iter()
                    .copied()
                    .filter(|&el| self.in_scope(el, scope))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Intersects the per-token index lists in document order, keeping only
    /// elements of the smallest list that are also present in every other
    /// token's list and inside `scope`.
    fn indexed_by_class(&self, scope: NodeId, tokens: &[&str]) -> Result<Vec<NodeId>, CoreError> {
        let mut smallest = None;
        let mut smallest_len = usize::MAX;
        for token in tokens {
            let len = self.query_index.by_class.get(*token).map_or(0, Vec::len);
            if len < smallest_len {
                smallest = Some(*token);
                smallest_len = len;
            }
        }
        let Some(first) = smallest else {
            return Ok(Vec::new());
        };
        let candidates = self
            .query_index
            .by_class
            .get(first)
            .cloned()
            .unwrap_or_default();
        let others: Vec<&str> = tokens.iter().copied().filter(|&t| t != first).collect();
        let mut other_sets: Vec<HashSet<NodeId>> = Vec::with_capacity(others.len());
        for token in &others {
            other_sets.push(
                self.query_index
                    .by_class
                    .get(*token)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .collect(),
            );
        }
        Ok(candidates
            .into_iter()
            .filter(|&el| {
                self.in_scope(el, scope) && other_sets.iter().all(|set| set.contains(&el))
            })
            .collect())
    }

    /// Whether `node` is a proper descendant of `scope` (so never the scope
    /// itself).
    fn in_scope(&self, node: NodeId, scope: NodeId) -> bool {
        self.is_descendant_of(node, scope).unwrap_or(false)
    }

    // ------------------------------------------------------------------
    // Index maintenance (the single place every write funnels through).
    // ------------------------------------------------------------------

    /// Rebuilds the whole index from the current tree, in document order.
    fn rebuild_query_index(&mut self) -> Result<(), CoreError> {
        self.query_index.clear();
        let Some(root) = self.cached_document_root() else {
            return Ok(());
        };
        let mut stack: Vec<NodeId> = self.children(root)?.into_iter().rev().collect();
        while let Some(node) = stack.pop() {
            if self.node_type(node)? == NodeType::Element {
                self.index_push_element(node)?;
            }
            for &child in self.children(node)?.iter().rev() {
                stack.push(child);
            }
        }
        Ok(())
    }

    /// Adds `el` to every key it currently belongs to plus `all_elements`,
    /// appending when `el` is the last node in document order (the common
    /// build/append case) and inserting at the computed position otherwise.
    fn index_insert_element(&mut self, el: NodeId) -> Result<(), CoreError> {
        let keys = self.index_keys_for(el)?;
        if self.is_last_in_document_order(el)? {
            self.query_index.all_elements.push(el);
            for (kind, value) in keys {
                self.query_index.push_key(&kind, &value, el);
            }
            return Ok(());
        }
        let mut work: Vec<(String, String, usize)> = Vec::with_capacity(keys.len());
        for (kind, value) in &keys {
            let pos = self
                .query_index
                .vec_for(kind, value)
                .partition_point(|&n| self.precedes(n, el));
            work.push((kind.clone(), value.clone(), pos));
        }
        let all_pos = self
            .query_index
            .all_elements
            .partition_point(|&n| self.precedes(n, el));
        for (kind, value, pos) in work {
            self.query_index.insert_key(&kind, &value, el, pos);
        }
        self.query_index.all_elements.insert(all_pos, el);
        Ok(())
    }

    /// Removes `el` from every key it currently belongs to plus
    /// `all_elements`.
    fn index_remove_element(&mut self, el: NodeId) -> Result<(), CoreError> {
        let keys = self.index_keys_for(el)?;
        self.query_index.all_elements.retain(|&n| n != el);
        for (kind, value) in keys {
            self.query_index.remove_key(&kind, &value, el);
        }
        Ok(())
    }

    /// Adds `el` to a single key (used when an attribute write introduces a
    /// new id/class token on an already-attached element).
    fn index_insert_into_key(
        &mut self,
        kind: &str,
        value: &str,
        el: NodeId,
    ) -> Result<(), CoreError> {
        if self.is_last_in_document_order(el)? {
            self.query_index.push_key(kind, value, el);
            return Ok(());
        }
        let pos = self
            .query_index
            .vec_for(kind, value)
            .partition_point(|&n| self.precedes(n, el));
        self.query_index.insert_key(kind, value, el, pos);
        Ok(())
    }

    /// Pushes `el` to every key it belongs to plus `all_elements`, assuming
    /// `el` is the last node in document order. Only used during the initial
    /// full rebuild, whose walk is already in document order.
    fn index_push_element(&mut self, el: NodeId) -> Result<(), CoreError> {
        let keys = self.index_keys_for(el)?;
        self.query_index.all_elements.push(el);
        for (kind, value) in keys {
            self.query_index.push_key(&kind, &value, el);
        }
        Ok(())
    }

    /// The `(kind, value)` index keys `el` currently belongs to, derived from
    /// its live id/class attributes and its local name.
    fn index_keys_for(&self, el: NodeId) -> Result<Vec<(String, String)>, CoreError> {
        let mut keys = Vec::new();
        if let Some(id) = self.get_attribute(el, "id")? {
            keys.push(("id".to_string(), id.to_string()));
        }
        if let Some(class) = self.get_attribute(el, "class")? {
            for token in class.split_ascii_whitespace() {
                keys.push(("class".to_string(), token.to_string()));
            }
        }
        keys.push(("tag".to_string(), self.node_name(el)?.to_ascii_lowercase()));
        Ok(keys)
    }

    /// Whether `node` is attached to the tree (has a parent; the document root
    /// is a `Document` node, never an element, so elements always have a
    /// parent when attached).
    fn is_attached(&self, node: NodeId) -> Result<bool, CoreError> {
        Ok(self.get(node)?.parent().is_some())
    }

    /// Whether `node` is the last node of the whole document in pre order.
    fn is_last_in_document_order(&self, node: NodeId) -> Result<bool, CoreError> {
        let mut cur = Some(node);
        while let Some(n) = cur {
            match self.get(n)?.parent() {
                None => return Ok(true),
                Some(p) => {
                    if self.get(p)?.last_child() != Some(n) {
                        return Ok(false);
                    }
                    cur = Some(p);
                }
            }
        }
        unreachable!("node chain terminates at the root")
    }

    /// Whether `a` comes before `b` in document (pre) order. Both must be live
    /// nodes of this document; disconnected nodes are treated as `false` (the
    /// index only ever holds attached elements).
    fn precedes(&self, a: NodeId, b: NodeId) -> bool {
        if a == b {
            return false;
        }
        // Walk `a`'s ancestor chain. If `b` shows up, `b` is an ancestor of
        // `a` (or `a` itself, handled above), so `b` comes first.
        let mut a_chain = Vec::new();
        let mut cur = Some(a);
        while let Some(n) = cur {
            if n == b {
                return false;
            }
            a_chain.push(n);
            cur = self.get(n).ok().and_then(|node| node.parent());
        }
        // Walk `b` up until its parent chain meets `a`'s chain at the least
        // common ancestor.
        let mut b_cur = b;
        loop {
            match self.get(b_cur).ok().and_then(|node| node.parent()) {
                None => return false,
                Some(p) => {
                    if let Some(pos) = a_chain.iter().position(|&n| n == p) {
                        if pos == 0 {
                            // `a` is an ancestor of `b`.
                            return true;
                        }
                        let a_branch = a_chain[pos - 1];
                        return self.sibling_precedes(a_branch, b_cur);
                    }
                    b_cur = p;
                }
            }
        }
    }

    /// Whether `a` appears before `b` among their shared parent's children.
    fn sibling_precedes(&self, a: NodeId, b: NodeId) -> bool {
        let mut cur = Some(a);
        while let Some(n) = cur {
            if n == b {
                return true;
            }
            cur = self.get(n).ok().and_then(|node| node.next_sibling());
        }
        false
    }

    // ------------------------------------------------------------------
    // Maintenance hooks called by the mutation and attribute APIs.
    // ------------------------------------------------------------------

    /// Removes the whole subtree rooted at `node` from the index (called from
    /// [`crate::dom::Document::detach`]); a no-op when the index is disabled.
    pub(crate) fn index_subtree_detached(&mut self, node: NodeId) -> Result<(), CoreError> {
        if !self.query_index.enabled {
            return Ok(());
        }
        let mut stack: Vec<NodeId> = vec![node];
        while let Some(cur) = stack.pop() {
            if self.node_type(cur)? == NodeType::Element {
                self.index_remove_element(cur)?;
            }
            for &child in self.children(cur)?.iter().rev() {
                stack.push(child);
            }
        }
        Ok(())
    }

    /// Adds the subtrees rooted at `nodes` (already attached, in document
    /// order) to the index; called from
    /// [`crate::dom::Document::link_detached_chain_between`]. A no-op when the
    /// index is disabled.
    pub(crate) fn index_subtree_attached(&mut self, nodes: &[NodeId]) -> Result<(), CoreError> {
        if !self.query_index.enabled {
            return Ok(());
        }
        for &root in nodes {
            let mut stack: Vec<NodeId> = vec![root];
            while let Some(cur) = stack.pop() {
                if self.node_type(cur)? == NodeType::Element {
                    self.index_insert_element(cur)?;
                }
                for &child in self.children(cur)?.iter().rev() {
                    stack.push(child);
                }
            }
        }
        Ok(())
    }

    /// Re-syncs the index when an attribute write changes `id` or `class`;
    /// other attribute names do not affect any index key. Called from the
    /// attribute write API with the previous and the new value. A no-op when
    /// the index is disabled.
    pub(crate) fn index_attribute_changed(
        &mut self,
        id: NodeId,
        name: &str,
        old: Option<&str>,
        new: Option<&str>,
    ) -> Result<(), CoreError> {
        if !self.query_index.enabled {
            return Ok(());
        }
        match name {
            "id" => {
                if let Some(old) = old {
                    self.query_index.remove_key("id", old, id);
                }
                if let Some(new) = new {
                    if self.is_attached(id)? {
                        self.index_insert_into_key("id", new, id)?;
                    }
                }
            }
            "class" => {
                if let Some(old) = old {
                    for token in old.split_ascii_whitespace() {
                        self.query_index.remove_key("class", token, id);
                    }
                }
                if self.is_attached(id)? {
                    if let Some(new) = new {
                        for token in new.split_ascii_whitespace() {
                            self.index_insert_into_key("class", token, id)?;
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Helpers.
    // ------------------------------------------------------------------

    /// Rejects a collection scope that is not a `ParentNode` kind.
    fn expect_collection_scope(&self, scope: NodeId) -> Result<(), CoreError> {
        if is_query_scope(self.node_type(scope)?) {
            Ok(())
        } else {
            Err(hierarchy(
                "getElementsByTagName/getElementsByClassName requires an Element, Document or DocumentFragment scope",
            ))
        }
    }

    /// Visits every descendant of `root` (excluding `root` itself) in document
    /// (pre) order, calling `visit` for each. Iterative, so deeply nested trees
    /// never overflow the stack (the same guarantee the HTML parser pinned).
    fn walk_collection_descendants(
        &self,
        root: NodeId,
        mut visit: impl FnMut(&Document, NodeId) -> Result<bool, CoreError>,
    ) -> Result<(), CoreError> {
        let mut stack: Vec<NodeId> = self.children(root)?.into_iter().rev().collect();
        while let Some(node) = stack.pop() {
            if !visit(self, node)? {
                return Ok(());
            }
            for &child in self.children(node)?.iter().rev() {
                stack.push(child);
            }
        }
        Ok(())
    }
}

/// Whether the element `el`'s `class` attribute contains every token of
/// `tokens` (case-sensitively, one token per whitespace run).
fn element_has_all_classes(doc: &Document, el: NodeId, tokens: &[&str]) -> Result<bool, CoreError> {
    let Some(class) = doc.get_attribute(el, "class")? else {
        return Ok(false);
    };
    let set: HashSet<&str> = class.split_ascii_whitespace().collect();
    Ok(tokens.iter().all(|token| set.contains(token)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a small corpus tree and returns the document.
    fn corpus() -> Document {
        let mut doc = Document::new();
        doc.ensure_html_skeleton().unwrap();
        let body = doc.document_body().unwrap().unwrap();
        let root = doc.create_element("div").unwrap();
        doc.set_attribute(root, "id", "root").unwrap();
        doc.set_attribute(root, "class", "container").unwrap();
        let a = doc.create_element("p").unwrap();
        doc.set_attribute(a, "id", "p1").unwrap();
        doc.set_attribute(a, "class", "x").unwrap();
        let b = doc.create_element("p").unwrap();
        doc.set_attribute(b, "class", "x y").unwrap();
        let c = doc.create_element("span").unwrap();
        doc.set_attribute(c, "id", "s1").unwrap();
        doc.append_child(body, root).unwrap();
        doc.append_child(root, a).unwrap();
        doc.append_child(root, b).unwrap();
        doc.append_child(root, c).unwrap();
        doc
    }

    /// The `all_elements` / per-key lists re-derived from a fresh traversal;
    /// used by the consistency cross-check.
    fn traversal_elements(doc: &Document) -> Vec<NodeId> {
        let root = doc.cached_document_root().expect("corpus has a root");
        let mut out = Vec::new();
        doc.walk_collection_descendants(root, |d, node| {
            if d.node_type(node).unwrap() == NodeType::Element {
                out.push(node);
            }
            Ok(true)
        })
        .unwrap();
        out
    }

    /// Cross-checks the index against a fresh traversal. A maintenance bug
    /// (or a deliberate corruption) makes the two disagree.
    fn index_matches_traversal(doc: &Document) -> Result<bool, CoreError> {
        let expected = traversal_elements(doc);
        if doc.query_index.all_elements != expected {
            return Ok(false);
        }
        // Rebuild the expected per-key lists from the traversal.
        let mut by_id: HashMap<String, Vec<NodeId>> = HashMap::new();
        let mut by_class: HashMap<String, Vec<NodeId>> = HashMap::new();
        let mut by_tag: HashMap<String, Vec<NodeId>> = HashMap::new();
        for el in &expected {
            for (kind, value) in doc.index_keys_for(*el)? {
                match kind.as_str() {
                    "id" => by_id.entry(value).or_default().push(*el),
                    "class" => by_class.entry(value).or_default().push(*el),
                    "tag" => by_tag.entry(value).or_default().push(*el),
                    _ => unreachable!(),
                }
            }
        }
        Ok(doc.query_index.by_id == by_id
            && doc.query_index.by_class == by_class
            && doc.query_index.by_tag == by_tag)
    }

    #[test]
    fn enabling_the_index_builds_it_from_the_current_tree() {
        let mut doc = corpus();
        doc.set_query_index_enabled(true).unwrap();
        assert!(doc.query_index.enabled);
        assert!(index_matches_traversal(&doc).unwrap());
    }

    #[test]
    fn mutations_keep_the_index_in_sync() {
        let mut doc = corpus();
        doc.set_query_index_enabled(true).unwrap();
        let body = doc.document_body().unwrap().unwrap();
        let root = doc.get_element_by_id("root").unwrap().unwrap();

        // Move, insert, replace and remove; after each step the index matches.
        let extra = doc.create_element("p").unwrap();
        doc.set_attribute(extra, "class", "x").unwrap();
        doc.append_child(body, extra).unwrap();
        assert!(index_matches_traversal(&doc).unwrap());

        doc.insert_before(
            root,
            doc.get_element_by_id("p1").unwrap().unwrap(),
            doc.get_element_by_id("s1").unwrap().unwrap(),
        )
        .unwrap();
        assert!(index_matches_traversal(&doc).unwrap());

        let replacement = doc.create_element("span").unwrap();
        doc.set_attribute(replacement, "id", "repl").unwrap();
        doc.replace_child(
            root,
            doc.get_element_by_id("s1").unwrap().unwrap(),
            replacement,
        )
        .unwrap();
        assert!(index_matches_traversal(&doc).unwrap());

        doc.remove_child(body, extra).unwrap();
        assert!(index_matches_traversal(&doc).unwrap());

        // Attribute writes re-key id/class.
        let p1 = doc.get_element_by_id("p1").unwrap().unwrap();
        doc.set_attribute(p1, "id", "p1-renamed").unwrap();
        doc.set_attribute(p1, "class", "z").unwrap();
        doc.remove_attribute(p1, "class").unwrap();
        assert!(index_matches_traversal(&doc).unwrap());
    }

    #[test]
    fn fragment_and_skelleton_mutations_keep_the_index_in_sync() {
        let mut doc = Document::new();
        doc.ensure_html_skeleton().unwrap();
        doc.set_query_index_enabled(true).unwrap();
        assert!(index_matches_traversal(&doc).unwrap());

        let body = doc.document_body().unwrap().unwrap();
        let frag = doc.create_document_fragment().unwrap();
        let x = doc.create_element("div").unwrap();
        doc.set_attribute(x, "class", "k").unwrap();
        let y = doc.create_element("div").unwrap();
        doc.set_attribute(y, "id", "y").unwrap();
        doc.append_child(frag, x).unwrap();
        doc.append_child(frag, y).unwrap();
        doc.append_child(body, frag).unwrap();
        assert!(index_matches_traversal(&doc).unwrap());

        // innerHTML replacement routes through the same primitives.
        doc.set_inner_html(body, "<section id=\"sec\"><i class=\"k\"></i></section>")
            .unwrap();
        assert!(index_matches_traversal(&doc).unwrap());
    }

    #[test]
    fn the_consistency_check_detects_index_corruption() {
        let mut doc = corpus();
        doc.set_query_index_enabled(true).unwrap();
        assert!(index_matches_traversal(&doc).unwrap());

        // Corrupt a per-key list and the all-elements list: the cross-check
        // must flag both, which is exactly the drift a maintenance bug would
        // cause and the property test is built to catch.
        let p1 = doc.get_element_by_id("p1").unwrap().unwrap();
        doc.query_index.by_id.get_mut("p1").unwrap().clear();
        assert!(
            !index_matches_traversal(&doc).unwrap(),
            "a by_id drift must be detected"
        );
        doc.query_index.by_id.get_mut("p1").unwrap().push(p1);
        assert!(index_matches_traversal(&doc).unwrap());

        doc.query_index.all_elements.clear();
        assert!(
            !index_matches_traversal(&doc).unwrap(),
            "an all_elements drift must be detected"
        );
    }

    #[test]
    fn disabling_the_index_returns_to_traversal_queries() {
        let mut doc = corpus();
        doc.set_query_index_enabled(true).unwrap();
        let root = doc.document_root();
        let indexed = doc.get_elements_by_tag_name(root, "p").unwrap();
        doc.set_query_index_enabled(false).unwrap();
        assert!(!doc.query_index.enabled);
        assert!(doc.query_index.by_id.is_empty());
        let traversed = doc.get_elements_by_tag_name(root, "p").unwrap();
        assert_eq!(indexed, traversed);
    }
}
