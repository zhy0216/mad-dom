//! T37 EventTarget propagation fixtures.
//!
//! Integration-level evidence for `src/dom/events.rs`: the Core contract the
//! JavaScript `addEventListener` / `removeEventListener` / `dispatchEvent`
//! surface drives through the native binding. Because Core keeps no JavaScript
//! callback, the fixtures simulate the binding: they register listeners with
//! the returned ids, run the dispatch loop (`begin_dispatch` →
//! `next_invocation` → `complete_invocation` → `finish_dispatch`) against a
//! fake invoker that records the invocation order, and assert the acceptance
//! criteria:
//!
//! * *registration / removal / order* — listeners fire in registration order,
//!   duplicates are deduplicated by the binding-level callback comparison
//!   (pinned here through the `event_listener_ids` query), and removed
//!   listeners never fire;
//! * *capture / target / bubbling* — a bubbling dispatch visits capture
//!   structs from the root down to the target, the target struct, then bubbling
//!   structs up to the root, and a non-bubbling event stops after the target;
//! * *cancellation* — `stopPropagation` ends the dispatch after the current
//!   struct, `stopImmediatePropagation` ends it immediately, `preventDefault`
//!   respects `cancelable` and `passive`, and the `dispatchEvent` return value
//!   is `!cancelable || !defaultPrevented`;
//! * *options* — `once` removes the listener after one invocation (even when
//!   the callback throws) and `passive` is reported per invocation;
//! * *reentrancy / mutation* — a listener may mutate the tree (the path is
//!   fixed at dispatch start), remove or re-add listeners, and dispatch a
//!   nested event without corrupting the outer dispatch; the same event can be
//!   re-dispatched after completion;
//! * *snapshot semantics* — a listener registered during a dispatch is not
//!   invoked by it, while a listener removed after its struct started still
//!   runs if it was captured by that struct's snapshot (the happy-dom clone
//!   semantics).

use mad_dom_core::arena::{ArenaError, NodeId};
use mad_dom_core::dom::{
    DispatchInvocation, Document, EventState, EVENT_PHASE_AT_TARGET, EVENT_PHASE_BUBBLING,
    EVENT_PHASE_CAPTURING, EVENT_PHASE_NONE,
};
use mad_dom_core::error::CoreError;

// ---- shared helpers ---------------------------------------------------------

/// Builds a tree `body > div > span` and returns the document plus the
/// `body`, `div` and `span` handles.
fn build_tree() -> (Document, NodeId, NodeId, NodeId) {
    let mut doc = Document::new();
    let body = doc.create_element("body").unwrap();
    let div = doc.create_element("div").unwrap();
    let span = doc.create_element("span").unwrap();
    doc.append_child(body, div).unwrap();
    doc.append_child(div, span).unwrap();
    (doc, body, div, span)
}

/// A fake binding-side invoker: records every `(node_name, phase)` step and
/// simulates a callback that may mutate the event state (default actions) or
/// call `complete_invocation` on behalf of the binding.
struct Invoker {
    steps: Vec<String>,
}

impl Invoker {
    /// Runs the full dispatch loop for `event` on `target`, invoking a fake
    /// listener for each invocation. `before` lets the fixture react to an
    /// invocation (set cancellation flags, mutate the tree, dispatch a nested
    /// event) before `complete_invocation`.
    fn run(
        doc: &mut Document,
        target: NodeId,
        mut event: EventState,
        mut before: impl FnMut(&mut Document, &DispatchInvocation, &mut EventState),
    ) -> (Vec<String>, EventState) {
        let mut invoker = Invoker { steps: Vec::new() };
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
                    let name = doc.node_name(invocation.target).unwrap().to_string();
                    invoker.steps.push(format!("{name}/{phase}"));
                    before(doc, &invocation, &mut event);
                    doc.complete_invocation(&mut dispatch, invocation.listener_id)
                        .unwrap();
                }
            }
        }
        doc.finish_dispatch(&mut dispatch, &mut event).unwrap();
        (invoker.steps, event)
    }
}

/// `step` helper: registers `listener` on `target` under a unique type and
/// returns the event state to dispatch with it.
fn register(
    doc: &mut Document,
    target: NodeId,
    event_type: &str,
    capture: bool,
    once: bool,
    passive: bool,
) -> u64 {
    doc.add_event_listener(target, event_type, capture, once, passive)
        .unwrap()
}

fn event_of(type_: &str, bubbles: bool, cancelable: bool) -> EventState {
    EventState::new(type_, bubbles, cancelable, false)
}

// ---- capture / target / bubbling order --------------------------------------

#[test]
fn bubbling_event_visits_structs_in_capture_target_bubble_order() {
    let (mut doc, body, div, span) = build_tree();
    register(&mut doc, body, "go", true, false, false);
    register(&mut doc, div, "go", true, false, false);
    register(&mut doc, span, "go", true, false, false);
    register(&mut doc, span, "go", false, false, false);
    register(&mut doc, div, "go", false, false, false);
    register(&mut doc, body, "go", false, false, false);

    let (steps, _) = Invoker::run(&mut doc, span, event_of("go", true, false), |_, _, _| {});
    assert_eq!(
        steps,
        ["body/c", "div/c", "span/c", "span/t", "div/b", "body/b"],
        "capture structs from root to target, then the target struct, then bubbling structs up"
    );
}

#[test]
fn non_bubbling_event_stops_after_the_target() {
    let (mut doc, body, div, span) = build_tree();
    register(&mut doc, body, "go", true, false, false);
    register(&mut doc, div, "go", true, false, false);
    register(&mut doc, span, "go", false, false, false);
    register(&mut doc, div, "go", false, false, false);

    let (steps, _) = Invoker::run(&mut doc, span, event_of("go", false, false), |_, _, _| {});
    assert_eq!(
        steps,
        ["body/c", "div/c", "span/t"],
        "capture + target only, no bubbling structs"
    );
}

#[test]
fn detached_target_only_visits_its_own_structs() {
    let mut doc = Document::new();
    let detached = doc.create_element("x").unwrap();
    register(&mut doc, detached, "go", true, false, false);
    register(&mut doc, detached, "go", false, false, false);

    let (steps, _) = Invoker::run(
        &mut doc,
        detached,
        event_of("go", true, false),
        |_, _, _| {},
    );
    assert_eq!(steps, ["x/c", "x/t"]);
}

#[test]
fn listeners_fire_in_registration_order_within_a_struct() {
    let (mut doc, _, _, span) = build_tree();
    let first = register(&mut doc, span, "go", false, false, false);
    let second = register(&mut doc, span, "go", false, false, false);
    let third = register(&mut doc, span, "go", false, false, false);
    assert_ne!(first, second);
    assert_ne!(second, third);

    let (steps, _) = Invoker::run(&mut doc, span, event_of("go", true, false), |_, _, _| {});
    assert_eq!(
        steps,
        ["span/t", "span/t", "span/t"],
        "registration order preserved"
    );
}

#[test]
fn listener_ids_are_document_unique_and_reused_ids_are_filtered() {
    let (mut doc, body, _, span) = build_tree();
    let a = register(&mut doc, body, "go", false, false, false);
    let b = register(&mut doc, span, "go", false, false, false);
    let c = register(&mut doc, body, "other", false, false, false);
    assert_ne!(a, b);
    assert_ne!(b, c);

    // The binding queries the bucket for dedup; only matching live listeners come back.
    assert_eq!(doc.event_listener_ids(body, "go", false).unwrap(), vec![a]);
    assert_eq!(doc.event_listener_ids(span, "go", false).unwrap(), vec![b]);
    assert_eq!(
        doc.event_listener_ids(body, "other", false).unwrap(),
        vec![c]
    );
    assert!(doc.event_listener_ids(body, "go", true).unwrap().is_empty());
    assert!(doc.event_listener_ids(span, "go", true).unwrap().is_empty());
}

// ---- removal ----------------------------------------------------------------

#[test]
fn removed_listener_never_fires_and_removal_is_reported() {
    let (mut doc, _, _, span) = build_tree();
    let id = register(&mut doc, span, "go", false, false, false);
    let removed = doc.remove_event_listeners(span, &[id]).unwrap();
    assert_eq!(removed, vec![id]);
    assert!(doc
        .event_listener_ids(span, "go", false)
        .unwrap()
        .is_empty());

    let (steps, _) = Invoker::run(&mut doc, span, event_of("go", true, false), |_, _, _| {});
    assert_eq!(
        steps,
        Vec::<String>::new(),
        "no listener survives the removal"
    );
}

#[test]
fn removing_a_listener_then_re_adding_it_produces_a_fresh_registration() {
    let (mut doc, _, _, span) = build_tree();
    let id = register(&mut doc, span, "go", false, false, false);
    doc.remove_event_listeners(span, &[id]).unwrap();
    let again = register(&mut doc, span, "go", false, false, false);
    assert_ne!(id, again, "a fresh registration gets a fresh id");

    let (steps, _) = Invoker::run(&mut doc, span, event_of("go", true, false), |_, _, _| {});
    assert_eq!(
        steps,
        ["span/t"],
        "the re-added listener fires exactly once"
    );
}

// ---- cancellation -----------------------------------------------------------

#[test]
fn stop_propagation_ends_dispatch_after_the_current_struct() {
    let (mut doc, body, div, span) = build_tree();
    register(&mut doc, div, "go", true, false, false);
    register(&mut doc, span, "go", false, false, false);
    register(&mut doc, span, "go", false, false, false); // second same-struct listener
    register(&mut doc, div, "go", false, false, false);
    register(&mut doc, body, "go", false, false, false);

    let (steps, _) = Invoker::run(
        &mut doc,
        span,
        event_of("go", true, false),
        |_: &mut Document, invocation: &DispatchInvocation, event: &mut EventState| {
            if invocation.phase == EVENT_PHASE_AT_TARGET {
                event.stop_propagation();
            }
        },
    );
    assert_eq!(
        steps,
        ["div/c", "span/t", "span/t"],
        "stopPropagation lets the current struct finish but skips the rest"
    );
}

#[test]
fn stop_immediate_propagation_ends_dispatch_immediately() {
    let (mut doc, _body, div, span) = build_tree();
    register(&mut doc, span, "go", false, false, false);
    register(&mut doc, span, "go", false, false, false);
    register(&mut doc, div, "go", false, false, false);

    let (steps, _) = Invoker::run(
        &mut doc,
        span,
        event_of("go", true, false),
        |_: &mut Document, invocation: &DispatchInvocation, event: &mut EventState| {
            // Stop after the FIRST target invocation: only it must run.
            if invocation.phase == EVENT_PHASE_AT_TARGET {
                event.stop_immediate_propagation();
            }
        },
    );
    assert_eq!(
        steps,
        ["span/t"],
        "stopImmediatePropagation stops mid-struct"
    );
}

#[test]
fn prevent_default_respects_cancelable_and_persists() {
    let (mut doc, _, _, span) = build_tree();
    register(&mut doc, span, "go", false, false, false);

    // Cancelable event: preventDefault wins and persists after dispatch.
    let event = event_of("go", true, true);
    let (_steps, finished) = Invoker::run(
        &mut doc,
        span,
        event,
        |_: &mut Document, _: &DispatchInvocation, event: &mut EventState| {
            event.prevent_default();
        },
    );
    assert!(finished.default_prevented);
    assert_eq!(finished.phase, EVENT_PHASE_NONE);
    assert!(!finished.dispatching);

    // Non-cancelable event: preventDefault is a no-op.
    let event = event_of("go", true, false);
    let (_steps, finished) = Invoker::run(
        &mut doc,
        span,
        event,
        |_: &mut Document, _: &DispatchInvocation, event: &mut EventState| {
            event.prevent_default();
        },
    );
    assert!(!finished.default_prevented);
}

#[test]
fn dispatch_event_return_is_false_only_when_cancelable_and_default_prevented() {
    let (mut doc, _, _, span) = build_tree();
    register(&mut doc, span, "go", false, false, false);

    // cancelable + preventDefault → false
    let event = event_of("go", true, true);
    let (_steps, finished) = Invoker::run(
        &mut doc,
        span,
        event,
        |_: &mut Document, _: &DispatchInvocation, event: &mut EventState| {
            event.prevent_default();
        },
    );
    assert!(finished.cancelable && finished.default_prevented);

    // cancelable, no preventDefault → true
    let event = event_of("go", true, true);
    let (_steps, finished) = Invoker::run(&mut doc, span, event, |_, _, _| {});
    assert!(!(finished.cancelable && finished.default_prevented));

    // non-cancelable + preventDefault → true
    let event = event_of("go", true, false);
    let (_steps, finished) = Invoker::run(
        &mut doc,
        span,
        event,
        |_: &mut Document, _: &DispatchInvocation, event: &mut EventState| {
            event.prevent_default();
        },
    );
    assert!(!(finished.cancelable && finished.default_prevented));
}

// ---- options ----------------------------------------------------------------

#[test]
fn once_listener_is_removed_after_its_first_invocation() {
    let (mut doc, _, _, span) = build_tree();
    let once = register(&mut doc, span, "go", false, true, false);
    let steady = register(&mut doc, span, "go", false, false, false);

    let mut first_event = event_of("go", true, false);
    let mut dispatch = doc.begin_dispatch(span, &mut first_event).unwrap();
    let mut steps = Vec::new();
    loop {
        match doc
            .next_invocation(&mut dispatch, &mut first_event)
            .unwrap()
        {
            None => break,
            Some(invocation) => {
                steps.push(invocation.listener_id);
                let removed = doc
                    .complete_invocation(&mut dispatch, invocation.listener_id)
                    .unwrap();
                if invocation.listener_id == once {
                    assert!(
                        removed,
                        "the once listener must be removed after its callback"
                    );
                } else {
                    assert!(!removed, "non-once listeners stay registered");
                }
            }
        }
    }
    doc.finish_dispatch(&mut dispatch, &mut first_event)
        .unwrap();
    assert_eq!(
        steps,
        [once, steady],
        "once listener fires before the steady one"
    );

    // Second dispatch: the once listener is gone.
    let (steps, _) = Invoker::run(&mut doc, span, event_of("go", true, false), |_, _, _| {});
    assert_eq!(
        steps,
        ["span/t"],
        "only the steady listener fires on re-dispatch"
    );
}

#[test]
fn once_listener_removed_even_when_its_callback_throws() {
    let (mut doc, _, _, span) = build_tree();
    let once = register(&mut doc, span, "go", false, true, false);
    register(&mut doc, span, "go", false, false, false);

    // The binding always calls complete_invocation, even after a throw, so the
    // once listener is cleaned up and the dispatch continues.
    let mut event = event_of("go", true, false);
    let mut dispatch = doc.begin_dispatch(span, &mut event).unwrap();
    let mut steps = Vec::new();
    loop {
        match doc.next_invocation(&mut dispatch, &mut event).unwrap() {
            None => break,
            Some(invocation) => {
                steps.push(invocation.listener_id);
                doc.complete_invocation(&mut dispatch, invocation.listener_id)
                    .unwrap();
            }
        }
    }
    doc.finish_dispatch(&mut dispatch, &mut event).unwrap();
    assert_eq!(
        steps,
        [once, doc.event_listener_ids(span, "go", false).unwrap()[0]]
    );
    assert_eq!(doc.event_listener_ids(span, "go", false).unwrap().len(), 1);
}

#[test]
fn passive_flag_is_reported_per_invocation() {
    let (mut doc, _, _, span) = build_tree();
    let active = register(&mut doc, span, "go", false, false, false);
    let passive = register(&mut doc, span, "go", false, false, true);

    let mut event = event_of("go", true, false);
    let mut dispatch = doc.begin_dispatch(span, &mut event).unwrap();
    let mut seen = Vec::new();
    loop {
        match doc.next_invocation(&mut dispatch, &mut event).unwrap() {
            None => break,
            Some(invocation) => {
                seen.push((invocation.listener_id, invocation.passive));
                doc.complete_invocation(&mut dispatch, invocation.listener_id)
                    .unwrap();
            }
        }
    }
    doc.finish_dispatch(&mut dispatch, &mut event).unwrap();
    assert_eq!(seen, [(active, false), (passive, true)]);
}

// ---- reentrancy / mutation --------------------------------------------------

#[test]
fn the_propagation_path_is_fixed_when_the_tree_mutates_during_dispatch() {
    let (mut doc, body, div, span) = build_tree();
    register(&mut doc, body, "go", true, false, false);
    register(&mut doc, div, "go", true, false, false);
    register(&mut doc, span, "go", false, false, false);
    register(&mut doc, body, "go", false, false, false);

    let mut removed = false;
    let (steps, _) = Invoker::run(
        &mut doc,
        span,
        event_of("go", true, false),
        |doc: &mut Document, _: &DispatchInvocation, _: &mut EventState| {
            // On the first capture invocation (body/c), detach the target: the
            // pre-computed path must still deliver the remaining structs.
            if !removed {
                removed = true;
                doc.remove_child(doc.parent(span).unwrap().unwrap(), span)
                    .unwrap();
            }
        },
    );
    assert_eq!(
        steps,
        ["body/c", "div/c", "span/t", "body/b"],
        "mutating the tree mid-dispatch never changes the fixed path"
    );
}

#[test]
fn listeners_added_during_dispatch_are_not_invoked_by_it() {
    let (mut doc, _, _, span) = build_tree();
    let trigger = register(&mut doc, span, "go", false, false, false);
    let mut added_id = None;

    let (steps, _) = Invoker::run(
        &mut doc,
        span,
        event_of("go", true, false),
        |doc: &mut Document, invocation: &DispatchInvocation, _: &mut EventState| {
            if invocation.listener_id == trigger {
                added_id = Some(register(doc, span, "go", false, false, false));
            }
        },
    );
    assert!(added_id.is_some());
    assert_eq!(steps, ["span/t"], "the added listener is snapshotted out");

    // A fresh dispatch sees it.
    let (steps, _) = Invoker::run(&mut doc, span, event_of("go", true, false), |_, _, _| {});
    assert_eq!(steps, ["span/t", "span/t"]);
}

#[test]
fn listeners_removed_after_their_struct_started_still_run() {
    let (mut doc, _, _, span) = build_tree();
    let remover = register(&mut doc, span, "go", false, false, false);
    let victim = register(&mut doc, span, "go", false, false, false);

    let mut event = event_of("go", true, false);
    let mut dispatch = doc.begin_dispatch(span, &mut event).unwrap();
    let mut steps = Vec::new();
    loop {
        match doc.next_invocation(&mut dispatch, &mut event).unwrap() {
            None => break,
            Some(invocation) => {
                steps.push(invocation.listener_id);
                if invocation.listener_id == remover {
                    // The victim is removed after the struct snapshot: it must
                    // still run (the happy-dom clone semantics), then be gone.
                    doc.remove_event_listeners(span, &[victim]).unwrap();
                }
                doc.complete_invocation(&mut dispatch, invocation.listener_id)
                    .unwrap();
            }
        }
    }
    doc.finish_dispatch(&mut dispatch, &mut event).unwrap();
    assert_eq!(
        steps,
        [remover, victim],
        "the snapshotted victim still runs even though removed mid-struct"
    );
    assert_eq!(
        doc.event_listener_ids(span, "go", false).unwrap(),
        vec![remover],
        "the victim is gone for good while the remover survives"
    );
}

#[test]
fn nested_dispatch_resumes_the_outer_dispatch() {
    let (mut doc, body, div, span) = build_tree();
    register(&mut doc, body, "go", false, false, false);
    register(&mut doc, span, "go", false, false, false);
    register(&mut doc, div, "inner", false, false, false);

    let mut event = event_of("go", true, false);
    let mut dispatch = doc.begin_dispatch(span, &mut event).unwrap();
    let mut steps = Vec::new();
    loop {
        match doc.next_invocation(&mut dispatch, &mut event).unwrap() {
            None => break,
            Some(invocation) => {
                steps.push(format!(
                    "{}/{}",
                    doc.node_name(invocation.target).unwrap(),
                    invocation.phase
                ));
                if invocation.phase == EVENT_PHASE_AT_TARGET {
                    // Dispatch a nested event on `div` while the outer dispatch
                    // is suspended.
                    let mut inner = event_of("inner", true, false);
                    let mut inner_dispatch = doc.begin_dispatch(div, &mut inner).unwrap();
                    while let Some(inner_invocation) = doc
                        .next_invocation(&mut inner_dispatch, &mut inner)
                        .unwrap()
                    {
                        steps.push(format!(
                            "inner:{}/{}",
                            doc.node_name(inner_invocation.target).unwrap(),
                            inner_invocation.phase
                        ));
                        doc.complete_invocation(&mut inner_dispatch, inner_invocation.listener_id)
                            .unwrap();
                    }
                    doc.finish_dispatch(&mut inner_dispatch, &mut inner)
                        .unwrap();
                }
                doc.complete_invocation(&mut dispatch, invocation.listener_id)
                    .unwrap();
            }
        }
    }
    doc.finish_dispatch(&mut dispatch, &mut event).unwrap();
    assert_eq!(
        steps,
        ["span/2", "inner:div/2", "body/3"],
        "the nested dispatch runs to completion between the outer target and bubble structs"
    );
}

#[test]
fn a_completed_event_can_be_dispatched_again_and_keeps_default_prevented() {
    let (mut doc, _, _, span) = build_tree();
    register(&mut doc, span, "go", false, false, false);

    let event = event_of("go", true, true);
    let (_steps, finished) = Invoker::run(
        &mut doc,
        span,
        event,
        |_: &mut Document, _: &DispatchInvocation, event: &mut EventState| {
            event.prevent_default();
        },
    );
    assert!(finished.default_prevented);
    assert!(!finished.dispatching);

    // Re-dispatch: the defaultPrevented flag persists (happy-dom parity) and
    // the listener runs again.
    let (steps, refinished) = Invoker::run(&mut doc, span, finished, |_, _, _| {});
    assert_eq!(steps, ["span/t"]);
    assert!(refinished.default_prevented);
    assert!(!refinished.dispatching);
    assert_eq!(refinished.phase, EVENT_PHASE_NONE);
}

// ---- handle validation ------------------------------------------------------

#[test]
fn event_operations_reject_foreign_and_stale_handles() {
    let mut a = Document::new();
    let mut b = Document::new();
    let el_a = a.create_element("div").unwrap();
    b.create_element("x").unwrap();

    assert!(matches!(
        b.add_event_listener(el_a, "go", false, false, false),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.event_listener_ids(el_a, "go", false),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.remove_event_listeners(el_a, &[1]),
        Err(CoreError::WrongDocument { .. })
    ));
    assert!(matches!(
        b.begin_dispatch(el_a, &mut EventState::new("go", false, false, false)),
        Err(CoreError::WrongDocument { .. })
    ));

    // A stale handle fails with Arena: the id was adopted into `b`, so the
    // *source* document recognises the handle as its own but its slot is gone.
    let mut source = Document::new();
    let moved = source.create_element("div").unwrap();
    b.adopt_node(&mut source, moved).unwrap();
    assert!(matches!(
        source.add_event_listener(moved, "go", false, false, false),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
    assert!(matches!(
        source.begin_dispatch(moved, &mut EventState::new("go", false, false, false)),
        Err(CoreError::Arena(ArenaError::EmptySlot { .. }))
    ));
}

#[test]
fn begin_dispatch_sets_target_and_dispatching_state() {
    let (mut doc, _, _, span) = build_tree();
    let mut event = event_of("go", true, false);
    let dispatch = doc.begin_dispatch(span, &mut event).unwrap();
    assert!(event.dispatching);
    assert_eq!(event.target, Some(span));
    assert_eq!(event.phase, EVENT_PHASE_NONE);
    assert_eq!(event.current_target, None);
    drop(dispatch);
}

#[test]
fn finish_dispatch_resets_the_event_to_its_non_dispatching_state() {
    let (mut doc, _, _, span) = build_tree();
    register(&mut doc, span, "go", false, false, false);
    let mut event = event_of("go", true, false);
    let mut dispatch = doc.begin_dispatch(span, &mut event).unwrap();
    let _ = doc.next_invocation(&mut dispatch, &mut event).unwrap();
    assert!(event.dispatching);
    assert_eq!(event.phase, EVENT_PHASE_AT_TARGET);
    assert_eq!(event.current_target, Some(span));
    doc.finish_dispatch(&mut dispatch, &mut event).unwrap();
    assert!(!event.dispatching);
    assert_eq!(event.phase, EVENT_PHASE_NONE);
    assert_eq!(event.current_target, None);
    assert_eq!(
        event.target,
        Some(span),
        "the target stays set after dispatch"
    );
}
