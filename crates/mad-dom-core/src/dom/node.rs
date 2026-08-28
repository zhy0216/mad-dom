//! Node type enumeration and per-type data storage.
//!
//! This module holds the *data* model only: the kind of a node, its name, its
//! text and its attribute storage. It deliberately contains no runtime
//! objects, no tree relations and no mutation methods — those arrive with tree
//! navigation (T14) and the unified mutation API (T15/T16).

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

/// A single node in a document: a wrapper around [`NodeData`].
///
/// Nodes live in the owning [`Document`](super::Document)'s arena and are
/// addressed through opaque [`NodeId`](crate::arena::NodeId) handles. This
/// struct carries no tree relation fields yet (T14) and no mutation methods
/// (T15/T16).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    data: NodeData,
}

impl Node {
    /// Creates a node holding `data`. Only reachable inside the crate.
    pub(crate) fn new(data: NodeData) -> Self {
        Self { data }
    }

    /// Returns the node's payload.
    pub fn data(&self) -> &NodeData {
        &self.data
    }

    /// Returns the node's [`NodeType`].
    pub fn node_type(&self) -> NodeType {
        self.data.node_type()
    }

    /// Returns the node's WHATWG `nodeName`.
    pub fn node_name(&self) -> &str {
        self.data.node_name()
    }
}
