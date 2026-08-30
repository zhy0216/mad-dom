//! T30 selector parser and arena matcher fixtures.
//!
//! Integration-level evidence for `src/selectors/`: selectors are parsed with
//! servo's `selectors`/`cssparser` (ADR-0004) and matched directly on the arena
//! of a parsed [`Document`], without any mirror tree. The three acceptance
//! criteria are pinned here:
//!
//! * *the parsed selector AST is runtime-agnostic* — `parse_selector_list`
//!   returns a `selectors::SelectorList` whose identifiers are this crate's own
//!   newtypes (`DomIdent`, `DomNamespace`, `DomAttrValue`); `mad-dom-core` has
//!   no Bun/JavaScriptCore dependency, so the AST cannot hold JS types (a
//!   compile-time property of the module design);
//! * *fixed corpus + generative DOM combinations* — a fixed HTML corpus is
//!   checked selector-by-selector against every element (hits *and* misses),
//!   and a generated random tree is checked against a self-consistent reference
//!   model for type / class / id / descendant / child selectors;
//! * *invalid selectors stably return a syntax error* — a fixed invalid corpus
//!   must fail with [`CoreError::Syntax`] carrying the location, identically
//!   across repeated parses.

mod common;

use common::SplitMix64;

use std::collections::HashMap;

use mad_dom_core::arena::{ArenaError, NodeId};
use mad_dom_core::dom::{Document, NodeType};
use mad_dom_core::error::CoreError;
use mad_dom_core::html::{parse_html_document, ParsedDocument};
use mad_dom_core::selectors::{match_selector_list, matches, parse_selector_list};

// ---- shared helpers -------------------------------------------------------

fn parse(input: &str) -> ParsedDocument {
    parse_html_document(input).expect("document parsing never fails")
}

/// Returns every element reachable from `start` in document (pre) order.
fn elements_in_order(doc: &Document, start: NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut stack = vec![start];
    while let Some(n) = stack.pop() {
        for c in doc.children(n).unwrap().into_iter().rev() {
            stack.push(c);
        }
        if doc.node_type(n).unwrap() == NodeType::Element {
            out.push(n);
        }
    }
    out
}

/// Builds `id -> handle` for every element that carries an `id` attribute.
fn ids_by_handle(doc: &Document, elements: &[NodeId]) -> HashMap<NodeId, String> {
    elements
        .iter()
        .copied()
        .filter_map(|el| {
            doc.get_attribute(el, "id")
                .unwrap()
                .map(|id| (el, id.to_string()))
        })
        .collect()
}

// ---- fixed selector corpus ------------------------------------------------

/// A document where *every* element carries a unique `id`, so a corpus entry's
/// expected hit set can be written as plain ids and compared against the
/// matcher on every element (hits and misses).
const CORPUS: &str = concat!(
    "<!DOCTYPE html>",
    "<html id=\"html\"><head id=\"head\"><title id=\"title\">corpus</title></head>",
    "<body id=\"body\">",
    "<div id=\"root\" class=\"container\">",
    "<p id=\"p1\" class=\"x\">one</p>",
    "<p id=\"p2\" class=\"x y\">two</p>",
    "<span id=\"s1\" data-kind=\"note\">three</span>",
    "<section id=\"sec\"><ul id=\"list\">",
    "<li id=\"li1\">a</li>",
    "<li id=\"li2\" class=\"selected\">b</li>",
    "</ul></section>",
    "<div id=\"empty\"></div>",
    "</div>",
    "<svg id=\"svg\" viewBox=\"0 0 8 8\"><circle id=\"c1\" cx=\"4\" cy=\"4\" r=\"2\"/></svg>",
    "</body></html>"
);

const ALL_IDS: &[&str] = &[
    "html", "head", "title", "body", "root", "p1", "p2", "s1", "sec", "list", "li1", "li2",
    "empty", "svg", "c1",
];

/// The HTML-namespaced subset: an unprefixed `*` obeys the default (HTML)
/// namespace and therefore skips the SVG elements.
const ALL_HTML_IDS: &[&str] = &[
    "html", "head", "title", "body", "root", "p1", "p2", "s1", "sec", "list", "li1", "li2", "empty",
];

/// `(selector, ids it must match)`. Every element outside the expected set must
/// *not* match, so this simultaneously pins hits and misses.
const CORPUS_SELECTORS: &[(&str, &[&str])] = &[
    ("*", ALL_HTML_IDS),
    ("*|*", ALL_IDS),
    ("html", &["html"]),
    ("html head title", &["title"]),
    ("div", &["root", "empty"]),
    ("p", &["p1", "p2"]),
    ("#p2", &["p2"]),
    (".x", &["p1", "p2"]),
    (".x.y", &["p2"]),
    (".y", &["p2"]),
    ("div.container", &["root"]),
    ("div.container.x", &[]),
    ("body > div", &["root"]),
    ("body div", &["root", "empty"]),
    ("body > p", &[]),
    ("div > p", &["p1", "p2"]),
    ("div p", &["p1", "p2"]),
    ("section li", &["li1", "li2"]),
    ("ul > li", &["li1", "li2"]),
    ("#root #list li", &["li1", "li2"]),
    ("li.selected", &["li2"]),
    ("li:not(.selected)", &["li1"]),
    ("p + p", &["p2"]),
    ("p.x + p", &["p2"]),
    ("p ~ span", &["s1"]),
    ("div + svg", &[]),
    ("div ~ svg", &[]),
    ("div + svg|svg", &["svg"]),
    ("div ~ svg|svg", &["svg"]),
    ("section + div", &["empty"]),
    ("section ~ div", &["empty"]),
    ("[data-kind]", &["s1"]),
    ("[data-kind=note]", &["s1"]),
    ("[data-kind=NOTE]", &[]),
    ("[data-kind=NOTE i]", &["s1"]),
    ("[data-kind^=not]", &["s1"]),
    ("[data-kind$=ote]", &["s1"]),
    ("[data-kind*=ot]", &["s1"]),
    ("[data-kind~=note]", &["s1"]),
    ("[data-kind|=note]", &["s1"]),
    ("span[data-kind]", &["s1"]),
    ("p[data-kind]", &[]),
    ("li, span", &["s1", "li1", "li2"]),
    ("li, svg|circle", &["li1", "li2", "c1"]),
    ("svg|circle", &["c1"]),
    ("*|circle", &["c1"]),
    ("circle", &[]),
    ("svg", &[]),
    ("*|svg", &["svg"]),
    ("svg|*", &["svg", "c1"]),
    (":root", &["html"]),
    (":empty", &["empty"]),
    ("svg|circle:empty", &["c1"]),
    ("li:first-child", &["li1"]),
    ("li:nth-child(2)", &["li2"]),
    ("li:nth-child(odd)", &["li1"]),
    ("#nope", &[]),
    (".missing", &[]),
    ("body > div p", &["p1", "p2"]),
];

#[test]
fn fixed_corpus_hits_and_misses_on_every_element() {
    let parsed = parse(CORPUS);
    let doc = &parsed.document;
    let root = parsed.root;
    let elements = elements_in_order(doc, root);
    assert_eq!(elements.len(), ALL_IDS.len(), "corpus doc shape drift");
    let id_of = ids_by_handle(doc, &elements);
    assert_eq!(id_of.len(), ALL_IDS.len(), "every corpus element has an id");

    for (selector, expected) in CORPUS_SELECTORS {
        for &el in &elements {
            let el_id = id_of.get(&el).map(String::as_str).unwrap_or("<no-id>");
            let expected_hit = expected.contains(&el_id);
            let actual = matches(doc, el, selector)
                .unwrap_or_else(|e| panic!("selector `{selector}` must parse: {e}"));
            assert_eq!(
                actual, expected_hit,
                "selector `{selector}` on element `{el_id}`"
            );
        }
    }
}

#[test]
fn selector_list_is_runtime_agnostic_and_reusable() {
    // The parsed list is a selectors::SelectorList over this crate's own
    // identifier newtypes; compiling this is the evidence that the AST does not
    // reference Bun/JavaScriptCore types.
    let list = parse_selector_list("div.container, #id").expect("valid selector parses");
    assert_eq!(list.slice().len(), 2);

    let parsed = parse(CORPUS);
    let doc = &parsed.document;
    let elements = elements_in_order(doc, parsed.root);
    let id_of = ids_by_handle(doc, &elements);

    let list = parse_selector_list("div p, li:nth-child(2)").expect("valid selector parses");
    for &el in &elements {
        let el_id = id_of.get(&el).map(String::as_str).unwrap_or("<no-id>");
        let expected = matches!(el_id, "p1" | "p2" | "li2");
        assert_eq!(
            match_selector_list(&list, doc, el).unwrap(),
            expected,
            "reused list on `{el_id}`"
        );
    }
}

// ---- generative DOM x selector combinations --------------------------------

const GEN_TAGS: &[&str] = &["div", "span", "p", "li", "a", "em"];
const GEN_CLASSES: &[&str] = &["a", "b", "c", "d"];

/// The generated model of one element: its identity, tag, classes, id, and the
/// parent/ancestor handles the reference evaluator needs.
struct Spec {
    self_id: NodeId,
    id: Option<String>,
    tag: &'static str,
    classes: Vec<&'static str>,
    parent: Option<NodeId>,
    ancestors: Vec<NodeId>,
}

/// Builds a random tree of `GEN_TAGS` elements with random classes and ids,
/// returning the per-element spec. The tree is capped at 150 elements.
fn build_generated_tree(rng: &mut SplitMix64, doc: &mut Document) -> Vec<Spec> {
    let mut specs: Vec<Spec> = Vec::new();
    let mut counter = 0usize;

    let root = doc.create_element("div").unwrap();
    doc.set_attribute(root, "id", "gen-0").unwrap();
    specs.push(Spec {
        self_id: root,
        id: Some("gen-0".to_string()),
        tag: "div",
        classes: vec![],
        parent: None,
        ancestors: vec![],
    });
    counter += 1;

    let mut stack: Vec<(NodeId, usize)> = vec![(root, 0)];
    while let Some((parent, depth)) = stack.pop() {
        if depth >= 6 || specs.len() >= 150 {
            continue;
        }
        for _ in 0..1 + rng.usize_in(4) {
            if specs.len() >= 150 {
                break;
            }
            let tag = GEN_TAGS[rng.usize_in(GEN_TAGS.len())];
            let el = doc.create_element(tag).unwrap();
            let mut classes = Vec::new();
            if rng.bool() {
                for _ in 0..1 + rng.usize_in(2) {
                    classes.push(GEN_CLASSES[rng.usize_in(GEN_CLASSES.len())]);
                }
            }
            let id = rng.bool().then(|| format!("gen-{counter}"));
            counter += 1;
            doc.append_child(parent, el).unwrap();
            if let Some(id) = &id {
                doc.set_attribute(el, "id", id).unwrap();
            }
            if !classes.is_empty() {
                doc.set_attribute(el, "class", &classes.join(" ")).unwrap();
            }

            // Ancestors, parent-most first: the parent itself, then its parent,
            // and so on up to (and including) the tree root.
            let mut upward = vec![parent];
            let mut cursor = parent;
            while let Some(p) = doc.parent(cursor).unwrap() {
                upward.push(p);
                cursor = p;
            }
            upward.reverse();

            specs.push(Spec {
                self_id: el,
                id,
                tag,
                classes,
                parent: Some(parent),
                ancestors: upward,
            });
            stack.push((el, depth + 1));
        }
    }
    specs
}

/// Renders a chain of `(combinator, tag)` compounds to a selector string.
fn render_chain(chain: &[(char, &str)]) -> String {
    let mut out = String::new();
    for (i, (combinator, tag)) in chain.iter().enumerate() {
        if i > 0 {
            out.push(' ');
            out.push(*combinator);
            out.push(' ');
        }
        out.push_str(tag);
    }
    out
}

/// Reference evaluator for chains of type selectors separated by ` ` (descendant)
/// or `>` (child) combinators. `chain[i]` with `i > 0` carries the combinator
/// linking compound `i - 1` to compound `i`; the last compound is the subject.
fn ref_matches(
    specs: &[Spec],
    index_of: &HashMap<NodeId, usize>,
    node: usize,
    chain: &[(char, &str)],
) -> bool {
    fn rest(
        specs: &[Spec],
        index_of: &HashMap<NodeId, usize>,
        node: usize,
        chain: &[(char, &str)],
        i: usize,
    ) -> bool {
        if specs[node].tag != chain[i].1 {
            return false;
        }
        if i == 0 {
            return true;
        }
        let (combinator, _) = chain[i];
        match combinator {
            '>' => match specs[node].parent {
                Some(parent) => rest(specs, index_of, index_of[&parent], chain, i - 1),
                None => false,
            },
            ' ' => specs[node]
                .ancestors
                .iter()
                .any(|&a| rest(specs, index_of, index_of[&a], chain, i - 1)),
            _ => unreachable!(),
        }
    }
    rest(specs, index_of, node, chain, chain.len() - 1)
}

#[test]
fn generative_tree_matches_self_consistent_model() {
    let mut rng = SplitMix64::new(0x5EED_1DEA);
    let mut doc = Document::new();
    let specs = build_generated_tree(&mut rng, &mut doc);
    assert!(specs.len() >= 100, "generated tree should be substantial");
    let index_of: HashMap<NodeId, usize> = specs
        .iter()
        .enumerate()
        .map(|(i, s)| (s.self_id, i))
        .collect();

    // Every element must match its own tag, each of its classes and its id.
    for (i, spec) in specs.iter().enumerate() {
        assert!(
            matches(&doc, spec.self_id, spec.tag).unwrap(),
            "`{}` must match its own tag at index {i}",
            spec.tag
        );
        for class in &spec.classes {
            assert!(
                matches(&doc, spec.self_id, &format!(".{class}")).unwrap(),
                ".{class} must match index {i}"
            );
        }
        if let Some(id) = &spec.id {
            assert!(
                matches(&doc, spec.self_id, &format!("#{id}")).unwrap(),
                "#{id} must match index {i}"
            );
        }
    }

    // A class/id no element carries must match nothing.
    for (i, spec) in specs.iter().enumerate() {
        assert!(
            !matches(&doc, spec.self_id, ".never").unwrap(),
            "`.never` must not match index {i}"
        );
        assert!(
            !matches(&doc, spec.self_id, "#never").unwrap(),
            "`#never` must not match index {i}"
        );
    }

    // Random type-selector chains (descendant / child) must agree with the
    // reference model on every element.
    for _ in 0..40 {
        let len = 1 + rng.usize_in(3);
        let mut chain = Vec::with_capacity(len);
        for i in 0..len {
            let tag = GEN_TAGS[rng.usize_in(GEN_TAGS.len())];
            chain.push((
                if i == 0 {
                    ' '
                } else if rng.bool() {
                    '>'
                } else {
                    ' '
                },
                tag,
            ));
        }
        for (i, spec) in specs.iter().enumerate() {
            let expected = ref_matches(&specs, &index_of, i, &chain);
            let actual = matches(&doc, spec.self_id, &render_chain(&chain)).unwrap();
            assert_eq!(
                actual,
                expected,
                "generated selector `{}` on element {} (tag {})",
                render_chain(&chain),
                i,
                spec.tag
            );
        }
    }
}

// ---- invalid selectors are stable syntax errors -----------------------------

const INVALID_SELECTORS: &[&str] = &[
    "",
    "div:::",
    "unknown|div",
    "div:totally-bogus",
    "> div",
    "div >",
    "div,,span",
    "#",
    ".",
    "[",
    "[attr=]",
    "a b,",
    "div[",
    "p +",
];

#[test]
fn invalid_selectors_are_stable_structured_syntax_errors() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    for bad in INVALID_SELECTORS {
        let err = matches(&doc, el, bad).expect_err(&format!("`{bad}` must fail"));
        match &err {
            CoreError::Syntax { message } => {
                assert!(
                    message.starts_with("invalid selector at line"),
                    "`{bad}` message should carry the location, got: {message}"
                );
            }
            other => panic!("`{bad}` must be a Syntax error, got {other:?}"),
        }
        // Stability: repeated parses produce the identical structured error.
        let again = matches(&doc, el, bad).expect_err("second parse must also fail");
        assert_eq!(err, again, "`{bad}` error must be deterministic");
    }
}

// ---- error mapping at the matcher boundary ----------------------------------

#[test]
fn matcher_validates_the_element_handle() {
    let mut doc = Document::new();
    let text = doc.create_text("not an element").unwrap();
    assert!(matches!(
        matches(&doc, text, "div"),
        Err(CoreError::Hierarchy { .. })
    ));

    let mut other = Document::new();
    let foreign = other.create_element("div").unwrap();
    assert!(matches!(
        matches(&doc, foreign, "div"),
        Err(CoreError::WrongDocument { .. })
    ));

    // Adopting the element frees its source slot; the old handle must then
    // fail with `Arena` instead of being silently read.
    let mut source = Document::new();
    let moved = source.create_element("div").unwrap();
    doc.adopt_node(&mut source, moved).unwrap();
    assert!(matches!(
        matches(&source, moved, "div"),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
}
