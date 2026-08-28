//! Opaque generational handle identifying a slot in an [`Arena`](super::Arena).

use std::fmt;

/// Opaque handle to a node slot in an [`Arena`](super::Arena).
///
/// A [`NodeId`] is a pair of a slot index and a generation counter. The slot
/// locates the backing entry; the generation detects stale handles after the
/// slot has been removed and reused. Both fields are deliberately hidden from
/// code outside `mad-dom-core`: handles are only created and validated by the
/// arena and are passed across crate boundaries as opaque values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId {
    slot: u32,
    generation: u32,
}

impl NodeId {
    /// Creates a new handle. Only reachable inside the crate.
    pub(crate) fn new(slot: u32, generation: u32) -> Self {
        Self { slot, generation }
    }

    /// Returns the slot index. Only reachable inside the crate.
    pub(crate) fn slot(self) -> u32 {
        self.slot
    }

    /// Returns the generation counter. Only reachable inside the crate.
    pub(crate) fn generation(self) -> u32 {
        self.generation
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "NodeId(slot {}, generation {})",
            self.slot, self.generation
        )
    }
}
