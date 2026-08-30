//! T43 Shadow DOM fixtures.
//!
//! Integration-level evidence for `src/dom/shadow_root.rs` and the shadow-aware
//! connectivity / event / query seams: `attachShadow` (open/closed mode), the
//! arena ownership of a shadow tree, the structural query/navigation boundary,
//! the shadow-including `is_connected`, the composed event path across a
//! shadow boundary, and the basic named slot assignment. The acceptance
//! criteria pinned here:
//!
//! * ordinary DOM navigation never pierces the shadow boundary (a host's
//!   children, queries and serialization stay on the light side; a shadow
//!   root's children are a separate tree);
//! * a `closed` root never leaks through the public `shadow_root` read;
//! * a composed event propagates across the boundary (capture from the host
//!   down, bubble back up) while a non-composed event stops at the shadow
//!   root, and the path fixed at dispatch start matches the WHATWG
//!   composed-path rule;
//! * a node inside an attached shadow tree reports `is_connected` like
//!   happy-dom.

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{
    DispatchInvocation, Document, EventState, ShadowRootMode, EVENT_PHASE_AT_TARGET,
    EVENT_PHASE_BUBBLING, EVENT_PHASE_CAPTURING,
};
use mad_dom_core::error::CoreError;
use mad_dom_core::serialize::serialize_node;

// ---- shared helpers ---------------------------------------------------------

/// Builds a shadow tree `host (shadow root) > inner`, detached from the
/// document, and returns the document plus the host and inner handles.
fn shadow_tree() -> (Document, NodeId, NodeId) {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    let inner = doc.create_element("span").unwrap();
    let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
    doc.append_child(root, inner).unwrap();
    (doc, host, inner)
}

/// Connects a host under the document root: `document root > html > body > host`
/// (the implied skeleton, public API only).
fn connect_host(doc: &mut Document, host: NodeId) {
    doc.ensure_html_skeleton().unwrap();
    let body = doc.document_body().unwrap().unwrap();
    doc.append_child(body, host).unwrap();
}

/// Runs a dispatch like the binding: records `(nodeName, phase)` steps for the
/// registered listeners and returns them with the post-dispatch event state.
/// `before` lets the fixture mutate the event state.
fn run_dispatch(
    doc: &mut Document,
    target: NodeId,
    mut event: EventState,
    mut before: impl FnMut(&mut Document, &DispatchInvocation, &mut EventState),
) -> (Vec<String>, EventState) {
    let mut steps = Vec::new();
    let mut dispatch = doc.begin_dispatch(target, &mut event).unwrap();
    loop {
        match doc.next_invocation(&mut dispatch, &mut event).unwrap() {
            None => break,
            Some(invocation) => {
                let phase = match invocation.phase {
                    EVENT_PHASE_CAPTURING => "c",
                    EVENT_PHASE_AT_TARGET => "t",
                    EVENT_PHASE_BUBBLING => "b",
                    _ => "?",
                };
                steps.push(format!(
                    "{}/{phase}",
                    doc.node_name(invocation.target).unwrap()
                ));
                before(doc, &invocation, &mut event);
                doc.complete_invocation(&mut dispatch, invocation.listener_id)
                    .unwrap();
            }
        }
    }
    doc.finish_dispatch(&mut dispatch, &mut event).unwrap();
    (steps, event)
}

// ---- ownership and the structural boundary ----------------------------------

#[test]
fn the_shadow_root_is_not_a_child_of_the_host() {
    let (doc, host, inner) = shadow_tree();
    assert_eq!(
        doc.children(host).unwrap(),
        Vec::<NodeId>::new(),
        "the host's light DOM stays empty"
    );
    let root = doc.shadow_root(host).unwrap().unwrap();
    assert_eq!(doc.parent(inner).unwrap(), Some(root));
    assert_eq!(doc.parent(root).unwrap(), None);
    assert_eq!(doc.check_invariants(host).unwrap(), ());
    assert_eq!(doc.check_invariants(root).unwrap(), ());
}

#[test]
fn queries_stay_on_their_own_side_of_the_boundary() {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
    let shadow_el = doc.create_element("p").unwrap();
    doc.append_child(root, shadow_el).unwrap();
    let light_el = doc.create_element("p").unwrap();
    doc.append_child(host, light_el).unwrap();

    assert_eq!(
        doc.query_selector(host, "p").unwrap(),
        Some(light_el),
        "a query on the host sees only the light DOM"
    );
    assert_eq!(
        doc.query_selector(root, "p").unwrap(),
        Some(shadow_el),
        "a query on the shadow root sees the shadow tree"
    );
    assert_eq!(doc.query_selector_all(host, "p").unwrap(), vec![light_el]);
    assert_eq!(doc.query_selector_all(root, "p").unwrap(), vec![shadow_el]);
}

#[test]
fn serialization_stays_on_its_own_side_of_the_boundary() {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
    let inner = doc.create_element("span").unwrap();
    doc.append_child(root, inner).unwrap();
    let light = doc.create_element("em").unwrap();
    doc.append_child(host, light).unwrap();

    assert_eq!(
        serialize_node(&doc, host).unwrap(),
        "<div><em></em></div>",
        "outerHTML of the host never serializes the shadow tree"
    );
    assert_eq!(
        doc.inner_html(host).unwrap(),
        "<em></em>",
        "innerHTML of the host stays on the light side"
    );
    assert_eq!(
        doc.inner_html(root).unwrap(),
        "<span></span>",
        "innerHTML of the shadow root serializes its own tree"
    );
}

#[test]
fn text_content_operates_per_tree() {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
    let text = doc.create_text("shadow").unwrap();
    doc.append_child(root, text).unwrap();

    assert_eq!(doc.text_content(root).unwrap(), Some("shadow".to_string()));
    assert_eq!(doc.text_content(host).unwrap(), Some(String::new()));
    doc.set_text_content(root, "updated").unwrap();
    assert_eq!(doc.text_content(root).unwrap(), Some("updated".to_string()));
    assert_eq!(
        doc.children(host).unwrap(),
        Vec::<NodeId>::new(),
        "the host's light tree is untouched by a shadow-tree textContent write"
    );
}

// ---- open / closed mode ------------------------------------------------------

#[test]
fn closed_roots_never_leak_through_the_public_read() {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    let closed = doc.attach_shadow(host, ShadowRootMode::Closed).unwrap();
    assert_eq!(
        doc.shadow_root(host).unwrap(),
        None,
        "a closed root reads as absent from the host"
    );
    assert_eq!(
        doc.shadow_root_mode(closed).unwrap(),
        Some(ShadowRootMode::Closed)
    );
    assert_eq!(doc.shadow_host(closed).unwrap(), Some(host));

    let open_host = doc.create_element("div").unwrap();
    let open = doc.attach_shadow(open_host, ShadowRootMode::Open).unwrap();
    assert_eq!(doc.shadow_root(open_host).unwrap(), Some(open));
}

#[test]
fn attach_shadow_rejects_a_host_that_already_owns_a_root() {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
    assert!(matches!(
        doc.attach_shadow(host, ShadowRootMode::Closed),
        Err(CoreError::Hierarchy { .. })
    ));
    let text = doc.create_text("x").unwrap();
    assert!(matches!(
        doc.attach_shadow(text, ShadowRootMode::Open),
        Err(CoreError::Hierarchy { .. })
    ));
}

// ---- shadow-including connectedness ------------------------------------------

#[test]
fn is_connected_crosses_the_shadow_boundary_to_the_host() {
    let (mut doc, host, inner) = shadow_tree();
    assert!(
        !doc.is_connected(inner).unwrap(),
        "a shadow tree under a detached host is not connected"
    );
    connect_host(&mut doc, host);
    assert!(
        doc.is_connected(inner).unwrap(),
        "a node inside an attached shadow tree is connected (the host is)"
    );
    let root = doc.shadow_root(host).unwrap().unwrap();
    assert!(doc.is_connected(root).unwrap());
    assert!(doc.is_connected(host).unwrap());
}

// ---- composed event path and propagation across the boundary ----------------

fn shadow_dispatch_fixture(doc: &mut Document) -> (NodeId, NodeId, NodeId, NodeId) {
    let host = doc.create_element("div").unwrap();
    let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
    let inner = doc.create_element("span").unwrap();
    doc.append_child(root, inner).unwrap();
    let outer = doc.create_element("section").unwrap();
    doc.append_child(host, outer).unwrap();
    connect_host(doc, host);
    (host, root, inner, outer)
}

#[test]
fn a_composed_event_propagates_across_the_shadow_boundary() {
    let mut doc = Document::new();
    let (host, root, inner, _outer) = shadow_dispatch_fixture(&mut doc);
    for node in [host, root, inner] {
        doc.add_event_listener(node, "boom", true, false, false)
            .unwrap();
        doc.add_event_listener(node, "boom", false, false, false)
            .unwrap();
    }
    let event = EventState::new("boom", true, false, true);
    let (steps, event) = run_dispatch(&mut doc, inner, event, |_, _, _| {});
    // Capture from the host down: host/c, root/c, inner/c; at-target inner/t;
    // bubble back up: root/b, host/b.
    assert_eq!(
        steps,
        vec![
            "div/c",
            "#document-fragment/c",
            "span/c",
            "span/t",
            "#document-fragment/b",
            "div/b",
        ]
    );
    let path = doc.composed_path(inner, true).unwrap();
    assert_eq!(
        path[..3],
        [inner, root, host],
        "the composed path starts with the target, the shadow root and the host"
    );
    assert_eq!(
        doc.node_type(*path.last().unwrap()).unwrap(),
        mad_dom_core::dom::NodeType::Document,
        "the composed path runs up to the document root"
    );
    assert_eq!(
        doc.composed_path(inner, false).unwrap(),
        vec![inner, root],
        "a non-composed path stops at the shadow root"
    );
    // The event target stays the original dispatch target (happy-dom does not
    // retarget), and the path is fixed at dispatch start.
    assert_eq!(event.target, Some(inner));
}

#[test]
fn a_non_composed_event_stops_at_the_shadow_root() {
    let mut doc = Document::new();
    let (host, _root, inner, _outer) = shadow_dispatch_fixture(&mut doc);
    for node in [host, inner] {
        doc.add_event_listener(node, "boom", true, false, false)
            .unwrap();
        doc.add_event_listener(node, "boom", false, false, false)
            .unwrap();
    }
    let event = EventState::new("boom", true, false, false);
    let (steps, _event) = run_dispatch(&mut doc, inner, event, |_, _, _| {});
    assert_eq!(
        steps,
        vec!["span/c", "span/t"],
        "a non-composed event never reaches the host (the shadow-root structs have no listeners)"
    );
}

// ---- basic named slot assignment ---------------------------------------------

#[test]
fn assigned_nodes_matches_named_and_default_slots() {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
    let named = doc.create_element("slot").unwrap();
    doc.set_attribute(named, "name", "one").unwrap();
    let fallback = doc.create_element("slot").unwrap();
    doc.append_child(root, named).unwrap();
    doc.append_child(root, fallback).unwrap();

    let a = doc.create_element("span").unwrap();
    let b = doc.create_element("span").unwrap();
    doc.set_attribute(a, "slot", "one").unwrap();
    doc.append_child(host, a).unwrap();
    doc.append_child(host, b).unwrap();

    assert_eq!(doc.slot_assigned_nodes(named, false).unwrap(), vec![a]);
    assert_eq!(doc.slot_assigned_nodes(fallback, false).unwrap(), vec![b]);
    assert_eq!(doc.slot_assigned_elements(named, false).unwrap(), vec![a]);
}

// ---- clone / serialization baseline ------------------------------------------

#[test]
fn cloning_a_host_does_not_clone_its_shadow_tree() {
    let (mut doc, host, inner) = shadow_tree();
    let clone = doc.clone_node(host, true).unwrap();
    assert_eq!(
        doc.shadow_root(clone).unwrap(),
        None,
        "a cloned host has no shadow root (the happy-dom clonable:false default)"
    );
    assert_eq!(
        doc.children(clone).unwrap(),
        Vec::<NodeId>::new(),
        "the light DOM is still cloned"
    );
    assert!(doc.get(inner).is_ok());
    assert_eq!(doc.check_invariants(clone).unwrap(), ());
}

#[test]
fn cloning_a_shadow_root_clones_the_shadow_tree() {
    let mut doc = Document::new();
    let host = doc.create_element("div").unwrap();
    let root = doc.attach_shadow(host, ShadowRootMode::Open).unwrap();
    let inner = doc.create_element("span").unwrap();
    doc.append_child(root, inner).unwrap();

    let clone = doc.clone_node(root, true).unwrap();
    assert_eq!(doc.node_name(clone).unwrap(), "#document-fragment");
    assert_eq!(
        doc.shadow_root_mode(clone).unwrap(),
        Some(ShadowRootMode::Open),
        "the cloned root keeps its mode"
    );
    assert_eq!(
        doc.shadow_host(clone).unwrap(),
        None,
        "the clone is detached and has no host"
    );
    let kids = doc.children(clone).unwrap();
    assert_eq!(kids.len(), 1);
    assert_eq!(doc.node_name(kids[0]).unwrap(), "span");
    assert_eq!(doc.check_invariants(clone).unwrap(), ());
}
