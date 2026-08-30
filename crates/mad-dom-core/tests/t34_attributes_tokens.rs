//! T34 attribute-node and token-list Core fixtures.
//!
//! Integration-level evidence for `src/dom/attribute_nodes.rs`: the
//! `NamedNodeMap`/`Attr` reads (`attribute_pairs`, `element_namespace_uri`,
//! `validate_attribute_name`) and the `DOMTokenList` contract
//! (`attribute_token_set` / `contains` / `add` / `remove` / `toggle` /
//! `replace`). The acceptance criteria pinned here:
//!
//! * *single Core state* — every `DOMTokenList` mutation funnels through the
//!   one attribute storage (verified via `get_attribute` / `has_attribute` /
//!   `attribute_pairs`), so a `classList` write and an `element.setAttribute`
//!   write are indistinguishable at the storage level;
//! * *token-set semantics* — the WHATWG ordered set (split on ASCII whitespace,
//!   first-occurrence dedupe), `add`/`remove`/`toggle`/`replace`/`contains`
//!   with force, replacement return value and the missing-old-token `false`;
//! * *live reads* — `attribute_pairs` and `attribute_token_set` are produced on
//!   demand, so a retained collection reflects later external writes;
//! * *empty-set update* — a mutator that empties the token set removes the
//!   attribute, while the raw `value` path stores verbatim;
//! * *invalid tokens* — an empty token fails with [`CoreError::Syntax`] and a
//!   whitespace token with [`CoreError::InvalidCharacter`], atomically;
//!   `contains` never throws;
//! * *cross-document separation* — every entry rejects foreign and stale
//!   handles with [`CoreError::WrongDocument`] / [`CoreError::Arena`] and a
//!   non-element receiver with [`CoreError::Hierarchy`].

use mad_dom_core::arena::ArenaError;
use mad_dom_core::dom::{Document, HTML_NAMESPACE};
use mad_dom_core::error::CoreError;

fn assert_hierarchy(err: CoreError) {
    assert!(
        matches!(err, CoreError::Hierarchy { .. }),
        "expected Hierarchy, got {err:?}"
    );
}

fn assert_syntax(err: CoreError) {
    assert!(
        matches!(err, CoreError::Syntax { .. }),
        "expected Syntax, got {err:?}"
    );
}

fn assert_invalid_character(err: CoreError) {
    assert!(
        matches!(err, CoreError::InvalidCharacter { .. }),
        "expected InvalidCharacter, got {err:?}"
    );
}

fn pairs(doc: &Document, id: mad_dom_core::arena::NodeId) -> Vec<(String, String)> {
    doc.attribute_pairs(id).unwrap()
}

// ---- attribute_pairs / element_namespace_uri / validate_attribute_name ----

#[test]
fn attribute_pairs_returns_the_ordered_list() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    assert!(pairs(&doc, el).is_empty());

    doc.set_attribute(el, "id", "root").unwrap();
    doc.set_attribute(el, "class", "a b").unwrap();
    doc.set_attribute(el, "data-x", "1").unwrap();
    assert_eq!(
        pairs(&doc, el),
        vec![
            ("id".to_string(), "root".to_string()),
            ("class".to_string(), "a b".to_string()),
            ("data-x".to_string(), "1".to_string()),
        ],
        "the list preserves insertion order"
    );

    // Re-setting preserves position; removing removes exactly the entry.
    doc.set_attribute(el, "class", "c").unwrap();
    doc.remove_attribute(el, "id").unwrap();
    assert_eq!(
        pairs(&doc, el),
        vec![
            ("class".to_string(), "c".to_string()),
            ("data-x".to_string(), "1".to_string()),
        ]
    );
}

#[test]
fn attribute_pairs_are_live_reads() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    doc.set_attribute(el, "a", "1").unwrap();
    let before = pairs(&doc, el);
    assert_eq!(before.len(), 1);

    // A write through the storage seam is visible to the next read (and vice
    // versa): no copy of the list is kept anywhere.
    doc.set_attribute(el, "b", "2").unwrap();
    assert_eq!(pairs(&doc, el).len(), 2);
}

#[test]
fn attribute_pairs_reject_non_elements_and_foreign_handles() {
    let mut doc = Document::new();
    let text = doc.create_text("hi").unwrap();
    assert_hierarchy(doc.attribute_pairs(text).unwrap_err());

    let mut other = Document::new();
    let el = other.create_element("div").unwrap();
    assert!(matches!(
        doc.attribute_pairs(el),
        Err(CoreError::WrongDocument { .. })
    ));
}

#[test]
fn attribute_pairs_reject_stale_handles() {
    let mut a = Document::new();
    let mut b = Document::new();
    let el = a.create_element("div").unwrap();
    // Adoption moves the node out of `a`, emptying its slot: the original
    // handle becomes stale in the document that recognises it.
    let moved = b.adopt_node(&mut a, el).unwrap();
    assert!(b.get(moved).is_ok());
    assert!(matches!(
        a.attribute_pairs(el),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
}

#[test]
fn element_namespace_uri_reads_the_html_namespace() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    assert_eq!(
        doc.element_namespace_uri(el).unwrap(),
        Some(HTML_NAMESPACE),
        "a fresh element carries the HTML namespace"
    );
    let text = doc.create_text("t").unwrap();
    assert_eq!(doc.element_namespace_uri(text).unwrap(), None);
}

#[test]
fn validate_attribute_name_shares_the_name_rule() {
    let doc = Document::new();
    assert!(doc.validate_attribute_name("class").is_ok());
    assert!(doc.validate_attribute_name("data-x").is_ok());
    assert_invalid_character(doc.validate_attribute_name("").unwrap_err());
    assert_invalid_character(doc.validate_attribute_name("1bad").unwrap_err());
    assert_invalid_character(doc.validate_attribute_name("has space").unwrap_err());
}

// ---- the token set (read surface) ----

#[test]
fn token_set_splits_on_ascii_whitespace_and_deduplicates() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    assert!(doc.attribute_token_set(el, "class").unwrap().is_empty());

    doc.set_attribute(el, "class", "  a\tb\nb\u{0c}c\r\n a  ")
        .unwrap();
    assert_eq!(
        doc.attribute_token_set(el, "class").unwrap(),
        vec!["a", "b", "c"],
        "split on ASCII whitespace, first-occurrence order, no duplicates"
    );

    // An absent attribute is the empty set, never an error.
    doc.remove_attribute(el, "class").unwrap();
    assert!(doc.attribute_token_set(el, "class").unwrap().is_empty());
}

#[test]
fn token_contains_never_throws() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    doc.set_attribute(el, "class", "a b").unwrap();

    assert!(doc.attribute_token_contains(el, "class", "a").unwrap());
    assert!(!doc.attribute_token_contains(el, "class", "zzz").unwrap());
    assert!(!doc.attribute_token_contains(el, "class", "").unwrap());
    assert!(!doc.attribute_token_contains(el, "class", "a b").unwrap());
}

// ---- the token-set mutators ----

#[test]
fn add_appends_and_deduplicates() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    doc.set_attribute(el, "class", "x y").unwrap();

    doc.attribute_token_add(el, "class", &["z"]).unwrap();
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("x y z"));

    // Already-present tokens are left in place; the set stays deduplicated.
    doc.attribute_token_add(el, "class", &["x", "w"]).unwrap();
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("x y z w"));
}

#[test]
fn add_on_absent_attribute_creates_it() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    doc.attribute_token_add(el, "class", &["a", "b"]).unwrap();
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("a b"));
    assert!(doc.has_attribute(el, "class").unwrap());
}

#[test]
fn remove_filters_tokens_and_drops_missing_ones() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    doc.set_attribute(el, "class", "x y z").unwrap();

    doc.attribute_token_remove(el, "class", &["y", "nope"])
        .unwrap();
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("x z"));
}

#[test]
fn remove_that_empties_the_set_removes_the_attribute() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    doc.set_attribute(el, "class", "a").unwrap();

    doc.attribute_token_remove(el, "class", &["a"]).unwrap();
    assert!(
        !doc.has_attribute(el, "class").unwrap(),
        "the WHATWG update steps remove the attribute when the set is empty"
    );
    assert_eq!(doc.get_attribute(el, "class").unwrap(), None);
}

#[test]
fn toggle_adds_and_removes_with_and_without_force() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();

    // Absent + no force → added.
    assert!(doc.attribute_token_toggle(el, "class", "a", None).unwrap());
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("a"));

    // Present + no force → removed (the empty set removes the attribute).
    assert!(!doc.attribute_token_toggle(el, "class", "a", None).unwrap());
    assert!(!doc.has_attribute(el, "class").unwrap());

    // force = true always adds; force = false always removes.
    assert!(doc
        .attribute_token_toggle(el, "class", "b", Some(true))
        .unwrap());
    assert!(doc
        .attribute_token_toggle(el, "class", "b", Some(true))
        .unwrap());
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("b"));
    assert!(!doc
        .attribute_token_toggle(el, "class", "b", Some(false))
        .unwrap());
    assert!(!doc.has_attribute(el, "class").unwrap());
}

#[test]
fn replace_returns_true_on_success_and_false_on_missing_old() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    doc.set_attribute(el, "class", "a b").unwrap();

    assert!(doc.attribute_token_replace(el, "class", "a", "c").unwrap());
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("c b"));

    assert!(!doc
        .attribute_token_replace(el, "class", "zzz", "c")
        .unwrap());
    assert_eq!(
        doc.get_attribute(el, "class").unwrap(),
        Some("c b"),
        "a missing old token leaves the attribute unchanged"
    );
}

// ---- invalid tokens are rejected atomically ----

#[test]
fn empty_and_whitespace_tokens_are_rejected_atomically() {
    let mut doc = Document::new();
    let el = doc.create_element("div").unwrap();
    doc.set_attribute(el, "class", "keep").unwrap();

    // An empty token is a SyntaxError (the DOMException the WHATWG contract
    // maps to CoreError::Syntax).
    assert_syntax(doc.attribute_token_add(el, "class", &[""]).unwrap_err());
    assert_syntax(doc.attribute_token_remove(el, "class", &[""]).unwrap_err());
    assert_syntax(
        doc.attribute_token_toggle(el, "class", "", None)
            .unwrap_err(),
    );
    assert_syntax(
        doc.attribute_token_replace(el, "class", "", "x")
            .unwrap_err(),
    );
    assert_syntax(
        doc.attribute_token_replace(el, "class", "keep", "")
            .unwrap_err(),
    );
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("keep"));

    // A token containing ASCII whitespace is an InvalidCharacterError.
    for bad in ["a b", "a\tb", "a\nb"] {
        assert_invalid_character(doc.attribute_token_add(el, "class", &[bad]).unwrap_err());
        assert_invalid_character(doc.attribute_token_remove(el, "class", &[bad]).unwrap_err());
        assert_invalid_character(
            doc.attribute_token_toggle(el, "class", bad, None)
                .unwrap_err(),
        );
        assert_invalid_character(
            doc.attribute_token_replace(el, "class", bad, "x")
                .unwrap_err(),
        );
        assert_invalid_character(
            doc.attribute_token_replace(el, "class", "keep", bad)
                .unwrap_err(),
        );
        assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("keep"));
    }

    // A failed batch leaves the attribute unchanged too (all tokens validate
    // before any is applied).
    doc.attribute_token_add(el, "class", &["good", ""])
        .unwrap_err();
    assert_eq!(doc.get_attribute(el, "class").unwrap(), Some("keep"));
}

// ---- cross-document separation and receiver kinds ----

#[test]
fn token_operations_reject_foreign_stale_and_non_element_handles() {
    let mut doc = Document::new();
    let text = doc.create_text("hi").unwrap();
    assert_hierarchy(doc.attribute_token_set(text, "class").unwrap_err());
    assert_hierarchy(
        doc.attribute_token_contains(text, "class", "a")
            .unwrap_err(),
    );

    let mut a = Document::new();
    let mut b = Document::new();
    let el = a.create_element("div").unwrap();
    assert!(matches!(
        b.attribute_token_set(el, "class"),
        Err(CoreError::WrongDocument { .. })
    ));

    // A stale handle: adoption empties `a`'s slot for the original id.
    let moved = b.adopt_node(&mut a, el).unwrap();
    assert!(b.get(moved).is_ok());
    assert!(matches!(
        a.attribute_token_set(el, "class"),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
}

#[test]
fn token_mutators_reject_non_element_receivers() {
    let mut doc = Document::new();
    let text = doc.create_text("hi").unwrap();
    assert_hierarchy(doc.attribute_token_add(text, "class", &["a"]).unwrap_err());
    assert_hierarchy(
        doc.attribute_token_remove(text, "class", &["a"])
            .unwrap_err(),
    );
    assert_hierarchy(
        doc.attribute_token_toggle(text, "class", "a", None)
            .unwrap_err(),
    );
    assert_hierarchy(
        doc.attribute_token_replace(text, "class", "a", "b")
            .unwrap_err(),
    );
}

#[test]
fn token_mutations_keep_the_tree_invariants() {
    let mut doc = Document::new();
    let parent = doc.create_element("div").unwrap();
    let child = doc.create_element("span").unwrap();
    doc.append_child(parent, child).unwrap();

    doc.set_attribute(child, "class", "a b").unwrap();
    doc.attribute_token_add(child, "class", &["c"]).unwrap();
    doc.attribute_token_remove(child, "class", &["a"]).unwrap();

    assert_eq!(doc.check_invariants(parent).unwrap(), ());
    assert_eq!(doc.parent(child).unwrap(), Some(parent));
    assert_eq!(doc.get_attribute(child, "class").unwrap(), Some("b c"));
}
