//! Property tests over random single-document mutation sequences (T18).
//!
//! A deterministic, seed-driven generator produces a stream of `append_child`,
//! `insert_before`, `remove_child` and `replace_child` operations over a pool of
//! live nodes. Every operation's expected outcome (success or failure) is
//! predicted from the documented mutation rules using only the public
//! navigation API, and after *every* step the tree invariants are re-checked
//! with [`Document::check_invariants`]. A fixed seed replays the exact same
//! operation stream, and any failure is reported with the seed and a minimal
//! reproduction (the shortest failing prefix, found by binary search).

mod common;

use common::*;
use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::{Document, NodeType};

/// Node kinds the generator creates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodeKind {
    Element,
    Text,
    Comment,
    Fragment,
}

/// One generated mutation step.
#[derive(Debug, Clone, Copy)]
enum Op {
    Create(NodeKind),
    Append {
        parent: usize,
        child: usize,
    },
    Insert {
        parent: usize,
        child: usize,
        reference: usize,
    },
    Remove {
        parent: usize,
        child: usize,
    },
    Replace {
        parent: usize,
        child: usize,
        node: usize,
    },
}

/// A replayable single-document property-run simulator.
struct Sim {
    doc: Document,
    pool: Vec<NodeId>,
    rng: SplitMix64,
    log: Vec<String>,
}

impl Sim {
    fn new(seed: u64) -> Self {
        Self {
            doc: Document::new(),
            pool: Vec::new(),
            rng: SplitMix64::new(seed),
            log: Vec::new(),
        }
    }

    /// Creates a fresh detached node and returns its new pool index.
    fn create_fresh(&mut self) -> usize {
        let kind = match self.rng.usize_in(4) {
            0 => NodeKind::Element,
            1 => NodeKind::Text,
            2 => NodeKind::Comment,
            _ => NodeKind::Fragment,
        };
        let id = match kind {
            NodeKind::Element => self.doc.create_element("el").unwrap(),
            NodeKind::Text => self.doc.create_text("text").unwrap(),
            NodeKind::Comment => self.doc.create_comment("note").unwrap(),
            NodeKind::Fragment => self.doc.create_document_fragment().unwrap(),
        };
        self.pool.push(id);
        self.pool.len() - 1
    }

    /// Generates the next operation from the current state and RNG stream.
    ///
    /// The stream mixes deliberately-legal operations (fresh detached children,
    /// valid references) with arbitrary index combinations, which are mostly
    /// illegal; both classes are needed to prove the tree survives whatever the
    /// mutation API is asked to do.
    fn generate(&mut self) -> Op {
        if self.pool.is_empty() || self.rng.usize_in(100) < 30 {
            return Op::Create(match self.rng.usize_in(4) {
                0 => NodeKind::Element,
                1 => NodeKind::Text,
                2 => NodeKind::Comment,
                _ => NodeKind::Fragment,
            });
        }
        let parent = self.rng.usize_in(self.pool.len());
        let reference = self.rng.usize_in(self.pool.len());
        let op_kind = self.rng.usize_in(4);
        if self.rng.usize_in(4) == 0 {
            let child = self.create_fresh();
            return match op_kind {
                0 => Op::Append { parent, child },
                1 => Op::Insert {
                    parent,
                    child,
                    reference,
                },
                2 => Op::Remove { parent, child },
                _ => Op::Replace {
                    parent,
                    child: reference,
                    node: child,
                },
            };
        }
        let child = self.rng.usize_in(self.pool.len());
        let node = self.rng.usize_in(self.pool.len());
        match op_kind {
            0 => Op::Append { parent, child },
            1 => Op::Insert {
                parent,
                child,
                reference,
            },
            2 => Op::Remove { parent, child },
            _ => Op::Replace {
                parent,
                child,
                node,
            },
        }
    }

    /// Applies `op`, verifies the outcome matches the prediction, then checks
    /// every invariant over the whole pool.
    fn apply(&mut self, op: Op) -> Result<(), String> {
        match op {
            Op::Create(kind) => {
                let id = match kind {
                    NodeKind::Element => self.doc.create_element("el"),
                    NodeKind::Text => self.doc.create_text("text"),
                    NodeKind::Comment => self.doc.create_comment("note"),
                    NodeKind::Fragment => self.doc.create_document_fragment(),
                }
                .map_err(|e| format!("create failed: {e}"))?;
                self.pool.push(id);
                self.check_all()
            }
            Op::Append { parent, child } => {
                let (p, c) = (self.pool[parent], self.pool[child]);
                let expected = self.predict_append(p, c);
                let ok = self.doc.append_child(p, c).is_ok();
                self.check_outcome(expected, ok, op)
            }
            Op::Insert {
                parent,
                child,
                reference,
            } => {
                let (p, c, r) = (self.pool[parent], self.pool[child], self.pool[reference]);
                let expected = self.predict_insert(p, c, r);
                let ok = self.doc.insert_before(p, c, r).is_ok();
                self.check_outcome(expected, ok, op)
            }
            Op::Remove { parent, child } => {
                let (p, c) = (self.pool[parent], self.pool[child]);
                let expected = self.predict_remove(p, c);
                let ok = self.doc.remove_child(p, c).is_ok();
                self.check_outcome(expected, ok, op)
            }
            Op::Replace {
                parent,
                child,
                node,
            } => {
                let (p, c, n) = (self.pool[parent], self.pool[child], self.pool[node]);
                let expected = self.predict_replace(p, c, n);
                let ok = self.doc.replace_child(p, c, n).is_ok();
                self.check_outcome(expected, ok, op)
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
        check_pool(&self.doc, &self.pool, &[])
    }

    fn is_valid_parent(&self, p: NodeId) -> bool {
        matches!(
            self.doc.node_type(p).unwrap(),
            NodeType::Element | NodeType::DocumentFragment
        )
    }

    /// Predicts whether `append_child(p, c)` succeeds, mirroring the documented
    /// mutation rules in `mutation.rs` (`pre_insert`).
    fn predict_append(&self, p: NodeId, c: NodeId) -> bool {
        if !self.is_valid_parent(p) {
            return false;
        }
        if p == c {
            return false;
        }
        if self.doc.is_descendant_of(p, c).unwrap() {
            return false;
        }
        if self.doc.node_type(c).unwrap() == NodeType::DocumentFragment {
            for &kid in &self.doc.children(c).unwrap() {
                if kid == p || self.doc.is_descendant_of(p, kid).unwrap() {
                    return false;
                }
            }
        }
        true
    }

    /// Predicts whether `insert_before(p, c, r)` succeeds, mirroring `pre_insert`
    /// including its no-op early returns.
    fn predict_insert(&self, p: NodeId, c: NodeId, r: NodeId) -> bool {
        if !self.is_valid_parent(p) {
            return false;
        }
        if p == c {
            return false;
        }
        if self.doc.is_descendant_of(p, c).unwrap() {
            return false;
        }
        if self.doc.node_type(c).unwrap() == NodeType::DocumentFragment {
            for &kid in &self.doc.children(c).unwrap() {
                if kid == p || self.doc.is_descendant_of(p, kid).unwrap() {
                    return false;
                }
            }
        }
        if c == r {
            return true;
        }
        if self.doc.parent(r).unwrap() != Some(p) {
            return false;
        }
        if self.doc.parent(c).unwrap() == Some(p) && self.doc.next_sibling(c).unwrap() == Some(r) {
            return true;
        }
        if self.doc.node_type(c).unwrap() == NodeType::DocumentFragment
            && self.doc.children(c).unwrap().is_empty()
        {
            return true;
        }
        true
    }

    /// Predicts whether `remove_child(p, c)` succeeds.
    fn predict_remove(&self, p: NodeId, c: NodeId) -> bool {
        self.doc.parent(c).unwrap() == Some(p)
    }

    /// Predicts whether `replace_child(p, c, n)` succeeds, mirroring
    /// `validate_replace_child` and its mutation phase.
    fn predict_replace(&self, p: NodeId, c: NodeId, n: NodeId) -> bool {
        if self.doc.parent(c).unwrap() != Some(p) {
            return false;
        }
        if n == p {
            return false;
        }
        if self.doc.is_descendant_of(p, n).unwrap() {
            return false;
        }
        if self.doc.node_type(n).unwrap() == NodeType::DocumentFragment {
            for &kid in &self.doc.children(n).unwrap() {
                if kid == p || self.doc.is_descendant_of(p, kid).unwrap() {
                    return false;
                }
            }
        }
        true
    }
}

/// Runs `steps` generated operations starting from `seed`, returning the full
/// outcome log on success or a [`Failure`] on the first violated expectation.
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
fn fixed_seed_sequences_keep_invariants() {
    for seed in [
        0x1234_5678_9ABC_DEF0,
        0xDEAD_BEEF_CAFE_F00D,
        0x0DDC_0FFE_0BAD_F00D,
        42,
    ] {
        property(seed, 400);
    }
}

#[test]
fn same_seed_replays_identical_outcomes() {
    let seed = 0xABCD_EF01_2345_6789;
    let steps = 300;
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
fn harness_reports_seed_and_minimal_repro_on_failure() {
    // Demonstrates the failure-reporting machinery against an injected,
    // always-failing verifier: the harness must locate the shortest failing
    // prefix and render a report that pins down the seed and the ops.
    let simulate = |len: usize| -> Result<(), String> {
        if len >= 3 {
            Err("injected relation defect detected".to_string())
        } else {
            Ok(())
        }
    };
    assert_eq!(smallest_failing_prefix(20, simulate), Some(3));

    let seed = 0xC0FF_EE01;
    let report = render_repro(
        seed,
        3,
        "injected relation defect detected",
        &[
            "append(a, b)".to_string(),
            "insert(c, d)".to_string(),
            "remove(e)".to_string(),
        ],
    );
    assert!(report.contains(&format!("seed: 0x{seed:016x}")));
    assert!(report.contains("minimal reproduction (3 ops)"));
    assert!(report.contains("injected relation defect detected"));
}
