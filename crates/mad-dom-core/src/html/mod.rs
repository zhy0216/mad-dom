//! HTML document and fragment parsing (T26 / T27).
//!
//! Parses a full HTML document — or an HTML *fragment* against a context
//! element — with servo's `html5ever` (ADR-0004, validated by the T05 spike)
//! and writes the result *directly* into a fresh [`Document`]'s arena through
//! the [`TreeSink`] adapter in the sibling `sink` module. The arena holds the
//! final tree the moment parsing finishes — no second, long-lived DOM is ever
//! built or kept, which is the core acceptance constraint of this milestone.
//!
//! The tree builder and tokenizer are html5ever's; this module adapts them and
//! implements the node-creation callbacks. Malformed markup never fails
//! parsing: per the HTML5 error-recovery algorithm the tree is still built and
//! the non-fatal diagnostics are collected in [`ParsedDocument::parse_errors`]
//! / [`ParsedFragment::parse_errors`].
//!
//! # Scope
//!
//! Document parsing ([`parse_html_document`], T26), context-based fragment
//! parsing ([`parse_html_fragment`], T27) and the T29 document-structure /
//! fragment-application contract (`documentElement` / `head` / `body`,
//! `innerHTML` / `outerHTML` setters, `load_html`, the implied skeleton) live
//! here. Serialization (T28) is out of scope; the T29 read path calls into
//! [`crate::serialize`].
//!
//! # Resource behaviour
//!
//! The sink links every node with O(1) relation writes and stores every node
//! in the arena, so the parse cost and the arena live-node count grow linearly
//! in the input size for typical (wide, balanced) documents, and both
//! html5ever's tree builder and the sink are iterative, so deeply nested input
//! never overflows the stack; dropping the result is a flat arena `Vec` drop.
//! One caveat is inherited from the HTML5 algorithm itself: html5ever runs the
//! spec's "has a p element in button scope" stack scan for every block-level
//! start tag, so *pathologically* deep nesting of non-boundary elements is
//! O(depth²) in the tree builder — browsers run the same scan. The fixed
//! corpus, error and resource tests in `tests/t26_html_parser.rs` and
//! `tests/t27_html_fragment.rs` pin both the linear node accounting and the
//! deep-nesting behaviour.

use crate::arena::NodeId;
use crate::dom::Document;
use crate::error::CoreError;

use html5ever::driver::{parse_document, ParseOpts};
use html5ever::tendril::TendrilSink;
use html5ever::tree_builder::QuirksMode;

mod apply;
mod fragment;
mod sink;

pub use fragment::{parse_html_fragment, FragmentContext, ParsedFragment};
pub use sink::{DocumentMode, FragmentMode, HtmlSink, SinkMode};

/// The outcome of parsing a full HTML document.
///
/// `document` is a fresh [`Document`] whose arena is the parse target; `root`
/// is the `Document`-kind node at the top of the parsed tree (its children are
/// the doctype, if any, and the `<html>` element). `parse_errors` carries the
/// non-fatal HTML5 diagnostics the tokenizer/tree builder reported, and
/// `quirks_mode` records the mode the doctype (or its absence) selected.
/// `template_contents` maps every `<template>` element created during the parse
/// to its HTML5 template-contents `DocumentFragment` (T40), so the content
/// stored outside the tree stays reachable for the T29 apply adoption.
pub struct ParsedDocument {
    pub document: Document,
    pub root: NodeId,
    pub parse_errors: Vec<String>,
    pub quirks_mode: QuirksMode,
    pub template_contents: Vec<(NodeId, NodeId)>,
}

/// Parses `input` as a full HTML document into a fresh [`Document`].
///
/// The returned [`Document`] owns the only tree: every node was allocated into
/// its arena as the tokens were processed, so no second DOM exists to keep or
/// convert. Malformed markup does not produce an error — it produces a tree
/// plus diagnostics in [`ParsedDocument::parse_errors`]; the `Result` wrapper
/// reserves the error channel for future resource-limit and encoding
/// boundaries.
pub fn parse_html_document(input: &str) -> Result<ParsedDocument, CoreError> {
    let parser = parse_document(HtmlSink::new(), ParseOpts::default());
    Ok(parser.one(input))
}
