//! Tree traversal state machines for `TreeWalker` / `NodeIterator` (T35).
//!
//! Implements the Core half of the WHATWG traversal surface: `nextNode`,
//! `previousNode`, `parentNode`, `firstChild`, `lastChild`, `nextSibling` and
//! `previousSibling`, driven by the WHATWG algorithms with the happy-dom
//! baseline behaviour. Every algorithm is a *filtered walk*: it navigates the
//! arena's parent / sibling / child relations and consults a per-node
//! `filter(node)` decision that combines the `whatToShow` mask with an
//! optional user filter.
//!
//! # Why a state machine (and no JavaScript callback in Core)
//!
//! The user filter is a JavaScript callback (a function or an object with
//! `acceptNode`), and the WHATWG algorithms consult it *between* tree
//! navigation steps. Core deliberately owns **no JavaScript callback**, exactly
//! like the T37 event engine: the binding maps each candidate node to its JS
//! wrapper, invokes the filter outside the document lock, and feeds the result
//! back. To make that possible every traversal method is a *coroutine* split
//! at each filter decision:
//!
//! * [`Document::traversal_start`] builds the [`TraversalPass`] for one method
//!   call and returns the first [`TraversalStep`];
//! * the binding runs a loop: for a [`TraversalStep::Filter`] it invokes the JS
//!   filter on that node and calls [`Document::traversal_filter`] with the
//!   result; for a [`TraversalStep::Done`] it mints the returned node (or
//!   `None`) and finishes.
//!
//! Because the pass is suspended between native calls and holds only
//! [`NodeId`]s (never a snapshot of the tree), a filter that mutates the tree
//! is observed by the very next navigation step — matching the baseline, which
//! reads the live relations of the current node on every step.
//!
//! # Filter decisions
//!
//! The WHATWG `filter(node)` for one candidate is: when the node's type is not
//! included in `whatToShow`, return [`FILTER_SKIP`]; otherwise, when there is
//! no user filter, return [`FILTER_ACCEPT`]; otherwise ask the user filter.
//! Core resolves the first two cases inline and only yields a
//! [`TraversalStep::Filter`] when a real JS decision is needed. A filter result
//! that is not one of the three constants is treated exactly like the
//! baseline: it is "not `FILTER_ACCEPT`" and "not `FILTER_REJECT`", so the
//! walkers descend into `FILTER_SKIP`-like branches (see each machine below).
//!
//! # Tree mutation safety
//!
//! Node removal detaches but never frees (the unified mutation API keeps the
//! removed node's [`NodeId`] live in the arena), so the cursor id a suspended
//! pass holds is always re-validated by [`Document::get`] on the next step —
//! a traversal never touches a dangling id, and every step reports a
//! structured [`CoreError`] for a foreign or stale handle instead of reading
//! freed memory.
//!
//! # Baseline parity notes
//!
//! The machines follow happy-dom's `TreeWalker` implementation exactly, which
//! differs from the raw WHATWG text in a few observable places and is the
//! compatibility baseline (ADR-0002):
//!
//! * `parentNode` filters the root as an ancestor candidate (a child of the
//!   root climbs to the root and may return it);
//! * `nextSibling` / `previousSibling` return `null` when an ancestor climbed
//!   to during the search filters to `FILTER_ACCEPT`, and otherwise continue
//!   the climb one level at a time;
//! * `previousNode` filters the root after climbing to it (a child of the root
//!   may yield the root);
//! * a node whose type is masked out of `whatToShow` filters to `FILTER_SKIP`.

use crate::arena::NodeId;
use crate::dom::Document;
use crate::dom::NodeType;
use crate::error::CoreError;

/// `NodeFilter.FILTER_ACCEPT`.
pub const FILTER_ACCEPT: u32 = 1;
/// `NodeFilter.FILTER_REJECT`.
pub const FILTER_REJECT: u32 = 2;
/// `NodeFilter.FILTER_SKIP`.
pub const FILTER_SKIP: u32 = 3;

/// `NodeFilter.SHOW_ALL` (the WHATWG `unsigned long` `0xFFFFFFFF`).
pub const SHOW_ALL: u32 = 0xFFFF_FFFF;
/// `NodeFilter.SHOW_ELEMENT`.
pub const SHOW_ELEMENT: u32 = 0x1;
/// `NodeFilter.SHOW_ATTRIBUTE`.
pub const SHOW_ATTRIBUTE: u32 = 0x2;
/// `NodeFilter.SHOW_TEXT`.
pub const SHOW_TEXT: u32 = 0x4;
/// `NodeFilter.SHOW_CDATA_SECTION`.
pub const SHOW_CDATA_SECTION: u32 = 0x8;
/// `NodeFilter.SHOW_ENTITY_REFERENCE`.
pub const SHOW_ENTITY_REFERENCE: u32 = 0x10;
/// `NodeFilter.SHOW_ENTITY`.
pub const SHOW_ENTITY: u32 = 0x20;
/// `NodeFilter.SHOW_PROCESSING_INSTRUCTION`.
pub const SHOW_PROCESSING_INSTRUCTION: u32 = 0x40;
/// `NodeFilter.SHOW_COMMENT`.
pub const SHOW_COMMENT: u32 = 0x80;
/// `NodeFilter.SHOW_DOCUMENT`.
pub const SHOW_DOCUMENT: u32 = 0x100;
/// `NodeFilter.SHOW_DOCUMENT_TYPE`.
pub const SHOW_DOCUMENT_TYPE: u32 = 0x200;
/// `NodeFilter.SHOW_DOCUMENT_FRAGMENT`.
pub const SHOW_DOCUMENT_FRAGMENT: u32 = 0x400;
/// `NodeFilter.SHOW_NOTATION`.
pub const SHOW_NOTATION: u32 = 0x800;

/// The `whatToShow` mask flag for one node type, mirroring
/// `NodeFilterMask` in the baseline.
fn node_type_mask(node_type: NodeType) -> u32 {
    match node_type {
        NodeType::Element => SHOW_ELEMENT,
        NodeType::Text => SHOW_TEXT,
        NodeType::Comment => SHOW_COMMENT,
        NodeType::Document => SHOW_DOCUMENT,
        NodeType::DocumentType => SHOW_DOCUMENT_TYPE,
        NodeType::DocumentFragment | NodeType::ShadowRoot => SHOW_DOCUMENT_FRAGMENT,
        NodeType::ProcessingInstruction => SHOW_PROCESSING_INSTRUCTION,
    }
}

/// The traversal method a pass performs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraversalOp {
    /// `TreeWalker.nextNode` / `NodeIterator.nextNode` (after the root check).
    NextNode,
    /// `TreeWalker.previousNode` / `NodeIterator.previousNode`.
    PreviousNode,
    /// `TreeWalker.parentNode`.
    ParentNode,
    /// `TreeWalker.firstChild`.
    FirstChild,
    /// `TreeWalker.lastChild`.
    LastChild,
    /// `TreeWalker.nextSibling`.
    NextSibling,
    /// `TreeWalker.previousSibling`.
    PreviousSibling,
}

/// The next thing the binding must do to drive a traversal to completion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TraversalStep {
    /// The binding must invoke the user filter on the wrapped `node` and feed
    /// the raw result back through [`Document::traversal_filter`].
    Filter(NodeId),
    /// The traversal is complete. `Some(node)` is the returned node and must
    /// become the walker's current node; `None` means no node was found and
    /// the walker's current node stays unchanged.
    Done(Option<NodeId>),
}

/// The suspended state of one traversal method call, owned by the binding
/// between native calls.
///
/// All fields are private: the algorithms and their per-op phases live here,
/// and the binding only *carries* the value between
/// [`Document::traversal_start`] and [`Document::traversal_filter`] calls.
#[derive(Debug)]
pub struct TraversalPass {
    /// The machine-independent shared state (root, current, mask, filter
    /// bookkeeping) of the pass.
    shared: PassState,
    /// The per-operation state machine.
    machine: Machine,
}

/// The shared, machine-independent state of a traversal pass.
///
/// Split from [`Machine`] so the driver can borrow the two halves of a pass
/// independently (`let TraversalPass { shared, machine } = pass`), which keeps
/// every machine-step transition free of borrow conflicts.
#[derive(Debug)]
struct PassState {
    /// The walker's root — the boundary the traversal never crosses.
    root: NodeId,
    /// The walker's current node captured when the pass started; updated to
    /// the accepted node on completion, read by the `firstChild`/`lastChild`
    /// machines as their subtree boundary.
    current: NodeId,
    /// The `whatToShow` mask applied to every candidate.
    what_to_show: u32,
    /// Whether a user filter exists (when `false`, every candidate that
    /// passes the mask is accepted inline).
    has_filter: bool,
    /// The last filter decision (initialised to `FILTER_ACCEPT` for the
    /// `nextNode` descend condition).
    result: u32,
    /// Whether `result` holds the decision for the machine's cursor node and
    /// must be processed by the next machine step (set before every candidate
    /// visit, including the inline mask/no-filter resolutions).
    pending: bool,
}

/// The per-operation state machine of a traversal pass.
#[derive(Debug)]
enum Machine {
    /// No traversal: the pass is finished before its first step (e.g.
    /// `firstChild` on a leaf).
    Finished,
    /// `parentNode`.
    Parent(ParentMachine),
    /// `nextNode`.
    Next(NextMachine),
    /// `previousNode`.
    Previous(PreviousMachine),
    /// `firstChild` / `lastChild`.
    Children(ChildrenMachine),
    /// `nextSibling` / `previousSibling`.
    Siblings(SiblingsMachine),
}

#[derive(Debug)]
struct ParentMachine {
    /// The cursor node (starts at the walker's current).
    node: NodeId,
}

#[derive(Debug)]
struct NextMachine {
    /// The cursor node.
    node: NodeId,
    /// `Descend` while looking into children, `Backtrack` while climbing to
    /// find the next sibling.
    phase: NextPhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NextPhase {
    Descend,
    Backtrack,
}

#[derive(Debug)]
struct PreviousMachine {
    /// The cursor node.
    node: NodeId,
    /// `Sibling` while searching previous siblings (and their last-child
    /// chains), `Ancestor` while climbing to the parent.
    phase: PrevPhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PrevPhase {
    Sibling,
    Ancestor,
}

#[derive(Debug)]
struct ChildrenMachine {
    /// The cursor node.
    node: NodeId,
    /// `false` for `firstChild`, `true` for `lastChild`.
    last: bool,
    /// `Descend` while visiting candidates, `Sibling` while backtracking.
    phase: ChildPhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChildPhase {
    Descend,
    Sibling,
}

#[derive(Debug)]
struct SiblingsMachine {
    /// The cursor node.
    node: NodeId,
    /// `false` for `nextSibling`, `true` for `previousSibling`.
    prev: bool,
    /// `Search` while exploring siblings (and their subtrees), `Climb` while
    /// climbing to an ancestor.
    phase: SiblingPhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SiblingPhase {
    Search,
    Climb,
}

impl Document {
    /// Starts a traversal pass for `op` over the subtree rooted at `root`,
    /// starting from the walker's `current`, and returns the pass plus its
    /// first step.
    ///
    /// `what_to_show` is the `whatToShow` mask (the binding passes the coerced
    /// `unsigned long`) and `has_filter` tells Core whether a user filter
    /// exists, so it can resolve the mask-only / no-filter decisions inline
    /// without a JS round trip.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] when `root` or
    /// `current` is foreign or stale.
    pub fn traversal_start(
        &self,
        op: TraversalOp,
        root: NodeId,
        current: NodeId,
        what_to_show: u32,
        has_filter: bool,
    ) -> Result<(TraversalPass, TraversalStep), CoreError> {
        self.get(root)?;
        self.get(current)?;
        let machine = match op {
            TraversalOp::ParentNode => Machine::Parent(ParentMachine { node: current }),
            TraversalOp::NextNode => Machine::Next(NextMachine {
                node: current,
                phase: NextPhase::Descend,
            }),
            TraversalOp::PreviousNode => Machine::Previous(PreviousMachine {
                node: current,
                phase: PrevPhase::Sibling,
            }),
            TraversalOp::FirstChild | TraversalOp::LastChild => {
                let last = op == TraversalOp::LastChild;
                match if last {
                    self.get(current)?.last_child()
                } else {
                    self.get(current)?.first_child()
                } {
                    None => Machine::Finished,
                    Some(child) => Machine::Children(ChildrenMachine {
                        node: child,
                        last,
                        phase: ChildPhase::Descend,
                    }),
                }
            }
            TraversalOp::NextSibling | TraversalOp::PreviousSibling => {
                Machine::Siblings(SiblingsMachine {
                    node: current,
                    prev: op == TraversalOp::PreviousSibling,
                    phase: SiblingPhase::Search,
                })
            }
        };
        let mut pass = TraversalPass {
            shared: PassState {
                root,
                current,
                what_to_show,
                has_filter,
                result: FILTER_ACCEPT,
                pending: false,
            },
            machine,
        };
        let step = self.advance(&mut pass, None)?;
        Ok((pass, step))
    }
    /// Resumes a traversal pass after the binding invoked the user filter on
    /// the node of the last [`TraversalStep::Filter`], passing the raw result
    /// (an arbitrary `u32`, compared verbatim against the three constants).
    ///
    /// Returns the next [`TraversalStep`]; the binding loops until
    /// [`TraversalStep::Done`].
    ///
    /// # Errors
    ///
    /// As for [`Document::traversal_start`] when the tree was mutated such
    /// that the pass's cursor became foreign or stale between steps.
    pub fn traversal_filter(
        &self,
        pass: &mut TraversalPass,
        result: u32,
    ) -> Result<TraversalStep, CoreError> {
        self.advance(pass, Some(result))
    }

    /// Whether the `whatToShow` mask skips `id`'s node type (returns `true`
    /// exactly when the baseline's mask check would produce `FILTER_SKIP`).
    ///
    /// Used by the binding's `NodeIterator.nextNode` root check, which must
    /// decide the root's mask-only outcome without a JS round trip.
    ///
    /// # Errors
    ///
    /// [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    /// stale `id`.
    pub fn traversal_mask_skips(&self, id: NodeId, what_to_show: u32) -> Result<bool, CoreError> {
        let mask = node_type_mask(self.get(id)?.node_type());
        Ok(mask != 0 && (what_to_show & mask) == 0)
    }

    /// Drives the machine until it yields a [`TraversalStep`] the binding must
    /// act on. `external` is the raw user-filter result that resumes a
    /// suspended [`TraversalStep::Filter`].
    fn advance(
        &self,
        pass: &mut TraversalPass,
        external: Option<u32>,
    ) -> Result<TraversalStep, CoreError> {
        let TraversalPass { shared, machine } = pass;
        if let Some(result) = external {
            shared.result = result;
        }
        loop {
            if let Some(step) = self.machine_step(shared, machine)? {
                return Ok(step);
            }
        }
    }

    /// Runs one transition of the current machine. Returns `Some(step)` when
    /// the machine needs the binding (a filter invocation or the final
    /// answer), and `None` to continue with the next transition.
    fn machine_step(
        &self,
        shared: &mut PassState,
        machine: &mut Machine,
    ) -> Result<Option<TraversalStep>, CoreError> {
        match machine {
            Machine::Finished => Ok(Some(TraversalStep::Done(None))),
            Machine::Parent(m) => self.parent_step(shared, m),
            Machine::Next(m) => self.next_step(shared, m),
            Machine::Previous(m) => self.previous_step(shared, m),
            Machine::Children(m) => self.children_step(shared, m),
            Machine::Siblings(m) => self.siblings_step(shared, m),
        }
    }

    /// Resolves one candidate visit: applies the `whatToShow` mask and the
    /// no-filter shortcut inline, or yields a [`TraversalStep::Filter`] for
    /// the binding to consult the user filter.
    ///
    /// The caller has already moved the cursor (`machine.node`) to `id` and
    /// set `shared.pending`; the inline resolutions leave `shared.pending` set
    /// so the next machine step processes `shared.result` exactly like a
    /// resumed JS decision.
    fn visit_filter(
        &self,
        shared: &mut PassState,
        id: NodeId,
    ) -> Result<Option<TraversalStep>, CoreError> {
        if self.traversal_mask_skips(id, shared.what_to_show)? {
            shared.result = FILTER_SKIP;
            return Ok(None);
        }
        if !shared.has_filter {
            shared.result = FILTER_ACCEPT;
            return Ok(None);
        }
        Ok(Some(TraversalStep::Filter(id)))
    }

    /// `parentNode`: climb from the walker's current, filtering each ancestor,
    /// until the first accepted one or the root boundary.
    fn parent_step(
        &self,
        shared: &mut PassState,
        machine: &mut ParentMachine,
    ) -> Result<Option<TraversalStep>, CoreError> {
        if shared.pending {
            shared.pending = false;
            if shared.result == FILTER_ACCEPT {
                shared.current = machine.node;
                return Ok(Some(TraversalStep::Done(Some(machine.node))));
            }
            // The walker's root itself was filtered and rejected: the climb
            // loop (`while node is not null and is not root`) ends there.
            if machine.node == shared.root {
                return Ok(Some(TraversalStep::Done(None)));
            }
        } else if machine.node == shared.root {
            return Ok(Some(TraversalStep::Done(None)));
        }
        let Some(parent) = self.parent(machine.node)? else {
            return Ok(Some(TraversalStep::Done(None)));
        };
        machine.node = parent;
        shared.pending = true;
        self.visit_filter(shared, parent)
    }

    /// `nextNode`: pre-order traversal from the walker's current. The descend
    /// condition is `result != FILTER_REJECT`, so a `FILTER_SKIP` (or an
    /// unrecognised result) still descends into the node's subtree while
    /// `FILTER_REJECT` prunes it.
    fn next_step(
        &self,
        shared: &mut PassState,
        machine: &mut NextMachine,
    ) -> Result<Option<TraversalStep>, CoreError> {
        if shared.pending {
            shared.pending = false;
            if shared.result == FILTER_ACCEPT {
                shared.current = machine.node;
                return Ok(Some(TraversalStep::Done(Some(machine.node))));
            }
            machine.phase = NextPhase::Descend;
        }
        match machine.phase {
            NextPhase::Descend => {
                if shared.result != FILTER_REJECT {
                    if let Some(first) = self.first_child(machine.node)? {
                        machine.node = first;
                        shared.pending = true;
                        return self.visit_filter(shared, first);
                    }
                }
                machine.phase = NextPhase::Backtrack;
            }
            NextPhase::Backtrack => loop {
                if machine.node == shared.root {
                    return Ok(Some(TraversalStep::Done(None)));
                }
                if let Some(sibling) = self.next_sibling(machine.node)? {
                    machine.node = sibling;
                    machine.phase = NextPhase::Descend;
                    shared.pending = true;
                    return self.visit_filter(shared, sibling);
                }
                let Some(parent) = self.parent(machine.node)? else {
                    return Ok(Some(TraversalStep::Done(None)));
                };
                machine.node = parent;
            },
        }
        Ok(None)
    }

    /// `previousNode`: the reverse pre-order walk — search the previous
    /// sibling and its last-child chain first, then climb to the parent.
    fn previous_step(
        &self,
        shared: &mut PassState,
        machine: &mut PreviousMachine,
    ) -> Result<Option<TraversalStep>, CoreError> {
        if shared.pending {
            shared.pending = false;
            match machine.phase {
                PrevPhase::Sibling => {
                    // Descend into the candidate's last-child chain while the
                    // result is not FILTER_REJECT (the baseline
                    // `while result is not REJECT and node has a child`).
                    if shared.result != FILTER_REJECT {
                        if let Some(last) = self.last_child(machine.node)? {
                            machine.node = last;
                            shared.pending = true;
                            return self.visit_filter(shared, last);
                        }
                    }
                    if shared.result == FILTER_ACCEPT {
                        shared.current = machine.node;
                        return Ok(Some(TraversalStep::Done(Some(machine.node))));
                    }
                    // Not accepted: the outer sibling loop looks at the
                    // previous sibling of the candidate.
                    if let Some(sibling) = self.previous_sibling(machine.node)? {
                        machine.node = sibling;
                        shared.pending = true;
                        return self.visit_filter(shared, sibling);
                    }
                    machine.phase = PrevPhase::Ancestor;
                    return Ok(None);
                }
                PrevPhase::Ancestor => {
                    if shared.result == FILTER_ACCEPT {
                        shared.current = machine.node;
                        return Ok(Some(TraversalStep::Done(Some(machine.node))));
                    }
                    // Loop back to the sibling search on the ancestor.
                    machine.phase = PrevPhase::Sibling;
                    return Ok(None);
                }
            }
        }
        match machine.phase {
            PrevPhase::Sibling => {
                if machine.node == shared.root {
                    return Ok(Some(TraversalStep::Done(None)));
                }
                if let Some(sibling) = self.previous_sibling(machine.node)? {
                    machine.node = sibling;
                    shared.pending = true;
                    return self.visit_filter(shared, sibling);
                }
                machine.phase = PrevPhase::Ancestor;
                Ok(None)
            }
            PrevPhase::Ancestor => {
                if machine.node == shared.root || self.parent(machine.node)?.is_none() {
                    return Ok(Some(TraversalStep::Done(None)));
                }
                let parent = self
                    .parent(machine.node)?
                    .expect("parent checked live above");
                machine.node = parent;
                shared.pending = true;
                self.visit_filter(shared, parent)
            }
        }
    }

    /// `firstChild` / `lastChild`: descend into the current's first/last child,
    /// then backtrack. Only `FILTER_SKIP` descends into the subtree;
    /// `FILTER_REJECT` (and an unrecognised result) prunes it.
    fn children_step(
        &self,
        shared: &mut PassState,
        machine: &mut ChildrenMachine,
    ) -> Result<Option<TraversalStep>, CoreError> {
        if shared.pending {
            shared.pending = false;
            if shared.result == FILTER_ACCEPT {
                shared.current = machine.node;
                return Ok(Some(TraversalStep::Done(Some(machine.node))));
            }
            if shared.result == FILTER_SKIP {
                if let Some(child) = self.child_direction(machine.node, machine.last)? {
                    machine.node = child;
                    machine.phase = ChildPhase::Descend;
                    shared.pending = true;
                    return self.visit_filter(shared, child);
                }
            }
            machine.phase = ChildPhase::Sibling;
            return Ok(None);
        }
        match machine.phase {
            ChildPhase::Descend => {
                shared.pending = true;
                self.visit_filter(shared, machine.node)
            }
            ChildPhase::Sibling => loop {
                if let Some(sibling) = self.sibling_direction(machine.node, machine.last)? {
                    machine.node = sibling;
                    machine.phase = ChildPhase::Descend;
                    shared.pending = true;
                    return self.visit_filter(shared, sibling);
                }
                let Some(parent) = self.parent(machine.node)? else {
                    return Ok(Some(TraversalStep::Done(None)));
                };
                // Never climb past the subtree the call started in.
                if parent == shared.root || parent == shared.current {
                    return Ok(Some(TraversalStep::Done(None)));
                }
                machine.node = parent;
            },
        }
    }

    /// `nextSibling` / `previousSibling`: search the siblings of the cursor
    /// (descending into a non-`FILTER_REJECT` sibling's subtree to find the
    /// next visible node), then climb one level at a time. Climbing filters
    /// the ancestor: an accepted ancestor ends the search with `null` (the
    /// next visible node would be that ancestor), anything else keeps
    /// searching the ancestor's siblings.
    fn siblings_step(
        &self,
        shared: &mut PassState,
        machine: &mut SiblingsMachine,
    ) -> Result<Option<TraversalStep>, CoreError> {
        if shared.pending {
            shared.pending = false;
            match machine.phase {
                SiblingPhase::Search => {
                    if shared.result == FILTER_ACCEPT {
                        shared.current = machine.node;
                        return Ok(Some(TraversalStep::Done(Some(machine.node))));
                    }
                    let child = self.child_direction(machine.node, machine.prev)?;
                    let sibling = if shared.result == FILTER_REJECT || child.is_none() {
                        self.sibling_direction(machine.node, machine.prev)?
                    } else {
                        child
                    };
                    if let Some(sibling) = sibling {
                        machine.node = sibling;
                        shared.pending = true;
                        return self.visit_filter(shared, sibling);
                    }
                    machine.phase = SiblingPhase::Climb;
                    return Ok(None);
                }
                SiblingPhase::Climb => {
                    if shared.result == FILTER_ACCEPT {
                        return Ok(Some(TraversalStep::Done(None)));
                    }
                    machine.phase = SiblingPhase::Search;
                    return Ok(None);
                }
            }
        }
        match machine.phase {
            SiblingPhase::Search => {
                if machine.node == shared.root {
                    return Ok(Some(TraversalStep::Done(None)));
                }
                if let Some(sibling) = self.sibling_direction(machine.node, machine.prev)? {
                    machine.node = sibling;
                    shared.pending = true;
                    return self.visit_filter(shared, sibling);
                }
                machine.phase = SiblingPhase::Climb;
                Ok(None)
            }
            SiblingPhase::Climb => {
                let Some(parent) = self.parent(machine.node)? else {
                    return Ok(Some(TraversalStep::Done(None)));
                };
                if parent == shared.root {
                    return Ok(Some(TraversalStep::Done(None)));
                }
                machine.node = parent;
                shared.pending = true;
                self.visit_filter(shared, parent)
            }
        }
    }

    /// First/last child of `node`; `last` selects the direction.
    fn child_direction(&self, node: NodeId, last: bool) -> Result<Option<NodeId>, CoreError> {
        if last {
            self.last_child(node)
        } else {
            self.first_child(node)
        }
    }

    /// Next/previous sibling of `node`; `prev` selects the direction.
    fn sibling_direction(&self, node: NodeId, prev: bool) -> Result<Option<NodeId>, CoreError> {
        if prev {
            self.previous_sibling(node)
        } else {
            self.next_sibling(node)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// Drives a traversal pass to completion with a fake filter that maps
    /// node names to the given decision function, returning the accepted node
    /// or `None` for a single traversal call.
    fn run_once(
        doc: &Document,
        op: TraversalOp,
        root: NodeId,
        current: NodeId,
        what_to_show: u32,
        mut filter: Option<&mut dyn FnMut(&str) -> u32>,
    ) -> Result<Option<NodeId>, CoreError> {
        let (mut pass, mut step) =
            doc.traversal_start(op, root, current, what_to_show, filter.is_some())?;
        loop {
            match step {
                TraversalStep::Done(Some(node)) => return Ok(Some(node)),
                TraversalStep::Done(None) => return Ok(None),
                TraversalStep::Filter(node) => {
                    let name = doc.node_name(node)?;
                    let result = filter.as_mut().map(|f| f(name)).unwrap_or(FILTER_ACCEPT);
                    step = doc.traversal_filter(&mut pass, result)?;
                }
            }
        }
    }

    #[test]
    fn next_node_visits_preorder_with_all_nodes() {
        let (doc, body, a, a1, b, b1, b2) = build_tree();
        let order = vec![a, a1, b, b1, b2];
        let mut current = body;
        for expected in order {
            let next = run_once(&doc, TraversalOp::NextNode, body, current, SHOW_ALL, None)
                .unwrap()
                .unwrap();
            assert_eq!(next, expected);
            current = next;
        }
        assert!(
            run_once(&doc, TraversalOp::NextNode, body, current, SHOW_ALL, None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn next_node_reject_prunes_the_subtree() {
        let (doc, body, _a, _a1, b, _b1, _b2) = build_tree();
        // Reject div#a only: its subtree is pruned, so the walk resumes at
        // div#b without visiting span#a1.
        let mut divs = 0;
        let next = run_once(
            &doc,
            TraversalOp::NextNode,
            body,
            body,
            SHOW_ALL,
            Some(&mut |name| {
                if name == "div" {
                    divs += 1;
                    if divs == 1 {
                        FILTER_REJECT
                    } else {
                        FILTER_ACCEPT
                    }
                } else {
                    FILTER_ACCEPT
                }
            }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(next, b);
    }

    #[test]
    fn next_node_skip_descends_into_the_subtree() {
        let (doc, body, _a, a1, _b, _b1, _b2) = build_tree();
        // Skip div#a: the node itself is not returned, but its child is.
        let next = run_once(
            &doc,
            TraversalOp::NextNode,
            body,
            body,
            SHOW_ALL,
            Some(&mut |name| {
                if name == "div" {
                    FILTER_SKIP
                } else {
                    FILTER_ACCEPT
                }
            }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(next, a1);
    }

    #[test]
    fn next_node_from_a_leaf_backtracks_through_siblings() {
        let (doc, body, _a, a1, b, b1, _b2) = build_tree();
        // From span#a1 (a leaf in div#a), the walk backtracks to div#b, then
        // descends to p#b1 (the baseline order).
        let first = run_once(&doc, TraversalOp::NextNode, body, a1, SHOW_ALL, None)
            .unwrap()
            .unwrap();
        assert_eq!(first, b);
        let second = run_once(&doc, TraversalOp::NextNode, body, first, SHOW_ALL, None)
            .unwrap()
            .unwrap();
        assert_eq!(second, b1);
    }

    #[test]
    fn previous_node_visits_reverse_preorder() {
        let (doc, body, a, a1, b, b1, b2) = build_tree();
        // From p#b2, previous visits p#b1, div#b, span#a1, div#a, body, then null.
        let order = vec![b1, b, a1, a, body];
        let mut current = b2;
        for expected in order {
            let previous = run_once(
                &doc,
                TraversalOp::PreviousNode,
                body,
                current,
                SHOW_ALL,
                None,
            )
            .unwrap()
            .unwrap();
            assert_eq!(previous, expected);
            current = previous;
        }
        assert!(run_once(
            &doc,
            TraversalOp::PreviousNode,
            body,
            current,
            SHOW_ALL,
            None
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn previous_node_skips_rejected_ancestors() {
        let (doc, body, _a, a1, _b, _b1, _b2) = build_tree();
        // Reject div#a only: from span#a1 the walk climbs past the rejected
        // div#a to body instead of returning it.
        let mut divs = 0;
        let previous = run_once(
            &doc,
            TraversalOp::PreviousNode,
            body,
            a1,
            SHOW_ALL,
            Some(&mut |name| {
                if name == "div" {
                    divs += 1;
                    if divs == 1 {
                        FILTER_REJECT
                    } else {
                        FILTER_ACCEPT
                    }
                } else {
                    FILTER_ACCEPT
                }
            }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(previous, body);
    }

    #[test]
    fn parent_node_climbs_to_the_root() {
        let (doc, body, a, a1, _b, _b1, _b2) = build_tree();
        assert_eq!(
            run_once(&doc, TraversalOp::ParentNode, body, a1, SHOW_ALL, None).unwrap(),
            Some(a)
        );
        assert_eq!(
            run_once(&doc, TraversalOp::ParentNode, body, a, SHOW_ALL, None).unwrap(),
            Some(body)
        );
        // From the root itself there is no parent (the baseline never returns
        // null here: the walker's current equals the root).
        assert_eq!(
            run_once(&doc, TraversalOp::ParentNode, body, body, SHOW_ALL, None).unwrap(),
            None
        );
    }

    #[test]
    fn parent_node_filters_ancestors() {
        let (doc, body, _a, a1, _b, _b1, _b2) = build_tree();
        // Reject div#a: from span#a1 the first accepted ancestor is body.
        let parent = run_once(
            &doc,
            TraversalOp::ParentNode,
            body,
            a1,
            SHOW_ALL,
            Some(&mut |name| {
                if name == "div" {
                    FILTER_REJECT
                } else {
                    FILTER_ACCEPT
                }
            }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(parent, body);
    }

    #[test]
    fn first_and_last_child_navigate_directly() {
        let (doc, body, a, a1, b, _b1, _b2) = build_tree();
        assert_eq!(
            run_once(&doc, TraversalOp::FirstChild, body, body, SHOW_ALL, None).unwrap(),
            Some(a)
        );
        assert_eq!(
            run_once(&doc, TraversalOp::LastChild, body, body, SHOW_ALL, None).unwrap(),
            Some(b)
        );
        // A leaf has no children.
        assert_eq!(
            run_once(&doc, TraversalOp::FirstChild, body, a1, SHOW_ALL, None).unwrap(),
            None
        );
    }

    #[test]
    fn first_child_skip_descends_into_the_subtree() {
        let (doc, body, _a, a1, _b, _b1, _b2) = build_tree();
        // Skip div#a: firstChild descends into it and returns span#a1.
        let child = run_once(
            &doc,
            TraversalOp::FirstChild,
            body,
            body,
            SHOW_ALL,
            Some(&mut |name| {
                if name == "div" {
                    FILTER_SKIP
                } else {
                    FILTER_ACCEPT
                }
            }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(child, a1);
    }

    #[test]
    fn next_sibling_walks_sibling_subtrees() {
        let (doc, body, a, a1, b, _b1, b2) = build_tree();
        // From span#a1 the parent div#a filters to ACCEPT, so the next-sibling
        // search ends with null (the baseline never returns an ancestor here).
        assert_eq!(
            run_once(&doc, TraversalOp::NextSibling, body, a1, SHOW_ALL, None).unwrap(),
            None
        );
        // From div#a the next visible node is div#b.
        assert_eq!(
            run_once(&doc, TraversalOp::NextSibling, body, a, SHOW_ALL, None).unwrap(),
            Some(b)
        );
        // From p#b2 there is no next sibling.
        assert_eq!(
            run_once(&doc, TraversalOp::NextSibling, body, b2, SHOW_ALL, None).unwrap(),
            None
        );
    }

    #[test]
    fn next_sibling_skip_descends_into_the_next_subtree() {
        let (doc, body, a, _a1, _b, b1, _b2) = build_tree();
        // Skip div#b: from div#a the search descends into it and returns its
        // descendant p#b1 (a FILTER_REJECT would prune the subtree instead).
        let mut divs = 0;
        let next = run_once(
            &doc,
            TraversalOp::NextSibling,
            body,
            a,
            SHOW_ALL,
            Some(&mut |name| {
                if name == "div" {
                    divs += 1;
                    if divs == 1 {
                        FILTER_SKIP
                    } else {
                        FILTER_ACCEPT
                    }
                } else {
                    FILTER_ACCEPT
                }
            }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(next, b1);
    }

    #[test]
    fn previous_sibling_reverse_direction() {
        let (doc, body, a, _a1, b, b1, b2) = build_tree();
        assert_eq!(
            run_once(&doc, TraversalOp::PreviousSibling, body, b, SHOW_ALL, None).unwrap(),
            Some(a)
        );
        // From p#b2 the previous visible node is its sibling p#b1.
        assert_eq!(
            run_once(&doc, TraversalOp::PreviousSibling, body, b2, SHOW_ALL, None).unwrap(),
            Some(b1)
        );
    }

    #[test]
    fn what_to_show_masks_out_node_types() {
        let (doc, body, a, _a1, _b, _b1, _b2) = build_tree();
        // SHOW_TEXT with an all-element tree yields no nodes.
        assert!(
            run_once(&doc, TraversalOp::NextNode, body, body, SHOW_TEXT, None)
                .unwrap()
                .is_none()
        );
        // Mixed mask still skips elements only when every element is rejected.
        let next = run_once(
            &doc,
            TraversalOp::NextNode,
            body,
            body,
            SHOW_ELEMENT | SHOW_TEXT,
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(next, a);
    }

    #[test]
    fn traversal_mask_skips_matches_node_types() {
        let (doc, _body, a, _a1, _b, _b1, _b2) = build_tree();
        assert!(doc.traversal_mask_skips(a, SHOW_TEXT).unwrap());
        assert!(!doc.traversal_mask_skips(a, SHOW_ELEMENT).unwrap());
        assert!(!doc.traversal_mask_skips(a, SHOW_ALL).unwrap());
    }

    #[test]
    fn foreign_or_stale_handles_are_rejected() {
        let (doc, _body, _a, _a1, _b, _b1, _b2) = build_tree();
        let foreign = NodeId::new(u64::MAX, 0, 0);
        assert!(matches!(
            doc.traversal_start(TraversalOp::NextNode, foreign, foreign, SHOW_ALL, false),
            Err(CoreError::WrongDocument { .. })
        ));
        let stale = NodeId::new(doc.id(), u32::MAX, 0);
        assert!(matches!(
            doc.traversal_start(TraversalOp::NextNode, stale, stale, SHOW_ALL, false),
            Err(CoreError::Arena(_))
        ));
    }

    #[test]
    fn a_detached_current_node_still_traverses_its_own_subtree() {
        let mut doc = Document::new();
        let root = doc.create_element("root").unwrap();
        let child = doc.create_element("child").unwrap();
        let grand = doc.create_element("grand").unwrap();
        doc.append_child(child, grand).unwrap();
        doc.append_child(root, child).unwrap();
        // Remove `child` from the tree: it stays live in the arena, so the
        // walker's current (child) keeps navigating its own subtree.
        doc.remove_child(root, child).unwrap();
        let next = run_once(&doc, TraversalOp::NextNode, child, child, SHOW_ALL, None)
            .unwrap()
            .unwrap();
        assert_eq!(next, grand);
    }
}
