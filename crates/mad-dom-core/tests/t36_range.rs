//! T36 Range / Selection fixtures.
//!
//! Integration-level evidence for `src/dom/range.rs`: the Core contract the
//! JavaScript `Range` / `Selection` surface drives through the native binding.
//! The fixtures pin the acceptance criteria that cross the mutation boundary —
//! the *mutation interplay*:
//!
//! * *adjustment* — character-data changes are observed lazily: an offset past
//!   the new length clamps on read, exactly like the baseline's offset
//!   getters;
//! * *no dangling handles* — removing a boundary container from the tree keeps
//!   the boundary readable (removal detaches but never frees), so a range
//!   never holds a dangling id after a tree mutation;
//! * *collapse on removal* — `deleteContents` / `extractContents` collapse the
//!   range to the computed position (or truncate a same-node text range
//!   without moving the boundaries);
//! * *insertNode* — a collapsed range's end moves to the insertion position
//!   after a text split.
//!
//! The `Selection` boundary (`selection_contains_node`) is pinned here too, as
//! it is the only Selection read that Core computes directly (the rest is
//! direction bookkeeping over boundary points, exercised by the Bun tests).

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{BoundaryPoint, Document};

/// Builds `body > p[Hello, b[world], foo]` and returns the ids.
fn build_tree() -> (Document, NodeId, NodeId, NodeId, NodeId) {
    let mut doc = Document::new();
    let body = doc.create_element("body").unwrap();
    let p = doc.create_element("p").unwrap();
    let hello = doc.create_text("Hello ").unwrap();
    let b = doc.create_element("b").unwrap();
    let world = doc.create_text("world").unwrap();
    let trailing = doc.create_text(" foo").unwrap();
    doc.append_child(b, world).unwrap();
    doc.append_child(p, hello).unwrap();
    doc.append_child(p, b).unwrap();
    doc.append_child(p, trailing).unwrap();
    doc.append_child(body, p).unwrap();
    (doc, body, p, hello, b)
}

#[test]
fn offsets_clamp_after_character_data_mutation() {
    let (mut doc, _body, _p, hello, _b) = build_tree();
    assert_eq!(doc.boundary_clamp(hello, 4).unwrap(), 4);
    doc.set_data(hello, "a").unwrap();
    assert_eq!(
        doc.boundary_clamp(hello, 4).unwrap(),
        1,
        "clamped to the new length"
    );
    // The clamped read is what every offset getter surfaces.
    assert_eq!(doc.boundary_clamp(hello, 0).unwrap(), 0);
}

#[test]
fn removed_container_never_dangles() {
    let (mut doc, body, p, hello, _b) = build_tree();
    doc.remove_child(p, hello).unwrap();
    // The detached text node stays live, so a boundary on it keeps reading.
    assert_eq!(doc.node_length(hello).unwrap(), 6);
    assert!(doc.get(hello).is_ok());
    assert_eq!(doc.parent(hello).unwrap(), None);
    assert!(doc.check_invariants(body).is_ok());
}

#[test]
fn delete_contents_collapses_a_cross_node_range() {
    let (mut doc, body, p, _hello, _b) = build_tree();
    let position = doc
        .range_delete_contents(BoundaryPoint::new(p, 0), BoundaryPoint::new(p, 2))
        .unwrap()
        .expect("a cross-node delete reports its collapse position");
    assert_eq!(position.node, p);
    assert_eq!(position.offset, 0);
    // Removing children 0..2 leaves the trailing text.
    let remaining = doc.children(p).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(
        doc.get(remaining[0]).unwrap().data().text_data(),
        Some(" foo")
    );
    assert!(doc.check_invariants(body).is_ok());
}

#[test]
fn delete_contents_same_text_node_truncates_without_moving_boundaries() {
    let (mut doc, _body, p, hello, _b) = build_tree();
    doc.append_child(p, hello).unwrap();
    let position = doc
        .range_delete_contents(BoundaryPoint::new(hello, 1), BoundaryPoint::new(hello, 4))
        .unwrap();
    assert_eq!(
        position, None,
        "a same-node delete leaves the boundaries untouched"
    );
    assert_eq!(doc.get(hello).unwrap().data().text_data(), Some("Ho "));
}

#[test]
fn insert_node_moves_the_collapsed_end_after_a_text_split() {
    let (mut doc, body, p, hello, _b) = build_tree();
    let em = doc.create_element("em").unwrap();
    let new_end = doc
        .range_insert_node(
            BoundaryPoint::new(hello, 2),
            BoundaryPoint::new(hello, 2),
            em,
        )
        .unwrap()
        .expect("a collapsed range reports its new end");
    assert_eq!(new_end.node, p);
    assert_eq!(new_end.offset, 2);
    // p = [hello("He"), em, tail("llo "), b, foo].
    assert_eq!(doc.children(p).unwrap().len(), 5);
    assert!(doc.check_invariants(body).is_ok());
}

#[test]
fn selection_contains_node_uses_the_baseline_rules() {
    let (doc, _body, p, hello, b) = build_tree();
    // A range strictly inside the leading text does not contain the text node.
    assert!(!doc
        .selection_contains_node(
            BoundaryPoint::new(hello, 1),
            BoundaryPoint::new(hello, 3),
            hello,
            true,
        )
        .unwrap());
    // A range over the whole paragraph contains every child.
    let start = BoundaryPoint::new(p, 0);
    let end = BoundaryPoint::new(p, doc.node_length(p).unwrap());
    assert!(doc.selection_contains_node(start, end, b, false).unwrap());
    assert!(doc
        .selection_contains_node(start, end, hello, true)
        .unwrap());
}
