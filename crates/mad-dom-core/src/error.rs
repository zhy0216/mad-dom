//! Crate-wide structured error taxonomy for recoverable input errors.
//!
//! This is the canonical error type of the Core: every public entry point that
//! can reject recoverable input returns a [`Result`] whose error is a
//! [`CoreError`]. A `panic` is reserved for programmer invariants and is never
//! used to report bad input.
//!
//! The taxonomy covers the categories fixed by ADR-0001:
//!
//! * invalid handles ([`CoreError::InvalidHandle`]);
//! * hierarchy violations ([`CoreError::Hierarchy`], produced by mutation);
//! * wrong-document handles ([`CoreError::WrongDocument`]);
//! * invalid characters ([`CoreError::InvalidCharacter`]);
//! * syntax errors ([`CoreError::Syntax`], produced by parsing);
//! * index errors ([`CoreError::IndexOutOfBounds`]);
//! * arena-level handle validation ([`CoreError::Arena`]).
//!
//! The type is runtime-agnostic: it carries only ids, indices and static
//! descriptions, so it can be mapped onto JavaScript exceptions by the binding
//! layer without depending on Bun or JavaScriptCore.

use crate::arena::{ArenaError, NodeId};
use std::error::Error;
use std::fmt;

/// Structured error returned by public `mad-dom-core` entry points.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    /// The handle is structurally invalid (for example a fabricated or
    /// reserved id), independently of arena validation.
    InvalidHandle(NodeId),
    /// The requested operation would violate a tree hierarchy invariant, such
    /// as inserting an ancestor into its own descendant. Produced by mutation
    /// operations in later milestones.
    Hierarchy { message: String },
    /// The handle belongs to a different document than the one it was passed
    /// to. Guarantees that a handle is never silently misread as a node of
    /// another document.
    WrongDocument {
        /// The foreign handle that was rejected.
        id: NodeId,
        /// The document that rejected the handle.
        expected_document: u64,
    },
    /// The input contains a character that is not permitted in the given
    /// context (element name, text data, comment data, ...).
    InvalidCharacter {
        /// What the input is, e.g. `"element name"`.
        what: &'static str,
        /// The offending character, or `None` when the input is empty.
        character: Option<char>,
    },
    /// The input is not syntactically valid, e.g. a malformed selector or
    /// markup fragment. Produced by parsing in later milestones.
    Syntax { message: String },
    /// An index is out of bounds for the value it addresses.
    IndexOutOfBounds { index: usize, len: usize },
    /// An arena-level validation failure (out of bounds, empty slot or
    /// generation mismatch) surfaced through the Core.
    Arena(ArenaError),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidHandle(id) => write!(f, "invalid node handle {id}"),
            Self::Hierarchy { message } => write!(f, "hierarchy error: {message}"),
            Self::WrongDocument {
                id,
                expected_document,
            } => write!(
                f,
                "node handle {id} belongs to another document (expected document {expected_document})"
            ),
            Self::InvalidCharacter { what, character } => match character {
                Some(c) => write!(f, "invalid character {c:?} in {what}"),
                None => write!(f, "invalid {what}"),
            },
            Self::Syntax { message } => write!(f, "syntax error: {message}"),
            Self::IndexOutOfBounds { index, len } => {
                write!(f, "index {index} out of bounds (len {len})")
            }
            Self::Arena(inner) => write!(f, "{inner}"),
        }
    }
}

impl Error for CoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Arena(inner) => Some(inner),
            _ => None,
        }
    }
}

impl From<ArenaError> for CoreError {
    fn from(inner: ArenaError) -> Self {
        Self::Arena(inner)
    }
}
