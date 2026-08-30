//! HTML document-structure API and atomic fragment application (T29).
//!
//! This module turns the T26/T27 parsers and the T28 serializer into the Core
//! contract the JavaScript `innerHTML` / `outerHTML` accessors and the
//! `documentElement` / `head` / `body` / full-document load surface call. It
//! owns *only* the tree/parse orchestration — the parsing itself still runs in
//! the sibling `mod.rs` (`parse_html_document`) / `fragment.rs`
//! (`parse_html_fragment`) modules and serialization in
//! [`crate::serialize`] — so the arena stays the only DOM and no second tree
//! is ever built or kept.
//!
//! # Atomic replacement
//!
//! The `innerHTML` / `outerHTML` setters and `load_html` all follow the same
//! shape: parse the input into a *fresh* document (`parse_html_fragment` /
//! `parse_html_document`), adopt the parsed nodes into this document, and only
//! then mutate the live tree. Every fallible step (node-kind validation, the
//! context build, the parse) runs before the first relation field is touched,
//! and the mutation phase is built from the crate's O(1) primitives
//! ([`Document::detach`](crate::dom::Document) and
//! [`Document::link_detached_chain_between`](crate::dom::Document)), so a
//! failed setter leaves the tree byte-for-byte unchanged — no partial
//! replacement.
//!
//! # Contexts
//!
//! * The `innerHTML` setter parses with the target element itself as the
//!   fragment context (name, namespace and attributes), so `table` parses "in
//!   table", `select` "in select", `title`/`textarea` in RCDATA and so on; a
//!   `DocumentFragment` target uses the WHATWG fallback `body` context.
//! * The `outerHTML` setter parses with the target's *parent* as the context
//!   (its document element when the parent is the `Document` root), and is a
//!   no-op when the target is detached (WHATWG §14.2).
//!
//! # Document structure
//!
//! [`Document::document_root`] allocates the `Document`-kind anchor node
//! lazily; [`Document::ensure_html_skeleton`] builds the implied
//! `<html><head></head><body></body></html>` skeleton under it when absent, so
//! `documentElement` / `head` / `body` are live reads of a structure that is
//! guaranteed to exist on first access. [`Document::load_html`] replaces the
//! document content with a freshly parsed full document.
//!
//! # Recorded limitations
//!
//! * A `<template>` element *inside* the fragment input keeps its content in an
//!   HTML5 template-contents `DocumentFragment` (T27), which the DOM model does
//!   not yet link to the element — so such content is not adopted and is lost
//!   on a parse→serialize round trip (the template milestone T40 links it).
//! * Template *contexts* (setting `innerHTML` on a `<template>` element)
//!   select "in template" mode and work normally.

use crate::arena::NodeId;
use crate::dom::{Document, NodeData, NodeType};
use crate::error::CoreError;
use crate::html::fragment::FragmentContext;
use crate::html::{parse_html_document, parse_html_fragment};
use crate::serialize::{serialize_children, serialize_node};

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

/// Returns the first `Element` child of `parent`, in document order.
fn first_element_child(doc: &Document, parent: NodeId) -> Result<Option<NodeId>, CoreError> {
    let mut cur = doc.get(parent)?.first_child();
    while let Some(c) = cur {
        if doc.get(c)?.node_type() == NodeType::Element {
            return Ok(Some(c));
        }
        cur = doc.get(c)?.next_sibling();
    }
    Ok(None)
}

/// Returns the first `Element` child of `parent` whose node name equals `name`,
/// in document order.
fn first_element_child_named(
    doc: &Document,
    parent: NodeId,
    name: &str,
) -> Result<Option<NodeId>, CoreError> {
    let mut cur = doc.get(parent)?.first_child();
    while let Some(c) = cur {
        if doc.get(c)?.node_type() == NodeType::Element && doc.node_name(c)? == name {
            return Ok(Some(c));
        }
        cur = doc.get(c)?.next_sibling();
    }
    Ok(None)
}

impl Document {
    /// Returns the WHATWG `documentElement`: the first `Element` child of the
    /// document root, or `None` when the document has no root element yet.
    ///
    /// This is a pure read; it never allocates a skeleton. The binding calls
    /// [`Document::ensure_html_skeleton`] first so a fresh HTML document reads
    /// as having the implied skeleton.
    pub fn document_element(&self) -> Result<Option<NodeId>, CoreError> {
        let Some(root) = self.cached_document_root() else {
            return Ok(None);
        };
        first_element_child(self, root)
    }

    /// Returns the WHATWG `head` element: the first `Element` child of the
    /// document element named `head`, or `None` when there is none.
    pub fn document_head(&self) -> Result<Option<NodeId>, CoreError> {
        let Some(html) = self.document_element()? else {
            return Ok(None);
        };
        first_element_child_named(self, html, "head")
    }

    /// Returns the WHATWG `body` element: the first `Element` child of the
    /// document element named `body`, or `None` when there is none.
    pub fn document_body(&self) -> Result<Option<NodeId>, CoreError> {
        let Some(html) = self.document_element()? else {
            return Ok(None);
        };
        first_element_child_named(self, html, "body")
    }

    /// Builds the implied `<html><head></head><body></body></html>` skeleton
    /// under the document root when the document has no document element yet.
    ///
    /// Idempotent: once a document element exists (parsed or built), this is a
    /// no-op, so a later `outerHTML` replacement of `body`/`head` that leaves
    /// the document element in place does not resurrect the removed parts.
    ///
    /// The nodes are linked through
    /// [`Document::link_detached_chain_between`](crate::dom::Document) — the
    /// same O(1) primitive the mutation API uses — so the T32 query index (when
    /// enabled) is maintained for the skeleton exactly like for any other
    /// attach.
    pub fn ensure_html_skeleton(&mut self) -> Result<(), CoreError> {
        if self.document_element()?.is_some() {
            return Ok(());
        }
        let root = self.document_root();
        let html = self.create_element("html")?;
        let head = self.create_element("head")?;
        let body = self.create_element("body")?;
        // The implied skeleton is internal bookkeeping, not a user-visible DOM
        // mutation, and the happy-dom baseline never records it; suppress the
        // T41 observer records for this build so the two stay consistent.
        self.with_observer_records_suppressed(|doc| {
            doc.link_detached_chain_between(root, &[html], None, None);
            doc.link_detached_chain_between(html, &[head, body], None, None);
        });
        self.verify_apply(root);
        Ok(())
    }

    /// Replaces the whole document content with a freshly parsed full document.
    ///
    /// Parses `input` with [`parse_html_document`] (T26), which produces the
    /// implied skeleton for bare fragments, then atomically replaces every
    /// child of the document root (the old doctype / `<html>` element) with the
    /// parsed doctype / `<html>` element. The old nodes stay live (detached),
    /// so existing wrappers remain valid; the new tree is owned by this
    /// document and `documentElement` / `head` / `body` reflect it. `<template>`
    /// contents fragments from the parse are adopted and linked too (T40).
    pub fn load_html(&mut self, input: &str) -> Result<(), CoreError> {
        let mut parsed = parse_html_document(input)?;
        let root = self.document_root();
        let children = parsed.document.children(parsed.root)?;
        let adopted = adopt_parsed(self, &mut parsed.document, &children)?;
        replace_children(self, root, &adopted)?;
        self.verify_apply(root);
        Ok(())
    }

    /// Returns the WHATWG `innerHTML` of `node`: the serialized children for an
    /// `Element` or `DocumentFragment`.
    ///
    /// A `<template>` element serializes its template-contents `DocumentFragment`
    /// (T40) instead of its ordinary children, matching the WHATWG rule and
    /// happy-dom's template `innerHTML` override. Reading the children of any
    /// other node kind (Text, Comment, Document, DocumentType) fails with
    /// [`CoreError::Hierarchy`] — in the WHATWG and happy-dom those node types
    /// do not expose `innerHTML`.
    pub fn inner_html(&self, node: NodeId) -> Result<String, CoreError> {
        match self.get(node)?.node_type() {
            NodeType::Element | NodeType::DocumentFragment | NodeType::ShadowRoot => {
                if self.is_template(node)? {
                    if let Some(content) = self.template_content_id(node)? {
                        return serialize_children(self, content);
                    }
                }
                serialize_children(self, node)
            }
            _ => Err(hierarchy(
                "innerHTML requires an Element, DocumentFragment or ShadowRoot node",
            )),
        }
    }

    /// Sets the WHATWG `innerHTML` of `node`, replacing its children atomically.
    ///
    /// The fragment is parsed in the target's own context (name, namespace and
    /// attributes for an `Element`; the fallback `body` context for a
    /// `DocumentFragment`) and every parsed node is adopted into this document
    /// before the existing children are detached, so a failure leaves the node
    /// byte-for-byte unchanged. An empty input clears the children. For a
    /// `<template>` target the parsed content populates the template-contents
    /// fragment (T40) instead of the element's ordinary child list; a nested
    /// `<template>` inside the input keeps its own contents fragment.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `node` is not an `Element` or a
    ///   `DocumentFragment`.
    pub fn set_inner_html(&mut self, node: NodeId, input: &str) -> Result<(), CoreError> {
        let mut parsed = parse_fragment_in_context(self, node, input)?;
        let adopted = adopt_parsed(self, &mut parsed.document, &parsed.nodes)?;
        let target = if self.is_template(node)? {
            self.template_content(node)?
        } else {
            node
        };
        replace_children(self, target, &adopted)?;
        self.verify_apply(node);
        Ok(())
    }

    /// Returns the WHATWG `outerHTML` of `node`: the serialized node itself.
    ///
    /// Only `Element` nodes expose `outerHTML`; any other kind fails with
    /// [`CoreError::Hierarchy`] (matching the WHATWG surface, where `outerHTML`
    /// lives on `Element` alone).
    pub fn outer_html(&self, node: NodeId) -> Result<String, CoreError> {
        match self.get(node)?.node_type() {
            NodeType::Element => serialize_node(self, node),
            _ => Err(hierarchy("outerHTML requires an Element node")),
        }
    }

    /// Sets the WHATWG `outerHTML` of `node`, replacing the node itself.
    ///
    /// The fragment is parsed in the target's *parent* context (the document
    /// element when the parent is the `Document` root), so a body replacement
    /// strips a leading `<body>` tag exactly like the browser, and the parsed
    /// nodes are adopted before the old node is detached — the replacement is
    /// atomic. A detached target is a no-op (WHATWG: "If the context object's
    /// parent is null, then return.").
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `node` is not an `Element`.
    pub fn set_outer_html(&mut self, node: NodeId, input: &str) -> Result<(), CoreError> {
        if self.get(node)?.node_type() != NodeType::Element {
            return Err(hierarchy("outerHTML requires an Element node"));
        }
        let parent = match self.get(node)?.parent() {
            Some(parent) => parent,
            None => return Ok(()),
        };
        let context = if self.get(parent)?.node_type() == NodeType::Document {
            match self.document_element()? {
                Some(element) => element,
                None => return Ok(()),
            }
        } else {
            parent
        };
        let mut parsed = parse_fragment_in_context(self, context, input)?;
        let adopted = adopt_parsed(self, &mut parsed.document, &parsed.nodes)?;
        replace_in_parent(self, node, &adopted)?;
        self.verify_apply(parent);
        Ok(())
    }

    /// In debug builds, re-checks the tree invariants over the subtree rooted
    /// at `root`'s top-level ancestor, so a relinking bug in the apply path
    /// surfaces in tests.
    fn verify_apply(&self, node: NodeId) {
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
                            "T29 apply at {node} left the tree inconsistent"
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

/// Parses `input` as a fragment in the context of `node`, validating that the
/// node kind may own parsed HTML content.
///
/// For an `Element` context the element's name, namespace and attributes are
/// used (so `table` parses "in table", `title`/`textarea` in RCDATA, SVG in the
/// SVG namespace, …); a `DocumentFragment` context uses the WHATWG fallback
/// `body` element. Any other node kind fails with [`CoreError::Hierarchy`].
///
/// The context borrows `doc`'s arena only for the duration of the parse call,
/// so the caller may mutate `doc` as soon as this returns.
fn parse_fragment_in_context(
    doc: &Document,
    node: NodeId,
    input: &str,
) -> Result<super::fragment::ParsedFragment, CoreError> {
    match doc.get(node)?.data() {
        NodeData::Element {
            name,
            namespace,
            attributes,
            ..
        } => {
            let pairs: Vec<(&str, &str)> = attributes
                .iter()
                .map(|(n, v)| (n.as_str(), v.as_str()))
                .collect();
            let context = FragmentContext {
                name: name.as_ref(),
                namespace: namespace.as_ref(),
                attributes: &pairs,
                allows_scripting: true,
            };
            parse_html_fragment(input, &context)
        }
        NodeData::DocumentFragment | NodeData::ShadowRoot { .. } => {
            parse_html_fragment(input, &FragmentContext::html("body"))
        }
        _ => Err(hierarchy(
            "innerHTML/outerHTML context requires an Element, DocumentFragment or ShadowRoot node",
        )),
    }
}

/// Adopts every parsed fragment node from `source` into `doc`, returning the
/// adopted roots in the same document order.
///
/// The parsed nodes are freshly minted handles of `source`'s arena, so every
/// [`Document::adopt_node`] call is validated and infallible; the source
/// document is drained and dropped by the caller afterwards. `<template>`
/// contents fragments are adopted recursively by [`Document::adopt_node`]
/// (T40), so the parse→adopt round trip keeps every template's content linked.
fn adopt_parsed(
    doc: &mut Document,
    source: &mut Document,
    nodes: &[NodeId],
) -> Result<Vec<NodeId>, CoreError> {
    let mut adopted = Vec::with_capacity(nodes.len());
    for &node in nodes {
        adopted.push(doc.adopt_node(source, node)?);
    }
    Ok(adopted)
}

/// Atomically replaces the children of `parent` with `new_children`.
///
/// All current children are detached first, then `new_children` (already
/// detached, document-owned handles) are linked as the new child list. The
/// detached old children stay live, so existing wrappers remain valid.
///
/// T42: the old children's `disconnectedCallback` reactions fire at the detach,
/// then the freshly parsed children are upgraded (their `attributeChangedCallback`
/// reactions for present observed attributes are enqueued) before the splice
/// enqueues their `connectedCallback` — the happy-dom innerHTML/load_html order
/// (`old-disconnected`, `attr`, `connected`). A failed upgrade leaves the tree
/// unchanged because it runs before the first relation field of the splice is
/// touched.
fn replace_children(
    doc: &mut Document,
    parent: NodeId,
    new_children: &[NodeId],
) -> Result<(), CoreError> {
    let existing = doc.children(parent)?;
    for &child in &existing {
        doc.detach(child);
    }
    for &child in new_children {
        doc.detach(child);
    }
    if !new_children.is_empty() {
        doc.upgrade_custom_elements(new_children[0])?;
        for &child in &new_children[1..] {
            doc.upgrade_custom_elements(child)?;
        }
        doc.link_detached_chain_between(parent, new_children, None, None);
    }
    Ok(())
}

/// Atomically replaces `node` (a child of some parent) with `new_nodes`.
///
/// `new_nodes` are detached, document-owned handles; the old node is detached
/// (its wrappers stay valid) and the chain is spliced into its position. An
/// empty `new_nodes` list simply removes the node.
///
/// T42: as for [`replace_children`], the old node's `disconnectedCallback` is
/// enqueued at the detach, the freshly parsed children are upgraded (with their
/// `attributeChangedCallback` reactions) before the splice enqueues their
/// `connectedCallback`.
fn replace_in_parent(
    doc: &mut Document,
    node: NodeId,
    new_nodes: &[NodeId],
) -> Result<(), CoreError> {
    let parent = doc
        .get(node)?
        .parent()
        .ok_or_else(|| hierarchy("outerHTML replacement requires a parent node"))?;
    let prev = doc.get(node)?.previous_sibling();
    let next = doc.get(node)?.next_sibling();
    doc.detach(node);
    if !new_nodes.is_empty() {
        for &n in new_nodes {
            doc.detach(n);
        }
        doc.upgrade_custom_elements(new_nodes[0])?;
        for &n in &new_nodes[1..] {
            doc.upgrade_custom_elements(n)?;
        }
        doc.link_detached_chain_between(parent, new_nodes, prev, next);
    }
    Ok(())
}
