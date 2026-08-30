//! HTMLElement interaction state: connectivity and active-element tracking (T39).
//!
//! This module implements the Core half of the T39 HTMLElement base surface.
//! The reflected attribute accessors (`id` / `title` / `dir` / `hidden` /
//! `tabIndex` / `dataset`, ...) carry **no Core state of their own**: they read
//! and write the existing attribute storage through
//! [`Document::get_attribute`] / [`Document::set_attribute`] /
//! [`Document::remove_attribute`], so the two-way sync is the attribute
//! contract itself (T25B) and the arena stays the single source of truth.
//!
//! What this module owns is the *interaction* state the facade cannot derive
//! from a single attribute:
//!
//! - [`Document::is_connected`] — whether a node's root ancestor is the
//!   `Document` node (the happy-dom `isConnected` predicate behind the
//!   `focus`/`blur` no-op rules);
//! - [`Document::is_inert`] — whether the node or any ancestor carries the
//!   `inert` attribute (the happy-dom focus no-op rule);
//! - the document's *active element* ([`Document::active_element`] /
//!   [`Document::set_active_element`]) — the per-document `document.activeElement`
//!   state the `focus`/`blur` facade reads and writes.
//!
//! The event dispatch itself (`focus`/`focusin`/`blur`/`focusout`) stays in the
//! binding + facade on top of the T37 propagation engine; this module only
//! decides *whether* an operation proceeds and keeps the one mutable cell the
//! facade transitions through the happy-dom sequence.
//!
//! # Error semantics
//!
//! Every entry validates document ownership and arena liveness through the
//! shared `Document` navigation/attribute entries, so a foreign or stale handle
//! fails with [`CoreError::WrongDocument`] / [`CoreError::Arena`]. These reads
//! never mutate the tree; [`Document::active_element`] is the only entry that
//! may write (clearing a stored active element that is no longer connected,
//! the happy-dom read semantics).

use crate::arena::NodeId;
use crate::error::CoreError;

use super::Document;
use super::NodeType;

impl Document {
    /// Returns whether the node for `id` is connected to this document: its
    /// root ancestor (the top of its parent chain) is the `Document` node.
    ///
    /// A detached element, a fragment or any node whose parent chain ends at a
    /// non-document node is *not* connected. This is a pure read; it never
    /// modifies the tree.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn is_connected(&self, id: NodeId) -> Result<bool, CoreError> {
        let mut cursor = id;
        loop {
            match self.get(cursor)?.parent() {
                None => {
                    return Ok(self.node_type(cursor)? == NodeType::Document);
                }
                Some(parent) => cursor = parent,
            }
        }
    }

    /// Returns whether the node for `id` or any of its ancestors carries the
    /// `inert` attribute (the happy-dom `HTMLElementUtility.isInert` rule the
    /// `focus` no-op predicate uses).
    ///
    /// Only `Element` nodes are inspected — the `Document` root terminates the
    /// walk without matching. This is a pure read; it never modifies the tree.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn is_inert(&self, id: NodeId) -> Result<bool, CoreError> {
        let mut cursor = Some(id);
        while let Some(current) = cursor {
            if self.get(current)?.node_type() == NodeType::Element
                && self.get_attribute(current, "inert")?.is_some()
            {
                return Ok(true);
            }
            cursor = self.get(current)?.parent();
        }
        Ok(false)
    }

    /// Returns the document's stored active element, clearing it when it is no
    /// longer connected (the happy-dom `document.activeElement` read
    /// semantics: a focused element that left the tree is forgotten on read).
    ///
    /// `Ok(None)` when nothing is focused (or the stored element was dropped).
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale stored id.
    pub fn active_element(&mut self) -> Result<Option<NodeId>, CoreError> {
        if let Some(id) = self.active_element_id {
            if !self.is_connected(id)? {
                self.active_element_id = None;
                return Ok(None);
            }
        }
        Ok(self.active_element_id)
    }

    /// Sets (or, with `None`, clears) the document's stored active element.
    ///
    /// The caller decides connectivity and inertness beforehand; this entry is
    /// the single mutation point the `focus`/`blur` facade transitions
    /// through, so the active element can never be changed behind the facade's
    /// back.
    pub fn set_active_element(&mut self, id: Option<NodeId>) {
        self.active_element_id = id;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a connected body under the document root and returns the body id.
    ///
    /// The unified mutation API rejects a `Document` parent, so the tree is
    /// linked with the test-only relation helper (same shape the T29 implied
    /// skeleton and the parser produce).
    fn connected_body(doc: &mut Document) -> NodeId {
        let root = doc.document_root();
        let html = doc.create_element("html").unwrap();
        let body = doc.create_element("body").unwrap();
        doc.append_child_for_test(root, html);
        doc.append_child_for_test(html, body);
        body
    }

    #[test]
    fn detached_elements_are_not_connected() {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();
        assert!(!doc.is_connected(el).unwrap());
    }

    #[test]
    fn elements_under_the_document_root_are_connected() {
        let mut doc = Document::new();
        let body = connected_body(&mut doc);
        let el = doc.create_element("div").unwrap();
        doc.append_child(body, el).unwrap();
        assert!(doc.is_connected(el).unwrap());
        assert!(doc.is_connected(body).unwrap());
        let root = doc.document_root();
        assert!(doc.is_connected(root).unwrap());
    }

    #[test]
    fn a_fragment_or_comment_is_never_connected() {
        let mut doc = Document::new();
        let frag = doc.create_document_fragment().unwrap();
        let comment = doc.create_comment("note").unwrap();
        assert!(!doc.is_connected(frag).unwrap());
        assert!(!doc.is_connected(comment).unwrap());
    }

    #[test]
    fn active_element_reads_clear_a_detached_focus() {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();
        doc.set_active_element(Some(el));
        assert_eq!(
            doc.active_element().unwrap(),
            None,
            "detached focus is forgotten"
        );
    }

    #[test]
    fn active_element_tracks_and_clears() {
        let mut doc = Document::new();
        let body = connected_body(&mut doc);
        let a = doc.create_element("a").unwrap();
        let b = doc.create_element("b").unwrap();
        doc.append_child(body, a).unwrap();
        doc.append_child(body, b).unwrap();

        doc.set_active_element(Some(a));
        assert_eq!(doc.active_element().unwrap(), Some(a));
        doc.set_active_element(Some(b));
        assert_eq!(doc.active_element().unwrap(), Some(b));
        doc.set_active_element(None);
        assert_eq!(doc.active_element().unwrap(), None);
    }

    #[test]
    fn is_inert_checks_the_ancestor_chain() {
        let mut doc = Document::new();
        let body = connected_body(&mut doc);
        let section = doc.create_element("section").unwrap();
        doc.append_child(body, section).unwrap();
        let el = doc.create_element("div").unwrap();
        doc.append_child(section, el).unwrap();

        assert!(!doc.is_inert(el).unwrap());
        doc.set_attribute(section, "inert", "").unwrap();
        assert!(
            doc.is_inert(el).unwrap(),
            "an inert ancestor makes the node inert"
        );
        doc.remove_attribute(section, "inert").unwrap();
        assert!(!doc.is_inert(el).unwrap());
    }

    #[test]
    fn foreign_and_stale_handles_fail_structured() {
        let mut a = Document::new();
        let mut b = Document::new();
        let el = a.create_element("div").unwrap();
        assert!(matches!(
            b.is_connected(el),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            b.is_inert(el),
            Err(CoreError::WrongDocument { .. })
        ));
        b.create_element("x").unwrap();
        let bogus = crate::arena::NodeId::new(b.id(), u32::MAX, 0);
        assert!(matches!(b.is_connected(bogus), Err(CoreError::Arena(_))));
        assert!(matches!(b.is_inert(bogus), Err(CoreError::Arena(_))));
    }

    /// Ensures the payload seam is exercised (element attributes for inert) and
    /// that the element/attribute helpers used above stay valid.
    #[test]
    fn inert_presence_is_attribute_driven() {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();
        assert_eq!(doc.get_attribute(el, "inert").unwrap(), None);
        doc.set_attribute(el, "inert", "x").unwrap();
        assert_eq!(doc.get_attribute(el, "inert").unwrap(), Some("x"));
        assert!(doc.is_inert(el).unwrap());
    }

    #[test]
    fn node_type_helper_is_reachable() {
        let mut doc = Document::new();
        let root = doc.document_root();
        assert_eq!(doc.node_type(root).unwrap(), NodeType::Document);
        assert!(doc.is_connected(root).unwrap());
    }
}
