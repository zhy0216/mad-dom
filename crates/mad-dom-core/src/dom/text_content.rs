//! `textContent` Core module (T25C).
//!
//! Implements the WHATWG `Node.textContent` getter/setter contract for the
//! first batch of node types on top of the T25A payload seam. Reads are
//! produced on the fly from the arena and never mutate or copy DOM state;
//! writes go through the unified text/mutation entries, so a failed call never
//! leaves a partial replacement.
//!
//! # Getter ([`Document::text_content`])
//!
//! * a `Document` node reads as `None` (the WHATWG property is null);
//! * a `Text` or `Comment` node reads its own character data;
//! * an `Element` or `DocumentFragment` reads the concatenation of every
//!   descendant `Text` node's data in tree order; comments are excluded.
//!
//! The read walks the tree through the public navigation API
//! ([`Document::children`], [`Document::get`]) plus the read accessors
//! [`NodeData::text_data`] / [`NodeData::comment_data`]. The walk is
//! iterative, so arbitrarily deep trees cannot overflow the call stack.
//!
//! # Setter ([`Document::set_text_content`])
//!
//! * a `Document` node is a no-op (the WHATWG setter on a Document does
//!   nothing);
//! * a `Text` or `Comment` node updates its data in place through the
//!   crate-internal [`Document::set_character_data`] entry, which validates
//!   ownership, node kind and text-data well-formedness (rejecting NUL with
//!   [`CoreError::InvalidCharacter`]) before the single data field is written;
//! * an `Element` or `DocumentFragment` replaces all of its children with a
//!   single text node holding the value (WHATWG "string replace all") via the
//!   unified mutation API ([`Document::create_text`],
//!   [`Document::remove_child`], [`Document::append_child`]). The text node is
//!   created and its data validated before the child list is touched, so a
//!   failure never leaves a partial replacement; an empty value removes all
//!   children and inserts no text node.
//!
//! The binding layer is responsible for the JS-level string conversion of the
//! setter value: the WHATWG setter steps act as if a `null` value were the
//! empty string, which this entry reaches as `""`.
//!
//! # Error and atomicity boundary
//!
//! A foreign handle fails with [`CoreError::WrongDocument`], a stale handle
//! with [`CoreError::Arena`], and a NUL byte in the setter value fails with
//! [`CoreError::InvalidCharacter`] while leaving the target unchanged. No raw
//! arena pointer escapes this crate and there is no second text state.
//!
//! Owned by **T25C**; integration gate: **T25**. T25C may only edit this file
//! and its dedicated tests (`tests/t25_text_content.rs`); it must not modify
//! `node.rs`, `document.rs`, `mod.rs` or the sibling `attributes.rs`.
//! Dependency rules: [`super::document`], [`super::node`], [`super::mutation`].

use crate::arena::NodeId;
use crate::error::CoreError;

use super::node::{NodeData, NodeType};
use super::Document;

impl Document {
    /// Returns the `textContent` of the node for `id`.
    ///
    /// Mirrors the WHATWG `Node.textContent` getter: a `Document` node has no
    /// text content and reads as `None`; a `Text` or `Comment` node reads its
    /// own data; an `Element` or `DocumentFragment` reads the concatenation of
    /// every descendant `Text` node's data in tree order (comments are
    /// excluded). The string is produced on demand from the arena; reading
    /// never mutates the tree.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    pub fn text_content(&self, id: NodeId) -> Result<Option<String>, CoreError> {
        let node = self.get(id)?;
        match node.data().node_type() {
            NodeType::Document => Ok(None),
            NodeType::Text => Ok(Some(
                node.data().text_data().unwrap_or_default().to_string(),
            )),
            NodeType::Comment => Ok(Some(
                node.data().comment_data().unwrap_or_default().to_string(),
            )),
            NodeType::Element | NodeType::DocumentFragment => {
                let mut out = String::new();
                self.collect_descendant_text(id, &mut out)?;
                Ok(Some(out))
            }
        }
    }

    /// Sets the `textContent` of the node for `id` to `value`.
    ///
    /// Mirrors the WHATWG `Node.textContent` setter: a `Document` node is a
    /// no-op; a `Text` or `Comment` node has its data replaced atomically
    /// through the Core text seam; an `Element` or `DocumentFragment` has all
    /// of its children replaced by a single text node holding `value` (an
    /// empty value removes every child and inserts no text node). The
    /// replacement is all-or-nothing: the text node is created and `value`
    /// validated before the child list is touched, so a failed call leaves the
    /// node byte-for-byte unchanged.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    /// * [`CoreError::InvalidCharacter`] when `value` contains a NUL character.
    pub fn set_text_content(&mut self, id: NodeId, value: &str) -> Result<(), CoreError> {
        let kind = self.get(id)?.data().node_type();
        match kind {
            NodeType::Document => Ok(()),
            NodeType::Text | NodeType::Comment => self.set_character_data(id, value),
            NodeType::Element | NodeType::DocumentFragment => {
                // WHATWG "string replace all": create the single replacement
                // text node (validating its data) before touching the child
                // list, so a rejected value leaves every child in place.
                let text = if value.is_empty() {
                    None
                } else {
                    Some(self.create_text(value)?)
                };
                let children = self.children(id)?;
                for &child in &children {
                    self.remove_child(id, child)?;
                }
                if let Some(t) = text {
                    self.append_child(id, t)?;
                }
                Ok(())
            }
        }
    }

    /// Appends the data of every descendant `Text` node of `root` (in tree
    /// order) to `out`.
    ///
    /// The walk is an iterative preorder traversal over the public navigation
    /// API, so arbitrarily deep trees cannot overflow the call stack; `Text`
    /// nodes contribute their data and every other node is descended into, so
    /// comments and nested containers contribute nothing themselves.
    fn collect_descendant_text(&self, root: NodeId, out: &mut String) -> Result<(), CoreError> {
        let mut stack = vec![root];
        while let Some(n) = stack.pop() {
            match self.get(n)?.data() {
                NodeData::Text { data } => out.push_str(data),
                _ => {
                    let children = self.children(n)?;
                    for &child in children.iter().rev() {
                        stack.push(child);
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_node_text_content_reads_as_null() {
        let mut doc = Document::new();
        let doc_node = doc.create_document_node_for_test();
        assert_eq!(doc.text_content(doc_node).unwrap(), None);
    }

    #[test]
    fn document_node_text_content_setter_is_a_noop() {
        let mut doc = Document::new();
        let doc_node = doc.create_document_node_for_test();
        assert_eq!(doc.set_text_content(doc_node, "anything").unwrap(), ());
        assert_eq!(doc.node_type(doc_node).unwrap(), NodeType::Document);
        assert_eq!(doc.children(doc_node).unwrap(), Vec::<NodeId>::new());
        assert_eq!(doc.text_content(doc_node).unwrap(), None);
    }

    #[test]
    fn deep_tree_text_content_does_not_overflow() {
        let mut doc = Document::new();
        let root = doc.create_element("root").unwrap();
        let mut cur = root;
        for _ in 0..200_000 {
            let child = doc.create_element("n").unwrap();
            doc.append_child_for_test(cur, child);
            cur = child;
        }
        let leaf = doc.create_text("deep").unwrap();
        doc.append_child_for_test(cur, leaf);

        assert_eq!(doc.text_content(root).unwrap(), Some("deep".to_string()));
        assert_eq!(doc.check_invariants(root).unwrap(), ());
    }
}
