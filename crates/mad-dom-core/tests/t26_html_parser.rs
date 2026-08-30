//! T26 HTML document parser fixtures.
//!
//! Integration-level evidence for `src/html/mod.rs` / `src/html/sink.rs`: a
//! full HTML document is parsed by html5ever straight into the returned
//! [`Document`]'s arena. The three acceptance criteria are pinned here:
//!
//! * *no second long-lived DOM* — the parse output is a single [`Document`]
//!   whose only tree is reachable from [`ParsedDocument::root`]; every family
//!   re-verifies [`Document::check_invariants`] over the completed tree;
//! * *stable trees for common and malformed input* — the fixed corpus below
//!   covers doctype, implied html/head/body, entities, Raw Text / RCDATA,
//!   comments, tables with foster parenting, and HTML/SVG/MathML namespace
//!   boundaries, and the malformed corpus asserts html5ever's error-recovery
//!   shapes plus the collected diagnostics;
//! * *clear resource behaviour* — deeply nested and large inputs parse with
//!   linear node accounting and no stack overflow or crash.
//!
//! Only document parsing is exercised; fragment parsing (T27), serialization
//! (T28) and any JavaScript `innerHTML` surface are out of scope.

mod common;

use common::SplitMix64;

use html5ever::tree_builder::QuirksMode;

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{
    Document, NodeData, NodeType, HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
};
use mad_dom_core::html::{parse_html_document, ParsedDocument};

// ---- shared helpers -------------------------------------------------------

fn parse(input: &str) -> ParsedDocument {
    parse_html_document(input).expect("document parsing never fails")
}

fn children(doc: &Document, id: NodeId) -> Vec<NodeId> {
    doc.children(id).unwrap()
}

fn names(doc: &Document, ids: &[NodeId]) -> Vec<String> {
    ids.iter()
        .map(|&id| doc.node_name(id).unwrap().to_string())
        .collect()
}

fn element_children(doc: &Document, id: NodeId) -> Vec<NodeId> {
    children(doc, id)
        .into_iter()
        .filter(|&c| doc.node_type(c).unwrap() == NodeType::Element)
        .collect()
}

fn text_of(doc: &Document, id: NodeId) -> String {
    match doc.get(id).unwrap().data() {
        NodeData::Text { data } => data.clone(),
        other => panic!("expected a text node, got {other:?}"),
    }
}

/// Returns the first element named `name` reachable from `start` (excluding
/// `start` itself) via an iterative pre-order walk.
fn find_element(doc: &Document, start: NodeId, name: &str) -> NodeId {
    let mut stack = vec![start];
    while let Some(n) = stack.pop() {
        for &c in &children(doc, n) {
            if doc.node_type(c).unwrap() == NodeType::Element && doc.node_name(c).unwrap() == name {
                return c;
            }
            stack.push(c);
        }
    }
    panic!("no element named {name:?} reachable from {start:?}");
}

/// Walks the subtree rooted at `start` and returns every node handle in
/// document (pre) order.
fn subtree(doc: &Document, start: NodeId) -> Vec<NodeId> {
    let mut out = vec![start];
    let mut stack = vec![start];
    while let Some(n) = stack.pop() {
        for c in children(doc, n).into_iter().rev() {
            out.push(c);
            stack.push(c);
        }
    }
    out
}

// ---- doctype, html/head/body and tree shape -------------------------------

const CANONICAL: &str = concat!(
    "<!DOCTYPE html>\n",
    "<html><head><title>T&amp;S</title></head>\n",
    "<body class=\"main\">\n",
    "<div id=\"a\" class=\"container\"><p>hello</p><p class=\"x\">world</p></div>\n",
    "<!-- spike comment -->\n",
    "<svg viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"2\"/></svg>\n",
    "</body></html>\n"
);

#[test]
fn canonical_document_has_stable_tree_shape() {
    let parsed = parse(CANONICAL);
    let doc = &parsed.document;
    let root = parsed.root;

    assert_eq!(
        parsed.parse_errors,
        Vec::<String>::new(),
        "canonical input parses clean"
    );
    assert_eq!(parsed.quirks_mode, QuirksMode::NoQuirks);

    // Document children: doctype then the html root element.
    let doc_children = children(doc, root);
    assert_eq!(
        doc_children.len(),
        2,
        "document children: {:?}",
        doc_children
    );
    assert_eq!(
        doc.node_type(doc_children[0]).unwrap(),
        NodeType::DocumentType
    );
    assert_eq!(doc.node_type(doc_children[1]).unwrap(), NodeType::Element);
    assert_eq!(doc.node_name(doc_children[1]).unwrap(), "html");

    // Doctype payload is fully recorded.
    let (doctype_name, public_id, system_id) = doc
        .get(doc_children[0])
        .unwrap()
        .data()
        .doctype_data()
        .expect("doctype node");
    assert_eq!(doctype_name, "html");
    assert_eq!(public_id, "");
    assert_eq!(system_id, "");

    // html > head, body.
    let html = doc_children[1];
    assert_eq!(
        doc.get(html).unwrap().data().element_namespace(),
        Some(HTML_NAMESPACE)
    );
    assert_eq!(names(doc, &element_children(doc, html)), ["head", "body"]);

    // head > title, entity expanded and adjacent text merged.
    let head = element_children(doc, html)[0];
    let title = find_element(doc, head, "title");
    let title_children = children(doc, title);
    assert_eq!(
        title_children.len(),
        1,
        "adjacent text must merge into one node"
    );
    assert_eq!(text_of(doc, title_children[0]), "T&S");

    // body attributes, div/paragraph nesting, comment node.
    let body = element_children(doc, html)[1];
    assert_eq!(doc.get_attribute(body, "class").unwrap(), Some("main"));
    let div = find_element(doc, body, "div");
    assert_eq!(doc.get_attribute(div, "id").unwrap(), Some("a"));
    assert_eq!(doc.get_attribute(div, "class").unwrap(), Some("container"));
    let paragraphs = element_children(doc, div);
    assert_eq!(names(doc, &paragraphs), ["p", "p"]);
    assert_eq!(text_of(doc, children(doc, paragraphs[0])[0]), "hello");
    assert_eq!(text_of(doc, children(doc, paragraphs[1])[0]), "world");
    assert_eq!(
        doc.get_attribute(paragraphs[1], "class").unwrap(),
        Some("x")
    );

    let comment = children(doc, body)
        .into_iter()
        .find(|&c| doc.node_type(c).unwrap() == NodeType::Comment)
        .expect("comment node in body");
    assert_eq!(
        doc.get(comment).unwrap().data().comment_data(),
        Some(" spike comment ")
    );

    // The whole document satisfies the tree invariants.
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn implied_html_head_body_are_created_for_bare_content() {
    let parsed = parse("<p>hello</p>");
    let doc = &parsed.document;
    let root = parsed.root;

    // No doctype: document has exactly the implied html element, and the
    // missing doctype leaves the document in quirks mode.
    let doc_children = children(doc, root);
    assert_eq!(doc_children.len(), 1);
    assert_eq!(doc.node_name(doc_children[0]).unwrap(), "html");
    assert_eq!(parsed.quirks_mode, QuirksMode::Quirks);

    let html = doc_children[0];
    // head is implied (empty) before body, and the <p> lands in body.
    let top = element_children(doc, html);
    assert_eq!(names(doc, &top), ["head", "body"]);
    assert_eq!(children(doc, top[0]), Vec::<NodeId>::new());
    let body = top[1];
    let p = find_element(doc, body, "p");
    assert_eq!(doc.node_name(p).unwrap(), "p");
    assert_eq!(text_of(doc, children(doc, p)[0]), "hello");
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn explicit_head_and_body_without_html_tag() {
    let parsed = parse("<head><title>t</title></head><body>b</body>");
    let doc = &parsed.document;
    let root = parsed.root;

    let doc_children = children(doc, root);
    assert_eq!(doc_children.len(), 1);
    let html = doc_children[0];
    let top = element_children(doc, html);
    assert_eq!(names(doc, &top), ["head", "body"]);
    assert_eq!(
        text_of(doc, children(doc, find_element(doc, top[0], "title"))[0]),
        "t"
    );
    assert_eq!(text_of(doc, children(doc, top[1])[0]), "b");
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn duplicate_html_and_body_tags_are_ignored() {
    // The second <html> and <body> tags are parse errors and never create a
    // second document structure, but their *content* is still processed in
    // body mode, so both paragraphs land in the single body element.
    let parsed = parse("<html><body><p>a</p></body></html><html><body><p>b</p></body></html>");
    let doc = &parsed.document;
    let root = parsed.root;

    let doc_children = children(doc, root);
    assert_eq!(doc_children.len(), 1, "only one html element ever exists");
    let top = element_children(doc, doc_children[0]);
    assert_eq!(names(doc, &top), ["head", "body"]);
    let body = top[1];
    let paragraphs = element_children(doc, body);
    assert_eq!(
        paragraphs.len(),
        2,
        "second body's content joins the existing body"
    );
    assert_eq!(text_of(doc, children(doc, paragraphs[0])[0]), "a");
    assert_eq!(text_of(doc, children(doc, paragraphs[1])[0]), "b");
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn whitespace_between_elements_becomes_text_nodes() {
    let parsed = parse("<html><head></head><body><p>a</p> <p>b</p></body></html>");
    let doc = &parsed.document;
    let root = parsed.root;

    let body = find_element(doc, root, "body");
    let kinds: Vec<NodeType> = children(doc, body)
        .iter()
        .map(|&c| doc.node_type(c).unwrap())
        .collect();
    assert_eq!(
        kinds,
        [NodeType::Element, NodeType::Text, NodeType::Element]
    );
    let ps = element_children(doc, body);
    assert_eq!(text_of(doc, children(doc, ps[0])[0]), "a");
    assert_eq!(text_of(doc, children(doc, ps[1])[0]), "b");
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

// ---- doctype variants and quirks mode -------------------------------------

#[test]
fn doctype_is_case_insensitive_and_selects_no_quirks() {
    for input in ["<!DOCTYPE html>", "<!doctype html>", "<!DOCTYPE HTML>"] {
        let parsed = parse(input);
        assert_eq!(parsed.quirks_mode, QuirksMode::NoQuirks, "input {input:?}");
        let doc_children = children(&parsed.document, parsed.root);
        let doctype = doc_children
            .iter()
            .find(|&&c| parsed.document.node_type(c).unwrap() == NodeType::DocumentType)
            .expect("doctype node");
        assert_eq!(
            parsed
                .document
                .get(*doctype)
                .unwrap()
                .data()
                .doctype_data()
                .unwrap()
                .0,
            "html"
        );
    }
}

#[test]
fn frameset_legacy_doctype_selects_quirks() {
    // The 4.01 Frameset / Transitional public identifiers with no system
    // identifier are the legacy-quirks trigger (WHATWG "set the Document to
    // quirks mode"). The strict "-//W3C//DTD HTML 4.01//EN" is *not* one of
    // them and selects NoQuirks instead.
    let frameset = parse("<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.01 Frameset//EN\">");
    assert_eq!(frameset.quirks_mode, QuirksMode::Quirks);

    let transitional = parse("<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\">");
    assert_eq!(transitional.quirks_mode, QuirksMode::Quirks);

    let strict_no_system = parse("<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.01//EN\">");
    assert_eq!(strict_no_system.quirks_mode, QuirksMode::NoQuirks);
}

#[test]
fn xhtml_doctype_with_system_identifier_selects_no_quirks() {
    let parsed = parse(concat!(
        "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\" ",
        "\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd\">"
    ));
    assert_eq!(parsed.quirks_mode, QuirksMode::NoQuirks);
}

#[test]
fn non_html_doctype_name_selects_quirks() {
    let parsed = parse("<!DOCTYPE svg>");
    assert_eq!(parsed.quirks_mode, QuirksMode::Quirks);
}

#[test]
fn doctype_public_and_system_identifiers_are_recorded() {
    let parsed = parse(concat!(
        "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\" ",
        "\"http://www.w3.org/TR/html4/strict.dtd\">"
    ));
    let doctype = children(&parsed.document, parsed.root)[0];
    let (name, public_id, system_id) = parsed
        .document
        .get(doctype)
        .unwrap()
        .data()
        .doctype_data()
        .expect("doctype node");
    assert_eq!(name, "html");
    assert_eq!(public_id, "-//W3C//DTD HTML 4.01//EN");
    assert_eq!(system_id, "http://www.w3.org/TR/html4/strict.dtd");
}

// ---- entities -------------------------------------------------------------

#[test]
fn named_and_numeric_entities_are_expanded() {
    let parsed = parse("<p>&amp; &lt; &gt; &quot; &apos; &copy; &#65; &#x41;</p>");
    let doc = &parsed.document;
    let p = find_element(doc, parsed.root, "p");
    let text = children(doc, p)
        .iter()
        .map(|&c| text_of(doc, c))
        .collect::<Vec<_>>()
        .join("");
    assert_eq!(text, "& < > \" ' \u{a9} A A");
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn unknown_entity_is_left_literal() {
    let parsed = parse("<p>&unknown; &amp;</p>");
    let doc = &parsed.document;
    let p = find_element(doc, parsed.root, "p");
    let text = children(doc, p)
        .iter()
        .map(|&c| text_of(doc, c))
        .collect::<Vec<_>>()
        .join("");
    // `&unknown;` has no definition and stays literal; `&amp;` decodes.
    assert_eq!(text, "&unknown; &");
    assert!(
        !parsed.parse_errors.is_empty(),
        "unknown reference is a parse error"
    );
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

// ---- Raw Text and RCDATA ---------------------------------------------------

#[test]
fn script_and_style_are_raw_text() {
    let source = "if (a < b && c > d) { x = \"&amp;\"; }";
    let parsed = parse(&format!(
        "<script>{source}</script><style>a > b {{ color: red }}</style>"
    ));
    let doc = &parsed.document;
    let script = find_element(doc, parsed.root, "script");
    // Raw text: no markup, no entity decoding — the source is one literal node.
    let script_text = children(doc, script)
        .iter()
        .map(|&c| text_of(doc, c))
        .collect::<Vec<_>>()
        .join("");
    assert_eq!(script_text, source);
    let style = find_element(doc, parsed.root, "style");
    let style_text = children(doc, style)
        .iter()
        .map(|&c| text_of(doc, c))
        .collect::<Vec<_>>()
        .join("");
    assert_eq!(style_text, "a > b { color: red }");
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn title_and_textarea_are_rcdata() {
    let parsed = parse("<title>A &amp; B</title><textarea><b>x</b> &amp; y</textarea>");
    let doc = &parsed.document;

    let title = find_element(doc, parsed.root, "title");
    assert_eq!(
        children(doc, title)
            .iter()
            .map(|&c| text_of(doc, c))
            .collect::<Vec<_>>()
            .join(""),
        "A & B",
        "RCDATA decodes entities"
    );

    let textarea = find_element(doc, parsed.root, "textarea");
    assert_eq!(
        children(doc, textarea)
            .iter()
            .map(|&c| text_of(doc, c))
            .collect::<Vec<_>>()
            .join(""),
        "<b>x</b> & y",
        "RCDATA keeps markup literal but decodes entities"
    );
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn xmp_is_raw_text() {
    let parsed = parse("<xmp><p>not a paragraph</p></xmp>");
    let doc = &parsed.document;
    let xmp = find_element(doc, parsed.root, "xmp");
    assert_eq!(
        children(doc, xmp)
            .iter()
            .map(|&c| text_of(doc, c))
            .collect::<Vec<_>>()
            .join(""),
        "<p>not a paragraph</p>"
    );
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

// ---- malformed markup ------------------------------------------------------

#[test]
fn stray_end_tag_recovers_and_reports() {
    let parsed = parse("</div><p>unclosed");
    let doc = &parsed.document;
    assert!(
        !parsed.parse_errors.is_empty(),
        "malformed input reports diagnostics"
    );

    // Error recovery still builds a tree containing the p and its text.
    let p = find_element(doc, parsed.root, "p");
    assert_eq!(text_of(doc, children(doc, p)[0]), "unclosed");
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn misnested_inline_elements_follow_adoption_agency() {
    // `<b><i>x</b>y</i>` — the stray `</b>` closes b; the i is reopened around
    // the remaining text per the adoption agency algorithm.
    let parsed = parse("<p><b><i>x</b>y</i></p>");
    let doc = &parsed.document;
    let p = find_element(doc, parsed.root, "p");
    let p_elements = element_children(doc, p);
    assert_eq!(
        names(doc, &p_elements),
        ["b", "i"],
        "b is closed early, i is reopened"
    );
    let b = p_elements[0];
    let i_inside_b = element_children(doc, b);
    assert_eq!(names(doc, &i_inside_b), ["i"]);
    assert_eq!(text_of(doc, children(doc, i_inside_b[0])[0]), "x");
    assert_eq!(text_of(doc, children(doc, p_elements[1])[0]), "y");
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn block_start_auto_closes_open_paragraph() {
    let parsed = parse("<p>a<div>b</div>");
    let doc = &parsed.document;
    let body = find_element(doc, parsed.root, "body");
    let elements = element_children(doc, body);
    assert_eq!(
        names(doc, &elements),
        ["p", "div"],
        "the p is closed before the div"
    );
    assert_eq!(text_of(doc, children(doc, elements[0])[0]), "a");
    assert_eq!(text_of(doc, children(doc, elements[1])[0]), "b");
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn duplicate_attributes_keep_first() {
    let parsed = parse("<div id=\"a\" id=\"b\">x</div>");
    let doc = &parsed.document;
    let div = find_element(doc, parsed.root, "div");
    assert_eq!(
        doc.get_attribute(div, "id").unwrap(),
        Some("a"),
        "first duplicate wins"
    );
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn table_foster_parenting_moves_phrasing_content_out() {
    let parsed = parse("<table><div>x</div><tr><td>y</td></tr></table>");
    let doc = &parsed.document;
    let root = parsed.root;

    // The div cannot live inside the table; it is fostered before the table,
    // as a child of the table's parent.
    let body = find_element(doc, root, "body");
    let body_elements = element_children(doc, body);
    assert_eq!(names(doc, &body_elements), ["div", "table"]);
    assert_eq!(text_of(doc, children(doc, body_elements[0])[0]), "x");

    // The table gains the implied tbody around the tr/td.
    let table = body_elements[1];
    let tbody = element_children(doc, table);
    assert_eq!(names(doc, &tbody), ["tbody"]);
    let tr = element_children(doc, tbody[0]);
    assert_eq!(names(doc, &tr), ["tr"]);
    let td = element_children(doc, tr[0]);
    assert_eq!(names(doc, &td), ["td"]);
    assert_eq!(text_of(doc, children(doc, td[0])[0]), "y");
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn template_is_a_stable_container_in_this_milestone() {
    // T26 scope: template contents become ordinary children of the template
    // element (the HTML5 template DocumentFragment is T27's concern). The tree
    // stays stable and valid.
    let parsed = parse("<template><p>in</p></template>");
    let doc = &parsed.document;
    let template = find_element(doc, parsed.root, "template");
    let inner = element_children(doc, template);
    assert_eq!(names(doc, &inner), ["p"]);
    assert_eq!(text_of(doc, children(doc, inner[0])[0]), "in");
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn bogus_comments_and_processing_instruction_like_text() {
    let parsed = parse("<p>a</p><?php echo \"x\"; ?><!-- real comment -->");
    let doc = &parsed.document;
    let body = find_element(doc, parsed.root, "body");
    let kinds: Vec<NodeType> = children(doc, body)
        .iter()
        .map(|&c| doc.node_type(c).unwrap())
        .collect();
    // `<?...?>` becomes a comment node; both comments carry their content.
    assert_eq!(
        kinds,
        [NodeType::Element, NodeType::Comment, NodeType::Comment]
    );
    let comments: Vec<String> = children(doc, body)
        .iter()
        .filter(|&&c| doc.node_type(c).unwrap() == NodeType::Comment)
        .map(|&c| {
            doc.get(c)
                .unwrap()
                .data()
                .comment_data()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(comments, ["?php echo \"x\"; ?", " real comment "]);
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn implied_body_gains_attributes_from_later_body_tag() {
    // The body element is implied by the <p>; the later explicit <body> tag is
    // a parse error whose attributes are merged into the existing element via
    // the `add_attrs_if_missing` tree-builder callback.
    let parsed = parse("<p>a</p><body class=\"main\" id=\"root\"></body>");
    let doc = &parsed.document;
    let body = find_element(doc, parsed.root, "body");
    assert_eq!(doc.get_attribute(body, "class").unwrap(), Some("main"));
    assert_eq!(doc.get_attribute(body, "id").unwrap(), Some("root"));
    assert!(
        !parsed.parse_errors.is_empty(),
        "the second body tag is a parse error"
    );
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

// ---- namespace boundaries --------------------------------------------------

#[test]
fn svg_subtree_stays_in_the_svg_namespace() {
    let parsed = parse("<svg viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"2\"/></svg>");
    let doc = &parsed.document;

    let svg = find_element(doc, parsed.root, "svg");
    assert_eq!(
        doc.get(svg).unwrap().data().element_namespace(),
        Some(SVG_NAMESPACE)
    );
    let circle = element_children(doc, svg)[0];
    assert_eq!(doc.node_name(circle).unwrap(), "circle");
    assert_eq!(
        doc.get(circle).unwrap().data().element_namespace(),
        Some(SVG_NAMESPACE)
    );
    // The outer container is still the HTML body.
    let body = find_element(doc, parsed.root, "body");
    assert_eq!(
        doc.get(body).unwrap().data().element_namespace(),
        Some(HTML_NAMESPACE)
    );
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn svg_adjusts_element_names() {
    let parsed = parse("<svg><linearGradient id=\"g\"/></svg>");
    let doc = &parsed.document;
    let svg = find_element(doc, parsed.root, "svg");
    let gradient = element_children(doc, svg)[0];
    // The SVG camel-case name is preserved (not lowercased like HTML names).
    assert_eq!(doc.node_name(gradient).unwrap(), "linearGradient");
    assert_eq!(doc.get_attribute(gradient, "id").unwrap(), Some("g"));
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn mathml_subtree_stays_in_the_mathml_namespace() {
    let parsed = parse("<math><mi>x</mi><mn>1</mn></math>");
    let doc = &parsed.document;
    let math = find_element(doc, parsed.root, "math");
    assert_eq!(
        doc.get(math).unwrap().data().element_namespace(),
        Some(MATHML_NAMESPACE)
    );
    let mi = element_children(doc, math)[0];
    assert_eq!(doc.node_name(mi).unwrap(), "mi");
    assert_eq!(
        doc.get(mi).unwrap().data().element_namespace(),
        Some(MATHML_NAMESPACE)
    );
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn foreign_object_re_enters_the_html_namespace() {
    let parsed = parse("<svg><foreignObject><div>html content</div></foreignObject></svg>");
    let doc = &parsed.document;
    let div = find_element(doc, parsed.root, "div");
    assert_eq!(
        doc.get(div).unwrap().data().element_namespace(),
        Some(HTML_NAMESPACE)
    );
    assert_eq!(
        text_of(doc, children(doc, div)[0]),
        "html content",
        "HTML text rules apply inside foreignObject"
    );
    let svg = find_element(doc, parsed.root, "svg");
    assert_eq!(
        doc.get(svg).unwrap().data().element_namespace(),
        Some(SVG_NAMESPACE)
    );
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn mathml_annotation_xml_integration_point_parses_html() {
    let parsed = parse(concat!(
        "<math><annotation-xml encoding=\"text/html\">",
        "<div>html</div>",
        "</annotation-xml></math>"
    ));
    let doc = &parsed.document;
    let div = find_element(doc, parsed.root, "div");
    assert_eq!(
        doc.get(div).unwrap().data().element_namespace(),
        Some(HTML_NAMESPACE),
        "annotation-xml is an HTML integration point, so <div> is HTML"
    );
    assert_eq!(text_of(doc, children(doc, div)[0]), "html");
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn cdata_in_svg_is_literal_text() {
    let parsed = parse("<svg><![CDATA[foo < bar & baz]]></svg>");
    let doc = &parsed.document;
    let svg = find_element(doc, parsed.root, "svg");
    let text = children(doc, svg)
        .iter()
        .map(|&c| text_of(doc, c))
        .collect::<Vec<_>>()
        .join("");
    assert_eq!(text, "foo < bar & baz");
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

// ---- no second long-lived DOM ---------------------------------------------

#[test]
fn the_whole_parse_output_is_one_owned_document() {
    let parsed = parse(CANONICAL);
    let mut doc = parsed.document; // moved out: the only DOM is the returned Document
    let root = parsed.root;

    // Every node is reachable from the document root through the public
    // navigation API, and the invariants hold over the entire tree.
    let reachable = subtree(&doc, root);
    assert!(reachable.len() > 10, "canonical corpus is not trivial");
    assert_eq!(doc.check_invariants(root).unwrap(), ());

    // The returned Document is a normal live document: the mutation API works
    // on it and the parser left no conflicting state.
    let extra = doc.create_element("p").unwrap();
    let body = find_element(&doc, root, "body");
    doc.append_child(body, extra).unwrap();
    assert_eq!(doc.node_name(extra).unwrap(), "p");
    assert_eq!(doc.parent(extra).unwrap(), Some(body));
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

// ---- resource limits: deep and large inputs --------------------------------

#[test]
fn deeply_nested_input_parses_without_stack_overflow() {
    // html5ever's tree builder runs the spec's "has a p element in button
    // scope" stack scan for every block-level start tag, so *pathologically*
    // deep nesting of non-boundary elements is O(depth²) in the tree builder
    // itself (the same algorithm browsers run, with a slower scan). 3000 levels
    // stays comfortably inside CI time while proving that deep nesting neither
    // overflows the stack nor corrupts the tree; the linear node-accounting
    // evidence for large inputs lives in the wide test below.
    const DEPTH: usize = 3_000;
    let input = format!("{}hello{}", "<div>".repeat(DEPTH), "</div>".repeat(DEPTH));
    let parsed = parse(&input);
    let doc = &parsed.document;

    // The chain is exactly `html > body > div^DEPTH` plus the implied empty
    // head: every level is reachable and the leaf text is intact.
    let body = find_element(doc, parsed.root, "body");
    let mut depth = 0;
    let mut cur = body;
    while let Some(first) = doc.first_child(cur).unwrap() {
        if doc.node_type(first).unwrap() != NodeType::Element {
            break;
        }
        cur = first;
        depth += 1;
    }
    assert_eq!(depth, DEPTH);
    let leaf = doc
        .first_child(cur)
        .unwrap()
        .expect("deepest div has a text child");
    assert_eq!(doc.get(leaf).unwrap().data().text_data(), Some("hello"));
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn wide_large_document_parses_with_linear_node_accounting() {
    const WIDTH: usize = 100_000;
    let mut input = String::with_capacity(WIDTH * 8);
    input.push_str("<ul>");
    for _ in 0..WIDTH {
        input.push_str("<li>item</li>");
    }
    input.push_str("</ul>");

    let parsed = parse(&input);
    let doc = &parsed.document;
    let ul = find_element(doc, parsed.root, "ul");
    let items = element_children(doc, ul);
    assert_eq!(items.len(), WIDTH);
    assert_eq!(text_of(doc, children(doc, items[0])[0]), "item");
    assert_eq!(text_of(doc, children(doc, items[WIDTH - 1])[0]), "item");

    // Linear accounting: the number of nodes reachable from the root is
    // exactly what the input implies (doctype-free: html + empty head + body +
    // ul + WIDTH li + WIDTH text + the document root itself).
    let reachable = subtree(doc, parsed.root).len();
    assert_eq!(reachable, 1 + 3 + 1 + WIDTH + WIDTH);
    assert_eq!(doc.check_invariants(parsed.root).unwrap(), ());
}

#[test]
fn seeded_generated_documents_keep_stable_trees() {
    // A deterministic corpus of medium-size documents exercises the parser in
    // bulk; every tree must stay internally consistent.
    let mut rng = SplitMix64::new(0x7E26_2026_0000_0000);
    let tags = [
        "div", "p", "span", "ul", "li", "section", "article", "aside",
    ];
    for round in 0..200 {
        let depth = 1 + rng.usize_in(6);
        let mut input = String::new();
        let mut open = Vec::new();
        for _ in 0..(1 + rng.usize_in(40)) {
            let tag = tags[rng.usize_in(tags.len())];
            input.push_str(&format!("<{tag}>"));
            open.push(tag);
            if rng.bool() {
                let text = format!("t{}", rng.usize_in(1000));
                input.push_str(&text);
            }
            while open.len() > depth && rng.bool() {
                input.push_str(&format!("</{}>", open.pop().unwrap()));
            }
        }
        while let Some(tag) = open.pop() {
            input.push_str(&format!("</{tag}>"));
        }
        let parsed = parse(&input);
        assert_eq!(
            parsed.document.check_invariants(parsed.root).unwrap(),
            (),
            "round {round} produced an inconsistent tree"
        );
        // The parser never leaves an element pointing outside the document.
        assert_eq!(
            parsed.document.parent(parsed.root).unwrap(),
            None,
            "round {round}: the document root must stay a root"
        );
    }
}
