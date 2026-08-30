//! EventTarget listener registration and DOM-tree event propagation (T37).
//!
//! Implements the Core half of `addEventListener` / `removeEventListener` /
//! `dispatchEvent`: a per-target listener registry (stored on each
//! [`Node`](super::node::Node) through the crate-internal accessors), the
//! propagation path over the DOM tree and the capture / at-target / bubbling
//! phase machinery, plus the cancellation semantics (`stopPropagation`,
//! `stopImmediatePropagation`, `preventDefault` and the `dispatchEvent`
//! return value).
//!
//! This module deliberately owns **no JavaScript callback** and **no
//! event-state that outlives a dispatch step beyond the opaque [`Dispatch`]**
//! the binding carries between native calls. The binding maps each listener id
//! to its JS function; Core only stores the *registration metadata* — type,
//! capture/once/passive flags and a stable id — and decides the invocation
//! order. The mutable [`EventState`] (an event's flags, target, current target
//! and phase) lives on the binding's `EventHandle` and is handed back into the
//! dispatch methods as `&mut`, so a listener's `preventDefault()` /
//! `stopPropagation()` / `stopImmediatePropagation()` calls are observed by
//! the same Core engine that drives the loop.
//!
//! # Propagation model (happy-dom baseline, T37)
//!
//! The propagation path is the target's ancestor chain, fixed when dispatch
//! begins: mutations to the tree during dispatch never change the path. The
//! dispatch visits a sequence of *structs* — a (node, capture-bucket or
//! non-capture-bucket) pair, in the order:
//!
//! 1. **capture structs** — the ancestors from the document root down to the
//!    target (the target included), each invoking its `capture` listeners;
//! 2. **the at-target struct** — the target's non-capture listeners;
//! 3. **bubbling structs** — when the event `bubbles`, the ancestors from the
//!    target's parent up to the root, each invoking its non-capture listeners.
//!
//! Each struct snapshots the matching live listeners of its node *when the
//! struct starts*. A listener registered during dispatch is therefore never
//! invoked by that dispatch, while a listener removed during dispatch — even
//! after its own struct started — still runs if it was captured by that
//! struct's snapshot (the happy-dom clone semantics). `stopPropagation` ends
//! the dispatch after the current struct finishes; `stopImmediatePropagation`
//! ends it immediately. The `once` flag removes a listener after its callback
//! returns (so a once listener that re-dispatches the same type before its
//! own callback returns is still invoked again, matching the baseline).
//!
//! # Reentrancy
//!
//! Dispatch is driven one invocation at a time: the binding calls
//! [`Document::begin_dispatch`], then repeatedly [`Document::next_invocation`],
//! invoking each JS callback *outside* the document lock, then
//! [`Document::complete_invocation`] (once-cleanup) and finally
//! [`Document::finish_dispatch`]. Between steps the binding holds no Core state,
//! so a listener may freely add/remove listeners, mutate the tree or dispatch a
//! nested event; the nested dispatch uses its own [`Dispatch`], and the outer
//! one resumes from its snapshot and path. The event state is the single
//! mutable cell shared across a dispatch, guarded by the binding's own lock, so
//! no lock ordering problem exists: the binding never holds the document lock
//! while a JS callback runs.

use std::sync::atomic::{AtomicU64, Ordering};

use crate::arena::NodeId;
use crate::dom::Document;
use crate::error::CoreError;

/// `Event.eventPhase` while the event is not being dispatched.
pub const EVENT_PHASE_NONE: u16 = 0;
/// `Event.eventPhase` during the capture structs.
pub const EVENT_PHASE_CAPTURING: u16 = 1;
/// `Event.eventPhase` at the target struct.
pub const EVENT_PHASE_AT_TARGET: u16 = 2;
/// `Event.eventPhase` during the bubbling structs.
pub const EVENT_PHASE_BUBBLING: u16 = 3;

/// Global counter assigning each registered listener a document-unique id.
static NEXT_LISTENER_ID: AtomicU64 = AtomicU64::new(1);

/// One registered event listener on a target node.
///
/// Pure metadata: the JS callback itself lives on the binding side, keyed by
/// [`EventRegistration::id`]. A registration is physically removed from its
/// node when removed, so the list only ever holds live listeners; snapshots
/// taken at struct start keep the ids of the listeners that were live then.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventRegistration {
    /// Document-unique opaque id handed to the binding as the callback key.
    pub id: u64,
    /// The event type string the listener is registered for.
    pub event_type: String,
    /// Whether the listener runs in the capture structs (`capture: true`).
    pub capture: bool,
    /// Whether the listener is auto-removed after its first invocation.
    pub once: bool,
    /// Whether `preventDefault` is ignored while this listener runs.
    pub passive: bool,
}

/// The mutable state of one event object, owned by the binding's `EventHandle`
/// and passed `&mut` into the dispatch methods so listener-facing mutations
/// (`preventDefault` / `stopPropagation` / `stopImmediatePropagation`) are seen
/// by the engine between invocation steps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventState {
    /// The event's `type` (the string listeners registered for).
    pub event_type: String,
    /// Whether the event bubbles past the target (`bubbles` init flag).
    pub bubbles: bool,
    /// Whether `preventDefault` may set `default_prevented`.
    pub cancelable: bool,
    /// Whether the event crosses shadow boundaries (`composed` init flag).
    /// Shadow DOM is out of scope (T43); the flag is stored for parity only.
    pub composed: bool,
    /// Whether `preventDefault` was called while a non-passive cancelable
    /// listener was running.
    pub default_prevented: bool,
    /// Set by `stopPropagation`; ends the dispatch after the current struct.
    pub stop_propagation: bool,
    /// Set by `stopImmediatePropagation`; ends the dispatch immediately.
    pub stop_immediate_propagation: bool,
    /// Whether the event is currently being dispatched.
    pub dispatching: bool,
    /// Whether the listener currently running is `passive` (suppresses
    /// `preventDefault`). Set by the binding around each callback invocation.
    pub in_passive_listener: bool,
    /// The event's `target`: the node `dispatchEvent` was called on.
    pub target: Option<NodeId>,
    /// The node whose listeners are currently being invoked (`null` outside
    /// a dispatch).
    pub current_target: Option<NodeId>,
    /// The current phase ([`EVENT_PHASE_NONE`] outside a dispatch).
    pub phase: u16,
}

impl EventState {
    /// Creates a fresh, non-dispatching event state from the WebIDL init
    /// values.
    pub fn new(
        event_type: impl Into<String>,
        bubbles: bool,
        cancelable: bool,
        composed: bool,
    ) -> Self {
        Self {
            event_type: event_type.into(),
            bubbles,
            cancelable,
            composed,
            default_prevented: false,
            stop_propagation: false,
            stop_immediate_propagation: false,
            dispatching: false,
            in_passive_listener: false,
            target: None,
            current_target: None,
            phase: EVENT_PHASE_NONE,
        }
    }

    /// WHATWG `Event.preventDefault`: no-ops for a non-cancelable event or
    /// while a passive listener runs.
    pub fn prevent_default(&mut self) {
        if !self.in_passive_listener && self.cancelable {
            self.default_prevented = true;
        }
    }

    /// WHATWG `Event.stopPropagation`.
    pub fn stop_propagation(&mut self) {
        self.stop_propagation = true;
    }

    /// WHATWG `Event.stopImmediatePropagation`.
    pub fn stop_immediate_propagation(&mut self) {
        self.stop_immediate_propagation = true;
    }

    /// WHATWG `Event.initEvent` (T38): re-initializes the event's `type`,
    /// `bubbles` and `cancelable` and resets the per-dispatch cancellation
    /// flags (`defaultPrevented`, `stopPropagation`, `stopImmediatePropagation`).
    ///
    /// Unlike the WHATWG rule ("do nothing while dispatching"), the baseline
    /// applies the mutation unconditionally — matching happy-dom, which does not
    /// guard `initEvent` on the dispatching flag. `timeStamp` is never reset.
    pub fn init_event(&mut self, event_type: impl Into<String>, bubbles: bool, cancelable: bool) {
        self.event_type = event_type.into();
        self.bubbles = bubbles;
        self.cancelable = cancelable;
        self.default_prevented = false;
        self.stop_propagation = false;
        self.stop_immediate_propagation = false;
    }

    /// `CustomEvent.initCustomEvent` (T38): re-initializes the event's `type`,
    /// `bubbles` and `cancelable` *without* touching the cancellation flags —
    /// the baseline's `initCustomEvent` leaves `defaultPrevented` /
    /// `stopPropagation` / `stopImmediatePropagation` as they are.
    pub fn set_init_values(
        &mut self,
        event_type: impl Into<String>,
        bubbles: bool,
        cancelable: bool,
    ) {
        self.event_type = event_type.into();
        self.bubbles = bubbles;
        self.cancelable = cancelable;
    }
}

/// One listener captured by the snapshot of a struct.
#[derive(Debug, Clone)]
struct SnapshotListener {
    listener_id: u64,
    node: NodeId,
    once: bool,
    passive: bool,
}

/// The next listener the binding must invoke.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchInvocation {
    /// Listener id the binding maps to the JS callback.
    pub listener_id: u64,
    /// The node whose listeners are being invoked (the event's `currentTarget`).
    pub target: NodeId,
    /// The current phase ([`EVENT_PHASE_CAPTURING`] / [`EVENT_PHASE_AT_TARGET`]
    /// / [`EVENT_PHASE_BUBBLING`]).
    pub phase: u16,
    /// Whether this listener was registered `passive` (the binding must set
    /// `EventState::in_passive_listener` around the invocation).
    pub passive: bool,
}

/// The propagation plan for one dispatch.
///
/// Created by [`Document::begin_dispatch`] and mutated by
/// [`Document::next_invocation`] / [`Document::complete_invocation`] /
/// [`Document::finish_dispatch`]; the binding only *carries* the value between
/// native calls (the JS callback is invoked with the document lock released).
/// All fields are private: every dispatch rule lives here.
#[derive(Debug)]
pub struct Dispatch {
    /// The propagation path: the target followed by its ancestors up to the
    /// document root, fixed when dispatch began.
    path: Vec<NodeId>,
    /// The phase of the struct currently being visited.
    phase: u16,
    /// Index into `path` for the current struct (the target for the
    /// at-target struct).
    struct_index: usize,
    /// The node of the current struct.
    current_node: NodeId,
    /// The listener snapshot of the current struct.
    snapshot: Vec<SnapshotListener>,
    /// Position inside `snapshot`.
    snapshot_index: usize,
    /// The listener served by the last [`Document::next_invocation`], for
    /// once-cleanup in [`Document::complete_invocation`].
    pending: Option<SnapshotListener>,
}

impl Document {
    /// Registers a listener on `target` and returns its stable id.
    ///
    /// The caller (binding) has already decided this registration is not a
    /// duplicate — the Core side keeps no JavaScript identity, so deduplication
    /// lives with the callback comparison. `target` is validated for document
    /// ownership and arena liveness like every other handle.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `target`.
    pub fn add_event_listener(
        &mut self,
        target: NodeId,
        event_type: &str,
        capture: bool,
        once: bool,
        passive: bool,
    ) -> Result<u64, CoreError> {
        let id = NEXT_LISTENER_ID.fetch_add(1, Ordering::Relaxed);
        self.node_mut(target)?
            .event_listeners_mut()
            .push(EventRegistration {
                id,
                event_type: event_type.to_string(),
                capture,
                once,
                passive,
            });
        Ok(id)
    }

    /// Returns the ids of the live listeners on `target` registered for
    /// `event_type` in the given bucket.
    ///
    /// Used by the binding for callback deduplication and for matching the
    /// listener to remove.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `target`.
    pub fn event_listener_ids(
        &self,
        target: NodeId,
        event_type: &str,
        capture: bool,
    ) -> Result<Vec<u64>, CoreError> {
        Ok(self
            .get(target)?
            .event_listeners()
            .iter()
            .filter(|registration| {
                registration.event_type == event_type && registration.capture == capture
            })
            .map(|registration| registration.id)
            .collect())
    }

    /// Removes the registrations with the given ids from `target`, returning
    /// the ids that were actually present.
    ///
    /// The binding compares callbacks first and passes the matching ids; this
    /// method physically removes them so a later snapshot never sees them.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `target`.
    pub fn remove_event_listeners(
        &mut self,
        target: NodeId,
        ids: &[u64],
    ) -> Result<Vec<u64>, CoreError> {
        let removed = ids.to_vec();
        let listeners = self.node_mut(target)?.event_listeners_mut();
        listeners.retain(|registration| !ids.contains(&registration.id));
        Ok(removed)
    }

    /// Returns the fixed propagation path of `target`: the target followed by
    /// its ancestor chain up to the document root (T37/T38).
    ///
    /// This is the path [`Document::begin_dispatch`] walks and the WHATWG
    /// `Event.composedPath()` reports (minus the shadow-host and window hops,
    /// which land with T43/T45). It is computed at dispatch start and never
    /// re-derived, so mid-dispatch tree mutation cannot change it.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `target`.
    pub fn propagation_path(&self, target: NodeId) -> Result<Vec<NodeId>, CoreError> {
        let mut path = vec![target];
        let mut cursor = target;
        while let Some(parent) = self.get(cursor)?.parent() {
            path.push(parent);
            cursor = parent;
        }
        Ok(path)
    }

    /// Starts a dispatch of `event` on `target`.
    ///
    /// Computes the propagation path (the target and its ancestors up to the
    /// document root), fixes the event's target and dispatcing flag and resets
    /// the per-dispatch cancellation flags so an already-dispatched event can
    /// be dispatched again (the baseline permits re-dispatch of a completed
    /// event).
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `target`.
    pub fn begin_dispatch(
        &mut self,
        target: NodeId,
        event: &mut EventState,
    ) -> Result<Dispatch, CoreError> {
        self.get(target)?;
        event.dispatching = true;
        event.phase = EVENT_PHASE_NONE;
        event.target = Some(target);
        event.current_target = None;
        // A re-dispatch of a completed event starts with clean cancellation
        // flags (the baseline keeps `default_prevented`, so it is preserved).
        event.stop_propagation = false;
        event.stop_immediate_propagation = false;
        event.in_passive_listener = false;

        let path = self.propagation_path(target)?;
        let struct_index = path.len().saturating_sub(1);
        let mut dispatch = Dispatch {
            struct_index,
            current_node: path[struct_index],
            path,
            phase: EVENT_PHASE_CAPTURING,
            snapshot: Vec::new(),
            snapshot_index: 0,
            pending: None,
        };
        self.refresh_snapshot(&mut dispatch, event)?;
        Ok(dispatch)
    }

    /// Returns the next listener to invoke, or `None` when the dispatch is
    /// complete.
    ///
    /// Advances through the struct sequence, taking each struct's listener
    /// snapshot lazily (so listeners added earlier in the dispatch never leak
    /// into a later struct) and honoring `stopPropagation` /
    /// `stopImmediatePropagation`. The returned invocation updates `event`'s
    /// phase and current target.
    ///
    /// # Errors
    ///
    /// [`CoreError::Arena`] when a node on the path was invalidated mid-dispatch
    /// (the public API never produces this, but the walk propagates it rather
    /// than panicking).
    pub fn next_invocation(
        &mut self,
        dispatch: &mut Dispatch,
        event: &mut EventState,
    ) -> Result<Option<DispatchInvocation>, CoreError> {
        loop {
            if event.stop_immediate_propagation {
                return Ok(None);
            }
            if dispatch.snapshot_index < dispatch.snapshot.len() {
                let listener = dispatch.snapshot[dispatch.snapshot_index].clone();
                dispatch.snapshot_index += 1;
                dispatch.pending = Some(listener.clone());
                event.phase = dispatch.phase;
                event.current_target = Some(dispatch.current_node);
                return Ok(Some(DispatchInvocation {
                    listener_id: listener.listener_id,
                    target: dispatch.current_node,
                    phase: dispatch.phase,
                    passive: listener.passive,
                }));
            }
            if !self.advance_struct(dispatch, event)? {
                return Ok(None);
            }
        }
    }

    /// Marks the last served invocation as handled: for a `once` listener,
    /// physically removes it from its node and reports that the binding should
    /// drop the callback reference. Safe to call after the callback returned
    /// or threw.
    ///
    /// Returns `false` (no-op) for non-once listeners, for a listener already
    /// removed (e.g. the callback removed itself) or when the listener's node
    /// was invalidated mid-dispatch.
    pub fn complete_invocation(
        &mut self,
        dispatch: &mut Dispatch,
        listener_id: u64,
    ) -> Result<bool, CoreError> {
        let Some(pending) = dispatch.pending.take() else {
            return Ok(false);
        };
        if pending.listener_id != listener_id || !pending.once {
            return Ok(false);
        }
        let removed = match self.node_mut(pending.node) {
            Ok(node) => {
                let listeners = node.event_listeners_mut();
                match listeners
                    .iter()
                    .position(|registration| registration.id == listener_id)
                {
                    Some(index) => {
                        listeners.remove(index);
                        true
                    }
                    None => false,
                }
            }
            Err(_) => false,
        };
        Ok(removed)
    }

    /// Ends a dispatch: reports that the binding should drop any remaining
    /// deferred callback references. The event's phase and current target are
    /// reset to their non-dispatching values; `dispatching` is cleared so the
    /// event can be re-dispatched.
    pub fn finish_dispatch(
        &mut self,
        dispatch: &mut Dispatch,
        event: &mut EventState,
    ) -> Result<(), CoreError> {
        let _ = dispatch;
        event.dispatching = false;
        event.phase = EVENT_PHASE_NONE;
        event.current_target = None;
        event.in_passive_listener = false;
        Ok(())
    }

    /// Moves the state machine to the next struct, snapshotting that struct's
    /// listeners. Returns `false` when the struct sequence is exhausted.
    fn advance_struct(
        &mut self,
        dispatch: &mut Dispatch,
        event: &mut EventState,
    ) -> Result<bool, CoreError> {
        if event.stop_propagation {
            return Ok(false);
        }
        match dispatch.phase {
            EVENT_PHASE_CAPTURING => {
                if dispatch.struct_index == 0 {
                    dispatch.phase = EVENT_PHASE_AT_TARGET;
                    dispatch.current_node = dispatch.path[0];
                } else {
                    dispatch.struct_index -= 1;
                    dispatch.current_node = dispatch.path[dispatch.struct_index];
                }
            }
            EVENT_PHASE_AT_TARGET => {
                if !event.bubbles || dispatch.path.len() < 2 {
                    return Ok(false);
                }
                dispatch.phase = EVENT_PHASE_BUBBLING;
                dispatch.struct_index = 1;
                dispatch.current_node = dispatch.path[dispatch.struct_index];
            }
            EVENT_PHASE_BUBBLING => {
                dispatch.struct_index += 1;
                if dispatch.struct_index >= dispatch.path.len() {
                    return Ok(false);
                }
                dispatch.current_node = dispatch.path[dispatch.struct_index];
            }
            _ => return Ok(false),
        }
        self.refresh_snapshot(dispatch, event)?;
        if dispatch.snapshot.is_empty() {
            return self.advance_struct(dispatch, event);
        }
        Ok(true)
    }

    /// Captures the live listeners of the current struct's node into the
    /// dispatch snapshot.
    fn refresh_snapshot(
        &self,
        dispatch: &mut Dispatch,
        event: &EventState,
    ) -> Result<(), CoreError> {
        let capture = dispatch.phase == EVENT_PHASE_CAPTURING;
        let listeners = self.get(dispatch.current_node)?.event_listeners();
        dispatch.snapshot = listeners
            .iter()
            .filter(|registration| {
                registration.event_type == event.event_type && registration.capture == capture
            })
            .map(|registration| SnapshotListener {
                listener_id: registration.id,
                node: dispatch.current_node,
                once: registration.once,
                passive: registration.passive,
            })
            .collect();
        dispatch.snapshot_index = 0;
        Ok(())
    }
}
