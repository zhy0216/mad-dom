//! T27 HTML fragment parser fixtures.
//!
//! Integration-level evidence for `src/html/fragment.rs` (and the fragment mode
//! of `src/html/sink.rs`): a fragment is parsed against a context element by
//! html5ever straight into the returned [`Document`]'s arena. The acceptance
//! criteria are pinned here:
//!
//! * *same input, different context elements* — the same markup yields the
//!   spec-defined tree under `table` / `tbody` / `tr` / `td` / `select`
//!   contexts (table insertion modes with implied elements and foster
//!   parenting), raw-text and RCDATA contexts (`script` / `style` /
//!   `textarea` / `title`), `template` contexts and foreign-namespace contexts
//!   (SVG / MathML / annotation-xml integration points);
//! * *fragment nodes belong to the target document and handles are valid* —
//!   every handle in [`ParsedFragment`] resolves against the returned
//!   [`Document`], is rejected by a foreign document, and the tree satisfies
//!   [`Document::check_invariants`];
//! * *no partial state* — malformed input still yields a complete tree plus
//!   collected diagnostics, and deeply nested input parses iteratively.
//!
//! The happy-dom differential for a first batch of scenarios lives in
//! `t27_fragment_diff.rs`.

mod common;

use common::SplitMix64;

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{
    Document, NodeData, NodeType, HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
};
use mad_dom_core::error::CoreError;
use mad_dom_core::html::{parse_html_fragment, FragmentContext, ParsedFragment};

// ---- shared helpers -------------------------------------------------------

fn context(name: &'static str) -> FragmentContext<'static> {
    FragmentContext {
        name,
        namespace: HTML_NAMESPACE,
        attributes: &[],
        allows_scripting: true,
    }
}

fn context_ns<'a>(
    name: &'a str,
    ns: &'a str,
    attrs: &'a [(&'a str, &'a str)],
) -> FragmentContext<'a> {
    FragmentContext {
        name,
        namespace: ns,
        attributes: attrs,
        allows_scripting: true,
    }
}

fn parse(input: &str, ctx: &FragmentContext<'_>) -> ParsedFragment {
    parse_html_fragment(input, ctx).expect("fragment parsing never fails")
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

fn kinds(doc: &Document, ids: &[NodeId]) -> Vec<NodeType> {
    ids.iter().map(|&id| doc.node_type(id).unwrap()).collect()
}

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

fn assert_node_text(doc: &Document, id: NodeId, expected: &str) {
    assert_eq!(text_of(doc, id), expected);
}

// ---- same input, different context elements --------------------------------

#[test]
fn table_row_markup_differs_across_contexts() {
    let input = "<tr><td>cell</td></tr>";

    // div: "in body" ignores tr/td as parse errors; only the text survives.
    let div = parse(input, &context("div"));
    let doc = &div.document;
    assert_eq!(kinds(doc, &div.nodes), [NodeType::Text]);
    assert_node_text(doc, div.nodes[0], "cell");
    assert!(
        !div.parse_errors.is_empty(),
        "tr/td in body are parse errors"
    );

    // table: "in table" wraps the row in an implied tbody.
    let table = parse(input, &context("table"));
    let doc = &table.document;
    assert_eq!(names(doc, &table.nodes), ["tbody"]);
    let tbody = table.nodes[0];
    assert_eq!(names(doc, &element_children(doc, tbody)), ["tr"]);
    let tr = element_children(doc, tbody)[0];
    assert_eq!(names(doc, &element_children(doc, tr)), ["td"]);
    let td = element_children(doc, tr)[0];
    assert_eq!(text_of(doc, children(doc, td)[0]), "cell");

    // tbody: "in table body" implies only the tr around the td.
    let tbody_ctx = parse(input, &context("tbody"));
    let doc = &tbody_ctx.document;
    assert_eq!(names(doc, &tbody_ctx.nodes), ["tr"]);
    let tr = tbody_ctx.nodes[0];
    assert_eq!(names(doc, &element_children(doc, tr)), ["td"]);
    assert_eq!(
        text_of(doc, children(doc, element_children(doc, tr)[0])[0]),
        "cell"
    );

    // td: "in cell" rejects the tr; the text survives.
    let td_ctx = parse(input, &context("td"));
    let doc = &td_ctx.document;
    assert_eq!(kinds(doc, &td_ctx.nodes), [NodeType::Text]);
    assert_node_text(doc, td_ctx.nodes[0], "cell");
    assert!(!td_ctx.parse_errors.is_empty());

    // Each parse owns its own document: contexts do not leak into each other.
    for parsed in [&div, &table, &tbody_ctx, &td_ctx] {
        assert_eq!(
            parsed
                .document
                .check_invariants(parsed.document_root)
                .unwrap(),
            ()
        );
    }
}

#[test]
fn bare_cell_in_table_gets_implied_tbody_and_tr() {
    let parsed = parse("<td>cell</td>", &context("table"));
    let doc = &parsed.document;
    assert_eq!(names(doc, &parsed.nodes), ["tbody"]);
    let tbody = parsed.nodes[0];
    let tr = element_children(doc, tbody)[0];
    assert_eq!(doc.node_name(tr).unwrap(), "tr");
    let td = element_children(doc, tr)[0];
    assert_eq!(doc.node_name(td).unwrap(), "td");
    assert_eq!(text_of(doc, children(doc, td)[0]), "cell");
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

#[test]
fn table_context_fosters_phrasing_content() {
    // Content that cannot live inside a table is fostered out of the fragment
    // sibling list (into the temporary root), per the fragment parsing rules.
    let parsed = parse("<div>a<p>b</div>c", &context("table"));
    let doc = &parsed.document;
    assert_eq!(names(doc, &parsed.nodes), ["div", "#text"]);
    let div = parsed.nodes[0];
    assert_eq!(names(doc, &element_children(doc, div)), ["p"]);
    assert_eq!(
        text_of(doc, children(doc, div)[0]),
        "a",
        "fostered div keeps its text"
    );
    assert_node_text(doc, parsed.nodes[1], "c");
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

#[test]
fn select_context_parses_options_and_drops_rejected_markup() {
    let parsed = parse("<option>o</option><div>x</div>", &context("select"));
    let doc = &parsed.document;
    assert_eq!(names(doc, &parsed.nodes), ["option", "div"]);
    assert_node_text(doc, children(doc, parsed.nodes[0])[0], "o");
    assert_node_text(doc, children(doc, parsed.nodes[1])[0], "x");
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

// ---- raw text and RCDATA contexts ------------------------------------------

#[test]
fn script_and_style_contexts_are_raw_text() {
    // A script context starts the tokenizer in script data: the whole input is
    // one literal text node, never markup.
    let source = "if (a < b) { x(); }";
    let script = parse(source, &context("script"));
    let doc = &script.document;
    assert_eq!(kinds(doc, &script.nodes), [NodeType::Text]);
    assert_node_text(doc, script.nodes[0], source);

    let markup = parse("<div>a</div>", &context("script"));
    let doc = &markup.document;
    assert_eq!(kinds(doc, &markup.nodes), [NodeType::Text]);
    assert_node_text(doc, markup.nodes[0], "<div>a</div>");

    let style = parse("a > b { color: red }", &context("style"));
    let doc = &style.document;
    assert_eq!(kinds(doc, &style.nodes), [NodeType::Text]);
    assert_node_text(doc, style.nodes[0], "a > b { color: red }");
}

#[test]
fn textarea_and_title_contexts_are_rcdata() {
    // RCDATA keeps markup literal but decodes character references.
    let textarea = parse("<b>x</b> &amp; y", &context("textarea"));
    let doc = &textarea.document;
    assert_eq!(kinds(doc, &textarea.nodes), [NodeType::Text]);
    assert_node_text(doc, textarea.nodes[0], "<b>x</b> & y");

    let title = parse("A &amp; B", &context("title"));
    let doc = &title.document;
    assert_eq!(kinds(doc, &title.nodes), [NodeType::Text]);
    assert_node_text(doc, title.nodes[0], "A & B");
}

#[test]
fn noscript_context_depends_on_scripting() {
    // noscript is raw text only when scripting is enabled; with scripting
    // disabled the tokenizer stays in data state and the markup parses.
    let enabled = FragmentContext {
        name: "noscript",
        namespace: HTML_NAMESPACE,
        attributes: &[],
        allows_scripting: true,
    };
    let parsed = parse("<p>n</p>", &enabled);
    let doc = &parsed.document;
    assert_eq!(kinds(doc, &parsed.nodes), [NodeType::Text]);
    assert_node_text(doc, parsed.nodes[0], "<p>n</p>");

    let disabled = FragmentContext {
        name: "noscript",
        namespace: HTML_NAMESPACE,
        attributes: &[],
        allows_scripting: false,
    };
    let parsed = parse("<p>n</p>", &disabled);
    let doc = &parsed.document;
    assert_eq!(names(doc, &parsed.nodes), ["p"]);
    assert_node_text(doc, children(doc, parsed.nodes[0])[0], "n");
}

// ---- template --------------------------------------------------------------

#[test]
fn template_context_parses_content() {
    // A template context selects "in template" mode: the row is parsed via the
    // table modes rather than being discarded.
    let parsed = parse("<tr><td>cell</td></tr>", &context("template"));
    let doc = &parsed.document;
    assert_eq!(names(doc, &parsed.nodes), ["tr"]);
    let tr = parsed.nodes[0];
    assert_eq!(names(doc, &element_children(doc, tr)), ["td"]);
    assert_eq!(
        text_of(doc, children(doc, element_children(doc, tr)[0])[0]),
        "cell"
    );
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

#[test]
fn template_element_in_input_gets_a_contents_fragment() {
    // A template inside the input keeps its content in a template-contents
    // DocumentFragment (HTML5 template contents), so the fragment sibling list
    // holds the template element with no element children.
    let parsed = parse("<template><p>inner</p></template>", &context("div"));
    let doc = &parsed.document;
    assert_eq!(names(doc, &parsed.nodes), ["template"]);
    let template = parsed.nodes[0];
    assert_eq!(
        element_children(doc, template),
        Vec::<NodeId>::new(),
        "template element children stay empty; content lives in template contents"
    );

    let contents = parsed
        .template_contents
        .iter()
        .find(|(element, _)| *element == template)
        .map(|&(_, fragment)| fragment)
        .expect("template contents fragment recorded");
    assert_eq!(doc.node_type(contents).unwrap(), NodeType::DocumentFragment);
    assert_eq!(names(doc, &element_children(doc, contents)), ["p"]);
    assert_eq!(
        text_of(doc, children(doc, element_children(doc, contents)[0])[0]),
        "inner"
    );

    // The contents fragment is a detached, valid node of the same document.
    assert_eq!(doc.parent(contents).unwrap(), None);
    assert_eq!(doc.check_invariants(contents).unwrap(), ());
}

// ---- foreign namespaces ----------------------------------------------------

#[test]
fn svg_and_mathml_contexts_enter_foreign_content() {
    let svg = parse("<circle cx='4'/>", &context_ns("svg", SVG_NAMESPACE, &[]));
    let doc = &svg.document;
    assert_eq!(names(doc, &svg.nodes), ["circle"]);
    assert_eq!(
        doc.get(svg.nodes[0]).unwrap().data().element_namespace(),
        Some(SVG_NAMESPACE)
    );
    assert_eq!(doc.get_attribute(svg.nodes[0], "cx").unwrap(), Some("4"));

    let math = parse("<mi>x</mi>", &context_ns("math", MATHML_NAMESPACE, &[]));
    let doc = &math.document;
    assert_eq!(names(doc, &math.nodes), ["mi"]);
    assert_eq!(
        doc.get(math.nodes[0]).unwrap().data().element_namespace(),
        Some(MATHML_NAMESPACE)
    );
}

#[test]
fn annotation_xml_integration_point_depends_on_context_attributes() {
    // A MathML annotation-xml context is an HTML integration point only when it
    // carries encoding="text/html". <mglyph> is not a breakout element, so it
    // is created in MathML without the flag and in HTML with it.
    let mathml = parse(
        "<mglyph>g</mglyph>",
        &context_ns("annotation-xml", MATHML_NAMESPACE, &[]),
    );
    let doc = &mathml.document;
    assert_eq!(
        doc.get(mathml.nodes[0]).unwrap().data().element_namespace(),
        Some(MATHML_NAMESPACE)
    );

    let integration = parse(
        "<mglyph>g</mglyph>",
        &context_ns(
            "annotation-xml",
            MATHML_NAMESPACE,
            &[("encoding", "text/html")],
        ),
    );
    let doc = &integration.document;
    assert_eq!(
        doc.get(integration.nodes[0])
            .unwrap()
            .data()
            .element_namespace(),
        Some(HTML_NAMESPACE),
        "encoding=text/html makes annotation-xml an HTML integration point"
    );
}

// ---- entities, comments and plain content ----------------------------------

#[test]
fn entities_decode_and_comments_parse_in_a_div_context() {
    let parsed = parse("a &amp; b < c", &context("div"));
    let doc = &parsed.document;
    assert_eq!(kinds(doc, &parsed.nodes), [NodeType::Text]);
    assert_node_text(doc, parsed.nodes[0], "a & b < c");

    let parsed = parse("<!-- comment -->text", &context("div"));
    let doc = &parsed.document;
    assert_eq!(
        kinds(doc, &parsed.nodes),
        [NodeType::Comment, NodeType::Text]
    );
    assert_eq!(
        doc.get(parsed.nodes[0]).unwrap().data().comment_data(),
        Some(" comment ")
    );
    assert_node_text(doc, parsed.nodes[1], "text");
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

#[test]
fn full_table_in_a_div_context_gets_implied_elements() {
    let parsed = parse("<table><tr><td>in</td></tr></table>", &context("div"));
    let doc = &parsed.document;
    assert_eq!(names(doc, &parsed.nodes), ["table"]);
    let table = parsed.nodes[0];
    assert_eq!(names(doc, &element_children(doc, table)), ["tbody"]);
    let tbody = element_children(doc, table)[0];
    assert_eq!(names(doc, &element_children(doc, tbody)), ["tr"]);
    let tr = element_children(doc, tbody)[0];
    assert_eq!(names(doc, &element_children(doc, tr)), ["td"]);
    let td = element_children(doc, tr)[0];
    assert_eq!(text_of(doc, children(doc, td)[0]), "in");
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

// ---- fragment nodes belong to the target document --------------------------

#[test]
fn every_handle_belongs_to_the_target_document() {
    let parsed = parse(
        "<table><tr><td>in</td></tr></table><template><p>t</p></template>",
        &context("div"),
    );
    let doc = &parsed.document;

    let mut all = Vec::new();
    for &node in &parsed.nodes {
        all.extend(subtree(doc, node));
    }
    all.push(parsed.document_root);
    all.push(parsed.root);
    for &(_, contents) in &parsed.template_contents {
        all.extend(subtree(doc, contents));
        all.push(contents);
    }

    // Every handle resolves against the owning document.
    for &id in &all {
        assert!(doc.get(id).is_ok(), "handle {id:?} must resolve");
        assert_eq!(doc.node_type(id).unwrap(), doc.node_type(id).unwrap());
    }

    // A foreign document rejects every handle with WrongDocument, never
    // misreading it as one of its own nodes.
    let foreign = Document::new();
    for &id in &all {
        assert!(
            matches!(foreign.get(id), Err(CoreError::WrongDocument { .. })),
            "foreign document must reject handle {id:?}"
        );
    }

    // The whole tree (temporary root included) satisfies the invariants, and so
    // does every detached template-contents fragment.
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
    for &(_, contents) in &parsed.template_contents {
        assert_eq!(doc.check_invariants(contents).unwrap(), ());
    }
}

#[test]
fn the_fragment_result_is_one_owned_document() {
    let parsed = parse("<p>hello</p>", &context("div"));
    let mut doc = parsed.document; // moved out: the only DOM is the returned Document
    let nodes = parsed.nodes;

    let p = nodes[0];
    assert_eq!(doc.node_name(p).unwrap(), "p");
    assert_eq!(doc.parent(p).unwrap(), Some(parsed.root));

    // The returned Document is a normal live document: the mutation API works
    // on it and the parser left no conflicting state.
    let extra = doc.create_element("span").unwrap();
    doc.append_child(p, extra).unwrap();
    assert_eq!(doc.node_name(extra).unwrap(), "span");
    assert_eq!(doc.parent(extra).unwrap(), Some(p));
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

// ---- error channel ---------------------------------------------------------

#[test]
fn empty_context_name_is_rejected() {
    let ctx = FragmentContext {
        name: "",
        namespace: HTML_NAMESPACE,
        attributes: &[],
        allows_scripting: true,
    };
    assert!(matches!(
        parse_html_fragment("x", &ctx),
        Err(CoreError::InvalidCharacter {
            what: "fragment context element name",
            character: None,
        })
    ));
}

#[test]
fn malformed_input_recovers_and_reports_diagnostics() {
    // Unclosed markup in a div context still produces a tree plus diagnostics.
    let parsed = parse("a <b>bold", &context("div"));
    let doc = &parsed.document;
    assert!(
        !parsed.parse_errors.is_empty(),
        "unclosed <b> is a parse error"
    );
    assert_eq!(names(doc, &parsed.nodes), ["#text", "b"]);
    assert_node_text(doc, parsed.nodes[0], "a ");
    assert_eq!(text_of(doc, children(doc, parsed.nodes[1])[0]), "bold");
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

// ---- resource limits -------------------------------------------------------

#[test]
fn deeply_nested_fragment_parses_without_stack_overflow() {
    const DEPTH: usize = 3_000;
    let input = format!("{}x{}", "<div>".repeat(DEPTH), "</div>".repeat(DEPTH));
    let parsed = parse(&input, &context("div"));
    let doc = &parsed.document;
    let mut depth = 0;
    let mut cur = parsed.nodes[0];
    while let Some(first) = doc.first_child(cur).unwrap() {
        if doc.node_type(first).unwrap() != NodeType::Element {
            break;
        }
        cur = first;
        depth += 1;
    }
    // The first div is the top of the fragment; the chain of element
    // first-children below it is `DEPTH - 1` deep.
    assert_eq!(depth, DEPTH - 1);
    assert_eq!(doc.check_invariants(parsed.document_root).unwrap(), ());
}

#[test]
fn seeded_generated_fragments_keep_stable_trees() {
    let mut rng = SplitMix64::new(0x7E27_2027_0000_0000);
    let tags = [
        "div", "p", "span", "ul", "li", "b", "i", "em", "table", "tr", "td",
    ];
    let contexts = ["div", "table", "tbody", "tr", "td", "template"];
    for round in 0..200 {
        let ctx_name = contexts[rng.usize_in(contexts.len())];
        let depth = 1 + rng.usize_in(5);
        let mut input = String::new();
        let mut open = Vec::new();
        for _ in 0..(1 + rng.usize_in(20)) {
            let tag = tags[rng.usize_in(tags.len())];
            input.push_str(&format!("<{tag}>"));
            open.push(tag);
            if rng.bool() {
                let text = format!("t{}", rng.usize_in(100));
                input.push_str(&text);
            }
            while open.len() > depth && rng.bool() {
                input.push_str(&format!("</{}>", open.pop().unwrap()));
            }
        }
        while let Some(tag) = open.pop() {
            input.push_str(&format!("</{tag}>"));
        }
        let parsed = parse(&input, &context(ctx_name));
        let doc = &parsed.document;
        // The whole document tree (temporary root html + the fragment) is
        // consistent; every fragment node is reachable from the document root.
        assert_eq!(
            doc.check_invariants(parsed.document_root).unwrap(),
            (),
            "round {round}: inconsistent document tree for {ctx_name}: {input:?}"
        );
        // Handles stay in the owning document.
        assert_eq!(doc.parent(parsed.document_root).unwrap(), None);
        for &node in &parsed.nodes {
            assert!(doc.get(node).is_ok());
        }
    }
}
