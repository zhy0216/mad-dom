//! T38 event-class initialization fixtures.
//!
//! Integration-level evidence for the T38 Core slice of `src/dom/events.rs`:
//! the fixed propagation path that backs `Event.composedPath()`, and the
//! initialization contract the `Event.initEvent` / `CustomEvent.initCustomEvent`
//! facade methods drive:
//!
//! * *propagation path* — `Document::propagation_path` returns the target
//!   followed by its ancestor chain up to the document root (the exact path
//!   `begin_dispatch` walks), stays stable under tree mutation after it is
//!   captured, and reports a single-element path for a detached node;
//! * *`initEvent`* — sets `type` / `bubbles` / `cancelable` and resets the
//!   per-dispatch cancellation flags (`defaultPrevented`,
//!   `stopPropagation`, `stopImmediatePropagation`) unconditionally, matching
//!   the baseline (happy-dom does not guard it on the dispatching flag);
//! * *`initCustomEvent`* — sets `type` / `bubbles` / `cancelable` without
//!   touching the cancellation flags, so `defaultPrevented` and the stop
//!   flags survive the re-initialization.
//!
//! The mutable dispatch-loop machinery itself (`begin_dispatch` →
//! `next_invocation` → `complete_invocation` → `finish_dispatch`) is covered by
//! `t37_events.rs`; this file only pins the new T38 surface.

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, EventState};
use mad_dom_core::html::parse_html_document;

/// Builds a connected tree `document-root > html > body > div > span` through
/// the HTML parser (the only path that may attach children under the document
/// root) and returns the document plus the `body`, `div` and `span` handles.
fn build_tree() -> (Document, NodeId, NodeId, NodeId) {
    let parsed = parse_html_document("<html><body><div><span></span></div></body></html>").unwrap();
    let mut doc = parsed.document;
    let html = find_child(&mut doc, parsed.root, "html").expect("document has an html child");
    let body = find_child(&mut doc, html, "body").expect("html has a body child");
    let div = find_child(&mut doc, body, "div").expect("body has a div child");
    let span = find_child(&mut doc, div, "span").expect("div has a span child");
    (doc, body, div, span)
}

/// Finds the first element child of `parent` whose tag equals `name`.
fn find_child(doc: &mut Document, parent: NodeId, name: &str) -> Option<NodeId> {
    let mut cur = doc.first_child(parent).ok()?;
    while let Some(node) = cur {
        if doc.node_name(node).ok().is_some_and(|n| n == name) {
            return Some(node);
        }
        cur = doc.next_sibling(node).ok().flatten();
    }
    None
}

/// The document root of the parsed document.
fn document_root(doc: &mut Document) -> NodeId {
    doc.document_root()
}

fn event_of(type_: &str, bubbles: bool, cancelable: bool) -> EventState {
    EventState::new(type_, bubbles, cancelable, false)
}

// ---- propagation_path (backs Event.composedPath) -----------------------------

#[test]
fn propagation_path_is_target_followed_by_ancestors_up_to_the_root() {
    let (mut doc, body, div, span) = build_tree();
    let root = document_root(&mut doc);
    let html = doc.parent(body).unwrap().expect("body has an html parent");

    let path = doc.propagation_path(span).unwrap();
    assert_eq!(path, vec![span, div, body, html, root]);
}

#[test]
fn propagation_path_of_a_detached_node_is_just_itself() {
    let (mut doc, _, _, _) = build_tree();
    let detached = doc.create_element("p").unwrap();
    assert_eq!(doc.propagation_path(detached).unwrap(), vec![detached]);
}

#[test]
fn propagation_path_is_fixed_at_capture_time_despite_mutation() {
    let (mut doc, body, div, span) = build_tree();
    let root = document_root(&mut doc);
    let html = doc.parent(body).unwrap().expect("body has an html parent");
    let path = doc.propagation_path(span).unwrap();
    assert_eq!(path, vec![span, div, body, html, root]);

    // Mutate the tree after capturing the path: the path is already fixed.
    doc.remove_child(body, div).unwrap();
    let section = doc.create_element("section").unwrap();
    doc.append_child(body, section).unwrap();
    doc.append_child(section, div).unwrap();
    assert_eq!(
        doc.propagation_path(span).unwrap(),
        vec![span, div, section, body, html, root],
        "a fresh capture reflects the moved position; the captured path does not change"
    );
    assert_eq!(path, vec![span, div, body, html, root]);
}

// ---- initEvent -----------------------------------------------------------------

#[test]
fn init_event_reinitializes_values_and_resets_cancellation_flags() {
    let mut event = event_of("evt", false, true);
    event.default_prevented = true;
    event.stop_propagation = true;
    event.stop_immediate_propagation = true;

    event.init_event("renamed", true, false);

    assert_eq!(event.event_type, "renamed");
    assert!(event.bubbles);
    assert!(!event.cancelable);
    assert!(
        !event.default_prevented,
        "initEvent resets defaultPrevented"
    );
    assert!(!event.stop_propagation, "initEvent resets stopPropagation");
    assert!(
        !event.stop_immediate_propagation,
        "initEvent resets stopImmediatePropagation"
    );
}

#[test]
fn init_event_applies_unconditionally_while_dispatching() {
    let (mut doc, _, _, span) = build_tree();

    let mut dispatching = event_of("orig", false, false);
    let mut dispatch = doc.begin_dispatch(span, &mut dispatching).unwrap();
    dispatching.init_event("changed", true, true);
    assert_eq!(dispatching.event_type, "changed");
    assert!(dispatching.bubbles);
    assert!(dispatching.cancelable);
    doc.finish_dispatch(&mut dispatch, &mut dispatching)
        .unwrap();
}

// ---- initCustomEvent ------------------------------------------------------------

#[test]
fn set_init_values_reinitializes_without_touching_cancellation_flags() {
    let mut event = event_of("evt", false, true);
    event.default_prevented = true;
    event.stop_propagation = true;
    event.stop_immediate_propagation = true;

    event.set_init_values("renamed", true, false);

    assert_eq!(event.event_type, "renamed");
    assert!(event.bubbles);
    assert!(!event.cancelable);
    assert!(
        event.default_prevented && event.stop_propagation && event.stop_immediate_propagation,
        "initCustomEvent keeps the cancellation flags as they are (baseline)"
    );
}
