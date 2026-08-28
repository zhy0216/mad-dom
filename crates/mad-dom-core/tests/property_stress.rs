use mad_dom_core::arena::{Arena, ArenaError, NodeId};
use mad_dom_core::dom::{Document, NodeData, NodeType};
use mad_dom_core::error::CoreError;

use std::any::Any;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};

const FIXED_SEEDS: &[u64] = &[
    0x18c0_ffee_1234_5678,
    0x5eed_fade_0dd0_cafe,
    0xa11c_e5ed_dead_beef,
    0xd0c0_babe_7654_3210,
];
const RANDOM_STEPS: usize = 192;
const MAX_LIVE_NODES: usize = 700;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum OperationKind {
    Create,
    Append,
    Insert,
    Remove,
    Replace,
    Clone,
    Import,
    Adopt,
    CrossAppend,
    CrossInsert,
    CrossRemove,
    CrossReplace,
    CrossClone,
    CrossImport,
    CrossAdopt,
    Cycle,
    BadMembership,
}

impl OperationKind {
    const ALL: [Self; 17] = [
        Self::Create,
        Self::Append,
        Self::Insert,
        Self::Remove,
        Self::Replace,
        Self::Clone,
        Self::Import,
        Self::Adopt,
        Self::CrossAppend,
        Self::CrossInsert,
        Self::CrossRemove,
        Self::CrossReplace,
        Self::CrossClone,
        Self::CrossImport,
        Self::CrossAdopt,
        Self::Cycle,
        Self::BadMembership,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    A,
    B,
}

impl Side {
    fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::B => "B",
        }
    }
}

/// SplitMix64 gives the tests a tiny, deterministic PRNG with no test-only
/// dependency and no ambient entropy. A failing seed can be copied directly
/// into `FIXED_SEEDS` or passed to `run_sequence` while debugging.
struct ReplayRng(u64);

impl ReplayRng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        value ^ (value >> 31)
    }

    fn index(&mut self, len: usize) -> usize {
        if len == 0 {
            0
        } else {
            (self.next_u64() as usize) % len
        }
    }

    fn coin(&mut self) -> bool {
        self.next_u64() & 1 == 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ObservedNode {
    id: NodeId,
    data: NodeData,
    parent: Option<NodeId>,
    first_child: Option<NodeId>,
    last_child: Option<NodeId>,
    previous_sibling: Option<NodeId>,
    next_sibling: Option<NodeId>,
    children: Vec<NodeId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ForestSnapshot {
    nodes: Vec<ObservedNode>,
}

impl ForestSnapshot {
    fn capture(document: &Document, known: &[NodeId]) -> Self {
        let mut seen = HashSet::new();
        let nodes = known
            .iter()
            .copied()
            .filter(|id| seen.insert(*id))
            .filter_map(|id| {
                let node = document.get(id).ok()?;
                Some(ObservedNode {
                    id,
                    data: node.data().clone(),
                    parent: document
                        .parent(id)
                        .expect("known live node has a parent result"),
                    first_child: document
                        .first_child(id)
                        .expect("known live node has a first-child result"),
                    last_child: document
                        .last_child(id)
                        .expect("known live node has a last-child result"),
                    previous_sibling: document
                        .previous_sibling(id)
                        .expect("known live node has a previous-sibling result"),
                    next_sibling: document
                        .next_sibling(id)
                        .expect("known live node has a next-sibling result"),
                    children: document
                        .children(id)
                        .expect("known live node has a child-list result"),
                })
            })
            .collect();
        Self { nodes }
    }

    /// An independent public-API oracle. This intentionally overlaps with
    /// `Document::check_invariants`: mutation bugs must fool both the Core
    /// checker and the externally observed relation graph to escape T18.
    fn validate(&self) -> Result<(), String> {
        let positions: HashMap<NodeId, usize> = self
            .nodes
            .iter()
            .enumerate()
            .map(|(index, node)| (node.id, index))
            .collect();
        if positions.len() != self.nodes.len() {
            return Err("a live handle was observed more than once".to_string());
        }

        for node in &self.nodes {
            for target in [
                node.parent,
                node.first_child,
                node.last_child,
                node.previous_sibling,
                node.next_sibling,
            ]
            .into_iter()
            .flatten()
            {
                if !positions.contains_key(&target) {
                    return Err(format!(
                        "relation from {:?} targets a non-live handle {:?}",
                        node.id, target
                    ));
                }
            }

            if node.first_child != node.children.first().copied()
                || node.last_child != node.children.last().copied()
            {
                return Err(format!("first/last child mismatch at {:?}", node.id));
            }

            for (index, child) in node.children.iter().copied().enumerate() {
                let child = &self.nodes[positions[&child]];
                if child.parent != Some(node.id) {
                    return Err(format!(
                        "parent/child mismatch: {:?} does not point back to {:?}",
                        child.id, node.id
                    ));
                }
                if child.previous_sibling != index.checked_sub(1).map(|i| node.children[i]) {
                    return Err(format!("previous-sibling mismatch at {:?}", child.id));
                }
                if child.next_sibling != node.children.get(index + 1).copied() {
                    return Err(format!("next-sibling mismatch at {:?}", child.id));
                }
            }

            if let Some(parent) = node.parent {
                let parent = &self.nodes[positions[&parent]];
                if !parent.children.contains(&node.id) {
                    return Err(format!(
                        "child {:?} points to {:?}, which does not contain it",
                        node.id, parent.id
                    ));
                }
            } else if node.previous_sibling.is_some() || node.next_sibling.is_some() {
                return Err(format!("detached root {:?} retains sibling links", node.id));
            }
        }

        let roots: Vec<NodeId> = self
            .nodes
            .iter()
            .filter(|node| node.parent.is_none())
            .map(|node| node.id)
            .collect();
        let mut reached = HashSet::new();
        let mut stack = roots;
        while let Some(id) = stack.pop() {
            if !reached.insert(id) {
                return Err(format!("node {:?} is reached more than once", id));
            }
            stack.extend(self.nodes[positions[&id]].children.iter().copied());
        }
        if reached.len() != self.nodes.len() {
            return Err(format!(
                "only {} of {} live nodes are reachable from roots",
                reached.len(),
                self.nodes.len()
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WorldSnapshot {
    a: ForestSnapshot,
    b: ForestSnapshot,
}

struct World {
    a: Document,
    b: Document,
    known_a: Vec<NodeId>,
    known_b: Vec<NodeId>,
    stale_a: Vec<NodeId>,
    stale_b: Vec<NodeId>,
    trace: Vec<String>,
}

impl World {
    fn new() -> Self {
        let mut world = Self {
            a: Document::new(),
            b: Document::new(),
            known_a: Vec::new(),
            known_b: Vec::new(),
            stale_a: Vec::new(),
            stale_b: Vec::new(),
            trace: Vec::new(),
        };
        for side in [Side::A, Side::B] {
            let root = world.create(side, 0, "root");
            let branch = world.create(side, 0, "branch");
            let text = world.create(side, 1, "seed-text");
            let fragment = world.create(side, 3, "fragment");
            world
                .doc_mut(side)
                .append_child(root, branch)
                .expect("initial append succeeds");
            world
                .doc_mut(side)
                .append_child(branch, text)
                .expect("initial append succeeds");
            world.trace.push(format!(
                "init {}: root={} branch={} text={} fragment={}",
                side.name(),
                world.label(side, root),
                world.label(side, branch),
                world.label(side, text),
                world.label(side, fragment)
            ));
        }
        world.validate();
        world
    }

    fn doc(&self, side: Side) -> &Document {
        match side {
            Side::A => &self.a,
            Side::B => &self.b,
        }
    }

    fn doc_mut(&mut self, side: Side) -> &mut Document {
        match side {
            Side::A => &mut self.a,
            Side::B => &mut self.b,
        }
    }

    fn known(&self, side: Side) -> &[NodeId] {
        match side {
            Side::A => &self.known_a,
            Side::B => &self.known_b,
        }
    }

    fn known_mut(&mut self, side: Side) -> &mut Vec<NodeId> {
        match side {
            Side::A => &mut self.known_a,
            Side::B => &mut self.known_b,
        }
    }

    fn stale(&self, side: Side) -> &[NodeId] {
        match side {
            Side::A => &self.stale_a,
            Side::B => &self.stale_b,
        }
    }

    fn stale_mut(&mut self, side: Side) -> &mut Vec<NodeId> {
        match side {
            Side::A => &mut self.stale_a,
            Side::B => &mut self.stale_b,
        }
    }

    fn snapshot(&self) -> WorldSnapshot {
        WorldSnapshot {
            a: ForestSnapshot::capture(&self.a, &self.known_a),
            b: ForestSnapshot::capture(&self.b, &self.known_b),
        }
    }

    fn live_ids(&self, side: Side) -> Vec<NodeId> {
        self.known(side)
            .iter()
            .copied()
            .filter(|id| self.doc(side).get(*id).is_ok())
            .collect()
    }

    fn parent_candidates(&self, side: Side) -> Vec<NodeId> {
        self.live_ids(side)
            .into_iter()
            .filter(|id| {
                matches!(
                    self.doc(side).node_type(*id),
                    Ok(NodeType::Element | NodeType::DocumentFragment)
                )
            })
            .collect()
    }

    fn attached(&self, side: Side) -> Vec<(NodeId, NodeId)> {
        self.live_ids(side)
            .into_iter()
            .filter_map(|id| {
                self.doc(side)
                    .parent(id)
                    .ok()
                    .flatten()
                    .map(|parent| (parent, id))
            })
            .collect()
    }

    fn label(&self, side: Side, id: NodeId) -> String {
        let index = self
            .known(side)
            .iter()
            .position(|known| *known == id)
            .expect("all logged handles are known");
        format!("{}#{index}", side.name())
    }

    fn create(&mut self, side: Side, kind: usize, payload: &str) -> NodeId {
        let id = match kind % 4 {
            0 => self
                .doc_mut(side)
                .create_element(if payload.is_empty() { "node" } else { payload })
                .expect("generated element names are valid"),
            1 => self
                .doc_mut(side)
                .create_text(payload)
                .expect("generated text contains no NUL"),
            2 => self
                .doc_mut(side)
                .create_comment(payload)
                .expect("generated comments contain no NUL"),
            _ => self
                .doc_mut(side)
                .create_document_fragment()
                .expect("fragment creation is infallible"),
        };
        self.known_mut(side).push(id);
        id
    }

    fn record_subtree(&mut self, side: Side, root: NodeId) {
        for id in public_subtree(self.doc(side), root) {
            if !self.known(side).contains(&id) {
                self.known_mut(side).push(id);
            }
        }
    }

    fn legal_pair(&self, side: Side, rng: &mut ReplayRng) -> Option<(NodeId, NodeId)> {
        let parents = self.parent_candidates(side);
        let children = self.live_ids(side);
        for _ in 0..32 {
            let parent = parents.get(rng.index(parents.len())).copied()?;
            let child = children.get(rng.index(children.len())).copied()?;
            if child != parent
                && !self
                    .doc(side)
                    .is_descendant_of(parent, child)
                    .expect("candidate handles are live")
            {
                return Some((parent, child));
            }
        }
        None
    }

    fn total_live(&self) -> usize {
        self.live_ids(Side::A).len() + self.live_ids(Side::B).len()
    }

    fn fallback_mutation(&mut self, rng: &mut ReplayRng, step: usize) -> OperationKind {
        let side = if rng.coin() { Side::A } else { Side::B };
        if let Some((parent, child)) = self.legal_pair(side, rng) {
            self.trace.push(format!(
                "{step}: fallback append {} <- {}",
                self.label(side, parent),
                self.label(side, child)
            ));
            self.doc_mut(side)
                .append_child(parent, child)
                .expect("filtered append is legal");
            OperationKind::Append
        } else {
            let id = self.create(side, 0, "fallback");
            self.trace
                .push(format!("{step}: fallback create {}", self.label(side, id)));
            OperationKind::Create
        }
    }

    fn step(&mut self, rng: &mut ReplayRng, step: usize) -> OperationKind {
        let requested = OperationKind::ALL[rng.index(OperationKind::ALL.len())];
        match requested {
            OperationKind::Create => {
                if self.total_live() >= MAX_LIVE_NODES {
                    return self.fallback_mutation(rng, step);
                }
                let side = if rng.coin() { Side::A } else { Side::B };
                let kind = rng.index(4);
                let id = self.create(side, kind, &format!("n{step}"));
                self.trace.push(format!(
                    "{step}: create kind={kind} {}",
                    self.label(side, id)
                ));
                OperationKind::Create
            }
            OperationKind::Append => {
                let side = if rng.coin() { Side::A } else { Side::B };
                let Some((parent, child)) = self.legal_pair(side, rng) else {
                    return self.fallback_mutation(rng, step);
                };
                self.trace.push(format!(
                    "{step}: append {} <- {}",
                    self.label(side, parent),
                    self.label(side, child)
                ));
                self.doc_mut(side)
                    .append_child(parent, child)
                    .expect("filtered append is legal");
                OperationKind::Append
            }
            OperationKind::Insert => {
                let side = if rng.coin() { Side::A } else { Side::B };
                let Some((parent, child)) = self.legal_pair(side, rng) else {
                    return self.fallback_mutation(rng, step);
                };
                let references = self
                    .doc(side)
                    .children(parent)
                    .expect("candidate parent is live");
                let Some(reference) = references.get(rng.index(references.len())).copied() else {
                    return self.fallback_mutation(rng, step);
                };
                self.trace.push(format!(
                    "{step}: insert {} <- {} before {}",
                    self.label(side, parent),
                    self.label(side, child),
                    self.label(side, reference)
                ));
                self.doc_mut(side)
                    .insert_before(parent, child, reference)
                    .expect("filtered insert is legal");
                OperationKind::Insert
            }
            OperationKind::Remove => {
                let side = if rng.coin() { Side::A } else { Side::B };
                let attached = self.attached(side);
                let Some((parent, child)) = attached.get(rng.index(attached.len())).copied() else {
                    return self.fallback_mutation(rng, step);
                };
                self.trace.push(format!(
                    "{step}: remove {} -/-> {}",
                    self.label(side, parent),
                    self.label(side, child)
                ));
                assert_eq!(
                    self.doc_mut(side).remove_child(parent, child).unwrap(),
                    child
                );
                OperationKind::Remove
            }
            OperationKind::Replace => {
                let side = if rng.coin() { Side::A } else { Side::B };
                let attached = self.attached(side);
                let Some((parent, child)) = attached.get(rng.index(attached.len())).copied() else {
                    return self.fallback_mutation(rng, step);
                };
                let candidates: Vec<NodeId> = self
                    .live_ids(side)
                    .into_iter()
                    .filter(|node| {
                        *node == child
                            || (*node != parent
                                && !self
                                    .doc(side)
                                    .is_descendant_of(parent, *node)
                                    .expect("candidate handles are live"))
                    })
                    .collect();
                let Some(node) = candidates.get(rng.index(candidates.len())).copied() else {
                    return self.fallback_mutation(rng, step);
                };
                self.trace.push(format!(
                    "{step}: replace {} child {} with {}",
                    self.label(side, parent),
                    self.label(side, child),
                    self.label(side, node)
                ));
                assert_eq!(
                    self.doc_mut(side)
                        .replace_child(parent, child, node)
                        .unwrap(),
                    child
                );
                OperationKind::Replace
            }
            OperationKind::Clone => {
                if self.total_live() >= MAX_LIVE_NODES {
                    return self.fallback_mutation(rng, step);
                }
                let side = if rng.coin() { Side::A } else { Side::B };
                let live = self.live_ids(side);
                let Some(id) = live.get(rng.index(live.len())).copied() else {
                    return self.fallback_mutation(rng, step);
                };
                let subtree_len = public_subtree(self.doc(side), id).len();
                let deep = rng.coin() && subtree_len <= 32;
                self.trace.push(format!(
                    "{step}: clone {} deep={deep}",
                    self.label(side, id)
                ));
                let cloned = self
                    .doc_mut(side)
                    .clone_node(id, deep)
                    .expect("live non-Document nodes can be cloned");
                self.record_subtree(side, cloned);
                OperationKind::Clone
            }
            OperationKind::Import => {
                if self.total_live() >= MAX_LIVE_NODES {
                    return self.fallback_mutation(rng, step);
                }
                let source = if rng.coin() { Side::A } else { Side::B };
                let target = source.other();
                let live = self.live_ids(source);
                let Some(id) = live.get(rng.index(live.len())).copied() else {
                    return self.fallback_mutation(rng, step);
                };
                let subtree_len = public_subtree(self.doc(source), id).len();
                let deep = rng.coin() && subtree_len <= 32;
                self.trace.push(format!(
                    "{step}: import {} {} -> {} deep={deep}",
                    self.label(source, id),
                    source.name(),
                    target.name()
                ));
                let imported = match (source, target) {
                    (Side::A, Side::B) => self.b.import_node(&self.a, id, deep),
                    (Side::B, Side::A) => self.a.import_node(&self.b, id, deep),
                    _ => unreachable!(),
                }
                .expect("live nodes can be imported");
                self.record_subtree(target, imported);
                OperationKind::Import
            }
            OperationKind::Adopt => {
                let source = if rng.coin() { Side::A } else { Side::B };
                let target = source.other();
                let live = self.live_ids(source);
                let Some(id) = live.get(rng.index(live.len())).copied() else {
                    return self.fallback_mutation(rng, step);
                };
                let old_subtree = public_subtree(self.doc(source), id);
                self.trace.push(format!(
                    "{step}: adopt {} {} -> {}",
                    self.label(source, id),
                    source.name(),
                    target.name()
                ));
                let adopted = match (source, target) {
                    (Side::A, Side::B) => self.b.adopt_node(&mut self.a, id),
                    (Side::B, Side::A) => self.a.adopt_node(&mut self.b, id),
                    _ => unreachable!(),
                }
                .expect("live nodes can be adopted");
                self.stale_mut(source).extend(old_subtree);
                self.record_subtree(target, adopted);
                OperationKind::Adopt
            }
            OperationKind::CrossAppend
            | OperationKind::CrossInsert
            | OperationKind::CrossRemove
            | OperationKind::CrossReplace => self.cross_document_error(requested, rng, step),
            OperationKind::CrossClone | OperationKind::CrossImport | OperationKind::CrossAdopt => {
                self.cross_document_copy_error(requested, rng, step)
            }
            OperationKind::Cycle => self.cycle_error(rng, step),
            OperationKind::BadMembership => self.bad_membership_error(rng, step),
        }
    }

    fn cross_document_error(
        &mut self,
        kind: OperationKind,
        rng: &mut ReplayRng,
        step: usize,
    ) -> OperationKind {
        let local = if rng.coin() { Side::A } else { Side::B };
        let foreign = local.other();
        let parents = self.parent_candidates(local);
        let local_live = self.live_ids(local);
        let foreign_live = self.live_ids(foreign);
        let Some(parent) = parents.get(rng.index(parents.len())).copied() else {
            return self.fallback_mutation(rng, step);
        };
        let Some(local_node) = local_live.get(rng.index(local_live.len())).copied() else {
            return self.fallback_mutation(rng, step);
        };
        let Some(foreign_node) = foreign_live.get(rng.index(foreign_live.len())).copied() else {
            return self.fallback_mutation(rng, step);
        };
        let before = self.snapshot();
        self.trace.push(format!(
            "{step}: {kind:?} local={} foreign={}",
            self.label(local, parent),
            self.label(foreign, foreign_node)
        ));

        let error = match kind {
            OperationKind::CrossAppend => self
                .doc_mut(local)
                .append_child(parent, foreign_node)
                .unwrap_err(),
            OperationKind::CrossInsert => {
                let references = self
                    .doc(local)
                    .children(parent)
                    .expect("local parent is live");
                if let Some(reference) = references.first().copied() {
                    self.doc_mut(local)
                        .insert_before(parent, foreign_node, reference)
                        .unwrap_err()
                } else {
                    self.doc_mut(local)
                        .insert_before(parent, foreign_node, foreign_node)
                        .unwrap_err()
                }
            }
            OperationKind::CrossRemove => self
                .doc_mut(local)
                .remove_child(parent, foreign_node)
                .unwrap_err(),
            OperationKind::CrossReplace => {
                let children = self
                    .doc(local)
                    .children(parent)
                    .expect("local parent is live");
                if let Some(child) = children.first().copied() {
                    self.doc_mut(local)
                        .replace_child(parent, child, foreign_node)
                        .unwrap_err()
                } else {
                    self.doc_mut(local)
                        .replace_child(parent, foreign_node, local_node)
                        .unwrap_err()
                }
            }
            _ => unreachable!(),
        };
        assert!(
            matches!(error, CoreError::WrongDocument { .. }),
            "expected WrongDocument, got {error:?}"
        );
        assert_eq!(self.snapshot(), before, "failed mutation must be atomic");
        kind
    }

    fn cross_document_copy_error(
        &mut self,
        kind: OperationKind,
        rng: &mut ReplayRng,
        step: usize,
    ) -> OperationKind {
        let source = if rng.coin() { Side::A } else { Side::B };
        let target = source.other();
        let source_live = self.live_ids(source);
        let target_live = self.live_ids(target);
        let Some(source_node) = source_live.get(rng.index(source_live.len())).copied() else {
            return self.fallback_mutation(rng, step);
        };
        let Some(target_node) = target_live.get(rng.index(target_live.len())).copied() else {
            return self.fallback_mutation(rng, step);
        };
        let before = self.snapshot();
        self.trace.push(format!(
            "{step}: {kind:?} source={} target={}",
            self.label(source, source_node),
            self.label(target, target_node)
        ));

        let error = match kind {
            OperationKind::CrossClone => self.doc_mut(source).clone_node(target_node, true),
            OperationKind::CrossImport => match (source, target) {
                (Side::A, Side::B) => self.b.import_node(&self.a, target_node, true),
                (Side::B, Side::A) => self.a.import_node(&self.b, target_node, true),
                _ => unreachable!(),
            },
            OperationKind::CrossAdopt => match (source, target) {
                (Side::A, Side::B) => self.b.adopt_node(&mut self.a, target_node),
                (Side::B, Side::A) => self.a.adopt_node(&mut self.b, target_node),
                _ => unreachable!(),
            },
            _ => unreachable!(),
        }
        .unwrap_err();
        assert!(
            matches!(error, CoreError::WrongDocument { .. }),
            "expected WrongDocument, got {error:?}"
        );
        assert_eq!(
            self.snapshot(),
            before,
            "failed clone/import/adopt must be atomic"
        );
        kind
    }

    fn cycle_error(&mut self, rng: &mut ReplayRng, step: usize) -> OperationKind {
        let side = if rng.coin() { Side::A } else { Side::B };
        let candidates: Vec<NodeId> = self
            .parent_candidates(side)
            .into_iter()
            .filter(|id| self.doc(side).parent(*id).ok().flatten().is_some())
            .collect();
        let (parent, ancestor) = if let Some(parent) = candidates.get(rng.index(candidates.len())) {
            (*parent, self.doc(side).parent(*parent).unwrap().unwrap())
        } else {
            let parents = self.parent_candidates(side);
            let Some(parent) = parents.get(rng.index(parents.len())).copied() else {
                return self.fallback_mutation(rng, step);
            };
            (parent, parent)
        };
        let before = self.snapshot();
        self.trace.push(format!(
            "{step}: cycle append {} <- {}",
            self.label(side, parent),
            self.label(side, ancestor)
        ));
        let error = self
            .doc_mut(side)
            .append_child(parent, ancestor)
            .unwrap_err();
        assert!(matches!(error, CoreError::Hierarchy { .. }));
        assert_eq!(self.snapshot(), before, "failed cycle must be atomic");
        OperationKind::Cycle
    }

    fn bad_membership_error(&mut self, rng: &mut ReplayRng, step: usize) -> OperationKind {
        let side = if rng.coin() { Side::A } else { Side::B };
        let parents = self.parent_candidates(side);
        let live = self.live_ids(side);
        for _ in 0..32 {
            let Some(parent) = parents.get(rng.index(parents.len())).copied() else {
                break;
            };
            let Some(node) = live.get(rng.index(live.len())).copied() else {
                break;
            };
            if self.doc(side).parent(node).unwrap() == Some(parent) {
                continue;
            }
            let before = self.snapshot();
            self.trace.push(format!(
                "{step}: remove non-child {} -/-> {}",
                self.label(side, parent),
                self.label(side, node)
            ));
            let error = self.doc_mut(side).remove_child(parent, node).unwrap_err();
            assert!(matches!(error, CoreError::Hierarchy { .. }));
            assert_eq!(self.snapshot(), before, "failed remove must be atomic");
            return OperationKind::BadMembership;
        }
        self.fallback_mutation(rng, step)
    }

    fn validate(&self) {
        for side in [Side::A, Side::B] {
            let snapshot = ForestSnapshot::capture(self.doc(side), self.known(side));
            snapshot.validate().unwrap_or_else(|error| {
                panic!(
                    "external relation oracle failed for {}: {error}",
                    side.name()
                )
            });
            for root in snapshot.nodes.iter().filter(|node| node.parent.is_none()) {
                self.doc(side)
                    .check_invariants(root.id)
                    .unwrap_or_else(|error| {
                        panic!(
                            "Core invariant checker failed for {} root {:?}: {error}",
                            side.name(),
                            root.id
                        )
                    });
            }
            for stale in self.stale(side) {
                assert!(
                    matches!(self.doc(side).get(*stale), Err(CoreError::Arena(_))),
                    "adoption-stale handle {:?} became live again in {}",
                    stale,
                    side.name()
                );
            }
        }
    }
}

fn public_subtree(document: &Document, root: NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        out.push(id);
        let mut children = document.children(id).expect("subtree handles are live");
        children.reverse();
        stack.extend(children);
    }
    out
}

fn panic_text(payload: Box<dyn Any + Send>) -> String {
    match payload.downcast::<String>() {
        Ok(message) => *message,
        Err(payload) => match payload.downcast::<&'static str>() {
            Ok(message) => (*message).to_string(),
            Err(_) => "non-string panic payload".to_string(),
        },
    }
}

fn run_sequence(seed: u64, steps: usize) -> (Vec<String>, BTreeSet<OperationKind>) {
    let mut rng = ReplayRng::new(seed);
    let mut world = World::new();
    let mut covered = BTreeSet::new();
    for step in 0..steps {
        let result = catch_unwind(AssertUnwindSafe(|| {
            let kind = world.step(&mut rng, step);
            world.validate();
            kind
        }));
        match result {
            Ok(kind) => {
                covered.insert(kind);
            }
            Err(payload) => {
                let cause = panic_text(payload);
                panic!(
                    "T18 mutation property failed\nseed: {seed:#018x}\n\
                     shortest failing prefix: {} generated steps\n\
                     replay: run_sequence({seed:#018x}, {})\n\
                     operations:\n{}\n\
                     cause: {cause}",
                    step + 1,
                    step + 1,
                    world.trace.join("\n")
                );
            }
        }
    }
    (world.trace, covered)
}

#[test]
fn fixed_seed_mutation_sequences_are_stable_and_replayable() {
    let mut covered = BTreeSet::new();
    for &seed in FIXED_SEEDS {
        let (trace, kinds) = run_sequence(seed, RANDOM_STEPS);
        covered.extend(kinds);
        if seed == FIXED_SEEDS[0] {
            let (replayed_trace, replayed_kinds) = run_sequence(seed, RANDOM_STEPS);
            assert_eq!(trace, replayed_trace, "same seed must produce same trace");
            assert_eq!(
                covered, replayed_kinds,
                "same seed must exercise the same operation kinds"
            );
        }
    }
    assert_eq!(
        covered,
        OperationKind::ALL.into_iter().collect(),
        "fixed corpus must keep every legal/illegal operation family live"
    );
}

#[test]
fn relationship_oracle_rejects_a_deliberately_faulted_observation() {
    let mut document = Document::new();
    let root = document.create_element("root").unwrap();
    let child = document.create_element("child").unwrap();
    document.append_child(root, child).unwrap();

    let mut snapshot = ForestSnapshot::capture(&document, &[root, child]);
    let child = snapshot
        .nodes
        .iter_mut()
        .find(|node| node.id == child)
        .unwrap();
    child.parent = None;
    assert!(
        snapshot.validate().is_err(),
        "the property oracle must fail when a parent relation is injected incorrectly"
    );
}

#[test]
fn deep_and_wide_trees_stay_iterative_and_bounded() {
    const DEPTH: usize = 1_200;
    const WIDTH: usize = 1_500;

    let mut deep = Document::new();
    let root = deep.create_element("root").unwrap();
    let mut parent = root;
    for _ in 0..DEPTH {
        let child = deep.create_element("n").unwrap();
        deep.append_child(parent, child).unwrap();
        parent = child;
    }
    assert!(deep.is_descendant_of(parent, root).unwrap());
    deep.check_invariants(root).unwrap();

    let mut wide = Document::new();
    let root = wide.create_element("root").unwrap();
    for index in 0..WIDTH {
        let child = if index % 2 == 0 {
            wide.create_text("x").unwrap()
        } else {
            wide.create_element("n").unwrap()
        };
        wide.append_child(root, child).unwrap();
    }
    assert_eq!(wide.children(root).unwrap().len(), WIDTH);
    wide.check_invariants(root).unwrap();
}

#[test]
fn arena_reuse_never_revives_a_stale_generation() {
    const REUSE_CYCLES: usize = 40_000;

    let mut arena = Arena::new();
    let mut live = arena.allocate(18, 0usize);
    let first = live;
    for value in 1..=REUSE_CYCLES {
        assert_eq!(arena.remove(live).unwrap(), value - 1);
        let stale = live;
        live = arena.allocate(18, value);
        assert_ne!(live, stale, "slot reuse must change the generation");
        assert!(matches!(
            arena.get(stale),
            Err(ArenaError::GenerationMismatch { .. })
        ));
        assert_eq!(arena.get(live), Ok(&value));
    }
    assert!(matches!(
        arena.get(first),
        Err(ArenaError::GenerationMismatch { .. })
    ));
    assert_eq!(
        arena.capacity(),
        1,
        "the stress loop must actually reuse a slot"
    );
    assert_eq!(arena.allocated(), (REUSE_CYCLES + 1) as u64);
}

#[test]
fn repeated_cross_document_misuse_is_rejected_without_mutation() {
    const ATTEMPTS: usize = 1_000;

    let mut a = Document::new();
    let mut b = Document::new();
    let a_root = a.create_element("a").unwrap();
    let a_child = a.create_element("child").unwrap();
    let b_root = b.create_element("b").unwrap();
    let b_child = b.create_text("foreign").unwrap();
    a.append_child(a_root, a_child).unwrap();
    b.append_child(b_root, b_child).unwrap();

    for attempt in 0..ATTEMPTS {
        let error = match attempt % 4 {
            0 => a.append_child(a_root, b_child).unwrap_err(),
            1 => a.insert_before(a_root, b_child, a_child).unwrap_err(),
            2 => a.remove_child(a_root, b_child).unwrap_err(),
            _ => a.replace_child(a_root, a_child, b_child).unwrap_err(),
        };
        assert!(matches!(error, CoreError::WrongDocument { .. }));
        assert_eq!(a.children(a_root).unwrap(), vec![a_child]);
        assert_eq!(b.children(b_root).unwrap(), vec![b_child]);
        a.check_invariants(a_root).unwrap();
        b.check_invariants(b_root).unwrap();
    }
}
