//! Shared helpers for the `mad-dom-core` property and stress suites (T18).
//!
//! Everything here is deliberately dependency-free. The deterministic PRNG is a
//! hand-rolled splitmix64 so that a fixed seed reproduces the exact same
//! operation stream on every platform, toolchain and run — there is no versioned
//! external RNG crate whose algorithm could drift between releases and silently
//! change test outcomes.
//!
//! Each integration test binary compiles this module privately and uses only
//! the subset of helpers it needs, so the module as a whole opts into
//! `allow(dead_code)`.

#![allow(dead_code)]

use mad_dom_core::arena::NodeId;
use mad_dom_core::dom::Document;

/// Deterministic 64-bit PRNG (splitmix64).
///
/// splitmix64 is fully specified: given the same seed it emits the same
/// sequence forever, so a failing run can be replayed exactly by re-running
/// with the printed seed.
#[derive(Debug, Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    /// Creates a fresh generator with the given `seed`.
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    /// Returns the next raw 64-bit output.
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform index in `0..n`. Panics when `n == 0`.
    pub fn usize_in(&mut self, n: usize) -> usize {
        assert!(n > 0, "usize_in called with an empty range");
        (self.next_u64() % n as u64) as usize
    }

    /// Uniform boolean.
    pub fn bool(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }
}

/// Returns every live node in `nodes` whose parent is `None` — i.e. the tree
/// roots over which `check_invariants` must run.
pub fn roots(doc: &Document, nodes: &[NodeId]) -> Vec<NodeId> {
    nodes
        .iter()
        .copied()
        .filter(|n| doc.parent(*n).unwrap_or(None).is_none())
        .collect()
}

/// Verifies the tree invariants over every root reachable from `nodes`,
/// returning a human-readable description of the first violation.
pub fn check_roots(doc: &Document, nodes: &[NodeId]) -> Result<(), String> {
    for n in roots(doc, nodes) {
        doc.check_invariants(n)
            .map_err(|v| format!("node {n}: {v}"))?;
    }
    Ok(())
}

/// Verifies that every handle in `live` still resolves and every handle in
/// `stale` is rejected (never aliasing a live value), then checks the tree
/// invariants over the live roots.
pub fn check_pool(doc: &Document, live: &[NodeId], stale: &[NodeId]) -> Result<(), String> {
    for &n in live {
        if doc.get(n).is_err() {
            return Err(format!("live handle {n} became invalid"));
        }
    }
    for &n in stale {
        match doc.get(n) {
            Ok(_) => return Err(format!("stale handle {n} became readable (aliasing)")),
            Err(mad_dom_core::error::CoreError::WrongDocument { .. }) => {
                return Err(format!("stale handle {n} resolved in the wrong document"));
            }
            Err(_) => {}
        }
    }
    check_roots(doc, live)
}

/// Collects the handles of the whole subtree rooted at `root` in pre-order
/// using only the public navigation API.
pub fn subtree(doc: &Document, root: NodeId) -> Vec<NodeId> {
    let mut out = vec![root];
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        for c in doc.children(n).unwrap() {
            out.push(c);
            stack.push(c);
        }
    }
    out
}

/// A property-test failure: the seed, the failing step, and the operation log
/// leading up to it.
#[derive(Debug, Clone)]
pub struct Failure {
    pub seed: u64,
    pub step: usize,
    pub message: String,
    pub ops: Vec<String>,
}

/// Binary-searches the smallest prefix length in `0..=max_len` whose
/// simulation fails.
///
/// Requires the simulation to be deterministic and monotone: a failing prefix
/// must fail for every longer prefix. This holds for the property simulators
/// here because every step verifies the state immediately, so the first
/// failing step is a fixed prefix boundary. Returns `None` when even the full
/// length passes.
pub fn smallest_failing_prefix(
    max_len: usize,
    mut simulate: impl FnMut(usize) -> Result<(), String>,
) -> Option<usize> {
    if simulate(max_len).is_ok() {
        return None;
    }
    let mut lo = 0;
    let mut hi = max_len;
    while lo + 1 < hi {
        let mid = lo + (hi - lo) / 2;
        if simulate(mid).is_ok() {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Some(hi)
}

/// Renders a seed + minimal-reproduction failure report for a property test.
pub fn render_repro(seed: u64, step: usize, message: &str, ops: &[String]) -> String {
    let mut out = String::new();
    out.push_str("property test failed\n");
    out.push_str(&format!("seed: 0x{seed:016x}\n"));
    out.push_str(&format!("failing step: {step}\n"));
    out.push_str(&format!("violation: {message}\n"));
    out.push_str(&format!("minimal reproduction ({} ops):\n", ops.len()));
    for (i, op) in ops.iter().enumerate() {
        out.push_str(&format!("  {i:>4}: {op}\n"));
    }
    out
}

/// Panics with the rendered [`render_repro`] report.
pub fn repro_panic(seed: u64, step: usize, message: &str, ops: &[String]) -> ! {
    panic!("{}", render_repro(seed, step, message, ops));
}
