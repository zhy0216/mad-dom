//! Structured errors returned by [`Arena`](super::Arena) operations.

use super::node_id::NodeId;
use std::error::Error;
use std::fmt;

/// Structured error returned by [`Arena`](super::Arena) operations.
///
/// Note: T13 defines the crate-wide error taxonomy in `src/error.rs`; this
/// type lives inside the `arena` module so the two do not conflict and can be
/// unified later without breaking callers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArenaError {
    /// The handle's slot index is outside the arena's backing storage.
    OutOfBounds { id: NodeId },
    /// The slot is currently empty because its value was removed.
    EmptySlot { id: NodeId },
    /// The slot is occupied but holds a different generation than the handle,
    /// meaning the handle is stale (dangling).
    GenerationMismatch { id: NodeId },
}

impl fmt::Display for ArenaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OutOfBounds { id } => write!(f, "node handle {id} is out of bounds"),
            Self::EmptySlot { id } => write!(f, "slot for node handle {id} is empty"),
            Self::GenerationMismatch { id } => {
                write!(f, "node handle {id} does not match the slot's generation")
            }
        }
    }
}

impl Error for ArenaError {}
