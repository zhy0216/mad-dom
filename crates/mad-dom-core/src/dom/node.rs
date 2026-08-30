//! Node type enumeration, per-type data storage and tree relations.
//!
//! This module holds the *data* model of a node: its kind, its name, its text,
//! its attribute storage, and the tree relations linking it to its parent,
//! children and siblings (T14). The relation fields are `pub(crate)`: only code
//! inside `mad-dom-core` can read or write them, so the binding layer cannot
//! corrupt the tree directly. Mutation of those fields is deliberately left to
//! the unified mutation API (T15/T16); this milestone only establishes the
//! storage, read-only navigation and an invariant checker.
//!
//! T26 (the HTML parser milestone) extends the model with the two structures
//! the parser must write into the arena: a [`DocumentType`] node holding the
//! doctype payload and the element namespace URI. Element names and namespaces
//! are stored as string-cache atoms (the same atom type html5ever hands the
//! parser), while the *string payload* — attribute values, text, comment and
//! doctype data — stays an owned `String` per ADR-0004 decision 3.

use crate::arena::NodeId;
use html5ever::{LocalName, Namespace};

use super::events::EventRegistration;

/// The WHATWG HTML namespace URI.
pub const HTML_NAMESPACE: &str = "http://www.w3.org/1999/xhtml";
/// The WHATWG SVG namespace URI.
pub const SVG_NAMESPACE: &str = "http://www.w3.org/2000/svg";
/// The WHATWG MathML namespace URI.
pub const MATHML_NAMESPACE: &str = "http://www.w3.org/1998/Math/MathML";

/// The kind of a node, mirroring the WHATWG `Node.nodeType` values for the
/// first batch of node types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NodeType {
    /// A `Document` node.
    Document,
    /// A `DocumentType` node.
    DocumentType,
    /// A `DocumentFragment` node.
    DocumentFragment,
    /// An `Element` node.
    Element,
    /// A `Text` node.
    Text,
    /// A `Comment` node.
    Comment,
    /// A `ProcessingInstruction` node (T33).
    ProcessingInstruction,
    /// A `ShadowRoot` node (T43).
    ShadowRoot,
}

/// The mode of a shadow root (T43): `open` roots are reachable through the
/// host's `shadowRoot` property, `closed` roots are not (`host.shadowRoot`
/// reads `null`, matching the WHATWG and happy-dom).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ShadowRootMode {
    /// An `open` shadow root: `host.shadowRoot` returns it.
    Open,
    /// A `closed` shadow root: `host.shadowRoot` reads `null`.
    Closed,
}

/// Per-type storage for a [`Node`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeData {
    /// A `Document` node. Payload arrives with tree relations (T14).
    Document,
    /// A `DocumentType` node holding the doctype payload produced by the HTML
    /// parser (T26).
    DocumentType {
        /// The doctype's name (e.g. `"html"`).
        name: String,
        /// The public identifier.
        public_id: String,
        /// The system identifier.
        system_id: String,
    },
    /// A `DocumentFragment` node. Payload arrives with tree relations (T14).
    DocumentFragment,
    /// An `Element` node: its name, namespace, attribute list and the HTML5
    /// element flags the parser must record.
    Element {
        /// The element's local name (e.g. `"div"`), stored as a string-cache
        /// atom so the parser's `TreeSink::elem_name` can clone it cheaply.
        name: LocalName,
        /// The element's namespace URI, stored as a string-cache atom.
        namespace: Namespace,
        /// Attribute storage as an ordered list of `(name, value)` pairs.
        /// The full attribute API is added in a later milestone.
        attributes: Vec<(String, String)>,
        /// Whether this is a MathML `annotation-xml` element that is an HTML
        /// integration point (recorded from `ElementFlags` by the parser).
        mathml_annotation_xml_integration_point: bool,
        /// Whether the tokenizer saw duplicate attributes on this element
        /// (recorded from `ElementFlags` by the parser; used by CSP nonce
        /// rules).
        had_duplicate_attributes: bool,
    },
    /// A `Text` node holding its character data.
    Text { data: String },
    /// A `Comment` node holding its character data.
    Comment { data: String },
    /// A `ProcessingInstruction` node (T33) holding its target and data.
    ///
    /// The WHATWG `nodeName` of a `ProcessingInstruction` is its target. Like
    /// `Text`/`Comment`, the data payload is a single mutable string; T33's
    /// `character_data` module lets it participate in the CharacterData-style
    /// mutation surface (happy-dom parity).
    ProcessingInstruction { target: String, data: String },
    /// A `ShadowRoot` node (T43) holding its [`ShadowRootMode`].
    ///
    /// The shadow root is *not* a child of its host: like the template-contents
    /// fragment, it lives in the same arena as every other node and is linked
    /// to its host only through the per-document `shadow_roots` map (the
    /// sibling `shadow_root` module owns that link). Keeping it out of the
    /// host's child list is what makes the query/traversal/serialization
    /// boundary structural — ordinary navigation never pierces into a shadow
    /// tree.
    ShadowRoot { mode: ShadowRootMode },
}

impl NodeData {
    /// Returns the [`NodeType`] for this payload.
    pub fn node_type(&self) -> NodeType {
        match self {
            Self::Document => NodeType::Document,
            Self::DocumentType { .. } => NodeType::DocumentType,
            Self::DocumentFragment => NodeType::DocumentFragment,
            Self::Element { .. } => NodeType::Element,
            Self::Text { .. } => NodeType::Text,
            Self::Comment { .. } => NodeType::Comment,
            Self::ProcessingInstruction { .. } => NodeType::ProcessingInstruction,
            Self::ShadowRoot { .. } => NodeType::ShadowRoot,
        }
    }

    /// Returns the WHATWG `nodeName` for this payload.
    pub fn node_name(&self) -> &str {
        match self {
            Self::Document => "#document",
            Self::DocumentType { name, .. } => name,
            Self::DocumentFragment => "#document-fragment",
            Self::Element { name, .. } => name,
            Self::Text { .. } => "#text",
            Self::Comment { .. } => "#comment",
            Self::ProcessingInstruction { target, .. } => target,
            Self::ShadowRoot { .. } => "#document-fragment",
        }
    }

    /// Returns the element's name, or `None` if this is not an element.
    pub fn element_name(&self) -> Option<&str> {
        match self {
            Self::Element { name, .. } => Some(name.as_ref()),
            _ => None,
        }
    }

    /// Returns the element's namespace URI, or `None` if this is not an
    /// element.
    pub fn element_namespace(&self) -> Option<&str> {
        match self {
            Self::Element { namespace, .. } => Some(namespace.as_ref()),
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

    /// Returns whether this element is a MathML `annotation-xml` HTML
    /// integration point, or `None` if this is not an element.
    pub fn element_mathml_integration_point(&self) -> Option<bool> {
        match self {
            Self::Element {
                mathml_annotation_xml_integration_point,
                ..
            } => Some(*mathml_annotation_xml_integration_point),
            _ => None,
        }
    }

    /// Returns whether the element's token had duplicate attributes, or `None`
    /// if this is not an element.
    pub fn element_had_duplicate_attributes(&self) -> Option<bool> {
        match self {
            Self::Element {
                had_duplicate_attributes,
                ..
            } => Some(*had_duplicate_attributes),
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

    /// Returns the doctype payload `(name, public_id, system_id)` as borrowed
    /// strings, or `None` if this is not a `DocumentType` node.
    pub fn doctype_data(&self) -> Option<(&str, &str, &str)> {
        match self {
            Self::DocumentType {
                name,
                public_id,
                system_id,
            } => Some((name, public_id, system_id)),
            _ => None,
        }
    }

    /// Returns the processing-instruction payload `(target, data)` as borrowed
    /// strings, or `None` if this is not a `ProcessingInstruction` node.
    pub fn pi_data(&self) -> Option<(&str, &str)> {
        match self {
            Self::ProcessingInstruction { target, data } => Some((target, data)),
            _ => None,
        }
    }

    /// Returns the shadow root's [`ShadowRootMode`], or `None` if this is not
    /// a `ShadowRoot` node.
    pub fn shadow_root_mode(&self) -> Option<ShadowRootMode> {
        match self {
            Self::ShadowRoot { mode } => Some(*mode),
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
    /// The registered event listeners on this node (T37).
    ///
    /// Event targets live on every node: `addEventListener` / `removeEventListener`
    /// / `dispatchEvent` are installed on the `Node` prototype by the facade and
    /// the propagation engine in the sibling `events` module reads this list
    /// through the crate-internal accessors. Only code inside `mad-dom-core`
    /// can reach it (the binding never mutates a node payload directly).
    pub(crate) event_listeners: Vec<EventRegistration>,
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
            event_listeners: Vec::new(),
        }
    }

    /// Returns the node's payload.
    pub fn data(&self) -> &NodeData {
        &self.data
    }

    /// Crate-internal: returns mutable access to the node's payload.
    ///
    /// This is the payload seam (T25A): the M4 attribute and `textContent`
    /// modules reach the payload only through the validated entries in
    /// [`Document`](super::Document) — [`Document::element_attributes_mut`] and
    /// [`Document::set_character_data`] — which check document ownership and
    /// node kind before exposing it. Code outside this crate only ever sees the
    /// payload through the read-only [`Node::data`] accessor, so the arena-held
    /// state can never be mutated behind the unified entry's back.
    pub(crate) fn data_mut(&mut self) -> &mut NodeData {
        &mut self.data
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

    /// Returns the node's registered event listeners (T37). Only reachable
    /// inside the crate.
    pub(crate) fn event_listeners(&self) -> &[EventRegistration] {
        &self.event_listeners
    }

    /// Crate-internal: returns mutable access to the node's registered event
    /// listeners (T37).
    ///
    /// Only the propagation engine in the sibling `events` module writes this
    /// list — registration, removal and once-cleanup — never the binding layer.
    pub(crate) fn event_listeners_mut(&mut self) -> &mut Vec<EventRegistration> {
        &mut self.event_listeners
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
