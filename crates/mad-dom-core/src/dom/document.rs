//! The [`Document`] type: sole owner of a per-document node arena.
//!
//! Every [`Document`] creates its own [`Arena`](crate::arena::Arena) and a
//! unique document id drawn from a global counter. Handles allocated into the
//! arena carry that document id, so a handle obtained from one document can be
//! recognised — and rejected — by another document instead of being silently
//! misread as one of its own nodes.

use crate::arena::{Arena, NodeId};
use crate::error::CoreError;

use super::node::{Node, NodeData, NodeType};

use std::sync::atomic::{AtomicU64, Ordering};

/// Global counter assigning each [`Document`] a unique id.
static NEXT_DOCUMENT_ID: AtomicU64 = AtomicU64::new(0);

/// A document that owns its own node arena.
///
/// Nodes are created through the `create_*` helpers, which allocate into the
/// arena and return an opaque [`NodeId`]. Read access validates that the
/// handle belongs to this document first, so foreign handles fail with
/// [`CoreError::WrongDocument`] rather than aliasing a node in this document.
pub struct Document {
    id: u64,
    arena: Arena<Node>,
}

impl Document {
    /// Creates an empty document with a fresh arena and a unique document id.
    pub fn new() -> Self {
        Self {
            id: NEXT_DOCUMENT_ID.fetch_add(1, Ordering::Relaxed),
            arena: Arena::new(),
        }
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
                name: name.to_string(),
                attributes: Vec::new(),
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
    let mut chars = name.chars();
    match chars.next() {
        None => Err(CoreError::InvalidCharacter {
            what: "element name",
            character: None,
        }),
        Some(first) => {
            if !is_valid_name_start(first) {
                return Err(CoreError::InvalidCharacter {
                    what: "element name",
                    character: Some(first),
                });
            }
            for c in chars {
                if !is_valid_name_char(c) {
                    return Err(CoreError::InvalidCharacter {
                        what: "element name",
                        character: Some(c),
                    });
                }
            }
            Ok(())
        }
    }
}

/// Validates character data by rejecting NUL characters.
fn validate_text_data(data: &str, what: &'static str) -> Result<(), CoreError> {
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
}
