//! Opaque generational handle identifying a slot in an [`Arena`](super::Arena).

use std::fmt;

/// Opaque handle to a node slot in an [`Arena`](super::Arena).
///
/// A [`NodeId`] is a triple of the owning document's id, a slot index and a
/// generation counter. The document id makes handles from different documents
/// distinguishable, so a handle is never silently misread as a node in another
/// document (the owning [`Document`](crate::dom::Document) rejects foreign
/// handles). The slot locates the backing entry; the generation detects stale
/// handles after the slot has been removed and reused. All fields are
/// deliberately hidden from code outside `mad-dom-core`: handles are only
/// created and validated inside the crate and are passed across crate
/// boundaries as opaque values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId {
    document_id: u64,
    slot: u32,
    generation: u32,
}

impl NodeId {
    /// Creates a new handle. Only reachable inside the crate.
    pub(crate) fn new(document_id: u64, slot: u32, generation: u32) -> Self {
        Self {
            document_id,
            slot,
            generation,
        }
    }

    /// Returns the owning document's id. Only reachable inside the crate.
    pub(crate) fn document_id(self) -> u64 {
        self.document_id
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
            "NodeId(doc {}, slot {}, generation {})",
            self.document_id, self.slot, self.generation
        )
    }
}
