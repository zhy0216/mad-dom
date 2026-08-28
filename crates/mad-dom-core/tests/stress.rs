//! Stress tests for `mad-dom-core` (T18).
//!
//! Four workload classes from the plan, sized so the whole suite finishes in a
//! few seconds on a typical CI machine. Deep/wide trees are built through the
//! *public* mutation API, where every step runs `is_descendant_of` plus a debug
//! `check_invariants` over the growing tree, so the build is intentionally
//! quadratic and these sizes land comfortably inside CI time:
//!
//! * `stress_deep_tree` — a 2 000-deep chain;
//! * `stress_wide_tree` — a 2 000-wide sibling chain under one root;
//! * `stress_frequent_arena_slot_reuse` — 20 000 adopt/allocate cycles, proving
//!   freed source slots are reused with a generation bump so old handles never
//!   alias new nodes;
//! * `stress_cross_document_misuse` — 1 000 seeded wrong-document /
//!   stale-handle operations that must all fail atomically.
//!
//! The truly-deep (200 000) and truly-wide (50 000) cases live in the in-crate
//! `dom::tree` and `dom::cross_document` unit tests, which use the crate-internal
//! tree builder precisely because the public path re-verifies after every step.

mod common;

use common::SplitMix64;
use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::Document;
use mad_dom_core::error::CoreError;

const DEEP_DEPTH: usize = 2_000;
const WIDE_WIDTH: usize = 2_000;
const REUSE_ITERATIONS: usize = 20_000;
const MISUSE_ITERATIONS: usize = 1_000;

#[test]
fn stress_deep_tree() {
    let mut doc = Document::new();
    let root = doc.create_element("root").unwrap();
    let mut prev = root;
    for _ in 0..DEEP_DEPTH {
        let n = doc.create_element("n").unwrap();
        doc.append_child(prev, n).unwrap();
        prev = n;
    }
    assert_eq!(doc.check_invariants(root).unwrap(), ());

    let mut cur = prev;
    let mut count = 0;
    while let Some(p) = doc.parent(cur).unwrap() {
        cur = p;
        count += 1;
    }
    assert_eq!(count, DEEP_DEPTH);
    assert!(doc.is_descendant_of(prev, root).unwrap());
}

#[test]
fn stress_wide_tree() {
    let mut doc = Document::new();
    let root = doc.create_element("ul").unwrap();
    for _ in 0..WIDE_WIDTH {
        let li = doc.create_element("li").unwrap();
        doc.append_child(root, li).unwrap();
    }
    assert_eq!(doc.check_invariants(root).unwrap(), ());

    let mut count = 0;
    let mut cur = doc.first_child(root).unwrap();
    while let Some(c) = cur {
        count += 1;
        cur = doc.next_sibling(c).unwrap();
    }
    assert_eq!(count, WIDE_WIDTH);

    let mut count = 0;
    let mut cur = doc.last_child(root).unwrap();
    while let Some(c) = cur {
        count += 1;
        cur = doc.previous_sibling(c).unwrap();
    }
    assert_eq!(count, WIDE_WIDTH);
}

#[test]
fn stress_frequent_arena_slot_reuse() {
    let mut source = Document::new();
    let mut target = Document::new();
    let mut old_handles = Vec::with_capacity(REUSE_ITERATIONS);
    let mut adopted = Vec::with_capacity(REUSE_ITERATIONS);
    for i in 0..REUSE_ITERATIONS {
        let old = source.create_element("old").unwrap();
        let migrated = target.adopt_node(&mut source, old).unwrap();
        // The freed source slot is reused with a bumped generation; the old
        // handle must be rejected, never aliasing the fresh node.
        let fresh = source.create_element("fresh").unwrap();
        assert!(
            matches!(source.get(old), Err(CoreError::Arena(_))),
            "iteration {i}: old handle aliased the reused slot"
        );
        assert_eq!(source.node_name(fresh).unwrap(), "fresh");
        old_handles.push(old);
        adopted.push(migrated);
    }
    // Every old handle stays permanently rejected, and every migrated node
    // lives on in the target document as a valid detached root.
    for &old in &old_handles {
        assert!(source.get(old).is_err());
        assert!(matches!(
            target.get(old),
            Err(CoreError::WrongDocument { .. })
        ));
    }
    for &migrated in &adopted {
        assert_eq!(target.node_name(migrated).unwrap(), "old");
        assert_eq!(target.check_invariants(migrated).unwrap(), ());
    }
}

#[test]
fn stress_cross_document_misuse_never_corrupts() {
    let seed = 0x5EED_F00D_CAFE_0123;
    let mut rng = SplitMix64::new(seed);
    let mut a = Document::new();
    let mut b = Document::new();
    let mut pool_a: Vec<NodeId> = Vec::new();
    let mut pool_b: Vec<NodeId> = Vec::new();
    for i in 0..MISUSE_ITERATIONS {
        if pool_a.is_empty() || rng.usize_in(10) == 0 {
            pool_a.push(a.create_element("a").unwrap());
        }
        if pool_b.is_empty() || rng.usize_in(10) == 0 {
            pool_b.push(b.create_element("b").unwrap());
        }
        let from_a = pool_a[rng.usize_in(pool_a.len())];
        let from_b = pool_b[rng.usize_in(pool_b.len())];
        match rng.usize_in(5) {
            0 => assert!(a.append_child(from_b, from_a).is_err(), "iter {i}"),
            1 => assert!(a.insert_before(from_b, from_a, from_b).is_err(), "iter {i}"),
            2 => assert!(a.remove_child(from_b, from_a).is_err(), "iter {i}"),
            3 => assert!(a.replace_child(from_b, from_a, from_b).is_err(), "iter {i}"),
            _ => {
                // A legal cross-document import must still succeed.
                assert!(a.import_node(&b, from_b, true).is_ok(), "iter {i}");
            }
        }
        // Passing a handle that belongs to `a` as the source argument for a
        // document rooted in `b` is misuse and must fail atomically.
        assert!(a.adopt_node(&mut b, from_a).is_err(), "iter {i}");
        // Both documents stay structurally consistent throughout.
        common::check_roots(&a, &pool_a).unwrap();
        common::check_roots(&b, &pool_b).unwrap();
    }
}
