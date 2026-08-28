//! Core DOM node data model.
//!
//! Holds the first batch of node types ([`Document`], `DocumentFragment`,
//! `Element`, `Text`, `Comment`) as pure data with no runtime objects and no
//! Bun/JavaScriptCore dependencies. [`Document`] owns its own node arena;
//! nodes are addressed through opaque [`NodeId`](crate::arena::NodeId)
//! handles. Tree relations (T14) are stored on each node but only readable
//! through [`Document`]'s navigation API, and their integrity can be checked
//! with [`Document::check_invariants`]; the unified mutation API (T15/T16)
//! lives in the sibling `mutation` module.

mod document;
mod mutation;
mod node;
mod tree;

pub use document::Document;
pub use node::{Node, NodeData, NodeType};
pub use tree::TreeViolation;
