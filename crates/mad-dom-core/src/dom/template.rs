//! HTMLTemplateElement content association (T40).
//!
//! The WHATWG `HTMLTemplateElement` owns a *template contents*
//! `DocumentFragment` that is deliberately **not** part of the element's
//! ordinary child list: `<template>` children are routed into the fragment by
//! the HTML parser (T26/T27), and the DOM exposes them through `content` (and
//! through the `innerHTML` / `outerHTML` surface). This module owns the one
//! link that keeps those contents reachable — the per-document
//! `template element -> contents fragment` map ([`Document::template_contents`])
//! — plus the read/write entries the binding and the serializer use:
//!
//! - [`Document::is_template`] — whether a node is an HTML-namespace
//!   `<template>` element;
//! - [`Document::template_content`] / [`Document::template_content_id`] — the
//!   (ensure-or-read) contents fragment;
//! - [`Document::set_template_content`] — the crate-internal registration the
//!   parser adoption and the clone/import family write.
//!
//! The contents fragment lives in the same arena as every other node, so no
//! second DOM exists: the map holds ordinary [`NodeId`]s and the serializer
//! and clone/import operations read exactly what the parser and the facade
//! wrote. A `<template>` created programmatically (`createElement`) gets an
//! empty contents fragment at creation; a template parsed from markup gets one
//! through the tree-sink and the T29 apply adoption. Detaching or replacing a
//! template leaves the fragment in the arena (reachable only through the
//! element's wrapper), which is the pre-alpha arena model — there is no GC.
//!
//! # Errors
//!
//! Every entry validates document ownership and arena liveness through the
//! shared [`Document`] navigation/attribute entries, so a foreign or stale
//! handle fails with [`CoreError::WrongDocument`] / [`CoreError::Arena`].
//! [`Document::template_content`] rejects a non-`<template>` element with
//! [`CoreError::Hierarchy`] (the happy-dom surface only exposes `content` on a
//! template element).

use crate::arena::NodeId;
use crate::error::CoreError;

use super::Document;
use super::NodeData;

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

impl Document {
    /// Returns whether the node for `id` is an HTML-namespace `<template>`
    /// element. Case-insensitive on the local name (matching the parser and
    /// the serializer rules).
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn is_template(&self, id: NodeId) -> Result<bool, CoreError> {
        match self.get(id)?.data() {
            NodeData::Element {
                name, namespace, ..
            } => Ok(namespace.as_ref() == super::HTML_NAMESPACE
                && name.as_ref().eq_ignore_ascii_case("template")),
            _ => Ok(false),
        }
    }

    /// Returns the contents `DocumentFragment` of the `<template>` element for
    /// `id`, allocating it on first access (the happy-dom constructor
    /// semantics: `template.content` is a fragment from creation, even when
    /// empty).
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`; [`CoreError::Hierarchy`] when `id` is not a `<template>`
    /// element.
    pub fn template_content(&mut self, id: NodeId) -> Result<NodeId, CoreError> {
        if !self.is_template(id)? {
            return Err(hierarchy("template content requires a template element"));
        }
        if let Some(&content) = self.template_contents.get(&id) {
            return Ok(content);
        }
        let content = self.allocate_node(NodeData::DocumentFragment);
        self.template_contents.insert(id, content);
        Ok(content)
    }

    /// Read-only: the registered contents fragment of the `<template>` element
    /// for `id`, or `None` when none is registered yet (a template that never
    /// had its content created or adopted). Pure read; never allocates.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn template_content_id(&self, id: NodeId) -> Result<Option<NodeId>, CoreError> {
        self.get(id)?;
        Ok(self.template_contents.get(&id).copied())
    }

    /// Crate-internal: registers (or replaces) the contents fragment of the
    /// `<template>` element for `template`. Used by the parser adoption path
    /// and by the clone/import/adopt family; `template` must already be a live
    /// element of this document.
    pub(crate) fn set_template_content(&mut self, template: NodeId, content: NodeId) {
        self.template_contents.insert(template, content);
    }

    /// Crate-internal: removes the template-content association for `template`
    /// (used when a template node leaves the live tree through the T40
    /// adoption path, so a replaced/removed template cannot leak a stale
    /// content link back into a re-read).
    #[allow(dead_code)]
    pub(crate) fn remove_template_content(&mut self, template: NodeId) {
        self.template_contents.remove(&template);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dom::NodeType;

    #[test]
    fn create_element_template_gets_an_empty_content_fragment() {
        let mut doc = Document::new();
        let template = doc.create_element("template").unwrap();
        assert!(doc.is_template(template).unwrap());
        let content = doc.template_content(template).unwrap();
        assert_eq!(doc.node_type(content).unwrap(), NodeType::DocumentFragment);
        assert_eq!(
            doc.children(content).unwrap(),
            Vec::<NodeId>::new(),
            "a fresh template has empty content"
        );
        assert_eq!(
            doc.template_content(template).unwrap(),
            content,
            "content identity is stable"
        );
    }

    #[test]
    fn is_template_is_html_namespace_and_case_insensitive() {
        let mut doc = Document::new();
        let t_lower = doc.create_element("template").unwrap();
        let t_upper = doc.create_element("TEMPLATE").unwrap();
        let div = doc.create_element("div").unwrap();
        assert!(doc.is_template(t_lower).unwrap());
        assert!(doc.is_template(t_upper).unwrap());
        assert!(!doc.is_template(div).unwrap());
        let text = doc.create_text("x").unwrap();
        assert!(!doc.is_template(text).unwrap());
    }

    #[test]
    fn content_requires_a_template_element() {
        let mut doc = Document::new();
        let div = doc.create_element("div").unwrap();
        assert!(matches!(
            doc.template_content(div),
            Err(CoreError::Hierarchy { .. })
        ));
    }

    #[test]
    fn foreign_and_stale_handles_fail_structured() {
        let mut a = Document::new();
        let mut b = Document::new();
        let template = a.create_element("template").unwrap();
        assert!(matches!(
            b.is_template(template),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            b.template_content_id(template),
            Err(CoreError::WrongDocument { .. })
        ));
        b.create_element("x").unwrap();
        let bogus = crate::arena::NodeId::new(b.id(), u32::MAX, 0);
        assert!(matches!(
            b.template_content_id(bogus),
            Err(CoreError::Arena(_))
        ));
    }

    #[test]
    fn unregistered_template_has_no_content_link() {
        let mut doc = Document::new();
        let template = doc.create_element("template").unwrap();
        doc.template_contents.remove(&template);
        assert_eq!(doc.template_content_id(template).unwrap(), None);
        let content = doc.template_content(template).unwrap();
        assert_eq!(doc.template_content_id(template).unwrap(), Some(content));
    }
}
