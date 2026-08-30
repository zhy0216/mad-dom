//! The [`Document`] type: sole owner of a per-document node arena.
//!
//! Every [`Document`] creates its own [`Arena`](crate::arena::Arena) and a
//! unique document id drawn from a global counter. Handles allocated into the
//! arena carry that document id, so a handle obtained from one document can be
//! recognised — and rejected — by another document instead of being silently
//! misread as one of its own nodes.
//!
//! This module also hosts the read-only tree navigation API (T14): parent,
//! first/last child, previous/next sibling, a `children` helper and descendant
//! checks. Every read verifies same-document ownership first, so foreign
//! handles fail with [`CoreError::WrongDocument`]. Writing the tree relations
//! is the job of the unified mutation API (T15/T16) in the sibling `mutation`
//! module; this module only exposes the crate-internal [`Document::node_mut`]
//! accessor that mutation and tests use.
//!
//! The M4 attribute / `textContent` payload seam (T25A) also lives here: the
//! crate-internal [`Document::element_attributes_mut`] and
//! [`Document::set_character_data`] entries are the *only* way to mutate an
//! element's ordered attribute storage or a text/comment node's character
//! data, so the future `attributes` / `text_content` modules (owned by T25B /
//! T25C) never need to reach into the arena or the raw [`Node`] fields.

use crate::arena::{Arena, NodeId};
use crate::error::CoreError;
use crate::selectors::live::QueryIndex;

use super::node::{Node, NodeData, NodeType, HTML_NAMESPACE};

use html5ever::{LocalName, Namespace};

use std::sync::atomic::{AtomicU64, Ordering};

/// Global counter assigning each [`Document`] a unique id.
static NEXT_DOCUMENT_ID: AtomicU64 = AtomicU64::new(0);

/// A document that owns its own node arena.
///
/// Nodes are created through the `create_*` helpers, which allocate into the
/// arena and return an opaque [`NodeId`]. Read access validates that the
/// handle belongs to this document first, so foreign handles fail with
/// [`CoreError::WrongDocument`] rather than aliasing a node in this document.
///
/// The `query_index` field holds the T32 optional id/class/tag query index
/// (`selectors/live.rs`). It is a pure cache of the arena, off by default,
/// and is only ever written through the mutation/attribute maintenance hooks
/// in that module; the arena stays the single authoritative tree state.
pub struct Document {
    id: u64,
    arena: Arena<Node>,
    /// The `Document`-kind node that is the root of this document's tree,
    /// allocated lazily on first access (T29). The HTML parser (T26/T27) and
    /// the JS-facing document-structure API use it as the anchor whose children
    /// are the doctype (if any) and the `<html>` element.
    document_root_id: Option<NodeId>,
    /// The T32 optional id/class/tag query index (off by default).
    pub(crate) query_index: QueryIndex,
}

impl Document {
    /// Creates an empty document with a fresh arena and a unique document id.
    pub fn new() -> Self {
        Self {
            id: NEXT_DOCUMENT_ID.fetch_add(1, Ordering::Relaxed),
            arena: Arena::new(),
            document_root_id: None,
            query_index: QueryIndex::default(),
        }
    }

    /// Returns the `Document`-kind node at the top of this document's tree,
    /// allocating it into the arena on first use.
    ///
    /// Every document can have at most one `Document` root; the id is cached on
    /// the [`Document`] so the HTML parser and the T29 document-structure API
    /// (`documentElement` / `head` / `body` / `load_html`) agree on the anchor
    /// without re-deriving it. Creating a fresh document leaves the arena empty
    /// until the root is requested.
    pub fn document_root(&mut self) -> NodeId {
        if let Some(root) = self.document_root_id {
            return root;
        }
        let root = self.allocate_node(NodeData::Document);
        self.document_root_id = Some(root);
        root
    }

    /// Returns the cached `Document` root id, or `None` before it has been
    /// allocated. Crate-internal read used by the T29 document-structure API to
    /// navigate without allocating.
    pub(crate) fn cached_document_root(&self) -> Option<NodeId> {
        self.document_root_id
    }

    /// Returns the document's doctype node, if any.
    ///
    /// A pure read: the `DocumentType` child (if any) of the cached document
    /// root. When the document root has not been materialized yet (a fresh
    /// document that never parsed or accessed a structure accessor), no
    /// allocation happens and `None` is returned — mirroring the WHATWG
    /// `document.doctype` on an empty document.
    pub fn doctype(&self) -> Result<Option<NodeId>, CoreError> {
        let Some(root) = self.cached_document_root() else {
            return Ok(None);
        };
        let mut cur = self.get(root)?.first_child();
        while let Some(child) = cur {
            if self.get(child)?.node_type() == NodeType::DocumentType {
                return Ok(Some(child));
            }
            cur = self.get(child)?.next_sibling();
        }
        Ok(None)
    }

    /// Returns this document's unique id.
    pub fn id(&self) -> u64 {
        self.id
    }

    /// Creates an element with `name` and returns its handle.
    ///
    /// Errors with [`CoreError::InvalidCharacter`] when `name` is not a valid
    /// element name (a WHATWG-style "Name": it must not be empty and every
    /// character must be a letter, digit, `-`, `.`, `_`, `:`, or a non-ASCII
    /// character, with the first character not being a digit).
    pub fn create_element(&mut self, name: &str) -> Result<NodeId, CoreError> {
        validate_element_name(name)?;
        Ok(self.arena.allocate(
            self.id,
            Node::new(NodeData::Element {
                name: LocalName::from(name.to_string()),
                namespace: Namespace::from(HTML_NAMESPACE),
                attributes: Vec::new(),
                mathml_annotation_xml_integration_point: false,
                had_duplicate_attributes: false,
            }),
        ))
    }

    /// Creates a text node with `data` and returns its handle.
    ///
    /// Errors with [`CoreError::InvalidCharacter`] when `data` contains a NUL
    /// character, which is not a well-formed text-data character.
    pub fn create_text(&mut self, data: &str) -> Result<NodeId, CoreError> {
        validate_text_data(data, "text data")?;
        Ok(self.arena.allocate(
            self.id,
            Node::new(NodeData::Text {
                data: data.to_string(),
            }),
        ))
    }

    /// Creates a comment node with `data` and returns its handle.
    ///
    /// See [`Document::create_text`] for the error condition.
    pub fn create_comment(&mut self, data: &str) -> Result<NodeId, CoreError> {
        validate_text_data(data, "comment data")?;
        Ok(self.arena.allocate(
            self.id,
            Node::new(NodeData::Comment {
                data: data.to_string(),
            }),
        ))
    }

    /// Creates a document fragment and returns its handle.
    pub fn create_document_fragment(&mut self) -> Result<NodeId, CoreError> {
        Ok(self
            .arena
            .allocate(self.id, Node::new(NodeData::DocumentFragment)))
    }

    /// Creates a `ProcessingInstruction` node with `target` and `data` and
    /// returns its handle.
    ///
    /// Errors with [`CoreError::InvalidCharacter`] when `target` is not a valid
    /// WHATWG-style "Name", when `data` contains the `?>` closing sequence, or
    /// when `data` contains a NUL character (the crate text-data
    /// well-formedness rule, [`validate_text_data`]).
    pub fn create_processing_instruction(
        &mut self,
        target: &str,
        data: &str,
    ) -> Result<NodeId, CoreError> {
        validate_name(target, "processing instruction target")?;
        if data.contains("?>") {
            return Err(CoreError::InvalidCharacter {
                what: "processing instruction data",
                character: Some('?'),
            });
        }
        validate_text_data(data, "processing instruction data")?;
        Ok(self.arena.allocate(
            self.id,
            Node::new(NodeData::ProcessingInstruction {
                target: target.to_string(),
                data: data.to_string(),
            }),
        ))
    }

    /// Returns a shared reference to the node for `id`.
    ///
    /// Errors with [`CoreError::WrongDocument`] when `id` belongs to another
    /// document, and with [`CoreError::Arena`] when the handle is stale or
    /// invalid for this document's arena.
    pub fn get(&self, id: NodeId) -> Result<&Node, CoreError> {
        self.expect_same_document(id)?;
        self.arena.get(id).map_err(CoreError::from)
    }

    /// Returns the [`NodeType`] of the node for `id`.
    ///
    /// See [`Document::get`] for the error conditions.
    pub fn node_type(&self, id: NodeId) -> Result<NodeType, CoreError> {
        Ok(self.get(id)?.node_type())
    }

    /// Returns the WHATWG `nodeName` of the node for `id`.
    ///
    /// See [`Document::get`] for the error conditions.
    pub fn node_name(&self, id: NodeId) -> Result<&str, CoreError> {
        Ok(self.get(id)?.node_name())
    }

    /// Returns the parent of the node for `id`, if any.
    ///
    /// Errors with [`CoreError::WrongDocument`] when `id` belongs to another
    /// document, and with [`CoreError::Arena`] when the handle is stale or
    /// invalid. This is a pure read; it never modifies the tree.
    pub fn parent(&self, id: NodeId) -> Result<Option<NodeId>, CoreError> {
        Ok(self.get(id)?.parent())
    }

    /// Returns the first child of the node for `id`, if any.
    ///
    /// See [`Document::parent`] for the error conditions.
    pub fn first_child(&self, id: NodeId) -> Result<Option<NodeId>, CoreError> {
        Ok(self.get(id)?.first_child())
    }

    /// Returns the last child of the node for `id`, if any.
    ///
    /// See [`Document::parent`] for the error conditions.
    pub fn last_child(&self, id: NodeId) -> Result<Option<NodeId>, CoreError> {
        Ok(self.get(id)?.last_child())
    }

    /// Returns the previous sibling of the node for `id`, if any.
    ///
    /// See [`Document::parent`] for the error conditions.
    pub fn previous_sibling(&self, id: NodeId) -> Result<Option<NodeId>, CoreError> {
        Ok(self.get(id)?.previous_sibling())
    }

    /// Returns the next sibling of the node for `id`, if any.
    ///
    /// See [`Document::parent`] for the error conditions.
    pub fn next_sibling(&self, id: NodeId) -> Result<Option<NodeId>, CoreError> {
        Ok(self.get(id)?.next_sibling())
    }

    /// Returns the child handles of the node for `id`, in document order.
    ///
    /// This is a read-only helper that walks the `first_child`/`next_sibling`
    /// chain. See [`Document::parent`] for the error conditions. Callers must
    /// pass a node whose tree satisfies the invariants enforced by the mutation
    /// API and verified by [`Document::check_invariants`]; this milestone
    /// exposes no way for external code to corrupt those relations.
    pub fn children(&self, id: NodeId) -> Result<Vec<NodeId>, CoreError> {
        let node = self.get(id)?;
        let mut out = Vec::new();
        let mut cur = node.first_child();
        while let Some(child) = cur {
            out.push(child);
            cur = self.get(child)?.next_sibling();
        }
        Ok(out)
    }

    /// Returns whether `node` is a proper descendant of `ancestor`.
    ///
    /// A node is never considered a descendant of itself. Walks up the parent
    /// chain from `node`, so it terminates even in the presence of a corrupted
    /// (cyclic) tree by capping the walk at the number of live nodes. Errors
    /// with [`CoreError::WrongDocument`] when either handle belongs to another
    /// document, and with [`CoreError::Arena`] when a handle is stale.
    pub fn is_descendant_of(&self, node: NodeId, ancestor: NodeId) -> Result<bool, CoreError> {
        self.get(node)?;
        self.get(ancestor)?;
        if node == ancestor {
            return Ok(false);
        }
        let mut cur = node;
        // A parent chain in a valid tree has at most `len - 1` edges; capping
        // the walk guarantees termination on corrupted input instead of looping.
        for _ in 0..=self.arena.len() {
            match self.get(cur)?.parent() {
                None => return Ok(false),
                Some(p) if p == ancestor => return Ok(true),
                Some(p) => cur = p,
            }
        }
        Ok(false)
    }

    /// Rejects handles that do not belong to this document.
    fn expect_same_document(&self, id: NodeId) -> Result<(), CoreError> {
        if id.document_id() == self.id {
            Ok(())
        } else {
            Err(CoreError::WrongDocument {
                id,
                expected_document: self.id,
            })
        }
    }

    /// Crate-internal: returns a mutable reference to the node for `id`.
    ///
    /// Only code inside `mad-dom-core` can reach this, so the tree relation
    /// fields stay write-only outside the crate. The unified mutation API
    /// (T15) uses it to relink relations atomically; in-crate tests use it to
    /// build trees and inject deliberate corruption for the invariant checker.
    pub(crate) fn node_mut(&mut self, id: NodeId) -> Result<&mut Node, CoreError> {
        self.expect_same_document(id)?;
        self.arena.get_mut(id).map_err(CoreError::from)
    }

    /// Crate-internal: allocates a fresh node carrying `data` into this
    /// document's arena.
    ///
    /// Used by the clone/import/adopt operations (T17), which hand every new
    /// node a brand-new [`NodeId`] from the target document's arena instead of
    /// reusing a handle from another document.
    pub(crate) fn allocate_node(&mut self, data: NodeData) -> NodeId {
        self.arena.allocate(self.id, Node::new(data))
    }

    /// Crate-internal: removes the live node for `id` from this document's
    /// arena, freeing its slot.
    ///
    /// Used by adoption so a migrated node's old handle becomes stale and can
    /// never be reused to reach the node again.
    pub(crate) fn remove_node(&mut self, id: NodeId) -> Result<Node, CoreError> {
        self.expect_same_document(id)?;
        self.arena.remove(id).map_err(CoreError::from)
    }

    /// Crate-internal: number of live nodes in the arena.
    ///
    /// Used by the debug-only invariant verification to cap the parent-chain
    /// walk so a (buggy) cyclic tree cannot hang the check.
    pub(crate) fn live_node_count(&self) -> usize {
        self.arena.len()
    }

    /// Crate-internal: returns the ordered attribute storage of the element for
    /// `id`, validated for document ownership and node kind.
    ///
    /// This is the attribute-payload half of the Core seam (T25A). The M4
    /// attribute API (`attributes` module, owned by T25B) reaches the ordered
    /// `(name, value)` list *only* through this entry — never through the arena
    /// or the raw [`Node`] fields. The returned reference is live into the
    /// node's arena slot (no copy of the DOM state is made), so any mutation is
    /// immediately visible to the public readers. A failed call leaves the
    /// storage untouched.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    /// * [`CoreError::Hierarchy`] when the node for `id` is not an `Element`.
    ///
    /// Dormant by design: T25B consumes this entry after T25A archives, so the
    /// crate does not reference it yet.
    #[allow(dead_code)]
    pub(crate) fn element_attributes_mut(
        &mut self,
        id: NodeId,
    ) -> Result<&mut Vec<(String, String)>, CoreError> {
        match self.node_mut(id)?.data_mut() {
            NodeData::Element { attributes, .. } => Ok(attributes),
            _ => Err(CoreError::Hierarchy {
                message: "attribute operations require an Element node".to_string(),
            }),
        }
    }

    /// Crate-internal: atomically replaces the character data of the text,
    /// comment or `ProcessingInstruction` node for `id`.
    ///
    /// This is the text-update half of the Core seam (T25A, extended to
    /// `ProcessingInstruction` by T33). The M4 `textContent` API
    /// (`text_content` module, owned by T25C) and the T33 `character_data`
    /// module write `Text`/`Comment`/`ProcessingInstruction` data only through
    /// this entry, and every other text change goes through the unified
    /// mutation API (`append_child`, `remove_child`, `replace_child`, ...), so
    /// no code ever edits a payload field behind an entry's back. The write is
    /// a single field replacement on a validated node, so a failed call leaves
    /// the node byte-for-byte unchanged and the tree relations are never
    /// touched.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    /// * [`CoreError::Hierarchy`] when the node for `id` is neither a `Text`
    ///   nor a `Comment` node.
    /// * [`CoreError::InvalidCharacter`] when `data` contains a NUL character.
    ///
    /// Dormant by design: T25C consumes this entry after T25A archives, so the
    /// crate does not reference it yet.
    #[allow(dead_code)]
    pub(crate) fn set_character_data(&mut self, id: NodeId, data: &str) -> Result<(), CoreError> {
        let node = self.node_mut(id)?;
        if !matches!(
            node.data(),
            NodeData::Text { .. }
                | NodeData::Comment { .. }
                | NodeData::ProcessingInstruction { .. }
        ) {
            return Err(CoreError::Hierarchy {
                message: "character data operations require a Text, Comment or ProcessingInstruction node"
                    .to_string(),
            });
        }
        validate_text_data(data, "text data")?;
        let slot = match node.data_mut() {
            NodeData::Text { data: slot } | NodeData::Comment { data: slot } => slot,
            NodeData::ProcessingInstruction { data: slot, .. } => slot,
            _ => unreachable!("node kind validated above"),
        };
        *slot = data.to_string();
        Ok(())
    }
}

#[cfg(test)]
impl Document {
    /// Test-only: allocates a `Document`-kind node so tests can exercise the
    /// rules that reject `Document` nodes as parents or children.
    ///
    /// The public creation helpers deliberately never produce a `Document`
    /// node; this exists solely to reach those rejection branches.
    pub(crate) fn create_document_node_for_test(&mut self) -> NodeId {
        self.arena.allocate(self.id, Node::new(NodeData::Document))
    }

    /// Test-only: appends `child` as the last child of `parent`, linking all
    /// five relation fields consistently.
    ///
    /// `child` must currently be detached; the helper keeps the tree valid so
    /// tests can build deep and wide trees before exercising navigation or the
    /// invariant checker.
    pub(crate) fn append_child_for_test(&mut self, parent: NodeId, child: NodeId) {
        let last = self.get(parent).expect("live parent").last_child();
        self.node_mut(child).expect("live child").parent = Some(parent);
        self.node_mut(child).expect("live child").previous_sibling = last;
        match last {
            Some(l) => {
                self.node_mut(l).expect("live last child").next_sibling = Some(child);
            }
            None => {
                self.node_mut(parent).expect("live parent").first_child = Some(child);
            }
        }
        self.node_mut(parent).expect("live parent").last_child = Some(child);
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

/// Whether `c` may start a WHATWG-style "Name" (letter, `_`, `:`, or
/// non-ASCII).
fn is_valid_name_start(c: char) -> bool {
    c == '_' || c == ':' || c.is_ascii_alphabetic() || u32::from(c) > 0x7F
}

/// Whether `c` may continue a WHATWG-style "Name" (start characters plus
/// digits, `-` and `.`).
fn is_valid_name_char(c: char) -> bool {
    is_valid_name_start(c) || c.is_ascii_digit() || c == '-' || c == '.'
}

/// Validates an element name against the WHATWG "Name" production.
fn validate_element_name(name: &str) -> Result<(), CoreError> {
    validate_name(name, "element name")
}

/// Validates `name` against the WHATWG "Name" production.
///
/// A "Name" must not be empty and every character must be a letter, digit,
/// `-`, `.`, `_`, `:`, or a non-ASCII character, with the first character not
/// being a digit. Shared by element creation (`validate_element_name`), the
/// attribute name entry and the T33 processing-instruction target.
fn validate_name(name: &str, what: &'static str) -> Result<(), CoreError> {
    let mut chars = name.chars();
    match chars.next() {
        None => Err(CoreError::InvalidCharacter {
            what,
            character: None,
        }),
        Some(first) => {
            if !is_valid_name_start(first) {
                return Err(CoreError::InvalidCharacter {
                    what,
                    character: Some(first),
                });
            }
            for c in chars {
                if !is_valid_name_char(c) {
                    return Err(CoreError::InvalidCharacter {
                        what,
                        character: Some(c),
                    });
                }
            }
            Ok(())
        }
    }
}

/// Validates character data by rejecting NUL characters.
///
/// `pub(crate)` so the payload seam's text-update entry
/// ([`Document::set_character_data`]) and the future `text_content` module
/// (T25C) share the single well-formedness rule that `create_text` /
/// `create_comment` enforce.
pub(crate) fn validate_text_data(data: &str, what: &'static str) -> Result<(), CoreError> {
    if let Some(c) = data.chars().find(|&c| c == '\0') {
        return Err(CoreError::InvalidCharacter {
            what,
            character: Some(c),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arena::ArenaError;

    #[test]
    fn documents_have_distinct_ids() {
        let a = Document::new();
        let b = Document::new();
        assert_ne!(a.id(), b.id());
    }

    #[test]
    fn create_element_stores_name_and_attributes() {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();
        assert_eq!(doc.node_type(el).unwrap(), NodeType::Element);
        assert_eq!(doc.node_name(el).unwrap(), "div");
        assert_eq!(doc.get(el).unwrap().data().element_name(), Some("div"));
        assert_eq!(
            doc.get(el).unwrap().data().element_attributes(),
            Some(&[][..])
        );
    }

    #[test]
    fn create_text_stores_data() {
        let mut doc = Document::new();
        let text = doc.create_text("hello").unwrap();
        assert_eq!(doc.node_type(text).unwrap(), NodeType::Text);
        assert_eq!(doc.node_name(text).unwrap(), "#text");
        assert_eq!(doc.get(text).unwrap().data().text_data(), Some("hello"));
    }

    #[test]
    fn create_comment_stores_data() {
        let mut doc = Document::new();
        let comment = doc.create_comment("a note").unwrap();
        assert_eq!(doc.node_type(comment).unwrap(), NodeType::Comment);
        assert_eq!(doc.node_name(comment).unwrap(), "#comment");
        assert_eq!(
            doc.get(comment).unwrap().data().comment_data(),
            Some("a note")
        );
    }

    #[test]
    fn create_document_fragment_has_fixed_name() {
        let mut doc = Document::new();
        let fragment = doc.create_document_fragment().unwrap();
        assert_eq!(doc.node_type(fragment).unwrap(), NodeType::DocumentFragment);
        assert_eq!(doc.node_name(fragment).unwrap(), "#document-fragment");
    }

    #[test]
    fn invalid_element_names_are_rejected() {
        let mut doc = Document::new();
        assert!(matches!(
            doc.create_element(""),
            Err(CoreError::InvalidCharacter {
                character: None,
                ..
            })
        ));
        assert!(matches!(
            doc.create_element("1div"),
            Err(CoreError::InvalidCharacter {
                character: Some('1'),
                ..
            })
        ));
        assert!(matches!(
            doc.create_element("div div"),
            Err(CoreError::InvalidCharacter {
                character: Some(' '),
                ..
            })
        ));
        assert!(matches!(
            doc.create_element("div/1"),
            Err(CoreError::InvalidCharacter {
                character: Some('/'),
                ..
            })
        ));
    }

    #[test]
    fn valid_element_names_are_accepted() {
        let mut doc = Document::new();
        for name in [
            "div",
            "div1",
            "_private",
            ":custom",
            "my-element",
            "ns:local",
            "中文元素",
        ] {
            assert!(doc.create_element(name).is_ok(), "{name:?} should be valid");
        }
    }

    #[test]
    fn invalid_text_characters_are_rejected() {
        let mut doc = Document::new();
        assert!(doc.create_text("ok").is_ok());
        assert!(matches!(
            doc.create_text("bad\0char"),
            Err(CoreError::InvalidCharacter {
                character: Some('\0'),
                ..
            })
        ));
        assert!(matches!(
            doc.create_comment("note\0with nul"),
            Err(CoreError::InvalidCharacter {
                character: Some('\0'),
                ..
            })
        ));
    }

    #[test]
    fn cross_document_handle_returns_wrong_document() {
        let mut a = Document::new();
        let b = Document::new();
        let el = a.create_element("div").unwrap();

        assert_eq!(
            b.get(el),
            Err(CoreError::WrongDocument {
                id: el,
                expected_document: b.id(),
            })
        );
        assert!(matches!(
            b.node_name(el),
            Err(CoreError::WrongDocument { .. })
        ));
        assert!(matches!(
            b.node_type(el),
            Err(CoreError::WrongDocument { .. })
        ));

        assert_eq!(
            a.node_name(el).unwrap(),
            "div",
            "owner still reads its node"
        );
    }

    #[test]
    fn cross_document_handles_are_distinguishable() {
        let mut a = Document::new();
        let mut b = Document::new();
        let el_a = a.create_element("div").unwrap();
        let el_b = b.create_element("div").unwrap();
        assert_eq!(el_a.slot(), el_b.slot());
        assert_eq!(el_a.generation(), el_b.generation());
        assert_ne!(el_a, el_b, "same slot/generation, different document");
    }

    #[test]
    fn cross_document_handle_never_misreads_same_slot() {
        let mut a = Document::new();
        let mut b = Document::new();
        let el_a = a.create_element("from-a").unwrap();
        let el_b = b.create_element("from-b").unwrap();
        assert_eq!(el_a.slot(), el_b.slot());
        assert_eq!(el_a.generation(), el_b.generation());

        assert_eq!(
            b.get(el_a),
            Err(CoreError::WrongDocument {
                id: el_a,
                expected_document: b.id(),
            }),
            "foreign handle is rejected, never reads B's node at the same slot"
        );
        assert_eq!(b.node_name(el_b).unwrap(), "from-b");
        assert_eq!(a.node_name(el_a).unwrap(), "from-a");
    }

    #[test]
    fn arena_errors_compose_through_core_error() {
        let mut doc = Document::new();
        doc.create_element("div").unwrap();
        let bogus = NodeId::new(doc.id(), u32::MAX, 0);
        assert!(matches!(
            doc.get(bogus),
            Err(CoreError::Arena(ArenaError::OutOfBounds { .. }))
        ));
        assert!(matches!(
            doc.node_name(bogus),
            Err(CoreError::Arena(ArenaError::OutOfBounds { .. }))
        ));
    }

    #[test]
    fn wrong_document_handle_with_invalid_slot_still_reads_as_wrong_document() {
        let mut a = Document::new();
        let b = Document::new();
        a.create_element("div").unwrap();
        let foreign = NodeId::new(a.id(), u32::MAX, 0);
        assert!(matches!(
            b.get(foreign),
            Err(CoreError::WrongDocument { .. })
        ));
    }

    // ---- payload seam (T25A) ----

    #[test]
    fn element_attributes_mut_exposes_ordered_storage() {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();

        let attributes = doc.element_attributes_mut(el).unwrap();
        attributes.push(("id".to_string(), "root".to_string()));
        attributes.push(("class".to_string(), "a b".to_string()));
        assert_eq!(doc.element_attributes_mut(el).unwrap().len(), 2);

        let expected: &[(String, String)] = &[
            ("id".to_string(), "root".to_string()),
            ("class".to_string(), "a b".to_string()),
        ];
        assert_eq!(
            doc.get(el).unwrap().data().element_attributes(),
            Some(expected),
            "mutations through the seam are immediately visible to the public reader"
        );
    }

    #[test]
    fn element_attributes_mut_rejects_non_elements() {
        let mut doc = Document::new();
        let text = doc.create_text("hi").unwrap();
        let comment = doc.create_comment("note").unwrap();
        let frag = doc.create_document_fragment().unwrap();
        let doc_node = doc.create_document_node_for_test();

        for id in [text, comment, frag, doc_node] {
            assert!(
                matches!(
                    doc.element_attributes_mut(id),
                    Err(CoreError::Hierarchy { .. })
                ),
                "non-element {id:?} must be rejected by the attribute seam"
            );
        }
    }

    #[test]
    fn element_attributes_mut_rejects_foreign_and_stale_handles() {
        let mut a = Document::new();
        let mut b = Document::new();
        let el = a.create_element("div").unwrap();
        assert!(matches!(
            b.element_attributes_mut(el),
            Err(CoreError::WrongDocument { .. })
        ));

        b.create_element("x").unwrap();
        let bogus = NodeId::new(b.id(), u32::MAX, 0);
        assert!(matches!(
            b.element_attributes_mut(bogus),
            Err(CoreError::Arena(ArenaError::OutOfBounds { .. }))
        ));
    }

    #[test]
    fn set_character_data_updates_text_and_comment_in_place() {
        let mut doc = Document::new();
        let text = doc.create_text("hello").unwrap();
        let comment = doc.create_comment("note").unwrap();

        doc.set_character_data(text, "world").unwrap();
        doc.set_character_data(comment, "updated").unwrap();

        assert_eq!(doc.node_type(text).unwrap(), NodeType::Text);
        assert_eq!(doc.get(text).unwrap().data().text_data(), Some("world"));
        assert_eq!(doc.node_type(comment).unwrap(), NodeType::Comment);
        assert_eq!(
            doc.get(comment).unwrap().data().comment_data(),
            Some("updated")
        );
    }

    #[test]
    fn set_character_data_leaves_tree_relations_untouched() {
        let mut doc = Document::new();
        let parent = doc.create_element("p").unwrap();
        let text = doc.create_text("hello").unwrap();
        doc.append_child(parent, text).unwrap();

        doc.set_character_data(text, "bye").unwrap();
        assert_eq!(doc.parent(text).unwrap(), Some(parent));
        assert_eq!(doc.first_child(parent).unwrap(), Some(text));
        assert_eq!(doc.last_child(parent).unwrap(), Some(text));
        assert_eq!(doc.check_invariants(parent).unwrap(), ());
    }

    #[test]
    fn set_character_data_rejects_nul_atomically() {
        let mut doc = Document::new();
        let text = doc.create_text("hello").unwrap();

        assert!(matches!(
            doc.set_character_data(text, "bad\0data"),
            Err(CoreError::InvalidCharacter {
                character: Some('\0'),
                ..
            })
        ));
        assert_eq!(
            doc.get(text).unwrap().data().text_data(),
            Some("hello"),
            "a rejected update leaves the data unchanged"
        );
    }

    #[test]
    fn set_character_data_rejects_non_character_data() {
        let mut doc = Document::new();
        let el = doc.create_element("div").unwrap();
        let frag = doc.create_document_fragment().unwrap();
        let doc_node = doc.create_document_node_for_test();

        for id in [el, frag, doc_node] {
            assert!(
                matches!(
                    doc.set_character_data(id, "x"),
                    Err(CoreError::Hierarchy { .. })
                ),
                "non-text/comment {id:?} must be rejected by the text seam"
            );
        }
    }

    #[test]
    fn set_character_data_rejects_foreign_and_stale_handles() {
        let mut a = Document::new();
        let mut b = Document::new();
        let text = a.create_text("hi").unwrap();
        assert!(matches!(
            b.set_character_data(text, "x"),
            Err(CoreError::WrongDocument { .. })
        ));

        b.create_element("x").unwrap();
        let bogus = NodeId::new(b.id(), u32::MAX, 0);
        assert!(matches!(
            b.set_character_data(bogus, "x"),
            Err(CoreError::Arena(ArenaError::OutOfBounds { .. }))
        ));
    }
}
