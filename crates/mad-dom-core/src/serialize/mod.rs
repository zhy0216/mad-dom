//! Unified HTML serializer (T28).
//!
//! Serializes the nodes of a [`Document`]'s arena back into HTML — the inverse
//! of the `html` document parser (T26). The serializer is a *pure reader*: it
//! walks the tree only through [`Document`]'s read-only navigation/read API
//! ([`Document::get`], [`Document::children`], ...) and never allocates into
//! or mutates the arena, so the arena remains the only DOM and serialization
//! never builds a second tree.
//!
//! The rules follow the WHATWG HTML fragment serialization algorithm
//! ("serialising HTML fragments", WHATWG HTML §13.3): node-type dispatch
//! (Document / DocumentType / DocumentFragment / Element / Text / Comment),
//! the "serializes as void" rule, the raw-text exemption and the text and
//! attribute escaping rules (implemented in the sibling [`escape`] and
//! [`rules`] modules). Two deliberate deviations from the algorithm's *text*
//! keep the output aligned with what browsers and happy-dom emit:
//!
//! * the doctype is rendered in the full `PUBLIC` / `SYSTEM` form
//!   (`<!DOCTYPE html PUBLIC "…" "…">`), not the name-only `<!DOCTYPE name>`
//!   the algorithm's text alone produces — this keeps the public/system
//!   identifiers through parse→serialize→parse and matches happy-dom's
//!   doctype serializer;
//! * processing instructions never appear in the arena (the HTML tokenizer
//!   turns `<?…?>` into a comment, T26), so no PI branch exists.
//!
//! # Scope
//!
//! `Document`, `DocumentFragment`, `Element`, `Text`, `Comment` and the
//! doctype are covered, including the namespace, doctype and template
//! structures the parser supports; the fixed fixture corpus and round-trip
//! tests live in `tests/t28_html_serializer.rs`. The JavaScript
//! `innerHTML`/`outerHTML` properties are out of scope (T29); this module is
//! the Core entry those bindings call.
//!
//! # Recorded serialization gaps
//!
//! The fixed fixtures byte-for-byte match happy-dom 20.11.11 except where a
//! gap is recorded explicitly (in `tests/t28_html_serializer.rs`):
//!
//! * **Attribute escaping**: the WHATWG algorithm escapes `&`, U+00A0, `<`,
//!   `>` and `"` in attribute values; happy-dom's serializer escapes only `&`
//!   and `"`. This serializer follows the WHATWG rule, so an attribute value
//!   containing `<`, `>` or a non-breaking space differs from happy-dom.
//! * **RCDATA markup**: for `textarea`/`title` text the WHATWG rule escapes
//!   the data; happy-dom's *parser* treats markup inside `textarea` as real
//!   elements, so the serialized output for such input differs (a parser
//!   divergence, not a serializer one).
//! * **Foreign-element namespaces**: the algorithm emits no synthetic `xmlns`
//!   declarations, so a foreign (SVG/MathML) element serialized outside its
//!   natural context re-parses into the HTML namespace. The round-trip tests
//!   locate this loss explicitly.
//!
//! Round-trip structural losses inherent to HTML are also located by the
//! tests: a leading U+000A after `<pre>`/`<textarea>`/`<listing>` is consumed
//! on parse, adjacent text nodes merge on re-parse, and comment data ending in
//! `-->` cannot survive serialization.

mod escape;
mod rules;

use crate::arena::NodeId;
use crate::dom::{Document, NodeData};
use crate::error::CoreError;

/// Options controlling serialization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SerializeOptions {
    /// Whether scripting is enabled. When `true` the text children of a
    /// `noscript` element are written literally (WHATWG "serialising HTML
    /// fragments"), matching html5ever's parse-time default so that
    /// parse→serialize round-trips keep the same tree.
    pub scripting_enabled: bool,
}

impl Default for SerializeOptions {
    fn default() -> Self {
        Self {
            scripting_enabled: true,
        }
    }
}

/// The part of `node` the serializer should emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SerializationScope {
    /// Serialize `node` itself: for an element its start tag, children and end
    /// tag (outerHTML semantics); for a `Document`/`DocumentFragment` its
    /// children.
    IncludeNode,
    /// Serialize only the children of `node` (innerHTML semantics).
    ChildrenOnly,
}

/// Serializes `node` to HTML per the WHATWG HTML fragment serialization
/// algorithm, reading only the arena's read-only navigation/read API.
///
/// # Errors
///
/// Propagates the read errors of the navigation API:
/// [`CoreError::WrongDocument`] when `node` belongs to another document and
/// [`CoreError::Arena`] when the handle is stale or invalid.
pub fn serialize(
    doc: &Document,
    node: NodeId,
    scope: SerializationScope,
    options: &SerializeOptions,
) -> Result<String, CoreError> {
    let mut out = String::new();
    serialize_to(doc, node, scope, options, &mut out)?;
    Ok(out)
}

/// Convenience wrapper over [`serialize`] emitting `node` itself (outerHTML
/// semantics) with default options.
pub fn serialize_node(doc: &Document, node: NodeId) -> Result<String, CoreError> {
    serialize(
        doc,
        node,
        SerializationScope::IncludeNode,
        &SerializeOptions::default(),
    )
}

/// Convenience wrapper over [`serialize`] emitting the children of `node`
/// (innerHTML semantics) with default options.
pub fn serialize_children(doc: &Document, node: NodeId) -> Result<String, CoreError> {
    serialize(
        doc,
        node,
        SerializationScope::ChildrenOnly,
        &SerializeOptions::default(),
    )
}

fn serialize_to(
    doc: &Document,
    node: NodeId,
    scope: SerializationScope,
    options: &SerializeOptions,
    out: &mut String,
) -> Result<(), CoreError> {
    match scope {
        SerializationScope::ChildrenOnly => write_children(doc, node, false, options, out),
        SerializationScope::IncludeNode => write_node(doc, node, options, out),
    }
}

/// Serializes the children of `node` in document order.
///
/// `parent_is_raw_text` records whether `node` is a raw-text element, in which
/// case its direct text children are written literally instead of escaped.
fn write_children(
    doc: &Document,
    node: NodeId,
    parent_is_raw_text: bool,
    options: &SerializeOptions,
    out: &mut String,
) -> Result<(), CoreError> {
    for child in doc.children(node)? {
        match doc.get(child)?.data() {
            NodeData::Text { data } if parent_is_raw_text => out.push_str(data),
            NodeData::Text { data } => escape::write_escaped_text(out, data),
            _ => write_node(doc, child, options, out)?,
        }
    }
    Ok(())
}

/// Serializes `node` itself (its full outer form), dispatching on its type.
fn write_node(
    doc: &Document,
    node: NodeId,
    options: &SerializeOptions,
    out: &mut String,
) -> Result<(), CoreError> {
    match doc.get(node)?.data() {
        NodeData::Document | NodeData::DocumentFragment | NodeData::ShadowRoot { .. } => {
            write_children(doc, node, false, options, out)
        }
        NodeData::DocumentType {
            name,
            public_id,
            system_id,
        } => {
            write_doctype(out, name, public_id, system_id);
            Ok(())
        }
        NodeData::Text { data } => {
            escape::write_escaped_text(out, data);
            Ok(())
        }
        NodeData::Comment { data } => {
            out.push_str("<!--");
            out.push_str(data);
            out.push_str("-->");
            Ok(())
        }
        NodeData::ProcessingInstruction { target, data } => {
            out.push_str("<?");
            out.push_str(target);
            out.push(' ');
            out.push_str(data);
            out.push_str("?>");
            Ok(())
        }
        NodeData::Element {
            name,
            namespace,
            attributes,
            ..
        } => write_element(
            doc,
            node,
            name.as_ref(),
            namespace.as_ref(),
            attributes,
            options,
            out,
        ),
    }
}

fn write_element(
    doc: &Document,
    node: NodeId,
    name: &str,
    namespace: &str,
    attributes: &[(String, String)],
    options: &SerializeOptions,
    out: &mut String,
) -> Result<(), CoreError> {
    write_start_tag(out, name, attributes);
    if rules::is_void_element(namespace, name) {
        return Ok(());
    }
    let raw_text = rules::is_raw_text_element(namespace, name, options.scripting_enabled);
    // A `<template>` serializes its template-contents DocumentFragment (T40),
    // not its ordinary children: the WHATWG "serialising HTML fragments" rule
    // mirrors how the parser routes template content. When the element has no
    // registered contents fragment (a doc-mode shortcut template, or a
    // programmatic template whose content was never created), its ordinary
    // children are serialized instead — the two stay consistent because a
    // template's content and its child list are never both populated.
    if namespace == crate::dom::HTML_NAMESPACE && name.eq_ignore_ascii_case("template") {
        if let Some(content) = doc.template_content_id(node)? {
            write_children(doc, content, false, options, out)?;
            out.push_str("</");
            out.push_str(name);
            out.push('>');
            return Ok(());
        }
    }
    write_children(doc, node, raw_text, options, out)?;
    out.push_str("</");
    out.push_str(name);
    out.push('>');
    Ok(())
}

fn write_start_tag(out: &mut String, name: &str, attributes: &[(String, String)]) {
    out.push('<');
    out.push_str(name);
    for (attr_name, attr_value) in attributes {
        out.push(' ');
        out.push_str(attr_name);
        out.push_str("=\"");
        escape::write_escaped_attr(out, attr_value);
        out.push('"');
    }
    out.push('>');
}

/// Writes `name` with the public/system identifiers, matching the classic
/// `PUBLIC` / `SYSTEM` doctype form browsers and happy-dom emit.
fn write_doctype(out: &mut String, name: &str, public_id: &str, system_id: &str) {
    out.push_str("<!DOCTYPE ");
    out.push_str(name);
    if !public_id.is_empty() {
        out.push_str(" PUBLIC \"");
        out.push_str(public_id);
        out.push('"');
        if !system_id.is_empty() {
            out.push_str(" \"");
            out.push_str(system_id);
            out.push('"');
        }
    } else if !system_id.is_empty() {
        out.push_str(" SYSTEM \"");
        out.push_str(system_id);
        out.push('"');
    }
    out.push('>');
}
