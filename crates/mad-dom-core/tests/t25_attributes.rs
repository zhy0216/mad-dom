//! Core attribute read/write contract fixtures (T25B).
//!
//! Integration-level evidence for the element attribute API implemented in
//! `src/dom/attributes.rs`: `get_attribute`, `set_attribute`,
//! `remove_attribute` and `has_attribute`, plus value string conversion,
//! ordered storage, invalid-name rejection and failure atomicity.
//!
//! The acceptance criteria pin down four families of fixed evidence:
//!
//! * *exceptions* — the exact error taxonomy (`WrongDocument` / `Arena` /
//!   `Hierarchy` / `InvalidCharacter`) and that a failed call changes nothing;
//! * *conversion* — attribute values round-trip character-for-character through
//!   `set_attribute` / `get_attribute`;
//! * *ordering* — the `(name, value)` list is ordered: new attributes append,
//!   re-setting keeps the original position, removal preserves the survivors'
//!   relative order;
//! * *types* — the public entry points return `Option<&str>`, `bool` and `()`
//!   respectively, and `get_attribute` borrows the arena slot rather than
//!   returning an owned copy.
//!
//! A separate family verifies the seam property: attribute changes are
//! immediately observable through the public readers and never touch the tree
//! structure, so [`Document::check_invariants`] keeps passing.

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::Document;
use mad_dom_core::error::CoreError;

/// Creates a fresh detached element.
fn element(doc: &mut Document) -> NodeId {
    doc.create_element("div").unwrap()
}

/// The ordered attribute list of `id` as seen through the public read accessor
/// [`NodeData::element_attributes`], cloning the by-value payload so the
/// fixture can compare it without holding a borrow.
fn ordered(doc: &Document, id: NodeId) -> Vec<(String, String)> {
    doc.get(id)
        .unwrap()
        .data()
        .element_attributes()
        .unwrap()
        .to_vec()
}

// ---- unknown attributes ----

#[test]
fn get_attribute_returns_none_for_unknown_attribute() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    let value: Option<&str> = doc.get_attribute(el, "id").unwrap();
    assert_eq!(value, None);
    assert_eq!(doc.get_attribute(el, "missing").unwrap(), None);
    // Reads do not validate the name: an unparseable name is just absent.
    assert_eq!(doc.get_attribute(el, "").unwrap(), None);
    assert_eq!(doc.get_attribute(el, "a b").unwrap(), None);
    assert_eq!(doc.get_attribute(el, "1x").unwrap(), None);
}

#[test]
fn has_attribute_reports_absence_for_unknown_attribute() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    assert!(!doc.has_attribute(el, "id").unwrap());
    assert!(!doc.has_attribute(el, "missing").unwrap());
}

// ---- string conversion (values round-trip verbatim) ----

#[test]
fn set_then_get_round_trips_exact_string_value() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    doc.set_attribute(el, "data-num", "42").unwrap();
    doc.set_attribute(el, "hidden", "").unwrap();
    doc.set_attribute(el, "data-bool", "false").unwrap();
    doc.set_attribute(el, "data-text", "a \"quoted\" & <tag>")
        .unwrap();
    doc.set_attribute(el, "data-uni", "中文\u{1F600}").unwrap();
    doc.set_attribute(el, "data-ws", "  padded  ").unwrap();

    let num: Option<&str> = doc.get_attribute(el, "data-num").unwrap();
    assert_eq!(num, Some("42"), "numeric-looking values stay strings");
    assert_eq!(
        doc.get_attribute(el, "data-bool").unwrap(),
        Some("false"),
        "boolean-looking values stay strings"
    );
    assert_eq!(
        doc.get_attribute(el, "hidden").unwrap(),
        Some(""),
        "empty values round-trip"
    );
    assert_eq!(
        doc.get_attribute(el, "data-text").unwrap(),
        Some("a \"quoted\" & <tag>"),
        "characters that would be escaped at serialization are stored raw"
    );
    assert_eq!(
        doc.get_attribute(el, "data-uni").unwrap(),
        Some("中文\u{1F600}"),
        "multi-byte UTF-8 round-trips exactly"
    );
    assert_eq!(
        doc.get_attribute(el, "data-ws").unwrap(),
        Some("  padded  "),
        "values are stored verbatim, never trimmed or normalized"
    );
    assert!(doc.has_attribute(el, "hidden").unwrap());
}

// ---- ordering ----

#[test]
fn set_appends_new_attributes_in_call_order() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    doc.set_attribute(el, "a", "1").unwrap();
    doc.set_attribute(el, "b", "2").unwrap();
    doc.set_attribute(el, "c", "3").unwrap();

    assert_eq!(
        ordered(&doc, el),
        vec![
            ("a".to_string(), "1".to_string()),
            ("b".to_string(), "2".to_string()),
            ("c".to_string(), "3".to_string()),
        ]
    );
}

#[test]
fn re_setting_existing_attribute_updates_in_place_and_keeps_position() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    doc.set_attribute(el, "a", "1").unwrap();
    doc.set_attribute(el, "b", "2").unwrap();
    doc.set_attribute(el, "c", "3").unwrap();
    doc.set_attribute(el, "a", "updated").unwrap();
    doc.set_attribute(el, "a", "again").unwrap();

    // One entry per name, the original position preserved, last write wins,
    // no duplicate `(name, value)` pair ever appears.
    assert_eq!(
        ordered(&doc, el),
        vec![
            ("a".to_string(), "again".to_string()),
            ("b".to_string(), "2".to_string()),
            ("c".to_string(), "3".to_string()),
        ]
    );
    assert_eq!(doc.get_attribute(el, "a").unwrap(), Some("again"));
}

#[test]
fn attribute_order_is_stable_across_updates_and_deletes() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    for name in ["a", "b", "c", "d"] {
        doc.set_attribute(el, name, "1").unwrap();
    }
    doc.set_attribute(el, "b", "2").unwrap(); // in-place update keeps position
    assert!(doc.remove_attribute(el, "c").unwrap());
    doc.set_attribute(el, "e", "5").unwrap(); // appended at the end

    assert_eq!(
        ordered(&doc, el),
        vec![
            ("a".to_string(), "1".to_string()),
            ("b".to_string(), "2".to_string()),
            ("d".to_string(), "1".to_string()),
            ("e".to_string(), "5".to_string()),
        ]
    );
}

// ---- removal ----

#[test]
fn remove_attribute_removes_and_reports_presence() {
    let mut doc = Document::new();
    let el = element(&mut doc);
    doc.set_attribute(el, "id", "root").unwrap();

    assert!(doc.has_attribute(el, "id").unwrap());
    let removed: bool = doc.remove_attribute(el, "id").unwrap();
    assert!(removed);
    assert!(!doc.has_attribute(el, "id").unwrap());
    assert_eq!(doc.get_attribute(el, "id").unwrap(), None);
    assert_eq!(ordered(&doc, el), Vec::<(String, String)>::new());
}

#[test]
fn remove_attribute_is_no_op_for_unknown() {
    let mut doc = Document::new();
    let el = element(&mut doc);
    doc.set_attribute(el, "a", "1").unwrap();

    let absent: bool = doc.remove_attribute(el, "missing").unwrap();
    assert!(!absent);
    assert_eq!(ordered(&doc, el), vec![("a".to_string(), "1".to_string())]);
}

#[test]
fn attribute_generation_tracks_successful_writes_only() {
    let mut doc = Document::new();
    let el = element(&mut doc);
    let initial = doc.attribute_generation();

    doc.set_attribute(el, "class", "a").unwrap();
    assert_eq!(doc.attribute_generation(), initial + 1);
    doc.set_attribute(el, "class", "a").unwrap();
    assert_eq!(
        doc.attribute_generation(),
        initial + 2,
        "an observable set call invalidates derived caches even when the value repeats"
    );
    assert!(!doc.remove_attribute(el, "missing").unwrap());
    assert_eq!(doc.attribute_generation(), initial + 2);
    assert!(doc.remove_attribute(el, "class").unwrap());
    assert_eq!(doc.attribute_generation(), initial + 3);

    let before_error = doc.attribute_generation();
    assert!(doc.set_attribute(el, "bad name", "x").is_err());
    assert_eq!(doc.attribute_generation(), before_error);
}

// ---- invalid names ----

#[test]
fn set_attribute_rejects_invalid_names_atomically() {
    let mut doc = Document::new();
    let el = element(&mut doc);
    doc.set_attribute(el, "keep", "me").unwrap();
    let before = ordered(&doc, el);

    for name in [
        "", "a b", "a/b", "a\tb", "a\nb", "-x", "a b c", "a\0b", "a'b",
    ] {
        let err = doc.set_attribute(el, name, "v").unwrap_err();
        assert!(
            matches!(
                err,
                CoreError::InvalidCharacter {
                    what: "attribute name",
                    ..
                }
            ),
            "{name:?} must fail with InvalidCharacter, got {err:?}"
        );
        assert_eq!(
            ordered(&doc, el),
            before,
            "a rejected set_attribute must leave the storage unchanged ({name:?})"
        );
    }
}

#[test]
fn set_attribute_accepts_valid_names() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    for name in [
        "data-x",
        "xml:lang",
        "x:y",
        "_private",
        "a1",
        "aria-label",
        "中文属性",
        "1bad",
        ".x",
        "a-b",
        "a.b",
        "é",
    ] {
        doc.set_attribute(el, name, "v").unwrap();
        assert_eq!(doc.get_attribute(el, name).unwrap(), Some("v"));
    }
    assert_eq!(ordered(&doc, el).len(), 12);
}

// ---- error taxonomy: non-element, foreign and stale handles ----

#[test]
fn attribute_operations_reject_non_elements() {
    let mut doc = Document::new();
    let text = doc.create_text("hi").unwrap();
    let comment = doc.create_comment("note").unwrap();
    let frag = doc.create_document_fragment().unwrap();

    for id in [text, comment, frag] {
        assert!(
            matches!(doc.get_attribute(id, "x"), Err(CoreError::Hierarchy { .. })),
            "get_attribute on non-element {id:?} must fail with Hierarchy"
        );
        assert!(
            matches!(doc.has_attribute(id, "x"), Err(CoreError::Hierarchy { .. })),
            "has_attribute on non-element {id:?} must fail with Hierarchy"
        );
        assert!(
            matches!(
                doc.set_attribute(id, "x", "v"),
                Err(CoreError::Hierarchy { .. })
            ),
            "set_attribute on non-element {id:?} must fail with Hierarchy"
        );
        assert!(
            matches!(
                doc.remove_attribute(id, "x"),
                Err(CoreError::Hierarchy { .. })
            ),
            "remove_attribute on non-element {id:?} must fail with Hierarchy"
        );
    }
}

#[test]
fn attribute_operations_reject_foreign_handles() {
    let mut a = Document::new();
    let mut b = Document::new();
    let el = a.create_element("div").unwrap();

    assert!(matches!(
        b.get_attribute(el, "x"),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.has_attribute(el, "x"),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.set_attribute(el, "x", "v"),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.remove_attribute(el, "x"),
        Err(CoreError::WrongDocument { .. })
    ));
}

#[test]
fn attribute_operations_reject_stale_handles() {
    let mut a = Document::new();
    let mut b = Document::new();
    let el = a.create_element("div").unwrap();
    a.set_attribute(el, "x", "1").unwrap();
    let adopted = b.adopt_node(&mut a, el).unwrap();

    // Adoption freed the source slot: every attribute op on the old handle
    // must fail with `Arena` and never read the migrated node.
    assert!(matches!(a.get_attribute(el, "x"), Err(CoreError::Arena(_))));
    assert!(matches!(a.has_attribute(el, "x"), Err(CoreError::Arena(_))));
    assert!(matches!(
        a.set_attribute(el, "x", "v"),
        Err(CoreError::Arena(_))
    ));
    assert!(matches!(
        a.remove_attribute(el, "x"),
        Err(CoreError::Arena(_))
    ));

    // The single copy of the attribute state moved with the node.
    assert_eq!(b.get_attribute(adopted, "x").unwrap(), Some("1"));
}

// ---- seam properties: immediate visibility, single state, tree untouched ----

#[test]
fn changes_are_immediately_visible_to_core_readers() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    doc.set_attribute(el, "id", "root").unwrap();
    assert_eq!(
        doc.get(el).unwrap().data().element_attributes(),
        Some(&[("id".to_string(), "root".to_string())][..]),
        "a set is immediately visible through the public read accessor"
    );

    doc.set_attribute(el, "id", "renamed").unwrap();
    assert_eq!(
        doc.get(el).unwrap().data().element_attributes(),
        Some(&[("id".to_string(), "renamed".to_string())][..]),
        "an in-place update is immediately visible"
    );

    doc.remove_attribute(el, "id").unwrap();
    assert_eq!(
        doc.get(el).unwrap().data().element_attributes(),
        Some(&[][..]),
        "a removal is immediately visible"
    );
}

#[test]
fn attribute_operations_never_touch_the_tree() {
    let mut doc = Document::new();
    let parent = doc.create_element("ul").unwrap();
    let child = doc.create_element("li").unwrap();
    doc.append_child(parent, child).unwrap();
    doc.set_attribute(parent, "id", "list").unwrap();

    assert_eq!(doc.parent(child).unwrap(), Some(parent));
    assert_eq!(doc.children(parent).unwrap(), vec![child]);
    assert_eq!(doc.first_child(parent).unwrap(), Some(child));
    assert_eq!(doc.last_child(parent).unwrap(), Some(child));
    assert_eq!(doc.check_invariants(parent).unwrap(), ());

    doc.set_attribute(parent, "data-x", "y").unwrap();
    doc.set_attribute(child, "role", "item").unwrap();
    doc.remove_attribute(parent, "id").unwrap();
    assert_eq!(doc.parent(child).unwrap(), Some(parent));
    assert_eq!(doc.children(parent).unwrap(), vec![child]);
    assert_eq!(doc.check_invariants(parent).unwrap(), ());
}

#[test]
fn each_element_keeps_its_own_attribute_state() {
    let mut doc = Document::new();
    let source = doc.create_element("div").unwrap();
    doc.set_attribute(source, "id", "src").unwrap();
    let clone = doc.clone_node(source, false).unwrap();

    // Mutating the source's attributes never leaks into the clone, and vice
    // versa: the state is one copy per node's arena slot, not a shared map.
    doc.set_attribute(source, "id", "changed").unwrap();
    doc.set_attribute(source, "extra", "x").unwrap();

    assert_eq!(doc.get_attribute(source, "id").unwrap(), Some("changed"));
    assert_eq!(doc.get_attribute(clone, "id").unwrap(), Some("src"));
    assert_eq!(doc.get_attribute(clone, "extra").unwrap(), None);
    assert_eq!(
        ordered(&doc, clone),
        vec![("id".to_string(), "src".to_string())]
    );
}

// ---- fixed return types ----

#[test]
fn public_entry_points_have_fixed_return_types() {
    let mut doc = Document::new();
    let el = element(&mut doc);

    let set_result: () = doc.set_attribute(el, "a", "1").unwrap();
    assert_eq!(set_result, ());

    let value: Option<&str> = doc.get_attribute(el, "a").unwrap();
    assert_eq!(value, Some("1"), "get_attribute borrows the arena slot");

    let present: bool = doc.has_attribute(el, "a").unwrap();
    assert!(present);

    let removed: bool = doc.remove_attribute(el, "a").unwrap();
    assert!(removed);
}
