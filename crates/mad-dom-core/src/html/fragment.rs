//! HTML fragment parsing (T27).
//!
//! Parses an HTML *fragment* against a caller-supplied context element with
//! servo's `html5ever` and writes the result *directly* into a fresh
//! [`Document`]'s arena through the same [`HtmlSink`](super::sink::HtmlSink)
//! adapter the document parser uses — no second, parser-owned DOM is ever
//! built or kept, exactly like the document path (T26).
//!
//! # Context element
//!
//! [`FragmentContext`] names the context element (local name, namespace URI and
//! attributes) the fragment is parsed in. html5ever's tree builder is
//! initialised from that element:
//!
//! * the tokenizer enters the matching state — plain data for `div`, RCDATA for
//!   `title`/`textarea`, raw text for `style`/`xmp`/`iframe`/`noembed`/
//!   `noframes`, script data for `script`, plaintext for `plaintext`;
//! * the insertion mode is reset from the context element's tag, so a `table`
//!   context parses "in table" (with foster parenting), `select` "in select",
//!   `td` "in cell", and so on.
//!
//! Malformed markup never fails parsing: the HTML5 error-recovery algorithm
//! still builds the tree and the non-fatal diagnostics are collected in
//! [`ParsedFragment::parse_errors`].
//!
//! # Result
//!
//! [`ParsedFragment`] owns the target [`Document`]. Its arena holds the
//! temporary root `<html>` element (appended to the document node), the
//! context element, and every parsed node — all with valid same-document
//! handles. The parsed fragment itself is the children of the temporary root
//! `<html>` element (html5ever's model, which the html5lib fragment suite
//! validates); [`ParsedFragment::nodes`] is that list in document order and is
//! the value a caller inserts into a live tree.
//!
//! Template elements *inside* the input follow the HTML5 algorithm: each gets
//! its own template-contents `DocumentFragment`, and the map in
//! [`ParsedFragment::template_contents`] keeps those fragments reachable (the
//! DOM model does not link an element to its template contents until a later
//! milestone).

use crate::arena::NodeId;
use crate::dom::Document;
use crate::error::CoreError;

use html5ever::driver::{parse_fragment_for_element, ParseOpts};
use html5ever::tendril::{StrTendril, TendrilSink};
use html5ever::tree_builder::create_element;
use html5ever::{ns, Attribute, LocalName, Namespace, QualName};

use super::sink::{FragmentMode, HtmlSink};
use crate::dom::HTML_NAMESPACE;

/// The context element a fragment is parsed in.
///
/// Fields mirror what the WHATWG fragment-parsing algorithm needs from the
/// context element: its name, its namespace URI, its attributes (used to set
/// the MathML `annotation-xml` HTML-integration-point flag and, later, form
/// association), and whether scripting is enabled (which decides whether a
/// `noscript` context is raw text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FragmentContext<'a> {
    /// The context element's local name. For the HTML namespace this is
    /// lowercased before parsing, matching `document.createElement`.
    pub name: &'a str,
    /// The context element's namespace URI
    /// ([`HTML_NAMESPACE`](crate::dom::HTML_NAMESPACE),
    /// [`SVG_NAMESPACE`](crate::dom::SVG_NAMESPACE) or
    /// [`MATHML_NAMESPACE`](crate::dom::MATHML_NAMESPACE)).
    pub namespace: &'a str,
    /// The context element's attributes in document order, as `(name, value)`
    /// pairs.
    pub attributes: &'a [(&'a str, &'a str)],
    /// Whether scripting is enabled in the context element's document.
    pub allows_scripting: bool,
}

impl<'a> FragmentContext<'a> {
    /// Builds an HTML context element with the given local name, no attributes
    /// and scripting enabled (the browser default).
    pub fn html(name: &'a str) -> Self {
        Self {
            name,
            namespace: HTML_NAMESPACE,
            attributes: &[],
            allows_scripting: true,
        }
    }
}

/// The outcome of parsing an HTML fragment in a context element.
///
/// `document` is a fresh [`Document`] whose arena is the parse target. `root`
/// is the temporary root `<html>` element whose children are the parsed
/// fragment, and `nodes` is that fragment in document order. Every handle in
/// `nodes`, `root`, `template_contents` and `document_root` belongs to
/// `document` and is valid against its arena.
///
/// `template_contents` maps every `<template>` element created during the parse
/// (including the context element, when it is one) to its HTML5
/// template-contents `DocumentFragment`, so content stored outside the
/// fragment's sibling list stays reachable.
pub struct ParsedFragment {
    pub document: Document,
    /// The `Document`-kind node at the top of the arena (the temporary root
    /// `<html>` element is its child).
    pub document_root: NodeId,
    /// The temporary root `<html>` element; `nodes` is its child list.
    pub root: NodeId,
    /// The parsed fragment, in document order (children of `root`).
    pub nodes: Vec<NodeId>,
    /// `template element -> its template-contents DocumentFragment`.
    pub template_contents: Vec<(NodeId, NodeId)>,
    /// The non-fatal HTML5 diagnostics the tokenizer/tree builder reported.
    pub parse_errors: Vec<String>,
}

/// Parses `input` as an HTML fragment in `context`, writing directly into a
/// fresh [`Document`]'s arena.
///
/// The returned [`Document`] owns the only tree: every node is allocated into
/// its arena as the tokens are processed, so no second DOM exists to keep or
/// convert. Malformed markup does not produce an error — it produces a tree
/// plus diagnostics in [`ParsedFragment::parse_errors`]; the `Result` wrapper
/// reserves the error channel for future resource-limit and encoding
/// boundaries, and rejects an empty context element name.
pub fn parse_html_fragment(
    input: &str,
    context: &FragmentContext<'_>,
) -> Result<ParsedFragment, CoreError> {
    if context.name.is_empty() {
        return Err(CoreError::InvalidCharacter {
            what: "fragment context element name",
            character: None,
        });
    }
    // HTML context names are compared against lowercased atoms by the
    // tokenizer / tree builder, so lowercase them like the browser's
    // createElement does; SVG / MathML names keep their case.
    let local = if context.namespace == HTML_NAMESPACE {
        LocalName::from(context.name.to_ascii_lowercase())
    } else {
        LocalName::from(context.name.to_string())
    };
    let qname = QualName::new(None, Namespace::from(context.namespace.to_string()), local);
    let attrs = context
        .attributes
        .iter()
        .map(|(name, value)| Attribute {
            name: QualName::new(None, ns!(), LocalName::from(name.to_string())),
            value: StrTendril::from(value.to_string()),
        })
        .collect::<Vec<_>>();

    let sink = HtmlSink::<FragmentMode>::for_fragment();
    let context_elem = create_element(&sink, qname, attrs);

    let parser = parse_fragment_for_element(
        sink,
        ParseOpts::default(),
        context_elem,
        context.allows_scripting,
        None,
    );
    Ok(parser.one(input))
}
