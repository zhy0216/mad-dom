//! Document-order selector queries (T31).
//!
//! Implements the Core half of `querySelector` / `querySelectorAll`,
//! `Element.matches` / `Element.closest` and `Document.getElementById` on top
//! of the T30 parser and arena matcher. General selector strings are parsed
//! exactly once (with [`parse_selector_list`](super::parser::parse_selector_list));
//! the common document-scoped plain `#id` subset goes straight to
//! `getElementById`. The arena tree is walked in document (pre) order,
//! matching elements against the pre-parsed selector list through
//! [`match_selector_list`](super::matcher::match_selector_list) — the same
//! "no mirror tree" contract the matcher already follows.
//!
//! # Static query results
//!
//! [`Document::query_selector_all`] collects its matches into a plain
//! `Vec<NodeId>` during one traversal, so the result is a *static snapshot*:
//! a later mutation of the tree never changes an already-returned result (the
//! WHATWG static `NodeList` semantics). General selector matching does not use
//! the T32 full live-collection index; document-scoped plain `#id` reads and
//! `getElementById` instead share an adaptive, mutation-maintained id-only
//! index.
//!
//! # Scopes and receivers
//!
//! * `querySelector` / `querySelectorAll` run on a `ParentNode` scope — an
//!   `Element`, the `Document`-kind root, or a `DocumentFragment` — and
//!   consider the scope's *descendants* only (the context object itself is
//!   never a candidate). Any other node kind fails with
//!   [`CoreError::Hierarchy`], matching the single-class facade model where a
//!   `Text`/`Comment` node reaches Core for every method.
//! * `matches` / `closest` require an `Element` receiver
//!   ([`CoreError::Hierarchy`] otherwise); `closest` starts at the receiver
//!   itself and walks up the ancestor chain.
//! * `getElementById` searches the whole document (the descendants of the
//!   document root) in document order and returns the first element whose `id`
//!   attribute equals the argument, or `None`.

use selectors::parser::SelectorList;

use crate::arena::NodeId;
use crate::dom::{Document, NodeType};
use crate::error::CoreError;

use super::matcher::{match_selector_list, match_selector_list_with_scope};
use super::parser::{parse_selector_list, DomSelectorImpl};

/// Whether a node kind may act as a `ParentNode` query scope.
fn is_query_scope(node_type: NodeType) -> bool {
    matches!(
        node_type,
        NodeType::Element | NodeType::Document | NodeType::DocumentFragment | NodeType::ShadowRoot
    )
}

/// Extracts the id from the common, unescaped ASCII `#id` selector subset.
///
/// Keeping this deliberately narrower than the full CSS identifier grammar
/// makes the fast path self-validating. Escapes, non-ASCII identifiers and
/// selector lists continue through the standards parser below.
fn simple_ascii_id_selector(selector: &str) -> Option<&str> {
    let id = selector.strip_prefix('#')?;
    let mut bytes = id.bytes();
    let first = bytes.next()?;
    if !first.is_ascii_alphabetic() && first != b'_' {
        return None;
    }
    bytes
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        .then_some(id)
}

impl Document {
    /// Prepares the adaptive id-only index for a document-scoped plain `#id`
    /// selector. Other selector shapes are left untouched and continue through
    /// the standards parser. Keeping recognition here makes the preparation
    /// rule identical to the actual simple-id fast path below.
    pub fn prepare_adaptive_document_query_selector(
        &mut self,
        selector: &str,
    ) -> Result<(), CoreError> {
        if simple_ascii_id_selector(selector).is_some() {
            self.ensure_id_query_index_enabled()?;
        }
        Ok(())
    }

    /// Prepares the same id-only index for `getElementById`. This reads only a
    /// cached document root and therefore never materializes the implied HTML
    /// skeleton of a clean document.
    pub fn prepare_adaptive_get_element_by_id(&mut self) -> Result<(), CoreError> {
        self.ensure_id_query_index_enabled()
    }

    /// Returns the first descendant element of `scope`, in document order,
    /// that matches `selector`, or `None` when there is none.
    ///
    /// The context object itself is never a candidate (WHATWG "descendant").
    ///
    /// # Errors
    ///
    /// * [`CoreError::Syntax`] when `selector` is not a valid selector list.
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale `scope`.
    /// * [`CoreError::Hierarchy`] when `scope` is not a `ParentNode` kind
    ///   (an `Element`, the `Document` root or a `DocumentFragment`).
    pub fn query_selector(
        &self,
        scope: NodeId,
        selector: &str,
    ) -> Result<Option<NodeId>, CoreError> {
        // A document-scoped plain id selector is exactly getElementById. This
        // avoids both selector parsing/matching and a full-result allocation;
        // scoped queries still use the matcher because duplicate ids outside
        // the scope must not hide an in-scope match.
        if let Some(id) = simple_ascii_id_selector(selector) {
            self.expect_query_scope(scope)?;
            if self.cached_document_root() == Some(scope) {
                return self.get_element_by_id(id);
            }
        }
        let list = parse_selector_list(selector)?;
        self.query_selector_parsed(scope, &list)
    }

    /// Returns every descendant element of `scope`, in document order, that
    /// matches `selector`.
    ///
    /// The returned vector is a static snapshot collected during this single
    /// traversal; a later mutation of the tree never changes an already
    /// returned result (the WHATWG static `NodeList` semantics).
    ///
    /// # Errors
    ///
    /// As for [`Document::query_selector`].
    pub fn query_selector_all(
        &self,
        scope: NodeId,
        selector: &str,
    ) -> Result<Vec<NodeId>, CoreError> {
        let list = parse_selector_list(selector)?;
        self.query_selector_all_parsed(scope, &list)
    }

    /// Returns whether the element `node` matches `selector` (WHATWG
    /// `Element.matches`).
    ///
    /// Delegates to the T30 matcher; `node` must be an `Element`.
    ///
    /// # Errors
    ///
    /// * [`CoreError::Syntax`] when `selector` is not a valid selector list.
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `node` is not an `Element`.
    pub fn matches(&self, node: NodeId, selector: &str) -> Result<bool, CoreError> {
        super::matches(self, node, selector)
    }

    /// Returns the closest ancestor of `node` — `node` itself included — that
    /// matches `selector`, or `None` when no element on the chain matches
    /// (WHATWG `Element.closest`).
    ///
    /// # Errors
    ///
    /// * [`CoreError::Syntax`] when `selector` is not a valid selector list.
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `node` is not an `Element`.
    pub fn closest(&self, node: NodeId, selector: &str) -> Result<Option<NodeId>, CoreError> {
        let list = parse_selector_list(selector)?;
        self.closest_parsed(node, &list)
    }

    /// Returns the first element in the document, in document order, whose
    /// `id` attribute equals `id`, or `None` when no element carries it
    /// (WHATWG `Document.getElementById`).
    ///
    /// The search covers the descendants of the document root; a document that
    /// has not allocated a root yet returns `None`. This is a pure read and
    /// never materializes the implied HTML skeleton. Once either the adaptive
    /// id-only or full T32 index is prepared, the lookup is served from its id
    /// map (`O(key size)` instead of a traversal) and returns the same first
    /// document-order match; otherwise it uses a document-order walk.
    ///
    /// # Errors
    ///
    /// [`CoreError::Arena`] when a tree handle turns out to be stale (the tree
    /// was corrupted); the public API never produces this, but the walk
    /// propagates it rather than panicking.
    pub fn get_element_by_id(&self, id: &str) -> Result<Option<NodeId>, CoreError> {
        if self.query_index.has_id_index() {
            let Some(root) = self.cached_document_root() else {
                return Ok(None);
            };
            return self.indexed_element_by_id(root, id);
        }
        let Some(root) = self.cached_document_root() else {
            return Ok(None);
        };
        let mut found = None;
        self.walk_descendants(root, |doc, candidate| {
            if doc.node_type(candidate)? != NodeType::Element {
                return Ok(true);
            }
            let matches = doc
                .get_attribute(candidate, "id")?
                .is_some_and(|value| value == id);
            if matches {
                found = Some(candidate);
                return Ok(false);
            }
            Ok(true)
        })?;
        Ok(found)
    }

    /// The parsed-list variant of [`Document::query_selector`]: the caller has
    /// already parsed `list`, so repeated queries reuse one parse.
    fn query_selector_parsed(
        &self,
        scope: NodeId,
        list: &SelectorList<DomSelectorImpl>,
    ) -> Result<Option<NodeId>, CoreError> {
        self.expect_query_scope(scope)?;
        let mut found = None;
        self.walk_descendants(scope, |doc, candidate| {
            if doc.node_type(candidate)? != NodeType::Element {
                return Ok(true);
            }
            // `querySelector` only needs the first document-order match.  Do
            // not build the complete `querySelectorAll` snapshot: stopping
            // the arena walk here is especially important for hot ID probes
            // against large documents.
            if match_selector_list_with_scope(list, doc, candidate, Some(scope))? {
                found = Some(candidate);
                return Ok(false);
            }
            Ok(true)
        })?;
        Ok(found)
    }

    /// The parsed-list variant of [`Document::query_selector_all`].
    fn query_selector_all_parsed(
        &self,
        scope: NodeId,
        list: &SelectorList<DomSelectorImpl>,
    ) -> Result<Vec<NodeId>, CoreError> {
        self.expect_query_scope(scope)?;
        let mut out = Vec::new();
        self.walk_descendants(scope, |doc, candidate| {
            if doc.node_type(candidate)? != NodeType::Element {
                return Ok(true);
            }
            // `:scope` resolves to the query scope element (the context object
            // itself is never a candidate, but it is the scoping element the
            // selector's `:scope` component matches).
            if match_selector_list_with_scope(list, doc, candidate, Some(scope))? {
                out.push(candidate);
            }
            Ok(true)
        })?;
        Ok(out)
    }

    /// The parsed-list variant of [`Document::closest`].
    fn closest_parsed(
        &self,
        node: NodeId,
        list: &SelectorList<DomSelectorImpl>,
    ) -> Result<Option<NodeId>, CoreError> {
        if self.node_type(node)? != NodeType::Element {
            return Err(hierarchy("closest requires an Element node"));
        }
        let mut cursor = Some(node);
        while let Some(candidate) = cursor {
            // The chain runs up to (and including) the `Document` root, which is
            // never a matching element; non-elements are skipped, never errors.
            if self.node_type(candidate)? == NodeType::Element
                && match_selector_list(list, self, candidate)?
            {
                return Ok(Some(candidate));
            }
            cursor = self.parent(candidate)?;
        }
        Ok(None)
    }

    /// Rejects a query scope that is not a `ParentNode` kind.
    fn expect_query_scope(&self, scope: NodeId) -> Result<(), CoreError> {
        if is_query_scope(self.node_type(scope)?) {
            Ok(())
        } else {
            Err(hierarchy(
                "querySelector/querySelectorAll requires an Element, Document or DocumentFragment scope",
            ))
        }
    }

    /// Visits every descendant of `root` (excluding `root` itself) in document
    /// (pre) order, calling `visit` for each. The visitor returns `Ok(false)`
    /// to stop early. Iterative, so deeply nested trees never overflow the
    /// stack (the same guarantee the HTML parser milestone pinned).
    fn walk_descendants(
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

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}
