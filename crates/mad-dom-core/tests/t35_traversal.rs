//! T35 traversal fixtures.
//!
//! Integration-level evidence for `src/traversal/mod.rs`: the Core contract the
//! JavaScript `TreeWalker` / `NodeIterator` surface drives through the native
//! binding. Because Core keeps no JavaScript callback, the fixtures simulate
//! the binding — they run each traversal loop (`traversal_start` →
//! `traversal_filter` per candidate → until `Done`) against a fake filter and
//! assert the acceptance criteria:
//!
//! * *order* — `nextNode` visits the subtree in document (pre)order, with and
//!   without a filter, and `previousNode` walks it backwards;
//! * *filtering* — `FILTER_REJECT` prunes a subtree and the `whatToShow` mask
//!   skips node types inline;
//! * *mutation* — removing a node mid-walk never leaves the traversal touching
//!   a dangling id: the walk continues over the surviving tree and the removed
//!   subtree's nodes are simply no longer visited;
//! * *reentrancy* — a filter that mutates the tree between decisions is
//!   observed by the very next step, exactly like the baseline.

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::Document;
use mad_dom_core::traversal::{TraversalOp, TraversalStep, FILTER_ACCEPT, FILTER_REJECT, SHOW_ALL};

/// Builds a tree and returns the document plus the node ids of
/// `body > (div#a > span#a1, div#b > (p#b1, p#b2))`.
fn build_tree() -> (Document, NodeId, NodeId, NodeId, NodeId, NodeId, NodeId) {
    let mut doc = Document::new();
    let body = doc.create_element("body").unwrap();
    let a = doc.create_element("div").unwrap();
    let a1 = doc.create_element("span").unwrap();
    let b = doc.create_element("div").unwrap();
    let b1 = doc.create_element("p").unwrap();
    let b2 = doc.create_element("p").unwrap();
    doc.append_child(a, a1).unwrap();
    doc.append_child(b, b1).unwrap();
    doc.append_child(b, b2).unwrap();
    doc.append_child(body, a).unwrap();
    doc.append_child(body, b).unwrap();
    (doc, body, a, a1, b, b1, b2)
}

/// The binding name of a node, or `"?"` when the handle is stale/foreign.
fn name(doc: &Document, id: NodeId) -> &str {
    doc.node_name(id).unwrap_or("?")
}

/// A fake binding-side driver: runs one traversal pass to completion, invoking
/// `filter` for each candidate and `before_apply` (a mutation hook) before the
/// traversal resumes. Returns the accepted node (or `None`).
///
/// This mirrors the binding loop exactly: `traversal_start` then a
/// `traversal_filter` round trip per candidate, with the JS-filter invocation
/// (here a fake) happening outside the document state between steps.
fn run_pass<F, M>(
    doc: &mut Document,
    op: TraversalOp,
    root: NodeId,
    current: NodeId,
    mut filter: F,
    mut before_apply: M,
) -> Option<NodeId>
where
    F: FnMut(&Document, NodeId) -> u32,
    M: FnMut(&mut Document, NodeId, u32),
{
    let (mut pass, mut step) = doc
        .traversal_start(op, root, current, SHOW_ALL, true)
        .unwrap();
    loop {
        match step {
            TraversalStep::Done(Some(node)) => return Some(node),
            TraversalStep::Done(None) => return None,
            TraversalStep::Filter(node) => {
                let result = filter(doc, node);
                before_apply(doc, node, result);
                step = doc.traversal_filter(&mut pass, result).unwrap();
            }
        }
    }
}

/// Full pre-order walk with an accepting filter: `body → div#a → span#a1 →
/// div#b → p#b1 → p#b2`, then `null`.
#[test]
fn next_node_full_preorder() {
    let (mut doc, body, a, a1, b, b1, b2) = build_tree();
    let mut current = body;
    for expected in [a, a1, b, b1, b2] {
        let next = run_pass(
            &mut doc,
            TraversalOp::NextNode,
            body,
            current,
            |_, _| FILTER_ACCEPT,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(next, expected);
        current = next;
    }
    assert!(run_pass(
        &mut doc,
        TraversalOp::NextNode,
        body,
        current,
        |_, _| FILTER_ACCEPT,
        |_, _, _| {}
    )
    .is_none());
}

/// Reverse walk from the last leaf: `p#b2 → p#b1 → div#b → span#a1 → div#a →
/// body`, then `null`.
#[test]
fn previous_node_reverse_walk() {
    let (mut doc, body, a, a1, b, b1, b2) = build_tree();
    let mut current = b2;
    for expected in [b1, b, a1, a, body] {
        let previous = run_pass(
            &mut doc,
            TraversalOp::PreviousNode,
            body,
            current,
            |_, _| FILTER_ACCEPT,
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(previous, expected);
        current = previous;
    }
    assert!(run_pass(
        &mut doc,
        TraversalOp::PreviousNode,
        body,
        current,
        |_, _| FILTER_ACCEPT,
        |_, _, _| {}
    )
    .is_none());
}

/// A `FILTER_REJECT` on the first subtree root prunes that whole subtree: the
/// walk resumes at the second subtree without visiting the rejected node's
/// children.
#[test]
fn reject_prunes_the_subtree() {
    let (mut doc, body, _a, _a1, b, _b1, _b2) = build_tree();
    let mut divs = 0;
    let next = run_pass(
        &mut doc,
        TraversalOp::NextNode,
        body,
        body,
        |doc, node| {
            if name(doc, node) == "div" {
                divs += 1;
                if divs == 1 {
                    FILTER_REJECT
                } else {
                    FILTER_ACCEPT
                }
            } else {
                FILTER_ACCEPT
            }
        },
        |_, _, _| {},
    )
    .unwrap();
    assert_eq!(next, b, "the rejected div#a subtree is skipped");
}

/// The `whatToShow` mask is applied inline: a masked-out type yields no
/// candidate even without a user filter.
#[test]
fn what_to_show_mask_skips_node_types_inline() {
    let (doc, body, a, _a1, _b, _b1, _b2) = build_tree();
    assert!(doc
        .traversal_mask_skips(a, mad_dom_core::traversal::SHOW_TEXT)
        .unwrap());
    assert!(!doc
        .traversal_mask_skips(a, mad_dom_core::traversal::SHOW_ELEMENT)
        .unwrap());
    let _ = body;
}

/// Removing a subtree mid-walk: the traversal never touches a dangling id. The
/// filter rejects nothing, but the mutation hook removes `span#a1` when the
/// walk reaches `div#a`, so the walk continues at `div#b` — the removed node is
/// never returned and no step errors.
#[test]
fn removing_a_subtree_mid_walk_never_touches_a_dangling_id() {
    let (mut doc, body, _a, _a1, b, _b1, _b2) = build_tree();
    let mut order = Vec::new();
    let mut current = body;
    let mut mutated = false;
    loop {
        let step = run_pass(
            &mut doc,
            TraversalOp::NextNode,
            body,
            current,
            |_, _| FILTER_ACCEPT,
            |doc, node, _| {
                if !mutated && name(doc, node) == "div" {
                    // The walk is deciding on div#a: drop its child subtree
                    // before the walk resumes.
                    if let Some(child) = doc.first_child(node).unwrap() {
                        if name(doc, child) == "span" {
                            doc.remove_child(node, child).unwrap();
                            mutated = true;
                        }
                    }
                }
            },
        );
        match step {
            Some(node) => {
                order.push(name(&doc, node).to_string());
                current = node;
            }
            None => break,
        }
    }
    assert!(mutated, "the mutation hook must have run");
    // div#a, div#b, p#b1, p#b2 — span#a1 was removed and never visited, and
    // no step touched a dangling id.
    assert_eq!(
        order,
        vec![
            "div".to_string(),
            "div".to_string(),
            "p".to_string(),
            "p".to_string()
        ]
    );
    let _ = b;
}

/// Reentrancy: the filter itself mutates the tree. When the walk filters
/// `div#b`, it removes `p#b1`; the next step observes the new tree, so `p#b1`
/// is never returned and the walk continues at `p#b2`.
#[test]
fn a_mutating_filter_is_observed_by_the_next_step() {
    let (mut doc, body, _a, _a1, b, _b1, b2) = build_tree();
    let mut order = Vec::new();
    let mut current = body;
    let mut removed = false;
    loop {
        let step = run_pass(
            &mut doc,
            TraversalOp::NextNode,
            body,
            current,
            |_, _| FILTER_ACCEPT,
            |doc, node, _| {
                if !removed && name(doc, node) == "div" {
                    // The first div is div#a (its child is a span, so nothing
                    // happens); this is div#b, whose child p#b1 is removed.
                    if let Some(child) = doc.first_child(node).unwrap() {
                        if name(doc, child) == "p" {
                            doc.remove_child(node, child).unwrap();
                            removed = true;
                        }
                    }
                }
            },
        );
        match step {
            Some(node) => {
                order.push(name(&doc, node).to_string());
                current = node;
            }
            None => break,
        }
    }
    assert!(removed);
    // div#a, span#a1, div#b, p#b2 — p#b1 was removed by the filter and never
    // returned.
    assert_eq!(
        order,
        vec![
            "div".to_string(),
            "span".to_string(),
            "div".to_string(),
            "p".to_string()
        ]
    );
    let _ = b;
    let _ = b2;
}

/// A foreign handle at pass start is rejected with a structured error rather
/// than touching memory.
#[test]
fn foreign_root_is_rejected() {
    let (doc, body, _a, _a1, _b, _b1, _b2) = build_tree();
    let mut other = Document::new();
    let foreign = other.create_element("foreign").unwrap();
    assert!(doc
        .traversal_start(TraversalOp::NextNode, foreign, body, SHOW_ALL, true)
        .is_err());
}
