//! Core DOM node data model.
//!
//! Holds the first batch of node types ([`Document`], `DocumentFragment`,
//! `Element`, `Text`, `Comment`) as pure data with no runtime objects and no
//! Bun/JavaScriptCore dependencies. [`Document`] owns its own node arena;
//! nodes are addressed through opaque [`NodeId`](crate::arena::NodeId)
//! handles. Tree relations (T14) and the unified mutation API (T15/T16) are
//! deliberately out of scope for this module.

mod document;
mod node;

pub use document::Document;
pub use node::{Node, NodeData, NodeType};
