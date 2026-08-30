//! Core DOM node data model.
//!
//! Holds the first batch of node types ([`Document`], `DocumentFragment`,
//! `Element`, `Text`, `Comment`) as pure data with no runtime objects and no
//! Bun/JavaScriptCore dependencies. [`Document`] owns its own node arena;
//! nodes are addressed through opaque [`NodeId`](crate::arena::NodeId)
//! handles. Tree relations (T14) are stored on each node but only readable
//! through [`Document`]'s navigation API, and their integrity can be checked
//! with [`Document::check_invariants`]; the unified mutation API (T15/T16)
//! lives in the sibling `mutation` module, and the clone/import/adopt family
//! (T17) in the sibling `cross_document` module.
//!
//! The M4 attribute / `textContent` payload seam (T25A) pre-registers the
//! `attributes` and `text_content` modules here as contract placeholders: they
//! define the error and atomicity boundary for element attribute storage,
//! text/comment data and recursive text reads, but implement no public API.
//! Their owners (T25B / T25C) take the files over after this seam archives,
//! building only on the crate-internal payload entries
//! [`Document::element_attributes_mut`] and [`Document::set_character_data`]
//! plus the unified mutation API — they never write back to `node.rs` or
//! `document.rs`.

mod attributes;
mod cross_document;
mod document;
mod mutation;
mod node;
mod text_content;
mod tree;

pub use document::Document;
pub use node::{Node, NodeData, NodeType};
pub use tree::TreeViolation;
