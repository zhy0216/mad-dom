//! Element view: dispatches selector matching onto the arena.
//!
//! [`DomElement`] borrows a [`Document`] and a [`NodeId`] and implements the
//! `selectors` crate's `Element` trait directly against the arena slots — the
//! same "no mirror tree" contract the T05 spike validated. Node / ancestor /
//! sibling matching (`Element.matches`) is built from the read-only navigation
//! API of [`Document`]: parent, previous/next sibling and first element child,
//! all walking the element link chain without allocating a tree.
//!
//! Element names and namespaces are compared against the string-cache atoms
//! ([`LocalName`] / [`Namespace`]) the HTML parser stored on each node (T26),
//! so the selector side never re-parses or duplicates element identity.
//! Attributes live in the element's ordered `(name, value)` list stored as
//! qualified names; [`attr_matches`](Self::attr_matches) splits the qualified
//! name to apply the selector's namespace constraint.

use std::fmt;

use selectors::attr::{AttrSelectorOperation, CaseSensitivity, NamespaceConstraint};
use selectors::matching::ElementSelectorFlags;
use selectors::parser::SelectorImpl;
use selectors::{Element, OpaqueElement};

use crate::arena::NodeId;
use crate::dom::Document;
use crate::dom::NodeData;
use crate::error::CoreError;

use super::parser::{
    DomAttrValue, DomIdent, DomNamespace, DomSelectorImpl, NoPseudoClass, NoPseudoElement,
};

/// Borrowed arena view of one element, the matching subject of a selector.
///
/// `Clone` only copies the document reference and the opaque handle; it never
/// copies node data. Every navigation step re-validates the handle through
/// [`Document`]'s read API, so a stale or foreign handle fails the same way it
/// would for any other Core read.
#[derive(Clone)]
pub struct DomElement<'a> {
    doc: &'a Document,
    id: NodeId,
}

impl<'a> DomElement<'a> {
    /// Creates an element view for `id`, rejecting non-elements with
    /// [`CoreError::Hierarchy`].
    pub fn new(doc: &'a Document, id: NodeId) -> Result<Self, CoreError> {
        match doc.get(id)?.data() {
            NodeData::Element { .. } => Ok(Self { doc, id }),
            _ => Err(CoreError::Hierarchy {
                message: "selector matching requires an Element node".to_string(),
            }),
        }
    }

    /// Returns the underlying element handle.
    pub fn id(&self) -> NodeId {
        self.id
    }

    /// Returns the element payload; the view is only ever built over an
    /// element, so the match is exhaustive.
    fn element(&self) -> &'a NodeData {
        self.doc
            .get(self.id)
            .expect("element view holds a live element")
            .data()
    }

    /// Returns the value of the unprefixed attribute `name`, if present.
    ///
    /// Only the `id`/`class` lookups use this; general attribute matching goes
    /// through [`Element::attr_matches`].
    fn attr(&self, name: &str) -> Option<&'a str> {
        match self.element() {
            NodeData::Element { attributes, .. } => attributes
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, value)| value.as_str()),
            _ => None,
        }
    }

    /// Builds an element view from the first element reached when walking the
    /// sibling chain starting at `start`, skipping non-element nodes.
    fn sibling(&self, mut start: Option<NodeId>) -> Option<Self> {
        while let Some(candidate) = start {
            if matches!(
                self.doc.get(candidate).expect("live sibling").data(),
                NodeData::Element { .. }
            ) {
                return Some(Self {
                    doc: self.doc,
                    id: candidate,
                });
            }
            start = self
                .doc
                .next_sibling(candidate)
                .expect("live sibling has live next sibling");
        }
        None
    }
}

impl fmt::Debug for DomElement<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DomElement").field("id", &self.id).finish()
    }
}

impl<'a> Element for DomElement<'a> {
    type Impl = DomSelectorImpl;

    fn opaque(&self) -> OpaqueElement {
        // Identity anchors to the element's arena slot. The document is only
        // ever read during a match (no mutation, no slot reuse), so the
        // address stays valid for the whole match and equals itself for any
        // two views of the same node.
        OpaqueElement::new(
            self.doc
                .get(self.id)
                .expect("element view holds a live element"),
        )
    }

    fn parent_element(&self) -> Option<Self> {
        let parent = self.doc.parent(self.id).expect("live parent read")?;
        match self.doc.get(parent).expect("live parent node").data() {
            NodeData::Element { .. } => Some(Self {
                doc: self.doc,
                id: parent,
            }),
            _ => None,
        }
    }

    fn parent_node_is_shadow_root(&self) -> bool {
        false
    }

    fn containing_shadow_host(&self) -> Option<Self> {
        None
    }

    fn is_pseudo_element(&self) -> bool {
        false
    }

    fn prev_sibling_element(&self) -> Option<Self> {
        let prev = self
            .doc
            .previous_sibling(self.id)
            .expect("live previous sibling read");
        self.sibling(prev)
    }

    fn next_sibling_element(&self) -> Option<Self> {
        let next = self
            .doc
            .next_sibling(self.id)
            .expect("live next sibling read");
        self.sibling(next)
    }

    fn first_element_child(&self) -> Option<Self> {
        let first = self
            .doc
            .first_child(self.id)
            .expect("live first child read");
        self.sibling(first)
    }

    fn is_html_element_in_html_document(&self) -> bool {
        matches!(
            self.element(),
            NodeData::Element {
                namespace,
                ..
            } if namespace.as_ref() == crate::dom::HTML_NAMESPACE
        )
    }

    fn has_local_name(&self, local_name: &str) -> bool {
        match self.element() {
            NodeData::Element { name, .. } => name.as_ref() == local_name,
            _ => unreachable!("element view holds an element"),
        }
    }

    fn has_namespace(&self, ns: &str) -> bool {
        match self.element() {
            NodeData::Element { namespace, .. } => namespace.as_ref() == ns,
            _ => unreachable!("element view holds an element"),
        }
    }

    fn is_same_type(&self, other: &Self) -> bool {
        match (self.element(), other.element()) {
            (
                NodeData::Element {
                    name: a,
                    namespace: ans,
                    ..
                },
                NodeData::Element {
                    name: b,
                    namespace: bns,
                    ..
                },
            ) => a == b && ans == bns,
            _ => false,
        }
    }

    fn attr_matches(
        &self,
        ns: &NamespaceConstraint<&DomNamespace>,
        local_name: &DomIdent,
        operation: &AttrSelectorOperation<&DomAttrValue>,
    ) -> bool {
        match self.element() {
            NodeData::Element { attributes, .. } => attributes.iter().any(|(name, value)| {
                let (prefix, local) = split_qualified_name(name);
                let namespace_ok = match ns {
                    NamespaceConstraint::Any => true,
                    NamespaceConstraint::Specific(url) => match prefix {
                        // An unprefixed attribute lives in the empty
                        // namespace; a prefixed one must resolve to the
                        // selector's namespace URL through a known prefix.
                        Some(prefix) => {
                            namespace_url_for_prefix(prefix).is_some_and(|known| known == url.0)
                        }
                        None => url.0.is_empty(),
                    },
                };
                namespace_ok
                    && local == local_name.0.as_str()
                    && match operation {
                        AttrSelectorOperation::Exists => true,
                        AttrSelectorOperation::WithValue { .. } => operation.eval_str(value),
                    }
            }),
            _ => false,
        }
    }

    fn match_non_ts_pseudo_class(
        &self,
        pc: &NoPseudoClass,
        _context: &mut selectors::context::MatchingContext<Self::Impl>,
    ) -> bool {
        match *pc {}
    }

    fn match_pseudo_element(
        &self,
        pe: &NoPseudoElement,
        _context: &mut selectors::context::MatchingContext<Self::Impl>,
    ) -> bool {
        match *pe {}
    }

    fn apply_selector_flags(&self, _flags: ElementSelectorFlags) {}

    fn is_link(&self) -> bool {
        false
    }

    fn is_html_slot_element(&self) -> bool {
        false
    }

    fn has_id(&self, id: &DomIdent, case_sensitivity: CaseSensitivity) -> bool {
        self.attr("id")
            .map(|value| case_sensitivity.eq(value.as_bytes(), id.0.as_bytes()))
            .unwrap_or(false)
    }

    fn has_class(&self, name: &DomIdent, case_sensitivity: CaseSensitivity) -> bool {
        self.attr("class")
            .map(|value| {
                value
                    .split_ascii_whitespace()
                    .any(|token| case_sensitivity.eq(token.as_bytes(), name.0.as_bytes()))
            })
            .unwrap_or(false)
    }

    fn has_custom_state(&self, _name: &DomIdent) -> bool {
        false
    }

    fn imported_part(&self, _name: &DomIdent) -> Option<<Self::Impl as SelectorImpl>::Identifier> {
        None
    }

    fn is_part(&self, _name: &DomIdent) -> bool {
        false
    }

    fn is_empty(&self) -> bool {
        self.doc
            .children(self.id)
            .expect("live element has readable children")
            .iter()
            .all(
                |&child| match self.doc.get(child).expect("live child").data() {
                    NodeData::Text { data } => data.is_empty(),
                    NodeData::Element { .. } => false,
                    _ => true,
                },
            )
    }

    fn is_root(&self) -> bool {
        match self.doc.parent(self.id).expect("live parent read") {
            Some(parent) => {
                matches!(
                    self.doc.get(parent).expect("live parent node").data(),
                    NodeData::Document
                )
            }
            None => false,
        }
    }

    fn ignores_nth_child_selectors(&self) -> bool {
        false
    }

    fn add_element_unique_hashes(&self, _filter: &mut selectors::bloom::BloomFilter) -> bool {
        // No ancestor hashes: only the `:has()` filter path calls this and
        // `:has()` is not enabled for this parser.
        false
    }
}

/// Splits a stored qualified attribute name into its (optional) prefix and
/// local part. Unprefixed names have a `None` prefix.
fn split_qualified_name(name: &str) -> (Option<&str>, &str) {
    match name.split_once(':') {
        Some((prefix, local)) => (Some(prefix), local),
        None => (None, name),
    }
}

/// Maps a known attribute-namespace prefix to its URL.
///
/// The HTML parser stores attribute names as their qualified markup name
/// (`prefix:local`), so the namespace URL of a prefixed attribute has to be
/// recovered from the prefix. Only the prefixes that appear in HTML/SVG
/// markup are recognised.
fn namespace_url_for_prefix(prefix: &str) -> Option<&'static str> {
    match prefix {
        "xml" => Some("http://www.w3.org/XML/1998/namespace"),
        "xmlns" => Some("http://www.w3.org/2000/xmlns/"),
        "xlink" => Some("http://www.w3.org/1999/xlink"),
        _ => None,
    }
}
