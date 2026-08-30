//! T32 live element collection and optional index fixtures.
//!
//! Integration-level evidence for `src/selectors/live.rs`: the Core contract
//! the JavaScript `getElementsByTagName` / `getElementsByClassName` surface and
//! the optional id/class/tag query index call. The acceptance criteria pinned
//! here:
//!
//! * *live reads* — a collection query is recomputed on every call, so mutating
//!   the tree or an element's attributes between two calls changes the result
//!   of the second call; there is no snapshot anywhere;
//! * *document order, `*` and no results* — matches come back in document (pre)
//!   order, `getElementsByTagName("*")` yields every element, and a name/token
//!   set with no matches yields an empty vector;
//! * *scoped queries* — an `Element` scope matches descendants only (the scope
//!   itself is never a candidate); tag matching is ASCII case-insensitive and
//!   class matching requires every whitespace-separated token;
//! * *index equivalence* — with the query index enabled, every query returns
//!   byte-for-byte the same result as the traversal path, both across a random
//!   mutation sequence (on/off runs produce identical histories) and against
//!   the independent T30 selector matcher after every single mutation;
//! * *handle validation* — foreign/stale scopes fail with
//!   [`CoreError::WrongDocument`] / [`CoreError::Arena`] and non-`ParentNode`
//!   scopes fail with [`CoreError::Hierarchy`].
//!
//! The index-drift detection itself (the acceptance "属性测试能发现树与索引不
//! 一致") lives in the unit tests of `src/selectors/live.rs`, which can reach
//! the crate-internal index state directly; this file proves the public,
//! observable equivalence the facade relies on.

use mad_dom_core::arena::{ArenaError, NodeId};
use mad_dom_core::dom::{Document, NodeType};
use mad_dom_core::error::CoreError;
use mad_dom_core::html::parse_html_document;

// ---- shared helpers ---------------------------------------------------------

/// Deterministic PRNG (the same `ReplayRng` the existing property suites use)
/// so a failing seed can be reproduced by copying it into `FIXED_SEEDS`.
struct ReplayRng(u64);

impl ReplayRng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        value ^ (value >> 31)
    }

    fn index(&mut self, len: usize) -> usize {
        if len == 0 {
            0
        } else {
            (self.next_u64() as usize) % len
        }
    }

    fn coin(&mut self) -> bool {
        self.next_u64() & 1 == 0
    }
}

/// Parses `input` as a full document and returns the document plus its
/// document root scope (the whole-tree query scope).
fn load(input: &str) -> (Document, NodeId) {
    let parsed = parse_html_document(input).expect("document parsing never fails");
    (parsed.document, parsed.root)
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

/// A corpus with unique ids, shared classes and mixed tags, so both tag and
/// class matching observe document order and the token rules.
const CORPUS: &str = concat!(
    "<!DOCTYPE html>",
    "<html id=\"html\"><head id=\"head\"><title id=\"title\">corpus</title></head>",
    "<body id=\"body\">",
    "<div id=\"root\" class=\"container\">",
    "<p id=\"p1\" class=\"x\">one</p>",
    "<p id=\"p2\" class=\"x y\">two</p>",
    "<span id=\"s1\" class=\"y\">three</span>",
    "<section id=\"sec\" class=\"container x\"><ul id=\"list\">",
    "<li id=\"li1\" class=\"item\">a</li>",
    "<li id=\"li2\" class=\"item x\">b</li>",
    "</ul></section>",
    "</div>",
    "</body></html>"
);

// ---- live reads, document order, `*`, no results ----------------------------

#[test]
fn get_elements_by_tag_name_returns_document_order_matches() {
    let (doc, root) = load(CORPUS);

    assert_eq!(
        id_of(&doc, &doc.get_elements_by_tag_name(root, "li").unwrap()),
        ["li1", "li2"]
    );
    assert_eq!(
        id_of(&doc, &doc.get_elements_by_tag_name(root, "p").unwrap()),
        ["p1", "p2"]
    );

    // `*` returns every element in document order.
    let all = doc.get_elements_by_tag_name(root, "*").unwrap();
    assert_eq!(all.len(), 12);
    for &node in &all {
        assert_eq!(doc.node_type(node).unwrap(), NodeType::Element);
    }

    // Case-insensitive tag matching (WHATWG HTML-document rule).
    assert_eq!(
        doc.get_elements_by_tag_name(root, "DIV").unwrap(),
        doc.get_elements_by_tag_name(root, "div").unwrap()
    );

    // No match.
    assert_eq!(
        doc.get_elements_by_tag_name(root, "table").unwrap(),
        Vec::<NodeId>::new()
    );
    assert_eq!(
        doc.get_elements_by_tag_name(root, "").unwrap(),
        Vec::<NodeId>::new()
    );
}

#[test]
fn get_elements_by_class_name_matches_every_token_in_document_order() {
    let (doc, root) = load(CORPUS);

    assert_eq!(
        id_of(&doc, &doc.get_elements_by_class_name(root, "x").unwrap()),
        ["p1", "p2", "sec", "li2"]
    );
    assert_eq!(
        id_of(&doc, &doc.get_elements_by_class_name(root, "item").unwrap()),
        ["li1", "li2"]
    );
    // Every token must match: "x y" matches p2 only.
    assert_eq!(
        id_of(&doc, &doc.get_elements_by_class_name(root, "x y").unwrap()),
        ["p2"]
    );
    // Multiple internal whitespace runs split identically.
    assert_eq!(
        doc.get_elements_by_class_name(root, "  x   y ").unwrap(),
        doc.get_elements_by_class_name(root, "x y").unwrap()
    );

    assert_eq!(
        doc.get_elements_by_class_name(root, "missing").unwrap(),
        Vec::<NodeId>::new()
    );
}

#[test]
fn empty_or_whitespace_class_name_is_an_empty_collection() {
    let (doc, root) = load(CORPUS);
    // The WHATWG rule: empty / ASCII-whitespace-only arguments yield an empty
    // collection (happy-dom throws on these, which the Bun tests pin as our
    // documented deviation).
    for bad in ["", " ", " \t\n"] {
        assert_eq!(
            doc.get_elements_by_class_name(root, bad).unwrap(),
            Vec::<NodeId>::new(),
            "{bad:?} must yield an empty collection"
        );
    }
}

// ---- scoped queries ---------------------------------------------------------

#[test]
fn element_scope_matches_descendants_only() {
    let (doc, root) = load(CORPUS);

    let root_el = doc.get_element_by_id("root").unwrap().unwrap();
    let sec = doc.get_element_by_id("sec").unwrap().unwrap();

    // A scope's own element is never a candidate.
    assert_eq!(
        doc.get_elements_by_tag_name(root_el, "div").unwrap(),
        Vec::<NodeId>::new()
    );
    // Descendants only, in document order.
    assert_eq!(
        id_of(&doc, &doc.get_elements_by_tag_name(root_el, "li").unwrap()),
        ["li1", "li2"]
    );
    assert_eq!(
        id_of(&doc, &doc.get_elements_by_tag_name(sec, "*").unwrap()),
        ["list", "li1", "li2"]
    );
    assert_eq!(
        id_of(&doc, &doc.get_elements_by_class_name(sec, "item").unwrap()),
        ["li1", "li2"]
    );

    // Document scope covers the whole tree; an element scope narrows it.
    let all_doc = doc.get_elements_by_tag_name(root, "*").unwrap();
    let all_sec = doc.get_elements_by_tag_name(sec, "*").unwrap();
    assert!(all_doc.len() > all_sec.len());

    // A DocumentFragment is a valid ParentNode scope.
    let mut fresh = Document::new();
    let frag = fresh.create_document_fragment().unwrap();
    let inner = fresh.create_element("b").unwrap();
    fresh.append_child(frag, inner).unwrap();
    assert_eq!(
        fresh.get_elements_by_tag_name(frag, "b").unwrap(),
        vec![inner]
    );
    assert_eq!(
        fresh.get_elements_by_class_name(frag, "nope").unwrap(),
        Vec::<NodeId>::new()
    );
}

// ---- live semantics: every call re-reads the arena ---------------------------

#[test]
fn live_results_reflect_tree_and_attribute_mutations() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let root = doc.document_root();
    let body = doc.document_body().unwrap().unwrap();

    let div = doc.create_element("div").unwrap();
    doc.set_attribute(div, "class", "a").unwrap();
    doc.append_child(body, div).unwrap();

    // A fresh query before any mutation sees the node...
    let before = doc.get_elements_by_tag_name(root, "div").unwrap();
    assert_eq!(before, vec![div]);

    // ...and after an append the *same* method call reflects it.
    let p = doc.create_element("p").unwrap();
    doc.append_child(body, p).unwrap();
    assert_eq!(
        id_of(&doc, &doc.get_elements_by_tag_name(root, "*").unwrap()).len(),
        5
    );

    // Attribute changes are reflected by class queries on the next read.
    doc.set_attribute(div, "class", "b").unwrap();
    assert_eq!(
        doc.get_elements_by_class_name(root, "a").unwrap(),
        Vec::<NodeId>::new()
    );
    assert_eq!(
        doc.get_elements_by_class_name(root, "b").unwrap(),
        vec![div]
    );

    // Removal too.
    doc.remove_child(body, div).unwrap();
    assert_eq!(
        doc.get_elements_by_tag_name(root, "div").unwrap(),
        Vec::<NodeId>::new()
    );
}

#[test]
fn moving_and_reordering_reflect_in_document_order() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    let root = doc.document_root();
    let body = doc.document_body().unwrap().unwrap();

    let a = doc.create_element("span").unwrap();
    let b = doc.create_element("span").unwrap();
    let c = doc.create_element("span").unwrap();
    doc.append_child(body, a).unwrap();
    doc.append_child(body, b).unwrap();
    doc.append_child(body, c).unwrap();
    assert_eq!(
        doc.get_elements_by_tag_name(root, "span").unwrap(),
        vec![a, b, c]
    );

    // Move `a` to the end: the next read reports the new document order.
    doc.append_child(body, a).unwrap();
    assert_eq!(
        doc.get_elements_by_tag_name(root, "span").unwrap(),
        vec![b, c, a]
    );
}

// ---- handle validation -------------------------------------------------------

#[test]
fn collection_apis_validate_the_scope_boundary() {
    let (mut doc, _root) = load(CORPUS);

    // A non-ParentNode scope fails with Hierarchy.
    let text = doc.create_text("plain").unwrap();
    assert!(matches!(
        doc.get_elements_by_tag_name(text, "p"),
        Err(CoreError::Hierarchy { .. })
    ));
    assert!(matches!(
        doc.get_elements_by_class_name(text, "x"),
        Err(CoreError::Hierarchy { .. })
    ));

    // A foreign scope fails with WrongDocument.
    let mut other = Document::new();
    let foreign = other.create_element("div").unwrap();
    assert!(matches!(
        doc.get_elements_by_tag_name(foreign, "p"),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        doc.get_elements_by_class_name(foreign, "x"),
        Err(CoreError::WrongDocument { .. })
    ));

    // A stale scope fails with Arena: the id was adopted into `doc`, so the
    // *source* document recognises the handle but its slot is gone.
    let mut source = Document::new();
    let moved = source.create_element("div").unwrap();
    doc.adopt_node(&mut source, moved).unwrap();
    assert!(matches!(
        source.get_elements_by_tag_name(moved, "p"),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
}

// ---- index on/off equivalence (the T32 acceptance) ---------------------------

/// Runs one deterministic mutation+query sequence on a fresh document and
/// returns the recorded query history as strings. `indexed` selects whether
/// the query index is enabled; the two runs must produce identical histories.
fn run_sequence(seed: u64, indexed: bool) -> Vec<String> {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    if indexed {
        doc.set_query_index_enabled(true).unwrap();
    }
    let root = doc.document_root();
    let body = doc.document_body().unwrap().unwrap();

    // A pool of live elements to mutate.
    let mut nodes: Vec<NodeId> = Vec::new();
    for i in 0..12 {
        let el = doc.create_element("div").unwrap();
        doc.set_attribute(el, "id", &format!("n{i}")).unwrap();
        doc.set_attribute(el, "class", if i % 2 == 0 { "a" } else { "a b" })
            .unwrap();
        doc.append_child(body, el).unwrap();
        nodes.push(el);
    }
    let extra = doc.create_element("p").unwrap();
    doc.set_attribute(extra, "class", "a").unwrap();
    doc.append_child(body, extra).unwrap();
    nodes.push(extra);

    let mut rng = ReplayRng::new(seed);
    let mut history = Vec::new();

    let snapshot = |doc: &Document| -> String {
        let mut parts = Vec::new();
        let id_of_found = |doc: &Document, id: &str| -> String {
            doc.get_element_by_id(id)
                .unwrap()
                .map(|el| {
                    doc.get_attribute(el, "id")
                        .unwrap()
                        .map(str::to_owned)
                        .unwrap_or_else(|| "(no-id)".to_string())
                })
                .unwrap_or_else(|| "(none)".to_string())
        };
        for (label, value) in [
            (
                "tag-div",
                format!(
                    "{:?}",
                    id_of(doc, &doc.get_elements_by_tag_name(root, "div").unwrap())
                ),
            ),
            (
                "tag-star",
                format!(
                    "{:?}",
                    id_of(doc, &doc.get_elements_by_tag_name(root, "*").unwrap())
                ),
            ),
            (
                "class-a",
                format!(
                    "{:?}",
                    id_of(doc, &doc.get_elements_by_class_name(root, "a").unwrap())
                ),
            ),
            (
                "class-ab",
                format!(
                    "{:?}",
                    id_of(doc, &doc.get_elements_by_class_name(root, "a b").unwrap())
                ),
            ),
            (
                "scoped-tag",
                format!(
                    "{:?}",
                    id_of(doc, &doc.get_elements_by_tag_name(body, "div").unwrap())
                ),
            ),
            ("id-n3", id_of_found(doc, "n3")),
            ("id-missing", id_of_found(doc, "zzz")),
        ] {
            parts.push(format!("{label}={value}"));
        }
        parts.join(" | ")
    };

    history.push(snapshot(&doc));

    for _ in 0..150 {
        let op = rng.index(5);
        match op {
            0 => {
                // Append a node (sometimes a fragment) at the end of `body`.
                let child = if rng.coin() {
                    let frag = doc.create_document_fragment().unwrap();
                    let x = doc.create_element("div").unwrap();
                    doc.set_attribute(x, "class", "a").unwrap();
                    let y = doc.create_element("span").unwrap();
                    doc.set_attribute(y, "id", &format!("f{}", rng.index(100)))
                        .unwrap();
                    doc.append_child(frag, x).unwrap();
                    doc.append_child(frag, y).unwrap();
                    frag
                } else {
                    nodes[rng.index(nodes.len())]
                };
                let _ = doc.append_child(body, child);
            }
            1 => {
                // Insert an existing node before a random child of `body`.
                let reference = nodes[rng.index(nodes.len())];
                let moving = nodes[rng.index(nodes.len())];
                let _ = doc.insert_before(body, moving, reference);
            }
            2 => {
                // Remove a random child of `body`.
                let child = nodes[rng.index(nodes.len())];
                let _ = doc.remove_child(body, child);
            }
            3 => {
                // Replace a random child of `body` with another node.
                let child = nodes[rng.index(nodes.len())];
                let replacement = nodes[rng.index(nodes.len())];
                let _ = doc.replace_child(body, child, replacement);
            }
            4 => {
                // Mutate id/class attributes on a random node.
                let el = nodes[rng.index(nodes.len())];
                match rng.index(4) {
                    0 => {
                        let value = format!("new{}", rng.index(50));
                        let _ = doc.set_attribute(el, "id", &value);
                    }
                    1 => {
                        let _ = doc.remove_attribute(el, "id");
                    }
                    2 => {
                        let value = format!("c{}", rng.index(5));
                        let _ = doc.set_attribute(el, "class", &value);
                    }
                    _ => {
                        let _ = doc.remove_attribute(el, "class");
                    }
                }
            }
            _ => unreachable!(),
        }
        history.push(snapshot(&doc));
    }

    history
}

/// The on/off histories are identical, so the index can never change an
/// observable query result (the acceptance "启用或禁用索引时结果完全一致").
#[test]
fn indexed_and_traversal_runs_produce_identical_query_histories() {
    for seed in [
        0x3200_0000_0000,
        0x0005_1eed_5eed_1234,
        0xdead_beef_cafe_babe,
    ] {
        let traversal = run_sequence(seed, false);
        let indexed = run_sequence(seed, true);
        assert_eq!(
            traversal, indexed,
            "seed {seed:#x}: the index changed an observable query result"
        );
    }
}

/// While the index is enabled, every query agrees with the independent T30
/// selector matcher after each single mutation — a maintenance bug in the
/// index would surface here as a mismatch.
#[test]
fn indexed_queries_agree_with_selector_matcher_after_each_mutation() {
    let mut doc = Document::new();
    doc.ensure_html_skeleton().unwrap();
    doc.set_query_index_enabled(true).unwrap();
    let root = doc.document_root();
    let body = doc.document_body().unwrap().unwrap();

    let mut nodes: Vec<NodeId> = Vec::new();
    for i in 0..10 {
        let el = doc.create_element("div").unwrap();
        doc.set_attribute(el, "id", &format!("n{i}")).unwrap();
        doc.set_attribute(el, "class", if i % 3 == 0 { "x" } else { "x y" })
            .unwrap();
        doc.append_child(body, el).unwrap();
        nodes.push(el);
    }

    let mut rng = ReplayRng::new(0xa11c_e5ed_2026);
    for _ in 0..120 {
        let op = rng.index(5);
        match op {
            0 => {
                let child = nodes[rng.index(nodes.len())];
                let _ = doc.append_child(body, child);
            }
            1 => {
                let reference = nodes[rng.index(nodes.len())];
                let moving = nodes[rng.index(nodes.len())];
                let _ = doc.insert_before(body, moving, reference);
            }
            2 => {
                let child = nodes[rng.index(nodes.len())];
                let _ = doc.remove_child(body, child);
            }
            3 => {
                let child = nodes[rng.index(nodes.len())];
                let replacement = nodes[rng.index(nodes.len())];
                let _ = doc.replace_child(body, child, replacement);
            }
            4 => {
                let el = nodes[rng.index(nodes.len())];
                match rng.index(4) {
                    0 => {
                        let value = format!("r{}", rng.index(50));
                        let _ = doc.set_attribute(el, "id", &value);
                    }
                    1 => {
                        let _ = doc.remove_attribute(el, "id");
                    }
                    2 => {
                        let value = format!("z{}", rng.index(4));
                        let _ = doc.set_attribute(el, "class", &value);
                    }
                    _ => {
                        let _ = doc.remove_attribute(el, "class");
                    }
                }
            }
            _ => unreachable!(),
        }

        // Tag queries: indexed `getElementsByTagName` vs the T30 matcher.
        for scope in [root, body] {
            for selector in ["div", "*"] {
                let indexed = doc.get_elements_by_tag_name(scope, selector).unwrap();
                let matched = doc.query_selector_all(scope, selector).unwrap();
                assert_eq!(
                    indexed, matched,
                    "tag {selector:?} at scope {scope:?} drifted"
                );
            }
        }
        // Class queries: indexed token intersection vs a `.a.b` selector.
        for cls in ["x", "y", "x y"] {
            let indexed = doc.get_elements_by_class_name(root, cls).unwrap();
            let selector = cls
                .split_ascii_whitespace()
                .map(|t| format!(".{t}"))
                .collect::<Vec<_>>()
                .join("");
            let matched = doc.query_selector_all(root, &selector).unwrap();
            assert_eq!(indexed, matched, "class {cls:?} drifted");
        }
        // Id lookups: indexed `getElementById` vs the selector `#id`.
        for i in 0..10 {
            let id = format!("n{i}");
            let indexed = doc.get_element_by_id(&id).unwrap();
            let matched = doc.query_selector(root, &format!("#{id}")).unwrap();
            assert_eq!(indexed, matched, "id #{id} drifted");
        }
    }
}
