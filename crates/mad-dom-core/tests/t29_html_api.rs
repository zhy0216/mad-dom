//! T29 HTML document-structure API and atomic fragment application fixtures.
//!
//! Integration-level evidence for `src/html/apply.rs`: the Core contract the
//! JavaScript `innerHTML` / `outerHTML` accessors and the
//! `documentElement` / `head` / `body` / `load_html` surface call.
//!
//! The acceptance criteria pinned here:
//!
//! * *document structure* — `document_root` is lazily allocated and stable,
//!   `ensure_html_skeleton` builds the implied `<html><head></head>
//!   <body></body></html>` skeleton exactly once, and `documentElement` /
//!   `head` / `body` are live reads of the current tree (they reflect
//!   `outerHTML` replacements that remove `head`/`body`);
//! * *parse → modify → serialize* — a full document loaded with `load_html`
//!   round-trips through the T28 serializer, and `innerHTML`/`outerHTML`
//!   getters produce the WHATWG serialization happy-dom emits for the common
//!   corpus;
//! * *context calibration* — the `innerHTML` setter parses in the target's own
//!   context (a `table` target inserts `tbody`, a `select` keeps option rows,
//!   `title` stays RCDATA), and the `outerHTML` setter parses in the parent's
//!   context (a `body` replacement strips a leading `<body>` tag);
//! * *replacement atomicity* — a failed setter (wrong-document, stale or
//!   non-element target) leaves the tree byte-for-byte unchanged, and a
//!   successful replacement detaches the old children (their handles stay
//!   live) while leaving the invariants intact.

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeData, NodeType};
use mad_dom_core::error::CoreError;
use mad_dom_core::serialize::serialize_node;

fn assert_hierarchy(err: CoreError) {
    assert!(
        matches!(err, CoreError::Hierarchy { .. }),
        "expected Hierarchy, got {err:?}"
    );
}

/// Parses `input` and returns the resulting document plus its document element.
fn load(input: &str) -> (Document, NodeId) {
    let mut doc = Document::new();
    doc.load_html(input).unwrap();
    let element = doc
        .document_element()
        .unwrap()
        .expect("loaded doc has an element");
    (doc, element)
}

/// Returns the tree-order (pre-order) concatenation of every `Text` node's
/// data in the subtree rooted at `start`.
fn text(doc: &Document, start: NodeId) -> String {
    let mut out = String::new();
    let mut stack = vec![start];
    while let Some(n) = stack.pop() {
        if let NodeData::Text { data } = doc.get(n).unwrap().data() {
            out.push_str(data);
        }
        // Push children in reverse so the pop order is document order.
        for c in doc.children(n).unwrap().iter().rev() {
            stack.push(*c);
        }
    }
    out
}

// ---- document structure ----------------------------------------------------

#[test]
fn document_root_is_allocated_lazily_and_is_stable() {
    let mut doc = Document::new();
    assert_eq!(
        doc.document_element().unwrap(),
        None,
        "no root -> no element"
    );

    let root = doc.document_root();
    assert_eq!(doc.node_type(root).unwrap(), NodeType::Document);
    assert_eq!(doc.document_root(), root, "the root id is cached");
    assert_eq!(doc.children(root).unwrap(), Vec::<NodeId>::new());
}

#[test]
fn document_element_head_body_read_none_before_the_skeleton() {
    let doc = Document::new();
    assert_eq!(doc.document_element().unwrap(), None);
    assert_eq!(doc.document_head().unwrap(), None);
    assert_eq!(doc.document_body().unwrap(), None);
}

#[test]
fn ensure_html_skeleton_builds_the_implied_structure_once() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    doc.ensure_html_skeleton().unwrap();

    let html = doc.document_element().unwrap().expect("html built");
    assert_eq!(doc.node_name(html).unwrap(), "html");
    assert_eq!(doc.children(html).unwrap().len(), 2);

    let head = doc.document_head().unwrap().expect("head built");
    let body = doc.document_body().unwrap().expect("body built");
    assert_eq!(doc.node_name(head).unwrap(), "head");
    assert_eq!(doc.node_name(body).unwrap(), "body");
    assert_eq!(doc.children(head).unwrap(), Vec::<NodeId>::new());
    assert_eq!(doc.children(body).unwrap(), Vec::<NodeId>::new());

    assert_eq!(
        serialize_node(&doc, html).unwrap(),
        "<html><head></head><body></body></html>"
    );
    let root = doc.document_root();
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn document_accessors_are_live_reads_of_the_tree() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let html = doc.document_element().unwrap().unwrap();
    let body = doc.document_body().unwrap().unwrap();

    // The same live element is returned on every read.
    assert_eq!(doc.document_body().unwrap(), Some(body));
    assert_eq!(
        doc.document_head()
            .unwrap()
            .map(|h| doc.node_name(h).unwrap()),
        Some("head")
    );

    // A write through the live body is visible to the documentElement
    // serialization immediately (single Core tree).
    doc.set_inner_html(body, "<p>hello</p>").unwrap();
    assert_eq!(doc.document_body().unwrap(), Some(body));
    assert_eq!(
        serialize_node(&doc, html).unwrap(),
        "<html><head></head><body><p>hello</p></body></html>"
    );
}

#[test]
fn load_html_replaces_the_document_content() {
    let mut doc = Document::new();
    doc.load_html(concat!(
        "<!DOCTYPE html><html><head><title>A &amp; B</title></head>",
        "<body class=\"main\"><p>hello</p><br></body></html>"
    ))
    .unwrap();

    let html = doc.document_element().unwrap().expect("parsed html");
    assert_eq!(doc.node_name(html).unwrap(), "html");
    assert_eq!(
        doc.document_head()
            .unwrap()
            .map(|h| doc.node_name(h).unwrap()),
        Some("head")
    );
    let body = doc.document_body().unwrap().expect("parsed body");
    assert_eq!(
        doc.get(body).unwrap().data().element_attributes(),
        Some(&[("class".to_string(), "main".to_string())][..])
    );

    let root = doc.document_root();
    assert_eq!(
        serialize_node(&doc, root).unwrap(),
        concat!(
            "<!DOCTYPE html><html><head><title>A &amp; B</title></head>",
            "<body class=\"main\"><p>hello</p><br></body></html>"
        )
    );
    assert_eq!(text(&doc, html), "A & Bhello");
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn load_html_of_a_bare_fragment_builds_the_implied_skeleton() {
    let mut doc = Document::new();
    doc.load_html("<p>bare</p>").unwrap();
    let html = doc.document_element().unwrap().unwrap();
    assert_eq!(
        serialize_node(&doc, html).unwrap(),
        "<html><head></head><body><p>bare</p></body></html>"
    );
    assert_eq!(text(&doc, html), "bare");
}

#[test]
fn load_html_on_an_existing_skeleton_replaces_it() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    doc.load_html("<html><body>new</body></html>").unwrap();
    assert_eq!(text(&doc, doc.document_element().unwrap().unwrap()), "new");
    assert_eq!(
        doc.document_element()
            .unwrap()
            .map(|h| doc.node_name(h).unwrap()),
        Some("html")
    );
}

// ---- innerHTML getter ------------------------------------------------------

#[test]
fn inner_html_serializes_children_only() {
    let (doc, html) = load("<html><body><div><p>hi</p></div></body></html>");
    let body = doc.document_body().unwrap().unwrap();
    let div = doc.first_child(body).unwrap().unwrap();

    assert_eq!(doc.inner_html(div).unwrap(), "<p>hi</p>");
    assert_eq!(doc.inner_html(body).unwrap(), "<div><p>hi</p></div>");
    assert_eq!(
        doc.inner_html(html).unwrap(),
        "<head></head><body><div><p>hi</p></div></body>"
    );
}

#[test]
fn inner_html_getter_rejects_non_element_and_fragment_nodes() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let text = doc.create_text("x").unwrap();
    let comment = doc.create_comment("c").unwrap();

    for id in [text, comment, doc.document_root()] {
        assert_hierarchy(doc.inner_html(id).unwrap_err());
    }
}

#[test]
fn inner_html_getter_on_a_fragment_serializes_its_children() {
    let mut doc = Document::new();
    let frag = doc.create_document_fragment().unwrap();
    doc.set_inner_html(frag, "<i>ital</i><b>x</b>").unwrap();
    assert_eq!(doc.inner_html(frag).unwrap(), "<i>ital</i><b>x</b>");
}

// ---- innerHTML setter ------------------------------------------------------

#[test]
fn set_inner_html_replaces_children_and_leaves_old_handles_live() {
    let mut doc = Document::new();
    let div = doc.create_element("div").unwrap();
    let a = doc.create_element("a").unwrap();
    let b = doc.create_element("b").unwrap();
    doc.append_child(div, a).unwrap();
    doc.append_child(div, b).unwrap();

    doc.set_inner_html(div, "<p>one</p><span>two</span>")
        .unwrap();

    let children = doc.children(div).unwrap();
    assert_eq!(children.len(), 2);
    assert_eq!(doc.node_name(children[0]).unwrap(), "p");
    assert_eq!(doc.node_name(children[1]).unwrap(), "span");
    assert_eq!(text(&doc, div), "onetwo");
    assert_eq!(doc.inner_html(div).unwrap(), "<p>one</p><span>two</span>");

    // The old children were detached, not freed: their handles stay live.
    assert_eq!(doc.parent(a).unwrap(), None);
    assert_eq!(doc.parent(b).unwrap(), None);
    assert!(doc.get(a).is_ok() && doc.get(b).is_ok());
    assert_eq!(doc.check_invariants(div).unwrap(), ());
}

#[test]
fn set_inner_html_empty_clears_children() {
    let mut doc = Document::new();
    let div = doc.create_element("div").unwrap();
    doc.set_inner_html(div, "<p>one</p><p>two</p>").unwrap();
    assert_eq!(doc.children(div).unwrap().len(), 2);

    doc.set_inner_html(div, "").unwrap();
    assert_eq!(doc.children(div).unwrap(), Vec::<NodeId>::new());
    assert_eq!(doc.inner_html(div).unwrap(), "");
    assert_eq!(doc.check_invariants(div).unwrap(), ());
}

#[test]
fn set_inner_html_table_context_inserts_tbody() {
    let (mut doc, _) = load("<html><body></body></html>");
    let table = doc.create_element("table").unwrap();
    doc.set_inner_html(table, "<tr><td>cell</td></tr>").unwrap();
    assert_eq!(
        doc.inner_html(table).unwrap(),
        "<tbody><tr><td>cell</td></tr></tbody>"
    );
    assert_eq!(
        doc.node_name(doc.first_child(table).unwrap().unwrap())
            .unwrap(),
        "tbody"
    );
    assert_eq!(doc.check_invariants(table).unwrap(), ());
}

#[test]
fn set_inner_html_select_context_keeps_option_rows() {
    let (mut doc, _) = load("<html><body></body></html>");
    let select = doc.create_element("select").unwrap();
    doc.set_inner_html(select, "<option>a</option><option>b</option>")
        .unwrap();
    assert_eq!(
        doc.inner_html(select).unwrap(),
        "<option>a</option><option>b</option>"
    );
    assert_eq!(doc.children(select).unwrap().len(), 2);
}

#[test]
fn set_inner_html_title_context_stays_rcdata() {
    let (mut doc, _) = load("<html><body></body></html>");
    let title = doc.create_element("title").unwrap();
    doc.set_inner_html(title, "<b>x</b>").unwrap();
    // RCDATA: markup stays literal text and serializes escaped.
    assert_eq!(doc.inner_html(title).unwrap(), "&lt;b&gt;x&lt;/b&gt;");
    assert_eq!(text(&doc, title), "<b>x</b>");
}

#[test]
fn set_inner_html_fragment_target_uses_the_fallback_context() {
    let mut doc = Document::new();
    let frag = doc.create_document_fragment().unwrap();
    doc.set_inner_html(frag, "<tr>").unwrap();
    // Fallback body context parses "<tr>" as an empty row (stripped tag).
    assert_eq!(doc.children(frag).unwrap(), Vec::<NodeId>::new());
    doc.set_inner_html(frag, "<i>ital</i>").unwrap();
    assert_eq!(
        doc.node_name(doc.first_child(frag).unwrap().unwrap())
            .unwrap(),
        "i"
    );
}

#[test]
fn set_inner_html_rejects_non_element_and_fragment_targets_atomically() {
    let mut doc = Document::new();
    let text = doc.create_text("keep").unwrap();
    assert_hierarchy(doc.set_inner_html(text, "<p>swap</p>").unwrap_err());
    assert_eq!(doc.get(text).unwrap().data().text_data(), Some("keep"));

    let comment = doc.create_comment("note").unwrap();
    assert_hierarchy(doc.set_inner_html(comment, "<p>swap</p>").unwrap_err());
    assert_eq!(
        doc.get(comment).unwrap().data().comment_data(),
        Some("note")
    );

    let root = doc.document_root();
    assert_hierarchy(doc.set_inner_html(root, "<p>swap</p>").unwrap_err());
}

#[test]
fn set_inner_html_wrong_document_and_stale_handles_leave_the_tree_unchanged() {
    let mut a = Document::new();
    let mut b = Document::new();
    let div = a.create_element("div").unwrap();
    a.set_inner_html(div, "<p>original</p>").unwrap();

    // A handle that belongs to another document is rejected before any change.
    assert!(matches!(
        b.set_inner_html(div, "<p>foreign</p>"),
        Err(CoreError::WrongDocument { .. })
    ));
    assert_eq!(a.inner_html(div).unwrap(), "<p>original</p>");

    // A stale handle is rejected too: adoption moves the div out of `a`, so
    // its old handle points at a freed slot.
    let mut source = Document::new();
    let mut target = Document::new();
    let stale = source.create_element("p").unwrap();
    target.adopt_node(&mut source, stale).unwrap();
    source.create_element("q").unwrap(); // reuse the freed slot, bumping generation
    assert!(matches!(
        source.set_inner_html(stale, "<p>x</p>"),
        Err(CoreError::Arena(_))
    ));
    assert_eq!(a.inner_html(div).unwrap(), "<p>original</p>");
}

// ---- outerHTML getter ------------------------------------------------------

#[test]
fn outer_html_serializes_the_node_itself() {
    let (doc, _) = load("<html><body><div id=\"a\"><p>hi</p></div></body></html>");
    let body = doc.document_body().unwrap().unwrap();
    let div = doc.first_child(body).unwrap().unwrap();
    assert_eq!(
        doc.outer_html(div).unwrap(),
        "<div id=\"a\"><p>hi</p></div>"
    );
    assert_eq!(
        doc.outer_html(body).unwrap(),
        "<body><div id=\"a\"><p>hi</p></div></body>"
    );
}

#[test]
fn outer_html_getter_rejects_non_element_nodes() {
    let mut doc = Document::new();
    let text = doc.create_text("x").unwrap();
    let frag = doc.create_document_fragment().unwrap();
    for id in [text, frag, doc.document_root()] {
        assert_hierarchy(doc.outer_html(id).unwrap_err());
    }
}

// ---- outerHTML setter ------------------------------------------------------

#[test]
fn set_outer_html_replaces_the_node_in_its_parent() {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    doc.set_inner_html(host, "<p id=\"old\">old</p><i>keep</i>")
        .unwrap();
    let old = doc.first_child(host).unwrap().unwrap();

    doc.set_outer_html(old, "<span id=\"new\">new</span>")
        .unwrap();

    let children = doc.children(host).unwrap();
    assert_eq!(children.len(), 2);
    assert_eq!(doc.node_name(children[0]).unwrap(), "span");
    assert_eq!(doc.node_name(children[1]).unwrap(), "i");
    assert_eq!(
        doc.inner_html(host).unwrap(),
        "<span id=\"new\">new</span><i>keep</i>"
    );
    // The replaced node stays live and detached.
    assert_eq!(doc.parent(old).unwrap(), None);
    assert!(doc.get(old).is_ok());
    assert_eq!(doc.check_invariants(host).unwrap(), ());
}

#[test]
fn set_outer_html_on_a_detached_node_is_a_no_op() {
    let mut doc = Document::new();
    let div = doc.create_element("div").unwrap();
    doc.set_inner_html(div, "<b>bold</b>").unwrap();
    let before = doc.inner_html(div).unwrap();

    doc.set_outer_html(div, "<article>content</article>")
        .unwrap();
    assert_eq!(doc.inner_html(div).unwrap(), before);
    assert_eq!(doc.parent(div).unwrap(), None);
    assert_eq!(doc.outer_html(div).unwrap(), "<div><b>bold</b></div>");
}

#[test]
fn set_outer_html_body_replacement_uses_the_html_context() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let body = doc.document_body().unwrap().unwrap();

    // The outerHTML context for a body element is its parent (the <html>
    // element). Per the WHATWG fragment algorithm an html context resets the
    // insertion mode to "before head", so the parser generates the implied
    // head/body skeleton and the <body> tag's content lands in the generated
    // body — spec-faithful (html5ever) behaviour that diverges from happy-dom's
    // own serializer quirks and is deliberately not probed by the differential
    // scenarios.
    doc.set_outer_html(body, "<body id=\"b\"><p>replaced</p></body>")
        .unwrap();

    let html = doc.document_element().unwrap().unwrap();
    assert_eq!(doc.children(html).unwrap().len(), 3);
    assert_eq!(
        serialize_node(&doc, html).unwrap(),
        "<html><head></head><head></head><body id=\"b\"><p>replaced</p></body></html>"
    );
    // document.body now reads the generated body element live.
    assert_eq!(
        doc.node_name(doc.document_body().unwrap().unwrap())
            .unwrap(),
        "body"
    );
    assert_eq!(
        text(&doc, doc.document_body().unwrap().unwrap()),
        "replaced"
    );
    let root = doc.document_root();
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn set_outer_html_rejects_non_element_targets() {
    let mut doc = Document::new();
    let text = doc.create_text("x").unwrap();
    assert_hierarchy(doc.set_outer_html(text, "<p>x</p>").unwrap_err());
    assert_eq!(doc.get(text).unwrap().data().text_data(), Some("x"));
}

// ---- cross-cutting ---------------------------------------------------------

#[test]
fn parsed_nodes_belong_to_the_target_document() {
    let mut doc = Document::new();
    let div = doc.create_element("div").unwrap();
    doc.set_inner_html(div, "<p>owned</p>").unwrap();

    let p = doc.first_child(div).unwrap().unwrap();
    // The parsed node is a live handle of this document, readable through it.
    assert!(doc.get(p).is_ok());
    assert_eq!(doc.node_name(p).unwrap(), "p");
    assert_eq!(doc.parent(p).unwrap(), Some(div));
}

#[test]
fn apply_round_trips_preserve_the_tree() {
    let input = concat!(
        "<!DOCTYPE html><html><head><title>T</title></head>",
        "<body><div class=\"a\"><p>one <b>bold</b></p></div>",
        "<table><tr><td>cell</td></tr></table></body></html>"
    );
    let (mut doc, html) = load(input);
    let serialized = serialize_node(&doc, html).unwrap();

    let mut doc2 = Document::new();
    doc2.load_html(&serialized).unwrap();
    let html2 = doc2.document_element().unwrap().unwrap();
    assert_eq!(
        serialize_node(&doc2, html2).unwrap(),
        serialized,
        "parse → serialize → parse is idempotent for the corpus"
    );
    let root = doc.document_root();
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}
