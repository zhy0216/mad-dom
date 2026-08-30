//! T28 HTML serializer fixtures.
//!
//! Integration-level evidence for `src/serialize/`: a parsed document's arena
//! is serialized back to HTML through the read-only navigation/read API, and
//! the fixed corpus below cross-checks the output against happy-dom 20.11.11
//! (the compat baseline, ADR-0002) as well as against the WHATWG HTML
//! fragment serialization algorithm.
//!
//! The acceptance criteria are pinned here:
//!
//! * *serializer only reads the unified arena* — every fixture serializes a
//!   [`Document`] produced by `parse_html_document` and never mutates it (the
//!   tree invariants still hold afterwards, and the arena node count is
//!   unchanged);
//! * *fixed fixture output matches happy-dom or records a gap* — the "fixed
//!   fixtures" section asserts byte-for-byte happy-dom 20.11.11 output for the
//!   common corpus; the "recorded gaps" section pins the deliberate WHATWG
//!   deviations (attribute escaping, RCDATA markup, foreign-element
//!   namespaces, raw-text `xmp`/`iframe`/`noembed`/`noframes`) with the gap
//!   spelled out;
//! * *round-trip tests locate structural loss* — the "round trips" section
//!   proves parse→serialize→parse preserves the tree for the well-formed
//!   corpus, proves serialize→parse→serialize is idempotent, and separately
//!   *locates* the structural losses inherent to HTML serialization (leading
//!   U+000A after `<pre>`, adjacent text-node merging, foreign-element
//!   namespaces, comment data ending in `-->`).

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeData, NodeType, HTML_NAMESPACE, SVG_NAMESPACE};
use mad_dom_core::error::CoreError;
use mad_dom_core::html::parse_html_document;
use mad_dom_core::serialize::{
    serialize, serialize_children, serialize_node, SerializationScope, SerializeOptions,
};

// ---- shared helpers -------------------------------------------------------

fn parse(input: &str) -> mad_dom_core::html::ParsedDocument {
    parse_html_document(input).expect("document parsing never fails")
}

/// Returns the first element named `name` reachable from `start` (excluding
/// `start` itself) via an iterative pre-order walk.
fn find_element(doc: &Document, start: NodeId, name: &str) -> NodeId {
    let mut stack = vec![start];
    while let Some(n) = stack.pop() {
        for c in doc.children(n).unwrap() {
            if doc.node_type(c).unwrap() == NodeType::Element && doc.node_name(c).unwrap() == name {
                return c;
            }
            stack.push(c);
        }
    }
    panic!("no element named {name:?} reachable from {start:?}");
}

/// Every node handle reachable from `start` in document (pre) order.
fn subtree(doc: &Document, start: NodeId) -> Vec<NodeId> {
    let mut out = vec![start];
    let mut stack = vec![start];
    while let Some(n) = stack.pop() {
        for c in doc.children(n).unwrap().into_iter().rev() {
            out.push(c);
            stack.push(c);
        }
    }
    out
}

/// Parses `input` and serializes the parsed `<html>` element itself (outer).
fn html_outer(input: &str) -> String {
    let parsed = parse(input);
    let html = find_element(&parsed.document, parsed.root, "html");
    serialize_node(&parsed.document, html).expect("serialization reads a live handle")
}

/// Parses `input` and serializes the children of the parsed `<body>` (inner).
fn body_inner(input: &str) -> String {
    let parsed = parse(input);
    let body = find_element(&parsed.document, parsed.root, "body");
    serialize_children(&parsed.document, body).expect("serialization reads a live handle")
}

/// A canonical, single-line pre-order rendering of a subtree that is sensitive
/// to every structure the round-trip tests must preserve: node kind, name,
/// namespace, attributes, data and nesting.
fn shape(doc: &Document, start: NodeId) -> String {
    fn walk(doc: &Document, id: NodeId, depth: usize, out: &mut String) {
        for _ in 0..depth {
            out.push_str("  ");
        }
        match doc.get(id).unwrap().data() {
            NodeData::Document => out.push_str("Document"),
            NodeData::DocumentFragment => out.push_str("DocumentFragment"),
            NodeData::DocumentType {
                name,
                public_id,
                system_id,
            } => out.push_str(&format!(
                "DocumentType({name}, {public_id:?}, {system_id:?})"
            )),
            NodeData::Element {
                name,
                namespace,
                attributes,
                ..
            } => {
                out.push_str(&format!("Element({name}) ns={namespace}"));
                for (n, v) in attributes {
                    out.push_str(&format!(" {n}={v:?}"));
                }
            }
            NodeData::Text { data } => out.push_str(&format!("Text({data:?})")),
            NodeData::Comment { data } => out.push_str(&format!("Comment({data:?})")),
            NodeData::ProcessingInstruction { target, data } => {
                out.push_str(&format!("ProcessingInstruction({target}, {data:?})"))
            }
        }
        out.push('\n');
        for child in doc.children(id).unwrap() {
            walk(doc, child, depth + 1, out);
        }
    }
    let mut out = String::new();
    walk(doc, start, 0, &mut out);
    out
}

// ---- fixed fixtures: byte-for-byte happy-dom 20.11.11 ---------------------
//
// The expected strings below are the actual output of happy-dom 20.11.11 (the
// ADR-0002 baseline) for the same input, captured through its outerHTML /
// innerHTML serializers. Entities in the *source* are kept entity-escaped so
// both parsers produce the same tree and the comparison isolates the
// serializer.

const F1_DOC: &str = concat!(
    "<!DOCTYPE html><html><head><title>A &amp; B</title></head>",
    "<body class=\"main\"><p>hello</p>",
    "<p class=\"x\">a &amp; b &lt; c &gt; d</p><!-- note --><br><img src=\"x\">",
    "<svg viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"2\"/></svg>",
    "</body></html>"
);

#[test]
fn canonical_document_matches_happy_dom() {
    let expected_html = concat!(
        "<html><head><title>A &amp; B</title></head>",
        "<body class=\"main\"><p>hello</p>",
        "<p class=\"x\">a &amp; b &lt; c &gt; d</p><!-- note --><br><img src=\"x\">",
        "<svg viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"2\"></circle></svg>",
        "</body></html>"
    );
    assert_eq!(html_outer(F1_DOC), expected_html);

    let expected_body = concat!(
        "<p>hello</p>",
        "<p class=\"x\">a &amp; b &lt; c &gt; d</p><!-- note --><br><img src=\"x\">",
        "<svg viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"2\"></circle></svg>"
    );
    assert_eq!(body_inner(F1_DOC), expected_body);
}

#[test]
fn raw_text_script_and_style_match_happy_dom() {
    let input = concat!(
        "<html><body>",
        "<script>if (a < b && c > d) { x = \"&amp;\"; }</script>",
        "<style>a > b { color: red }</style>",
        "</body></html>"
    );
    // Raw-text content is written literally, including the `&amp;` the parser
    // kept undecoded inside `<script>`.
    assert_eq!(
        body_inner(input),
        "<script>if (a < b && c > d) { x = \"&amp;\"; }</script><style>a > b { color: red }</style>"
    );
}

#[test]
fn attributes_match_happy_dom() {
    let input = concat!(
        "<html><body><div id=\"a\" class=\"b c\" data-x=\"a&amp;b\" ",
        "title=\"it&apos;s &quot;q&quot;\"></div></body></html>"
    );
    // Values are decoded on parse and re-escaped on serialize; the apostrophe
    // needs no escaping in a double-quoted value.
    assert_eq!(
        body_inner(input),
        "<div id=\"a\" class=\"b c\" data-x=\"a&amp;b\" title=\"it's &quot;q&quot;\"></div>"
    );
}

#[test]
fn comments_void_and_empty_elements_match_happy_dom() {
    let input = concat!(
        "<html><body><!-- c1 --><div></div>",
        "<span><br><hr><input disabled><img alt=\"\"></span></body></html>"
    );
    // Void elements emit only a start tag; empty attributes serialize as `=""`.
    assert_eq!(
        body_inner(input),
        "<!-- c1 --><div></div><span><br><hr><input disabled=\"\"><img alt=\"\"></span>"
    );
}

#[test]
fn template_matches_happy_dom() {
    let input = "<html><body><template><p>in</p></template></body></html>";
    assert_eq!(body_inner(input), "<template><p>in</p></template>");
}

#[test]
fn mathml_matches_happy_dom() {
    let input = "<html><body><math><mi>x</mi><mn>1</mn></math></body></html>";
    assert_eq!(body_inner(input), "<math><mi>x</mi><mn>1</mn></math>");
}

#[test]
fn entities_and_non_breaking_space_match_happy_dom() {
    let input = "<html><body><p>&copy; &#65; &nbsp; &amp;</p></body></html>";
    assert_eq!(body_inner(input), "<p>© A &nbsp; &amp;</p>");
}

#[test]
fn svg_camel_case_names_are_preserved() {
    let input = "<html><body><svg><linearGradient id=\"g\"></linearGradient></svg></body></html>";
    assert_eq!(
        body_inner(input),
        "<svg><linearGradient id=\"g\"></linearGradient></svg>"
    );
}

#[test]
fn implied_structure_serializes_fully() {
    // A bare fragment still serializes the implied html/head/body skeleton.
    assert_eq!(
        html_outer("<p>hello</p>"),
        "<html><head></head><body><p>hello</p></body></html>"
    );
}

#[test]
fn doctype_matches_happy_dom_serializer() {
    // happy-dom's doctype serializer emits the full PUBLIC/SYSTEM form (the
    // WHATWG algorithm's *text* alone would drop the identifiers).
    let parsed = parse(concat!(
        "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\" ",
        "\"http://www.w3.org/TR/html4/strict.dtd\">",
        "<html><body>x</body></html>"
    ));
    assert_eq!(
        serialize_node(&parsed.document, parsed.root).unwrap(),
        concat!(
            "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\" ",
            "\"http://www.w3.org/TR/html4/strict.dtd\">",
            "<html><head></head><body>x</body></html>"
        )
    );
}

#[test]
fn doctype_system_only_uses_system_keyword() {
    let parsed = parse(concat!(
        "<!DOCTYPE svg SYSTEM \"http://www.w3.org/2000/svg\">",
        "<html><body>x</body></html>"
    ));
    assert_eq!(
        serialize_node(&parsed.document, parsed.root).unwrap(),
        concat!(
            "<!DOCTYPE svg SYSTEM \"http://www.w3.org/2000/svg\">",
            "<html><head></head><body>x</body></html>"
        )
    );
}

#[test]
fn plain_doctype_has_no_identifiers() {
    let parsed = parse("<!DOCTYPE html><html><body>x</body></html>");
    assert_eq!(
        serialize_node(&parsed.document, parsed.root).unwrap(),
        "<!DOCTYPE html><html><head></head><body>x</body></html>"
    );
}

// ---- recorded gaps: spec-faithful deviations from happy-dom ---------------

#[test]
fn gap_attribute_values_escape_more_than_happy_dom() {
    // happy-dom 20.11.11 escapes only & and " in attribute values; the WHATWG
    // algorithm additionally escapes U+00A0, < and >. This serializer follows
    // WHATWG, so the output below is deliberately not what happy-dom emits
    // (happy-dom would keep `<`, `>` and the non-breaking space literal).
    let mut doc = Document::new();
    let div = doc.create_element("div").unwrap();
    doc.set_attribute(div, "x", "a < b > c & \" d \u{00A0} e")
        .unwrap();
    assert_eq!(
        serialize_node(&doc, div).unwrap(),
        "<div x=\"a &lt; b &gt; c &amp; &quot; d &nbsp; e\"></div>"
    );
}

#[test]
fn gap_rcdata_markup_is_escaped() {
    // `textarea` is RCDATA: markup stays literal in the tree and its data is
    // escaped on serialize (WHATWG). happy-dom's *parser* instead turns the
    // `<b>` inside the textarea into a real element, so its serialization
    // differs — a parser divergence, not a serializer one.
    let input = concat!(
        "<html><head><title>A &amp; B</title></head>",
        "<body><textarea><b>x</b> &amp; y</textarea></body></html>"
    );
    let expected = concat!(
        "<html><head><title>A &amp; B</title></head>",
        "<body><textarea>&lt;b&gt;x&lt;/b&gt; &amp; y</textarea></body></html>"
    );
    assert_eq!(html_outer(input), expected);
}

#[test]
fn gap_raw_text_xmp_iframe_noembed_noframes() {
    // `xmp`, `iframe`, `noembed`, `noframes` (and `plaintext`) are raw text:
    // their content is one literal text node and serializes verbatim.
    // happy-dom's parser treats markup inside them as real elements, so its
    // serialization differs for these elements (script/style match, see above).
    let input = concat!(
        "<html><body>",
        "<xmp><p>not a paragraph</p></xmp>",
        "<iframe><b>x</b></iframe>",
        "<noembed>ne &amp;</noembed>",
        "<noframes>nf <i>y</i></noframes>",
        "</body></html>"
    );
    assert_eq!(
        body_inner(input),
        concat!(
            "<xmp><p>not a paragraph</p></xmp>",
            "<iframe><b>x</b></iframe>",
            "<noembed>ne &amp;</noembed>",
            "<noframes>nf <i>y</i></noframes>"
        )
    );
}

#[test]
fn plaintext_swallows_the_rest_of_the_document() {
    let input = "<html><body><plaintext>z <w></body></html>";
    // Everything after `<plaintext>` is one literal text node, so the raw-text
    // content serializes verbatim and the element still gets its end tag
    // (plaintext is raw text but not void). Re-parsing the output swallows
    // that `</plaintext>` as text again — plaintext is inherently
    // non-round-trippable, which browsers share.
    assert_eq!(
        body_inner(input),
        "<plaintext>z <w></body></html></plaintext>"
    );
}

#[test]
fn noscript_text_depends_on_scripting_enabled() {
    let mut doc = Document::new();
    let noscript = doc.create_element("noscript").unwrap();
    let text = doc.create_text("a & b").unwrap();
    doc.append_child(noscript, text).unwrap();

    // Scripting enabled (default): text children are literal.
    let enabled = serialize(
        &doc,
        noscript,
        SerializationScope::IncludeNode,
        &SerializeOptions::default(),
    )
    .unwrap();
    assert_eq!(enabled, "<noscript>a & b</noscript>");

    // Scripting disabled: the text is escaped.
    let disabled = serialize(
        &doc,
        noscript,
        SerializationScope::IncludeNode,
        &SerializeOptions {
            scripting_enabled: false,
        },
    )
    .unwrap();
    assert_eq!(disabled, "<noscript>a &amp; b</noscript>");
}

// ---- round trips ----------------------------------------------------------

#[test]
fn parse_serialize_parse_preserves_structure_for_corpus() {
    let corpus = [
        F1_DOC,
        "<!DOCTYPE html><html><head><title>T</title></head><body>x</body></html>",
        "<html><body><script>a < b</script><style>c > d</style></body></html>",
        "<html><body><div id=\"a\" class=\"b c\">t</div></body></html>",
        "<html><body><!-- c --><div></div><span><br><img src=\"x\"></span></body></html>",
        "<html><body><template><p>in</p></template></body></html>",
        "<html><body><math><mi>x</mi></math></body></html>",
        "<html><body><svg><circle cx=\"4\" cy=\"4\" r=\"2\"/></svg></body></html>",
        "<html><body><p>&copy; &#65; &nbsp;</p></body></html>",
        "<html><body><table><tr><td>cell</td></tr></table></body></html>",
        "<html><body><p>one <b>bold</b> two</p></body></html>",
    ];
    for input in corpus {
        let first = parse(input);
        let html = find_element(&first.document, first.root, "html");
        let serialized = serialize_node(&first.document, html).unwrap();
        let second = parse(&serialized);
        let html2 = find_element(&second.document, second.root, "html");
        assert_eq!(
            shape(&second.document, html2),
            shape(&first.document, html),
            "parse→serialize→parse changed the tree for input {input:?}"
        );
        // The serializer never mutated the source arena.
        assert_eq!(first.document.check_invariants(first.root).unwrap(), ());
    }
}

#[test]
fn serialization_is_idempotent() {
    // Re-serializing a re-parsed tree yields the identical string, so the
    // serializer has a single stable normal form per tree.
    let corpus = [
        F1_DOC,
        "<html><body><script>if (a < b) { x = \"&amp;\"; }</script></body></html>",
        "<html><body><div data-x=\"a&amp;b\">t</div></body></html>",
        "<html><body><svg><circle cx=\"4\"/></svg></body></html>",
        "<html><body><p>&nbsp; &amp; &lt;</p></body></html>",
    ];
    for input in corpus {
        let first = parse(input);
        let html = find_element(&first.document, first.root, "html");
        let once = serialize_node(&first.document, html).unwrap();
        let second = parse(&once);
        let html2 = find_element(&second.document, second.root, "html");
        let twice = serialize_node(&second.document, html2).unwrap();
        assert_eq!(
            twice, once,
            "serialization must be idempotent for {input:?}"
        );
    }
}

#[test]
fn locates_pre_leading_newline_loss() {
    // The HTML5 parser strips one leading U+000A after a `<pre>` start tag, so
    // a programmatic `<pre>` whose text starts with a newline serializes to
    // `<pre>\n…</pre>` and re-parses with the newline gone. The shape
    // comparison surfaces the loss instead of masking it.
    let mut doc = Document::new();
    let pre = doc.create_element("pre").unwrap();
    let text = doc.create_text("\nindented").unwrap();
    doc.append_child(pre, text).unwrap();

    let serialized = serialize_node(&doc, pre).unwrap();
    assert_eq!(serialized, "<pre>\nindented</pre>");

    let reparsed = parse(&serialized);
    let pre2 = find_element(&reparsed.document, reparsed.root, "pre");
    let text: String = reparsed
        .document
        .children(pre2)
        .unwrap()
        .iter()
        .map(|&c| match reparsed.document.get(c).unwrap().data() {
            NodeData::Text { data } => data.clone(),
            _ => String::new(),
        })
        .collect();
    assert_eq!(
        text, "indented",
        "the leading newline is consumed on re-parse"
    );
    assert_ne!(
        shape(&reparsed.document, pre2),
        shape(&doc, pre),
        "the shape comparison must locate the leading-newline loss"
    );
}

#[test]
fn locates_adjacent_text_node_merge() {
    // The parser merges adjacent text nodes, so a programmatic tree with two
    // sibling text nodes collapses to one node on re-parse.
    let mut doc = Document::new();
    let div = doc.create_element("div").unwrap();
    let a = doc.create_text("a").unwrap();
    let b = doc.create_text("b").unwrap();
    doc.append_child(div, a).unwrap();
    doc.append_child(div, b).unwrap();

    let serialized = serialize_node(&doc, div).unwrap();
    assert_eq!(serialized, "<div>ab</div>");

    let reparsed = parse(&serialized);
    let div2 = find_element(&reparsed.document, reparsed.root, "div");
    assert_eq!(
        reparsed.document.children(div2).unwrap().len(),
        1,
        "the two adjacent text nodes merged on re-parse"
    );
    assert_ne!(shape(&reparsed.document, div2), shape(&doc, div));
}

#[test]
fn locates_foreign_element_namespace_loss() {
    // The WHATWG algorithm emits no synthetic xmlns declarations, so a foreign
    // element serialized standalone re-parses into the HTML namespace. The
    // round-trip comparison locates this loss explicitly.
    let first = parse("<svg><circle cx=\"1\"/></svg>");
    let circle = find_element(&first.document, first.root, "circle");
    assert_eq!(
        first
            .document
            .get(circle)
            .unwrap()
            .data()
            .element_namespace(),
        Some(SVG_NAMESPACE)
    );

    let serialized = serialize_node(&first.document, circle).unwrap();
    assert_eq!(serialized, "<circle cx=\"1\"></circle>");

    let reparsed = parse(&serialized);
    let circle2 = find_element(&reparsed.document, reparsed.root, "circle");
    assert_eq!(
        reparsed
            .document
            .get(circle2)
            .unwrap()
            .data()
            .element_namespace(),
        Some(HTML_NAMESPACE),
        "a standalone <circle> is HTML, so the SVG namespace is lost"
    );
    assert_ne!(
        shape(&reparsed.document, circle2),
        shape(&first.document, circle)
    );
}

#[test]
fn locates_comment_end_sequence_loss() {
    // Comment data containing `-->` terminates the comment on re-parse; the
    // serializer (like browsers) cannot preserve it. The round-trip locates
    // the lost data.
    let mut doc = Document::new();
    let comment = doc.create_comment("a-->b").unwrap();

    let serialized = serialize_node(&doc, comment).unwrap();
    assert_eq!(serialized, "<!--a-->b-->");

    let reparsed = parse(&serialized);
    let lost = subtree(&reparsed.document, reparsed.root).iter().all(|&n| {
        !matches!(
            reparsed.document.get(n).unwrap().data(),
            NodeData::Comment { data } if data == "a-->b"
        )
    });
    assert!(lost, "the original comment data must not survive re-parse");
    assert_ne!(
        shape(&reparsed.document, reparsed.root),
        shape(&doc, comment),
        "the shape comparison must locate the comment loss"
    );
}

// ---- scope, fragments and error handling ----------------------------------

#[test]
fn scoped_serialize_switches_between_node_and_children() {
    let mut doc = Document::new();
    let div = doc.create_element("div").unwrap();
    let text = doc.create_text("x").unwrap();
    doc.append_child(div, text).unwrap();

    assert_eq!(
        serialize(
            &doc,
            div,
            SerializationScope::IncludeNode,
            &SerializeOptions::default()
        )
        .unwrap(),
        "<div>x</div>"
    );
    assert_eq!(
        serialize(
            &doc,
            div,
            SerializationScope::ChildrenOnly,
            &SerializeOptions::default()
        )
        .unwrap(),
        "x"
    );
}

#[test]
fn document_fragment_serializes_its_children() {
    let mut doc = Document::new();
    let frag = doc.create_document_fragment().unwrap();
    let p = doc.create_element("p").unwrap();
    let text = doc.create_text("hi").unwrap();
    doc.append_child(p, text).unwrap();
    doc.append_child(frag, p).unwrap();

    assert_eq!(serialize_node(&doc, frag).unwrap(), "<p>hi</p>");
    assert_eq!(serialize_children(&doc, frag).unwrap(), "<p>hi</p>");
}

#[test]
fn leaf_nodes_serialize_directly() {
    let mut doc = Document::new();
    let text = doc.create_text("a < b & c").unwrap();
    assert_eq!(serialize_node(&doc, text).unwrap(), "a &lt; b &amp; c");
    let comment = doc.create_comment("note").unwrap();
    assert_eq!(serialize_node(&doc, comment).unwrap(), "<!--note-->");
}

#[test]
fn serialization_never_mutates_the_arena() {
    let parsed = parse(F1_DOC);
    let html = find_element(&parsed.document, parsed.root, "html");
    let node_count_before = subtree(&parsed.document, parsed.root).len();
    let body = find_element(&parsed.document, parsed.root, "body");

    serialize_node(&parsed.document, html).unwrap();
    serialize_children(&parsed.document, body).unwrap();

    let node_count_after = subtree(&parsed.document, parsed.root).len();
    assert_eq!(node_count_after, node_count_before, "no nodes allocated");
    assert_eq!(parsed.document.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn foreign_handle_is_rejected() {
    let mut a = Document::new();
    let b = Document::new();
    let el = a.create_element("div").unwrap();
    assert!(matches!(
        serialize_node(&b, el),
        Err(CoreError::WrongDocument { .. })
    ));
}

#[test]
fn stale_handle_is_rejected() {
    // Adoption moves the node out of the source arena; the old handle becomes
    // stale (the freed slot is reused with a bumped generation), so reading it
    // through the serializer's navigation API is rejected with an arena error.
    let mut source = Document::new();
    let mut target = Document::new();
    let div = source.create_element("div").unwrap();
    target.adopt_node(&mut source, div).unwrap();
    source.create_element("p").unwrap();

    assert!(matches!(
        serialize_node(&source, div),
        Err(CoreError::Arena(_))
    ));
}
