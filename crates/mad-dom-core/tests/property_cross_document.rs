//! Property tests over random cross-document sequences (T18).
//!
//! Two documents share one deterministic, seed-driven generator that produces
//! local `append`/`insert`/`remove`/`replace` mutations, `clone`/`import`/
//! `adopt` operations, and deliberate cross-document misuse (handles passed to
//! the wrong document, stale handles left behind by adoption). Every step is
//! predicted against the documented rules, both documents' tree invariants are
//! re-checked after every step, and any failure is reported with the seed and a
//! minimal reproduction.

mod common;

use common::*;
use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeType};
use mad_dom_core::error::CoreError;

/// One generated step across the two documents.
#[derive(Debug, Clone, Copy)]
enum Op {
    Create {
        doc: u8,
    },
    Append {
        doc: u8,
        parent: usize,
        child: usize,
    },
    Insert {
        doc: u8,
        parent: usize,
        child: usize,
        reference: usize,
    },
    Remove {
        doc: u8,
        parent: usize,
        child: usize,
    },
    Replace {
        doc: u8,
        parent: usize,
        child: usize,
        node: usize,
    },
    Clone {
        doc: u8,
        node: usize,
        deep: bool,
    },
    Import {
        target: u8,
        source: u8,
        node: usize,
        deep: bool,
    },
    Adopt {
        target: u8,
        source: u8,
        node: usize,
    },
}

/// A replayable two-document property-run simulator.
struct Sim {
    docs: (Document, Document),
    pool: [Vec<NodeId>; 2],
    stale: [Vec<NodeId>; 2],
    rng: SplitMix64,
    log: Vec<String>,
}

impl Sim {
    fn new(seed: u64) -> Self {
        Self {
            docs: (Document::new(), Document::new()),
            pool: [Vec::new(), Vec::new()],
            stale: [Vec::new(), Vec::new()],
            rng: SplitMix64::new(seed),
            log: Vec::new(),
        }
    }

    fn doc(&self, d: u8) -> &Document {
        if d == 0 {
            &self.docs.0
        } else {
            &self.docs.1
        }
    }

    fn doc_mut(&mut self, d: u8) -> &mut Document {
        if d == 0 {
            &mut self.docs.0
        } else {
            &mut self.docs.1
        }
    }

    /// Splits the two documents into `(first, second)` mutable borrows.
    ///
    /// Only ever called with distinct document ids (source != target), so the
    /// two borrows are disjoint.
    fn split_docs(&mut self, first: u8, _second: u8) -> (&mut Document, &mut Document) {
        let (a, b) = &mut self.docs;
        if first == 0 {
            (a, b)
        } else {
            (b, a)
        }
    }

    fn pool_len(&self) -> usize {
        self.pool[0].len() + self.pool[1].len()
    }

    fn resolve(&self, idx: usize) -> (u8, NodeId) {
        let pa = self.pool[0].len();
        if idx < pa {
            (0, self.pool[0][idx])
        } else {
            (1, self.pool[1][idx - pa])
        }
    }

    fn create_in(&mut self, d: u8) -> NodeId {
        let kind = self.rng.usize_in(4);
        match kind {
            0 => self.doc_mut(d).create_element("el").unwrap(),
            1 => self.doc_mut(d).create_text("text").unwrap(),
            2 => self.doc_mut(d).create_comment("note").unwrap(),
            _ => self.doc_mut(d).create_document_fragment().unwrap(),
        }
    }

    /// Moves handles freed by adoption out of the source pool into the stale
    /// set, so they can no longer be used as live handles.
    fn move_to_stale(&mut self, doc: u8, freed: &[NodeId]) {
        self.pool[doc as usize].retain(|n| !freed.contains(n));
        self.stale[doc as usize].extend_from_slice(freed);
    }

    fn generate(&mut self) -> Op {
        if self.pool_len() == 0 {
            return Op::Create {
                doc: self.rng.bool() as u8,
            };
        }
        let doc = self.rng.bool() as u8;
        let roll = self.rng.usize_in(100);
        if roll < 12 {
            return Op::Create { doc };
        }
        if roll < 22 {
            return Op::Clone {
                doc,
                node: self.rng.usize_in(self.pool_len()),
                deep: self.rng.bool(),
            };
        }
        if roll < 40 {
            return Op::Import {
                target: doc,
                source: 1 - doc,
                node: self.rng.usize_in(self.pool_len()),
                deep: self.rng.bool(),
            };
        }
        if roll < 52 {
            return Op::Adopt {
                target: doc,
                source: 1 - doc,
                node: self.rng.usize_in(self.pool_len()),
            };
        }
        let parent = self.rng.usize_in(self.pool_len());
        let child = self.rng.usize_in(self.pool_len());
        let reference = self.rng.usize_in(self.pool_len());
        let node = self.rng.usize_in(self.pool_len());
        match self.rng.usize_in(4) {
            0 => Op::Append { doc, parent, child },
            1 => Op::Insert {
                doc,
                parent,
                child,
                reference,
            },
            2 => Op::Remove { doc, parent, child },
            _ => Op::Replace {
                doc,
                parent,
                child,
                node,
            },
        }
    }

    fn apply(&mut self, op: Op) -> Result<(), String> {
        match op {
            Op::Create { doc } => {
                let id = self.create_in(doc);
                self.pool[doc as usize].push(id);
                self.check_all()
            }
            Op::Append { doc, parent, child } => {
                let (_, p) = self.resolve(parent);
                let (_, c) = self.resolve(child);
                let expected = self.predict_append(doc, p, c);
                let ok = self.doc_mut(doc).append_child(p, c).is_ok();
                self.check_outcome(expected, ok, op)
            }
            Op::Insert {
                doc,
                parent,
                child,
                reference,
            } => {
                let (_, p) = self.resolve(parent);
                let (_, c) = self.resolve(child);
                let (_, r) = self.resolve(reference);
                let expected = self.predict_insert(doc, p, c, r);
                let ok = self.doc_mut(doc).insert_before(p, c, r).is_ok();
                self.check_outcome(expected, ok, op)
            }
            Op::Remove { doc, parent, child } => {
                let (_, p) = self.resolve(parent);
                let (_, c) = self.resolve(child);
                let expected = self.predict_remove(doc, p, c);
                let ok = self.doc_mut(doc).remove_child(p, c).is_ok();
                self.check_outcome(expected, ok, op)
            }
            Op::Replace {
                doc,
                parent,
                child,
                node,
            } => {
                let (_, p) = self.resolve(parent);
                let (_, c) = self.resolve(child);
                let (_, n) = self.resolve(node);
                let expected = self.predict_replace(doc, p, c, n);
                let ok = self.doc_mut(doc).replace_child(p, c, n).is_ok();
                self.check_outcome(expected, ok, op)
            }
            Op::Clone { doc, node, deep } => {
                let (_, h) = self.resolve(node);
                let expected = self.doc(doc).get(h).is_ok();
                let outcome = self.doc_mut(doc).clone_node(h, deep);
                self.finish_allocating_op(doc, expected, outcome, op)
            }
            Op::Import {
                target,
                source,
                node,
                deep,
            } => {
                let (_, h) = self.resolve(node);
                let expected = self.doc(source).get(h).is_ok();
                let outcome = {
                    let (src, tgt) = self.split_docs(source, target);
                    tgt.import_node(src, h, deep)
                };
                self.finish_allocating_op(target, expected, outcome, op)
            }
            Op::Adopt {
                target,
                source,
                node,
            } => {
                let (_, h) = self.resolve(node);
                let expected = self.doc(source).get(h).is_ok();
                // Snapshot the source subtree before adoption so every handle
                // freed by the migration can be moved into the stale set.
                let freed = if expected {
                    common::subtree(self.doc(source), h)
                } else {
                    Vec::new()
                };
                let outcome = {
                    let (src, tgt) = self.split_docs(source, target);
                    tgt.adopt_node(src, h)
                };
                match outcome {
                    Ok(root) => {
                        if !expected {
                            return Err(format!("expected an error but {op:?} succeeded"));
                        }
                        self.move_to_stale(source, &freed);
                        let fresh = common::subtree(self.doc(target), root);
                        self.pool[target as usize].extend(fresh);
                        self.check_all()
                    }
                    Err(e) => {
                        if expected {
                            return Err(format!("expected Ok but {op:?} failed: {e}"));
                        }
                        self.check_all()
                    }
                }
            }
        }
    }

    /// Finishes a clone/import: on success the freshly allocated subtree is
    /// added to the target pool; on failure (wrong document or stale handle)
    /// nothing may have changed.
    fn finish_allocating_op(
        &mut self,
        doc: u8,
        expected: bool,
        outcome: Result<NodeId, CoreError>,
        op: Op,
    ) -> Result<(), String> {
        match outcome {
            Ok(root) => {
                if !expected {
                    return Err(format!("expected an error but {op:?} succeeded"));
                }
                let fresh = common::subtree(self.doc(doc), root);
                self.pool[doc as usize].extend(fresh);
                self.check_all()
            }
            Err(e) => {
                if expected {
                    return Err(format!("expected Ok but {op:?} failed: {e}"));
                }
                self.check_all()
            }
        }
    }

    fn check_outcome(&self, expected_ok: bool, actual_ok: bool, op: Op) -> Result<(), String> {
        if expected_ok != actual_ok {
            let what = if expected_ok {
                "expected Ok but got an error"
            } else {
                "expected an error but got Ok"
            };
            return Err(format!("{what} for {op:?}"));
        }
        self.check_all()
    }

    fn check_all(&self) -> Result<(), String> {
        check_pool(self.doc(0), &self.pool[0], &self.stale[0])?;
        check_pool(self.doc(1), &self.pool[1], &self.stale[1])?;
        Ok(())
    }

    // --- outcome predictors (mirror the documented mutation rules) ---

    fn owned_live(&self, d: u8, h: NodeId) -> bool {
        self.doc(d).get(h).is_ok()
    }

    fn is_valid_parent(&self, d: u8, p: NodeId) -> bool {
        matches!(
            self.doc(d).node_type(p).unwrap(),
            NodeType::Element | NodeType::DocumentFragment
        )
    }

    /// Whether inserting/attaching `fragment` under `p` would create a cycle
    /// through one of the fragment's children.
    fn fragment_would_cycle(&self, d: u8, p: NodeId, fragment: NodeId) -> bool {
        for &kid in &self.doc(d).children(fragment).unwrap() {
            if kid == p || self.doc(d).is_descendant_of(p, kid).unwrap() {
                return true;
            }
        }
        false
    }

    fn predict_append(&self, d: u8, p: NodeId, c: NodeId) -> bool {
        if !self.owned_live(d, p) || !self.owned_live(d, c) {
            return false;
        }
        if !self.is_valid_parent(d, p) {
            return false;
        }
        if p == c {
            return false;
        }
        if self.doc(d).is_descendant_of(p, c).unwrap() {
            return false;
        }
        if self.doc(d).node_type(c).unwrap() == NodeType::DocumentFragment
            && self.fragment_would_cycle(d, p, c)
        {
            return false;
        }
        true
    }

    fn predict_insert(&self, d: u8, p: NodeId, c: NodeId, r: NodeId) -> bool {
        if !self.owned_live(d, p) || !self.owned_live(d, c) {
            return false;
        }
        if !self.is_valid_parent(d, p) {
            return false;
        }
        if p == c {
            return false;
        }
        if self.doc(d).is_descendant_of(p, c).unwrap() {
            return false;
        }
        if self.doc(d).node_type(c).unwrap() == NodeType::DocumentFragment
            && self.fragment_would_cycle(d, p, c)
        {
            return false;
        }
        if c == r {
            return true;
        }
        if !self.owned_live(d, r) {
            return false;
        }
        if self.doc(d).parent(r).unwrap() != Some(p) {
            return false;
        }
        if self.doc(d).parent(c).unwrap() == Some(p)
            && self.doc(d).next_sibling(c).unwrap() == Some(r)
        {
            return true;
        }
        if self.doc(d).node_type(c).unwrap() == NodeType::DocumentFragment
            && self.doc(d).children(c).unwrap().is_empty()
        {
            return true;
        }
        true
    }

    fn predict_remove(&self, d: u8, p: NodeId, c: NodeId) -> bool {
        if !self.owned_live(d, p) || !self.owned_live(d, c) {
            return false;
        }
        self.doc(d).parent(c).unwrap() == Some(p)
    }

    fn predict_replace(&self, d: u8, p: NodeId, c: NodeId, n: NodeId) -> bool {
        if !self.owned_live(d, p) || !self.owned_live(d, c) || !self.owned_live(d, n) {
            return false;
        }
        if self.doc(d).parent(c).unwrap() != Some(p) {
            return false;
        }
        if n == p {
            return false;
        }
        if self.doc(d).is_descendant_of(p, n).unwrap() {
            return false;
        }
        if self.doc(d).node_type(n).unwrap() == NodeType::DocumentFragment
            && self.fragment_would_cycle(d, p, n)
        {
            return false;
        }
        true
    }
}

/// Runs `steps` generated operations starting from `seed`.
fn run_property(seed: u64, steps: usize) -> Result<Vec<String>, Failure> {
    let mut sim = Sim::new(seed);
    for step in 0..steps {
        let op = sim.generate();
        sim.log.push(format!("{op:?}"));
        sim.apply(op).map_err(|message| Failure {
            seed,
            step,
            message,
            ops: sim.log.clone(),
        })?;
    }
    Ok(sim.log)
}

/// Deterministic replay of the first `len` operations, used by the minimizer.
fn simulate(seed: u64, len: usize) -> Result<(), String> {
    let mut sim = Sim::new(seed);
    for _ in 0..len {
        let op = sim.generate();
        sim.apply(op)?;
    }
    Ok(())
}

/// Operation descriptions for the first `len` operations of `seed`.
fn describe(seed: u64, len: usize) -> Vec<String> {
    let mut sim = Sim::new(seed);
    (0..len)
        .map(|_| {
            let op = sim.generate();
            format!("{op:?}")
        })
        .collect()
}

/// Runs a fixed-seed property test; on failure panics with seed + minimal
/// reproduction.
fn property(seed: u64, steps: usize) {
    if let Err(f) = run_property(seed, steps) {
        let minimal =
            smallest_failing_prefix(steps, |len| simulate(seed, len)).unwrap_or(f.step + 1);
        repro_panic(seed, f.step, &f.message, &describe(seed, minimal));
    }
}

#[test]
fn fixed_seed_cross_document_sequences_keep_invariants() {
    for seed in [
        0xABCD_EF01_2345_6789,
        0xFEED_FACE_00DD_F00D,
        99,
        0x0B5E_C0DE,
    ] {
        property(seed, 300);
    }
}

#[test]
fn same_seed_cross_document_replays_identically() {
    let seed = 0x0102_0304_0506_0708;
    let steps = 200;
    let first = run_property(seed, steps).unwrap();
    let second = run_property(seed, steps).unwrap();
    assert_eq!(first, second, "a fixed seed must replay deterministically");
    let other = run_property(seed ^ 1, steps).unwrap();
    assert_ne!(
        first, other,
        "different seeds should exercise different streams"
    );
}

#[test]
fn adopted_handle_generation_defect_is_detected() {
    // A deterministic reproduction of the generation-defect class the property
    // suite guards against at every step: adopting a node frees its source
    // slot, a fresh source allocation reuses that slot with a bumped
    // generation, and the old handle must be rejected — never aliasing the new
    // node.
    let mut source = Document::new();
    let mut target = Document::new();
    for i in 0..256u64 {
        let old = source.create_element("old").unwrap();
        let migrated = target.adopt_node(&mut source, old).unwrap();
        assert_eq!(target.node_name(migrated).unwrap(), "old");
        let fresh = source.create_element("fresh").unwrap();
        assert!(
            matches!(source.get(old), Err(CoreError::Arena(_))),
            "iteration {i}: old handle aliased the reused slot"
        );
        assert_eq!(source.node_name(fresh).unwrap(), "fresh");
        assert!(
            source.node_name(old).is_err(),
            "iteration {i}: old handle still readable"
        );
    }
}
