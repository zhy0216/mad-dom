//! Live element collections and the adaptive/full query index (T32).
//!
//! Implements the Core half of the WHATWG live collection surface —
//! `Document` / `Element` `getElementsByTagName` and `getElementsByClassName`
//! — as document-order reads that are *re-evaluated on every call* (by traversal
//! or the maintained full index), so an already-returned result set is never a
//! snapshot: the live collection facade re-reads this contract on every access
//! and therefore reflects any tree or attribute change immediately, with no
//! second tree state anywhere.
//!
//! # Adaptive and full query-index modes
//!
//! Queries rooted in the light document tree can be served from a
//! per-document [`QueryIndex`] of `id` / `class` / `tag` keys instead of a
//! fresh traversal. Detached and shadow-tree scopes fall back to traversal so
//! one document-wide index never has to impose an order across disconnected
//! roots. Its explicit modes are `Off` (the default), `IdOnly` (adaptively
//! enabled by document-scoped plain `#id` and `getElementById` reads), and
//! `Full` (the opt-in T32 id/class/tag/all-elements diagnostic mode selected by
//! [`Document::set_query_index_enabled`]). The public T32 enabled flag denotes
//! only `Full`, so the adaptive implementation detail does not change that
//! contract.
//!
//! Every write that can change a query result is funnelled through the single
//! mutation/attribute maintenance surface in this module
//! ([`Document::index_subtree_attached`],
//! [`Document::index_subtree_detached`], [`Document::index_attribute_changed`]),
//! which the unified tree mutation API and the attribute write API call. An
//! Off → IdOnly or IdOnly → Full transition builds complete local state before
//! publishing it. The maintained and traversal paths therefore produce
//! byte-for-byte identical results (the T32 acceptance "启用或禁用索引时结果
//! 完全一致").
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

/// The adaptive/full light-document-tree query index of one [`Document`].
///
/// In `IdOnly`, only `by_id` is populated. In `Full`, each key maps to matching
/// elements **in document (pre) order**, plus a flat `all_elements` list used
/// by `getElementsByTagName("*")`. The lists are maintained by the mutation and
/// attribute entries of this module, so they always mirror the arena; indexed
/// reads cost `O(key size)` instead of a whole-tree walk. `Off` keeps every
/// structure empty and serves all reads by traversal.
///
/// `id` / `class` / `tag` are the only indexed keys: `id` is the `id`
/// attribute value, `class` is one token of the `class` attribute per entry
/// (so `getElementsByClassName` intersects token lists), and `tag` is the
/// element's local name lowercased (so `getElementsByTagName` matches
/// ASCII case-insensitively like the WHATWG HTML-document rule).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum QueryIndexMode {
    #[default]
    Off,
    IdOnly,
    Full,
}

#[derive(Debug, Default)]
pub(crate) struct QueryIndex {
    /// Which light-document-tree indexes are built and maintained.
    mode: QueryIndexMode,
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
    /// Whether document id reads may use `by_id` and writes must maintain it.
    pub(crate) fn has_id_index(&self) -> bool {
        self.mode != QueryIndexMode::Off
    }

    /// Whether live class/tag collection reads may use the full index.
    pub(crate) fn has_full_index(&self) -> bool {
        self.mode == QueryIndexMode::Full
    }

    /// Every indexed element matching `id`, in its owning tree's order.
    ///
    /// Only light-document-tree elements are maintained in this shared index.
    pub(crate) fn matches_for_id(&self, id: &str) -> Option<&[NodeId]> {
        self.by_id.get(id).map(Vec::as_slice)
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
    /// immediately. With the query index enabled, light-document-tree scopes
    /// are served from it; detached and shadow-tree scopes use the same fresh
    /// traversal as the disabled mode. The results are identical.
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
        if self.query_index.has_full_index() && self.scope_uses_document_index(scope)? {
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
        if self.query_index.has_full_index() && self.scope_uses_document_index(scope)? {
            self.indexed_by_class(scope, &tokens)
        } else {
            self.traverse_by_class(scope, &tokens)
        }
    }

    /// Counts the descendants returned by [`Document::get_elements_by_tag_name`]
    /// without materializing a `Vec<NodeId>`.
    ///
    /// This is the read used by the native `HTMLCollection.length` fast path:
    /// it applies the same scope validation, matching rules and optional-index
    /// filtering as the node-producing query, but does not allocate a result
    /// collection that the caller would immediately discard.
    pub fn count_elements_by_tag_name(&self, scope: NodeId, name: &str) -> Result<u32, CoreError> {
        self.expect_collection_scope(scope)?;
        if self.query_index.has_full_index() && self.scope_uses_document_index(scope)? {
            // A Document collection is scoped at the document root, so every
            // indexed candidate is necessarily in scope. Avoid re-checking
            // ancestry for each element; the maintained index already is the
            // exact live cardinality.
            if self.cached_document_root() == Some(scope) {
                let len = if name == "*" {
                    self.query_index.all_elements.len()
                } else {
                    let key = name.to_ascii_lowercase();
                    self.query_index.by_tag.get(&key).map_or(0, Vec::len)
                };
                return Ok(u32::try_from(len).expect("DOM element count exceeds u32::MAX"));
            }
            let mut count = 0_u32;
            if name == "*" {
                for &element in &self.query_index.all_elements {
                    if self.in_scope(element, scope) {
                        count += 1;
                    }
                }
            } else {
                let key = name.to_ascii_lowercase();
                if let Some(elements) = self.query_index.by_tag.get(&key) {
                    for &element in elements {
                        if self.in_scope(element, scope) {
                            count += 1;
                        }
                    }
                }
            }
            Ok(count)
        } else {
            self.traverse_count_by_tag(scope, name)
        }
    }

    /// Counts the descendants returned by
    /// [`Document::get_elements_by_class_name`] without materializing result
    /// nodes. The traversal path uses a cheap nested scan for short queries
    /// and a set for long ones; the indexed path builds membership sets so
    /// multi-token queries remain linear.
    ///
    /// Empty/whitespace-only input and all validation/error semantics are
    /// identical to the node-producing query.
    pub fn count_elements_by_class_name(
        &self,
        scope: NodeId,
        name: &str,
    ) -> Result<u32, CoreError> {
        self.expect_collection_scope(scope)?;
        if name.split_ascii_whitespace().next().is_none() {
            return Ok(0);
        }
        if self.query_index.has_full_index() && self.scope_uses_document_index(scope)? {
            Ok(self.indexed_count_by_class(scope, name))
        } else {
            self.traverse_count_by_class(scope, name)
        }
    }

    /// Enables or disables the full id/class/tag/all-elements query index.
    ///
    /// Enabling builds the index from the current tree in one document-order
    /// pass; from then on every mutation and attribute write keeps it in lock
    /// step through the maintenance entries of this module. Enabling from an
    /// adaptive IdOnly state rebuilds the exact full index atomically.
    /// Disabling either indexed mode drops every cached list and restores the
    /// pure-traversal query path. The paths are interchangeable — indexed and
    /// traversal queries return the same result for any tree state (the T32
    /// acceptance).
    ///
    /// This is a Core diagnostic/benchmark surface; the native binding and the
    /// facade deliberately do not expose it.
    pub fn set_query_index_enabled(&mut self, enabled: bool) -> Result<(), CoreError> {
        if enabled {
            if self.query_index.has_full_index() {
                return Ok(());
            }
            self.query_index = self.build_full_query_index()?;
        } else {
            if self.query_index.mode == QueryIndexMode::Off {
                return Ok(());
            }
            self.query_index = QueryIndex::default();
        }
        Ok(())
    }

    /// Ensures that document-scoped id lookups have a lightweight `by_id`
    /// index. Off → IdOnly builds into local state and publishes only after a
    /// successful traversal; IdOnly and Full are idempotent no-ops.
    pub fn ensure_id_query_index_enabled(&mut self) -> Result<(), CoreError> {
        if self.query_index.has_id_index() {
            return Ok(());
        }
        self.query_index = self.build_id_query_index()?;
        Ok(())
    }

    /// Returns whether the public T32 full query index is currently enabled.
    ///
    /// The private adaptive IdOnly mode deliberately reports `false` so this
    /// diagnostic contract retains its original meaning.
    pub fn query_index_enabled(&self) -> bool {
        self.query_index.has_full_index()
    }

    /// Returns the first document-order `id` match below `scope` from the
    /// optional shared index.
    ///
    /// The maintenance layer admits only light-document-tree entries. The
    /// explicit comparison is kept as a defensive ordering guarantee rather
    /// than trusting mutation history when duplicate ids exist.
    pub(crate) fn indexed_element_by_id(
        &self,
        scope: NodeId,
        id: &str,
    ) -> Result<Option<NodeId>, CoreError> {
        let mut first = None;
        if let Some(matches) = self.query_index.matches_for_id(id) {
            for &candidate in matches {
                if !self.is_descendant_of(candidate, scope)? {
                    continue;
                }
                if first.is_none_or(|current| self.precedes(candidate, current)) {
                    first = Some(candidate);
                }
            }
        }
        Ok(first)
    }

    /// Whether `scope` belongs to the one light document tree represented by
    /// the shared index. Other valid query roots (detached elements/fragments
    /// and shadow roots) deliberately use traversal.
    fn scope_uses_document_index(&self, scope: NodeId) -> Result<bool, CoreError> {
        let Some(root) = self.cached_document_root() else {
            return Ok(false);
        };
        Ok(scope == root || self.is_descendant_of(scope, root)?)
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

    /// Allocation-free tag counterpart of [`Document::traverse_by_tag`].
    fn traverse_count_by_tag(&self, scope: NodeId, name: &str) -> Result<u32, CoreError> {
        let mut count = 0_u32;
        self.walk_collection_descendants_no_alloc(scope, |doc, node| {
            if doc.node_type(node)? == NodeType::Element
                && (name == "*" || doc.node_name(node)?.eq_ignore_ascii_case(name))
            {
                count += 1;
            }
            Ok(())
        })?;
        Ok(count)
    }

    /// Result-allocation-free class counterpart of
    /// [`Document::traverse_by_class`].
    fn traverse_count_by_class(&self, scope: NodeId, name: &str) -> Result<u32, CoreError> {
        let tokens: Vec<&str> = name.split_ascii_whitespace().collect();
        let mut count = 0_u32;
        self.walk_collection_descendants_no_alloc(scope, |doc, node| {
            if doc.node_type(node)? == NodeType::Element
                && element_has_all_classes_adaptive(doc, node, &tokens)?
            {
                count += 1;
            }
            Ok(())
        })?;
        Ok(count)
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

    /// Result-allocation-free count counterpart of
    /// [`Document::indexed_by_class`].
    fn indexed_count_by_class(&self, scope: NodeId, name: &str) -> u32 {
        let tokens: Vec<&str> = name.split_ascii_whitespace().collect();
        let Some(smallest) = tokens
            .iter()
            .copied()
            .min_by_key(|token| self.query_index.by_class.get(*token).map_or(0, Vec::len))
        else {
            return 0;
        };
        let Some(candidates) = self.query_index.by_class.get(smallest) else {
            return 0;
        };

        // Index vectors are document-ordered, not NodeId-ordered, so binary
        // search is invalid after a tree reorder. Hash each other token list
        // once instead of scanning it for every candidate (quadratic for
        // dense multi-class queries).
        let other_sets: Vec<HashSet<NodeId>> = tokens
            .iter()
            .copied()
            .filter(|&token| token != smallest)
            .map(|token| {
                self.query_index
                    .by_class
                    .get(token)
                    .map(|matches| matches.iter().copied().collect())
                    .unwrap_or_default()
            })
            .collect();

        let mut count = 0_u32;
        for &element in candidates {
            if self.in_scope(element, scope)
                && other_sets.iter().all(|matches| matches.contains(&element))
            {
                count += 1;
            }
        }
        count
    }

    /// Whether `node` is a proper descendant of `scope` (so never the scope
    /// itself).
    fn in_scope(&self, node: NodeId, scope: NodeId) -> bool {
        self.is_descendant_of(node, scope).unwrap_or(false)
    }

    // ------------------------------------------------------------------
    // Index maintenance (the single place every write funnels through).
    // ------------------------------------------------------------------

    /// Builds the full index in local state, publishing nothing until the
    /// complete document-order traversal succeeds.
    fn build_full_query_index(&self) -> Result<QueryIndex, CoreError> {
        let mut index = QueryIndex {
            mode: QueryIndexMode::Full,
            ..QueryIndex::default()
        };
        let Some(root) = self.cached_document_root() else {
            return Ok(index);
        };
        let mut stack: Vec<NodeId> = self.children(root)?.into_iter().rev().collect();
        while let Some(node) = stack.pop() {
            if self.node_type(node)? == NodeType::Element {
                index.all_elements.push(node);
                for (kind, value) in self.index_keys_for(node)? {
                    index.push_key(&kind, &value, node);
                }
            }
            for &child in self.children(node)?.iter().rev() {
                stack.push(child);
            }
        }
        Ok(index)
    }

    /// Builds only `by_id` in local state for the adaptive lookup mode.
    fn build_id_query_index(&self) -> Result<QueryIndex, CoreError> {
        let mut index = QueryIndex {
            mode: QueryIndexMode::IdOnly,
            ..QueryIndex::default()
        };
        let Some(root) = self.cached_document_root() else {
            return Ok(index);
        };
        let mut stack: Vec<NodeId> = self.children(root)?.into_iter().rev().collect();
        while let Some(node) = stack.pop() {
            if self.node_type(node)? == NodeType::Element {
                if let Some(id) = self.get_attribute(node, "id")? {
                    index.push_key("id", id, node);
                }
            }
            for &child in self.children(node)?.iter().rev() {
                stack.push(child);
            }
        }
        Ok(index)
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

    /// Id-only maintenance counterpart that never allocates class/tag keys or
    /// touches the full-index vectors.
    fn id_index_insert_element(&mut self, el: NodeId) -> Result<(), CoreError> {
        let Some(id) = self.get_attribute(el, "id")?.map(str::to_owned) else {
            return Ok(());
        };
        self.index_insert_into_key("id", &id, el)
    }

    fn id_index_remove_element(&mut self, el: NodeId) -> Result<(), CoreError> {
        if let Some(id) = self.get_attribute(el, "id")?.map(str::to_owned) {
            self.query_index.remove_key("id", &id, el);
        }
        Ok(())
    }

    /// Adds `el` to a single key (used when an attribute write introduces a
    /// new id/class token on an element in the light document tree).
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

    /// The `(kind, value)` index keys `el` currently belongs to, derived from
    /// its live id/class attributes and its local name.
    fn index_keys_for(&self, el: NodeId) -> Result<Vec<(String, String)>, CoreError> {
        let mut keys = Vec::new();
        if let Some(id) = self.get_attribute(el, "id")? {
            keys.push(("id".to_string(), id.to_string()));
        }
        if let Some(class) = self.get_attribute(el, "class")? {
            let mut seen = HashSet::new();
            for token in class.split_ascii_whitespace() {
                if seen.insert(token) {
                    keys.push(("class".to_string(), token.to_string()));
                }
            }
        }
        keys.push(("tag".to_string(), self.node_name(el)?.to_ascii_lowercase()));
        Ok(keys)
    }

    /// Whether `node` belongs to the light document tree represented by the
    /// optional index. A parent alone is insufficient: detached fragments and
    /// shadow roots own child trees but must not pollute document-order lists.
    fn is_in_document_tree(&self, node: NodeId) -> Result<bool, CoreError> {
        let Some(root) = self.cached_document_root() else {
            return Ok(false);
        };
        Ok(node == root || self.is_descendant_of(node, root)?)
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
    /// nodes in this document's light tree (the index never holds disconnected
    /// or shadow-tree elements).
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
        if !self.query_index.has_id_index() {
            return Ok(());
        }
        let mut stack: Vec<NodeId> = vec![node];
        while let Some(cur) = stack.pop() {
            if self.node_type(cur)? == NodeType::Element {
                if self.query_index.has_full_index() {
                    self.index_remove_element(cur)?;
                } else {
                    self.id_index_remove_element(cur)?;
                }
            }
            for &child in self.children(cur)?.iter().rev() {
                stack.push(child);
            }
        }
        Ok(())
    }

    /// Adds the subtrees rooted at `nodes` when they have just entered the
    /// light document tree; called from
    /// [`crate::dom::Document::link_detached_chain_between`]. Attachments under
    /// disconnected/shadow roots and calls while the index is disabled are
    /// no-ops.
    pub(crate) fn index_subtree_attached(&mut self, nodes: &[NodeId]) -> Result<(), CoreError> {
        if !self.query_index.has_id_index() {
            return Ok(());
        }
        for &root in nodes {
            if !self.is_in_document_tree(root)? {
                continue;
            }
            let mut stack: Vec<NodeId> = vec![root];
            while let Some(cur) = stack.pop() {
                if self.node_type(cur)? == NodeType::Element {
                    if self.query_index.has_full_index() {
                        self.index_insert_element(cur)?;
                    } else {
                        self.id_index_insert_element(cur)?;
                    }
                }
                for &child in self.children(cur)?.iter().rev() {
                    stack.push(child);
                }
            }
        }
        Ok(())
    }

    /// Adds a single light-document-tree element to the index without touching
    /// its subtree, whose entries were already maintained by the mutation that
    /// moved the subtree (a no-op outside that tree or when disabled).
    ///
    /// Used by the T42 define-after-connect replacement: it reparents a
    /// connected candidate's children onto a fresh replacement element (their
    /// index entries stay valid — the subtree never leaves the document and
    /// keeps its document order) and therefore only needs to index the
    /// replacement itself.
    pub(crate) fn index_element_attached(&mut self, el: NodeId) -> Result<(), CoreError> {
        if !self.query_index.has_id_index() {
            return Ok(());
        }
        if !self.is_in_document_tree(el)? {
            return Ok(());
        }
        if self.query_index.has_full_index() {
            self.index_insert_element(el)
        } else {
            self.id_index_insert_element(el)
        }
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
        if !self.query_index.has_id_index() {
            return Ok(());
        }
        match name {
            "id" => {
                if let Some(old) = old {
                    self.query_index.remove_key("id", old, id);
                }
                if let Some(new) = new {
                    if self.is_in_document_tree(id)? {
                        self.index_insert_into_key("id", new, id)?;
                    }
                }
            }
            "class" => {
                if !self.query_index.has_full_index() {
                    return Ok(());
                }
                if let Some(old) = old {
                    for token in old.split_ascii_whitespace() {
                        self.query_index.remove_key("class", token, id);
                    }
                }
                if self.is_in_document_tree(id)? {
                    if let Some(new) = new {
                        let mut seen = HashSet::new();
                        for token in new.split_ascii_whitespace() {
                            if seen.insert(token) {
                                self.index_insert_into_key("class", token, id)?;
                            }
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

    /// Visits every descendant without allocating the explicit stack used by
    /// the node-producing query. Parent/first-child/next-sibling links are
    /// sufficient to advance in document pre-order while staying below
    /// `root`.
    fn walk_collection_descendants_no_alloc(
        &self,
        root: NodeId,
        mut visit: impl FnMut(&Document, NodeId) -> Result<(), CoreError>,
    ) -> Result<(), CoreError> {
        let mut current = self.first_child(root)?;
        while let Some(node) = current {
            visit(self, node)?;
            if let Some(child) = self.first_child(node)? {
                current = Some(child);
                continue;
            }

            let mut cursor = node;
            loop {
                if let Some(sibling) = self.next_sibling(cursor)? {
                    current = Some(sibling);
                    break;
                }
                let Some(parent) = self.parent(cursor)? else {
                    return Ok(());
                };
                if parent == root {
                    return Ok(());
                }
                cursor = parent;
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

/// Count-path matcher: short class queries avoid a per-element `HashSet`, while
/// longer queries use the set-based matcher rather than degrading to a
/// required-token × present-token scan.
fn element_has_all_classes_adaptive(
    doc: &Document,
    el: NodeId,
    tokens: &[&str],
) -> Result<bool, CoreError> {
    if tokens.len() > 8 {
        return element_has_all_classes(doc, el, tokens);
    }
    let Some(class) = doc.get_attribute(el, "class")? else {
        return Ok(false);
    };
    Ok(tokens.iter().all(|required| {
        class
            .split_ascii_whitespace()
            .any(|present| present == *required)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dom::ShadowRootMode;

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

    fn id_index_matches_traversal(doc: &Document) -> Result<bool, CoreError> {
        let mut by_id: HashMap<String, Vec<NodeId>> = HashMap::new();
        for el in traversal_elements(doc) {
            if let Some(id) = doc.get_attribute(el, "id")? {
                by_id.entry(id.to_owned()).or_default().push(el);
            }
        }
        Ok(doc.query_index.mode == QueryIndexMode::IdOnly
            && doc.query_index.by_id == by_id
            && doc.query_index.by_class.is_empty()
            && doc.query_index.by_tag.is_empty()
            && doc.query_index.all_elements.is_empty())
    }

    #[test]
    fn enabling_the_index_builds_it_from_the_current_tree() {
        let mut doc = corpus();
        doc.set_query_index_enabled(true).unwrap();
        assert_eq!(doc.query_index.mode, QueryIndexMode::Full);
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
        assert_eq!(doc.query_index.mode, QueryIndexMode::Off);
        assert!(doc.query_index.by_id.is_empty());
        let traversed = doc.get_elements_by_tag_name(root, "p").unwrap();
        assert_eq!(indexed, traversed);
    }

    #[test]
    fn adaptive_id_index_mode_transitions_are_idempotent_and_exact() {
        let mut clean = Document::new();
        assert_eq!(clean.query_index.mode, QueryIndexMode::Off);
        clean.prepare_adaptive_get_element_by_id().unwrap();
        assert_eq!(clean.query_index.mode, QueryIndexMode::IdOnly);
        assert!(!clean.query_index_enabled());
        assert!(clean.cached_document_root().is_none());
        assert_eq!(clean.get_element_by_id("missing").unwrap(), None);

        let mut doc = corpus();
        doc.prepare_adaptive_document_query_selector(".x").unwrap();
        assert_eq!(doc.query_index.mode, QueryIndexMode::Off);
        doc.prepare_adaptive_document_query_selector("#p1").unwrap();
        assert!(id_index_matches_traversal(&doc).unwrap());

        let id_snapshot = doc.query_index.by_id.clone();
        doc.prepare_adaptive_get_element_by_id().unwrap();
        doc.prepare_adaptive_document_query_selector("#p1").unwrap();
        assert_eq!(doc.query_index.by_id, id_snapshot);

        doc.set_query_index_enabled(true).unwrap();
        assert_eq!(doc.query_index.mode, QueryIndexMode::Full);
        assert!(doc.query_index_enabled());
        assert!(index_matches_traversal(&doc).unwrap());
        let full_id_snapshot = doc.query_index.by_id.clone();
        doc.set_query_index_enabled(true).unwrap();
        doc.ensure_id_query_index_enabled().unwrap();
        assert_eq!(doc.query_index.mode, QueryIndexMode::Full);
        assert_eq!(doc.query_index.by_id, full_id_snapshot);
        assert!(index_matches_traversal(&doc).unwrap());

        doc.set_query_index_enabled(false).unwrap();
        assert_eq!(doc.query_index.mode, QueryIndexMode::Off);
        assert!(doc.query_index.by_id.is_empty());
        assert!(doc.query_index.by_class.is_empty());
        assert!(doc.query_index.by_tag.is_empty());
        assert!(doc.query_index.all_elements.is_empty());
        doc.set_query_index_enabled(false).unwrap();
        assert_eq!(doc.query_index.mode, QueryIndexMode::Off);
    }

    #[test]
    fn adaptive_id_index_tracks_duplicate_order_moves_detach_and_id_changes() {
        let mut doc = corpus();
        let document_root = doc.document_root();
        let root = doc.get_element_by_id("root").unwrap().unwrap();
        let p1 = doc.get_element_by_id("p1").unwrap().unwrap();
        let s1 = doc.get_element_by_id("s1").unwrap().unwrap();
        doc.prepare_adaptive_document_query_selector("#p1").unwrap();

        doc.set_attribute(s1, "id", "p1").unwrap();
        assert_eq!(doc.get_element_by_id("p1").unwrap(), Some(p1));
        assert_eq!(doc.query_selector(document_root, "#p1").unwrap(), Some(p1));
        doc.append_child(root, p1).unwrap();
        assert_eq!(doc.get_element_by_id("p1").unwrap(), Some(s1));

        doc.remove_attribute(s1, "id").unwrap();
        assert_eq!(doc.get_element_by_id("p1").unwrap(), Some(p1));
        doc.remove_child(root, p1).unwrap();
        assert_eq!(doc.get_element_by_id("p1").unwrap(), None);
        doc.set_attribute(p1, "id", "renamed").unwrap();
        doc.append_child(root, p1).unwrap();
        assert_eq!(doc.get_element_by_id("renamed").unwrap(), Some(p1));
        assert!(id_index_matches_traversal(&doc).unwrap());
    }

    #[test]
    fn adaptive_id_index_tracks_parser_replacement_and_non_light_trees() {
        let mut doc = corpus();
        let body = doc.document_body().unwrap().unwrap();
        doc.prepare_adaptive_get_element_by_id().unwrap();

        let fragment = doc.create_document_fragment().unwrap();
        let detached = doc.create_element("p").unwrap();
        doc.set_attribute(detached, "id", "outside").unwrap();
        doc.append_child(fragment, detached).unwrap();
        assert_eq!(doc.get_element_by_id("outside").unwrap(), None);

        let host = doc.create_element("div").unwrap();
        let shadow = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
        let shadow_match = doc.create_element("p").unwrap();
        doc.set_attribute(shadow_match, "id", "shadow-only")
            .unwrap();
        doc.append_child(shadow, shadow_match).unwrap();
        doc.append_child(body, host).unwrap();
        assert_eq!(doc.get_element_by_id("shadow-only").unwrap(), None);

        doc.append_child(body, fragment).unwrap();
        assert_eq!(doc.get_element_by_id("outside").unwrap(), Some(detached));
        assert!(id_index_matches_traversal(&doc).unwrap());

        doc.set_inner_html(
            body,
            "<main id='parsed'><p id='duplicate'></p><p id='duplicate'></p></main>",
        )
        .unwrap();
        assert_eq!(doc.get_element_by_id("root").unwrap(), None);
        assert!(doc.get_element_by_id("parsed").unwrap().is_some());
        assert!(doc.get_element_by_id("duplicate").unwrap().is_some());
        assert!(id_index_matches_traversal(&doc).unwrap());

        doc.load_html("<!doctype html><html><body><section id='loaded'></section></body></html>")
            .unwrap();
        assert_eq!(doc.get_element_by_id("parsed").unwrap(), None);
        assert!(doc.get_element_by_id("loaded").unwrap().is_some());
        assert!(id_index_matches_traversal(&doc).unwrap());
    }

    #[test]
    fn adaptive_id_index_tracks_cross_document_adoption() {
        let mut source = Document::new();
        source.ensure_html_skeleton().unwrap();
        let source_body = source.document_body().unwrap().unwrap();
        let moved = source.create_element("article").unwrap();
        source.set_attribute(moved, "id", "moved").unwrap();
        source.append_child(source_body, moved).unwrap();
        source.prepare_adaptive_get_element_by_id().unwrap();

        let mut target = corpus();
        target.prepare_adaptive_get_element_by_id().unwrap();
        let target_body = target.document_body().unwrap().unwrap();
        let adopted = target.adopt_node(&mut source, moved).unwrap();
        assert_eq!(source.get_element_by_id("moved").unwrap(), None);
        assert_eq!(target.get_element_by_id("moved").unwrap(), None);
        target.append_child(target_body, adopted).unwrap();
        assert_eq!(target.get_element_by_id("moved").unwrap(), Some(adopted));
        assert!(id_index_matches_traversal(&source).unwrap());
        assert!(id_index_matches_traversal(&target).unwrap());
    }
}
