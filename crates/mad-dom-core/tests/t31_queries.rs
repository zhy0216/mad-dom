//! T31 document-order selector query fixtures.
//!
//! Integration-level evidence for `src/selectors/query.rs`: the Core contract
//! the JavaScript `querySelector` / `querySelectorAll` / `matches` / `closest`
//! / `getElementById` surface calls. The acceptance criteria pinned here:
//!
//! * *document order and no results* — `query_selector_all` returns matches in
//!   document (pre) order over a parsed corpus with mixed element/text/comment
//!   children, `query_selector` returns the first match, and a selector that
//!   matches nothing yields `None` / an empty vector;
//! * *static snapshots* — a `query_selector_all` result is a snapshot captured
//!   during one traversal: mutating the tree afterwards leaves the already
//!   returned vector byte-for-byte unchanged, while a fresh query reflects the
//!   mutation;
//! * *scoped queries* — `query_selector_all` on an `Element` scope matches
//!   descendants only (the scope itself is never a candidate), while a
//!   `Document` scope covers the whole tree;
//! * *matches / closest / getElementById* — `matches` is a per-element test,
//!   `closest` walks from the receiver (itself included) up the ancestor chain,
//!   and `getElementById` returns the first matching element in document order
//!   without an index;
//! * *syntax errors* — invalid selectors fail with [`CoreError::Syntax`]
//!   before any traversal;
//! * *handle validation* — foreign/stale scopes and handles fail with
//!   [`CoreError::WrongDocument`] / [`CoreError::Arena`], and non-`ParentNode`
//!   scopes / non-`Element` receivers fail with [`CoreError::Hierarchy`].

use mad_dom_core::arena::{ArenaError, NodeId};
use mad_dom_core::dom::{Document, NodeType};
use mad_dom_core::error::CoreError;
use mad_dom_core::html::parse_html_document;

// ---- shared helpers ---------------------------------------------------------

/// Parses `input` as a full document and returns the document plus its
/// document element.
fn load(input: &str) -> (Document, NodeId) {
    let parsed = parse_html_document(input).expect("document parsing never fails");
    let element = parsed
        .document
        .document_element()
        .expect("document has a document element")
        .expect("corpus always has a document element");
    (parsed.document, element)
}

/// Maps every element handle to its `id` attribute value.
fn id_of(doc: &Document, nodes: &[NodeId]) -> Vec<String> {
    nodes
        .iter()
        .copied()
        .map(|node| {
            doc.get_attribute(node, "id")
                .expect("readable element id")
                .map(str::to_owned)
                .unwrap_or_default()
        })
        .collect()
}

// ---- fixed corpus: document order, first match, no results ------------------

/// A corpus where every element carries a unique `id` and text/comment nodes
/// are interleaved with elements, so both the element traversal order and the
/// "elements only" rule are observable.
const CORPUS: &str = concat!(
    "<!DOCTYPE html>",
    "<html id=\"html\"><head id=\"head\"><title id=\"title\">corpus</title></head>",
    "<body id=\"body\">",
    "leading text",
    "<div id=\"root\" class=\"container\">",
    "<p id=\"p1\" class=\"x\">one</p>",
    "<!-- a comment -->",
    "<p id=\"p2\" class=\"x y\">two</p>",
    "<span id=\"s1\" data-kind=\"note\">three</span>",
    "<section id=\"sec\"><ul id=\"list\">",
    "<li id=\"li1\">a</li>",
    "<li id=\"li2\" class=\"selected\">b</li>",
    "</ul></section>",
    "</div>",
    "</body></html>"
);

#[test]
fn query_selector_all_returns_document_order_matches() {
    let (mut doc, _element) = load(CORPUS);
    let root = doc.document_root();

    // `p` matches p1 then p2 (document order, despite the comment in between).
    assert_eq!(
        id_of(&doc, &doc.query_selector_all(root, "p").unwrap()),
        ["p1", "p2"]
    );

    // `.x` matches the two paragraphs; `.x.y` only p2.
    assert_eq!(
        id_of(&doc, &doc.query_selector_all(root, ".x").unwrap()),
        ["p1", "p2"]
    );
    assert_eq!(
        id_of(&doc, &doc.query_selector_all(root, ".x.y").unwrap()),
        ["p2"]
    );

    // `li` matches in document order; a descendant chain works.
    assert_eq!(
        id_of(&doc, &doc.query_selector_all(root, "li").unwrap()),
        ["li1", "li2"]
    );
    assert_eq!(
        id_of(
            &doc,
            &doc.query_selector_all(root, "#root #list li").unwrap()
        ),
        ["li1", "li2"]
    );

    // `*` matches every HTML element in document order (the corpus is all HTML
    // namespace, so the default namespace applies).
    let all = doc.query_selector_all(root, "*").unwrap();
    let expected: &[&str] = &[
        "html", "head", "title", "body", "root", "p1", "p2", "s1", "sec", "list", "li1", "li2",
    ];
    assert_eq!(id_of(&doc, &all), expected);
}

#[test]
fn query_selector_returns_the_first_match_in_document_order() {
    let (mut doc, _element) = load(CORPUS);
    let root = doc.document_root();

    assert_eq!(
        id_of(&doc, &[doc.query_selector(root, "p").unwrap().unwrap()]),
        ["p1"],
        "querySelector returns the first document-order match"
    );
    assert_eq!(
        id_of(
            &doc,
            &[doc.query_selector(root, "div, span").unwrap().unwrap()],
        ),
        ["root"],
        "a selector list picks the first element matching any compound"
    );

    // No match: `None` for querySelector, empty vector for querySelectorAll.
    assert_eq!(doc.query_selector(root, "li.missing").unwrap(), None);
    assert_eq!(
        doc.query_selector_all(root, "li.missing").unwrap(),
        Vec::<NodeId>::new()
    );
}

#[test]
fn query_selector_all_ignores_non_element_nodes() {
    let (mut doc, _element) = load(CORPUS);
    let root = doc.document_root();

    // The corpus interleaves text and a comment between elements; only elements
    // are candidates, and every returned node is an element.
    let matches = doc.query_selector_all(root, "p").unwrap();
    assert_eq!(matches.len(), 2);
    for &node in &matches {
        assert_eq!(doc.node_type(node).unwrap(), NodeType::Element);
    }
}

// ---- scoped queries ---------------------------------------------------------

#[test]
fn element_scope_matches_descendants_only() {
    let (mut doc, _element) = load(CORPUS);

    let root_el = doc.get_element_by_id("root").unwrap().unwrap();

    // `div` inside `#root` matches only its descendants — never itself.
    let inside = doc.query_selector_all(root_el, "div").unwrap();
    assert!(
        inside.is_empty(),
        "a scope's own element is not a candidate"
    );

    // `p` inside `#root` matches the two nested paragraphs.
    assert_eq!(
        id_of(&doc, &doc.query_selector_all(root_el, "p").unwrap()),
        ["p1", "p2"]
    );

    // `section p` (relative to the scope) matches nothing — the `section`
    // ancestor is above the scope root.
    assert_eq!(
        doc.query_selector_all(root_el, "section p").unwrap(),
        Vec::<NodeId>::new()
    );

    // `li` scoped to the section finds both list items.
    let sec = doc.get_element_by_id("sec").unwrap().unwrap();
    assert_eq!(
        id_of(&doc, &doc.query_selector_all(sec, "li").unwrap()),
        ["li1", "li2"]
    );

    // A DocumentFragment scope behaves like any other ParentNode scope.
    let frag = doc.create_document_fragment().unwrap();
    let frag_div = doc.create_element("div").unwrap();
    doc.set_attribute(frag_div, "id", "frag-inner").unwrap();
    doc.append_child(frag, frag_div).unwrap();
    assert_eq!(
        id_of(&doc, &doc.query_selector_all(frag, "div").unwrap()),
        ["frag-inner"]
    );
}

#[test]
fn document_scope_covers_the_whole_tree_and_skeleton() {
    // A fresh document with the implied skeleton: `body` is discoverable even
    // though no innerHTML was ever set.
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let root = doc.document_root();

    assert_eq!(
        id_of(&doc, &doc.query_selector_all(root, "body").unwrap()),
        [""],
        "the implied body element is matched"
    );
    assert_eq!(doc.query_selector(root, "p").unwrap(), None);

    // A document that never allocated a root has no elements at all.
    let mut empty = Document::new();
    let empty_root = empty.document_root();
    assert_eq!(
        empty.query_selector_all(empty_root, "body").unwrap(),
        Vec::<NodeId>::new()
    );
}

// ---- matches / closest ------------------------------------------------------

#[test]
fn matches_tests_a_single_element() {
    let (doc, _element) = load(CORPUS);
    let p1 = doc.get_element_by_id("p1").unwrap().unwrap();
    let s1 = doc.get_element_by_id("s1").unwrap().unwrap();

    assert!(doc.matches(p1, "p.x").unwrap());
    assert!(!doc.matches(p1, "li").unwrap());
    assert!(doc.matches(s1, "[data-kind=note]").unwrap());
    assert!(!doc.matches(s1, "p").unwrap());
}

#[test]
fn closest_walks_up_including_the_receiver_itself() {
    let (doc, _element) = load(CORPUS);
    let li1 = doc.get_element_by_id("li1").unwrap().unwrap();
    let li2 = doc.get_element_by_id("li2").unwrap().unwrap();

    // The receiver itself matches.
    assert_eq!(
        doc.closest(li1, "li").unwrap(),
        Some(li1),
        "closest includes the receiver"
    );
    // A parent element on the chain.
    assert_eq!(
        doc.closest(li1, "#list").unwrap(),
        doc.get_element_by_id("list").unwrap()
    );
    // A grandparent via a descendant chain selector.
    assert_eq!(
        doc.closest(li2, "section ul li.selected").unwrap(),
        Some(li2)
    );
    assert_eq!(
        doc.closest(li1, "section").unwrap(),
        doc.get_element_by_id("sec").unwrap()
    );
    // Nothing on the chain matches.
    assert_eq!(doc.closest(li1, "table").unwrap(), None);
    // The chain can climb all the way to the document root; `:root` matches
    // the html element.
    assert_eq!(
        doc.closest(li1, ":root").unwrap(),
        doc.get_element_by_id("html").unwrap()
    );
}

// ---- static snapshots -------------------------------------------------------

#[test]
fn query_selector_all_returns_a_static_snapshot() {
    let (mut doc, _element) = load(CORPUS);
    let root = doc.document_root();

    let captured = doc.query_selector_all(root, "li").unwrap();
    assert_eq!(id_of(&doc, &captured), ["li1", "li2"]);

    // A later mutation must not change the already-returned result.
    let li1 = doc.get_element_by_id("li1").unwrap().unwrap();
    let list = doc.get_element_by_id("list").unwrap().unwrap();
    doc.remove_child(list, li1).unwrap();

    assert_eq!(
        captured,
        [li1, doc.get_element_by_id("li2").unwrap().unwrap()],
        "the captured snapshot is unaffected by the mutation"
    );

    // A fresh query reflects the mutation.
    assert_eq!(
        id_of(&doc, &doc.query_selector_all(root, "li").unwrap()),
        ["li2"]
    );
}

#[test]
fn query_selector_snapshot_handles_stale_ids_after_replacement() {
    // Reusing a captured id after the node was replaced with a fresh arena
    // handle must not silently alias the new node: the old id stays live but
    // detached, and a re-query finds the new node.
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let root = doc.document_root();
    let body = doc.document_body().unwrap().unwrap();

    let p = doc.create_element("p").unwrap();
    doc.set_attribute(p, "id", "old").unwrap();
    doc.append_child(body, p).unwrap();
    assert_eq!(doc.query_selector(root, "#old").unwrap(), Some(p));

    // Replace the paragraph: the old handle is now detached but still live, so
    // a re-query finds the new paragraph instead.
    let replacement = doc.create_element("p").unwrap();
    doc.set_attribute(replacement, "id", "new").unwrap();
    doc.replace_child(body, p, replacement).unwrap();
    assert_eq!(
        id_of(&doc, &[doc.query_selector(root, "p").unwrap().unwrap()]),
        ["new"]
    );
    assert!(doc.get(p).is_ok(), "the old node stays live (detached)");
}

// ---- getElementById ---------------------------------------------------------

#[test]
fn get_element_by_id_returns_the_first_document_order_match() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let body = doc.document_body().unwrap().unwrap();

    // Two elements share the same id; the first in document order wins.
    let first = doc.create_element("div").unwrap();
    doc.set_attribute(first, "id", "dup").unwrap();
    doc.append_child(body, first).unwrap();
    let second = doc.create_element("div").unwrap();
    doc.set_attribute(second, "id", "dup").unwrap();
    doc.append_child(body, second).unwrap();

    assert_eq!(doc.get_element_by_id("dup").unwrap(), Some(first));
    assert_eq!(doc.get_element_by_id("missing").unwrap(), None);
}

#[test]
fn get_element_by_id_is_a_pure_read_without_an_index() {
    let doc = Document::new();
    assert_eq!(
        doc.get_element_by_id("anything").unwrap(),
        None,
        "a document without a root has nothing to search"
    );
}

// ---- syntax errors and handle validation ------------------------------------

#[test]
fn invalid_selectors_fail_with_syntax_before_any_traversal() {
    let (mut doc, _element) = load(CORPUS);
    let root = doc.document_root();
    let el = doc.get_element_by_id("p1").unwrap().unwrap();

    for bad in [
        "",
        "div:::",
        "> div",
        "div >",
        "div,,span",
        "#",
        "unknown|div",
    ] {
        assert!(
            matches!(doc.query_selector(root, bad), Err(CoreError::Syntax { .. })),
            "`{bad}` must fail query_selector with Syntax"
        );
        assert!(
            matches!(
                doc.query_selector_all(root, bad),
                Err(CoreError::Syntax { .. })
            ),
            "`{bad}` must fail query_selector_all with Syntax"
        );
        assert!(
            matches!(doc.matches(el, bad), Err(CoreError::Syntax { .. })),
            "`{bad}` must fail matches with Syntax"
        );
        assert!(
            matches!(doc.closest(el, bad), Err(CoreError::Syntax { .. })),
            "`{bad}` must fail closest with Syntax"
        );
    }
}

#[test]
fn query_apis_validate_the_handle_boundary() {
    let (mut doc, _element) = load(CORPUS);

    // A foreign scope fails with WrongDocument.
    let mut other = Document::new();
    let foreign = other.create_element("div").unwrap();
    assert!(matches!(
        doc.query_selector(foreign, "p"),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        doc.query_selector_all(foreign, "p"),
        Err(CoreError::WrongDocument { .. })
    ));

    // A stale scope fails with Arena: the id was adopted into `doc`, so the
    // *source* document recognises the handle as its own but its slot is gone.
    let mut source = Document::new();
    let moved = source.create_element("div").unwrap();
    doc.adopt_node(&mut source, moved).unwrap();
    assert!(matches!(
        source.query_selector(moved, "p"),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
    assert!(matches!(
        source.query_selector_all(moved, "p"),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
    // The adopting document rejects the foreign id before arena validation.
    assert!(matches!(
        doc.query_selector(moved, "p"),
        Err(CoreError::WrongDocument { .. })
    ));

    // getElementById is document-local: a foreign document's id is absent here
    // and present in its own document.
    let mut fresh = Document::new();
    fresh.ensure_html_skeleton().unwrap();
    let body = fresh.document_body().unwrap().unwrap();
    let el = fresh.create_element("span").unwrap();
    fresh.set_attribute(el, "id", "local").unwrap();
    fresh.append_child(body, el).unwrap();
    assert_eq!(fresh.get_element_by_id("local").unwrap(), Some(el));
    assert_eq!(fresh.get_element_by_id("anything-else").unwrap(), None);
    assert_eq!(doc.get_element_by_id("local").unwrap(), None);

    // A non-ParentNode scope fails with Hierarchy.
    let text = doc.create_text("not a parent").unwrap();
    assert!(matches!(
        doc.query_selector(text, "p"),
        Err(CoreError::Hierarchy { .. })
    ));
    assert!(matches!(
        doc.query_selector_all(text, "p"),
        Err(CoreError::Hierarchy { .. })
    ));

    // A non-Element receiver fails matches/closest with Hierarchy.
    let comment = doc.create_comment("note").unwrap();
    assert!(matches!(
        doc.matches(text, "p"),
        Err(CoreError::Hierarchy { .. })
    ));
    assert!(matches!(
        doc.closest(comment, "p"),
        Err(CoreError::Hierarchy { .. })
    ));
}

// ---- tree order across a hand-built tree ------------------------------------

#[test]
fn hand_built_tree_queries_in_document_order() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let body = doc.document_body().unwrap().unwrap();

    let a = doc.create_element("a").unwrap();
    doc.set_attribute(a, "id", "a").unwrap();
    let b = doc.create_element("b").unwrap();
    doc.set_attribute(b, "id", "b").unwrap();
    let c = doc.create_element("a").unwrap();
    doc.set_attribute(c, "id", "c").unwrap();
    doc.append_child(body, a).unwrap();
    doc.append_child(body, b).unwrap();
    doc.append_child(body, c).unwrap();

    assert_eq!(
        id_of(&doc, &doc.query_selector_all(body, "a").unwrap()),
        ["a", "c"],
        "matches stay in document order after tree mutation"
    );
    assert_eq!(doc.query_selector(body, "a").unwrap(), Some(a));
}
