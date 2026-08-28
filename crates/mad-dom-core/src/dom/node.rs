//! Node type enumeration, per-type data storage and tree relations.//!
//! This module holds the *data* model of a node: its kind, its name, its text,
//! its attribute storage, and the tree relations linking it to its parent,
//! children and siblings (T14). The relation fields are `pub(crate)`: only code
//! inside `mad-dom-core` can read or write them, so the binding layer cannot
//! corrupt the tree directly. Mutation of those fields is deliberately left to
//! the unified mutation API (T15/T16); this milestone only establishes the
//! storage, read-only navigation and an invariant checker.

use crate::arena::NodeId;

/// The kind of a node, mirroring the WHATWG `Node.nodeType` values for the
/// first batch of node types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NodeType {
    /// A `Document` node.
    Document,
    /// A `DocumentFragment` node.
    DocumentFragment,
    /// An `Element` node.
    Element,
    /// A `Text` node.
    Text,
    /// A `Comment` node.
    Comment,
}

/// Per-type storage for a [`Node`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeData {
    /// A `Document` node. Payload arrives with tree relations (T14).
    Document,
    /// A `DocumentFragment` node. Payload arrives with tree relations (T14).
    DocumentFragment,
    /// An `Element` node: its qualified name and its attribute list.
    Element {
        /// The element's name (e.g. `"div"`).
        name: String,
        /// Attribute storage as an ordered list of `(name, value)` pairs.
        /// The full attribute API is added in a later milestone.
        attributes: Vec<(String, String)>,
    },
    /// A `Text` node holding its character data.
    Text { data: String },
    /// A `Comment` node holding its character data.
    Comment { data: String },
}

impl NodeData {
    /// Returns the [`NodeType`] for this payload.
    pub fn node_type(&self) -> NodeType {
        match self {
            Self::Document => NodeType::Document,
            Self::DocumentFragment => NodeType::DocumentFragment,
            Self::Element { .. } => NodeType::Element,
            Self::Text { .. } => NodeType::Text,
            Self::Comment { .. } => NodeType::Comment,
        }
    }

    /// Returns the WHATWG `nodeName` for this payload.
    pub fn node_name(&self) -> &str {
        match self {
            Self::Document => "#document",
            Self::DocumentFragment => "#document-fragment",
            Self::Element { name, .. } => name,
            Self::Text { .. } => "#text",
            Self::Comment { .. } => "#comment",
        }
    }

    /// Returns the element's name, or `None` if this is not an element.
    pub fn element_name(&self) -> Option<&str> {
        match self {
            Self::Element { name, .. } => Some(name),
            _ => None,
        }
    }

    /// Returns the element's attribute storage, or `None` if this is not an
    /// element.
    pub fn element_attributes(&self) -> Option<&[(String, String)]> {
        match self {
            Self::Element { attributes, .. } => Some(attributes),
            _ => None,
        }
    }

    /// Returns the text node's data, or `None` if this is not a text node.
    pub fn text_data(&self) -> Option<&str> {
        match self {
            Self::Text { data } => Some(data),
            _ => None,
        }
    }

    /// Returns the comment node's data, or `None` if this is not a comment
    /// node.
    pub fn comment_data(&self) -> Option<&str> {
        match self {
            Self::Comment { data } => Some(data),
            _ => None,
        }
    }
}

/// A single node in a document: its data plus its tree relations.
///
/// Nodes live in the owning [`Document`](super::Document)'s arena and are
/// addressed through opaque [`NodeId`](crate::arena::NodeId) handles. The tree
/// relation fields are `pub(crate)` (T14): code outside this crate can read
/// relations only through the read-only [`Document`](super::Document)
/// navigation API and can never modify them, so the tree cannot be corrupted
/// from the binding layer. Mutation is added by T15/T16.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    data: NodeData,
    /// The node's parent, if any.
    pub(crate) parent: Option<NodeId>,
    /// The node's first child, if any.
    pub(crate) first_child: Option<NodeId>,
    /// The node's last child, if any.
    pub(crate) last_child: Option<NodeId>,
    /// The node's previous sibling, if any.
    pub(crate) previous_sibling: Option<NodeId>,
    /// The node's next sibling, if any.
    pub(crate) next_sibling: Option<NodeId>,
}

impl Node {
    /// Creates a node holding `data`. Only reachable inside the crate.
    pub(crate) fn new(data: NodeData) -> Self {
        Self {
            data,
            parent: None,
            first_child: None,
            last_child: None,
            previous_sibling: None,
            next_sibling: None,
        }
    }

    /// Returns the node's payload.
    pub fn data(&self) -> &NodeData {
        &self.data
    }

    /// Consumes the node and returns its payload, dropping the tree relations.
    ///
    /// Used by the cross-document adoption path
    /// ([`Document::adopt_node`](super::Document::adopt_node)) to move a
    /// node's data out of its source arena and into the target arena.
    pub(crate) fn into_data(self) -> NodeData {
        self.data
    }

    /// Returns the node's [`NodeType`].
    pub fn node_type(&self) -> NodeType {
        self.data.node_type()
    }

    /// Returns the node's WHATWG `nodeName`.
    pub fn node_name(&self) -> &str {
        self.data.node_name()
    }

    /// Returns the node's parent, if any. Only reachable inside the crate.
    pub(crate) fn parent(&self) -> Option<NodeId> {
        self.parent
    }

    /// Returns the node's first child, if any. Only reachable inside the crate.
    pub(crate) fn first_child(&self) -> Option<NodeId> {
        self.first_child
    }

    /// Returns the node's last child, if any. Only reachable inside the crate.
    pub(crate) fn last_child(&self) -> Option<NodeId> {
        self.last_child
    }

    /// Returns the node's previous sibling, if any. Only reachable inside the crate.
    pub(crate) fn previous_sibling(&self) -> Option<NodeId> {
        self.previous_sibling
    }

    /// Returns the node's next sibling, if any. Only reachable inside the crate.
    pub(crate) fn next_sibling(&self) -> Option<NodeId> {
        self.next_sibling
    }
}

#[cfg(test)]
impl Node {
    /// Test-only: appends an attribute to an element node.
    ///
    /// The public creation helpers start elements with an empty attribute
    /// list, so clone/import tests use this to seed attributes and verify that
    /// attribute data is copied by value into clones.
    pub(crate) fn push_attribute_for_test(&mut self, name: &str, value: &str) {
        if let NodeData::Element { attributes, .. } = &mut self.data {
            attributes.push((name.to_string(), value.to_string()));
        }
    }
}
