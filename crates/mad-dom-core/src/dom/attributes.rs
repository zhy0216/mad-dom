//! Element attribute read/write contract (T25B).
//!
//! This module implements the Core half of the DOM attribute API:
//! [`Document::get_attribute`], [`Document::set_attribute`],
//! [`Document::remove_attribute`] and [`Document::has_attribute`]. It is the
//! T25B owner of the module T25A pre-registered; the integration gate is **T25**,
//! and the JavaScript-facing binding (T25E) maps these entries to the `Element`
//! attribute accessors.
//!
//! # Single source of attribute state
//!
//! Attribute state lives in exactly one place: the ordered `(name, value)` list
//! of the element's own [`NodeData::Element`](super::node::NodeData::Element)
//! payload inside the node's arena slot. Reads use the public
//! [`NodeData::element_attributes`](super::node::NodeData::element_attributes)
//! accessor; writes go through the crate-internal `Document::element_attributes_mut`
//! seam. No copy of the attribute list is kept anywhere — not in this module,
//! not in a future binding or facade — so a write performed through any entry
//! point is immediately visible to every reader, and there is no second
//! attribute state that could drift out of sync.
//!
//! # Ordering
//!
//! The list is ordered. Setting a *new* attribute appends `(name, value)` at the
//! end; re-setting an *existing* attribute updates its value in place, preserving
//! the attribute's original position. Removing an attribute removes exactly its
//! entry, and the relative order of the surviving attributes is unchanged.
//!
//! # String conversion
//!
//! Values are stored verbatim as Rust strings: the WHATWG/DOM step of converting
//! the value to a DOMString is a no-op on an already-string value, so the stored
//! string always round-trips exactly through [`Document::get_attribute`] — empty
//! strings, whitespace, multi-byte UTF-8 and values that look like numbers or
//! booleans are all preserved character-for-character. Case folding for HTML
//! documents is not part of this Core milestone: attribute names are matched
//! byte-for-byte and case-sensitively, and any HTML-namespace lowercasing belongs
//! to the binding or the HTML milestone.
//!
//! # Errors and failure atomicity
//!
//! Every operation validates its arguments before touching the storage, so a
//! failed call leaves the attribute list byte-for-byte unchanged. The error
//! boundary is fixed by the T25A seam:
//!
//! * a foreign handle fails with [`CoreError::WrongDocument`];
//! * a stale handle fails with [`CoreError::Arena`];
//! * a non-element node fails with [`CoreError::Hierarchy`];
//! * `set_attribute` rejects an invalid attribute name (an empty name, a name
//!   starting with `-`, or a name containing an HTML-invalid character such as
//!   ASCII whitespace, `"`, `'`, `>`, `<`, `=` or `/` — the happy-dom
//!   `validateAttributeName` boundary; digit-led, `.`-led, `:` and non-ASCII
//!   names are accepted) with [`CoreError::InvalidCharacter`].
//!
//! The read entries ([`Document::get_attribute`], [`Document::has_attribute`])
//! and [`Document::remove_attribute`] do *not* validate the name: per the DOM,
//! they treat any name they cannot find as absent (`None` / `false` / no-op).
//! Only `set_attribute` validates, because only it creates an attribute carrying
//! the given name.
//!
//! # Tree structure is untouched
//!
//! Attributes are payload of the element itself: none of these entries go
//! through the tree mutation API, and none of them read or write tree relations.
//! Setting or removing an attribute on a node leaves its parent, children and
//! sibling relations exactly as they were, so
//! [`Document::check_invariants`] keeps passing.
//!
//! T25B may only edit this file and its dedicated tests
//! (`tests/t25_attributes.rs`); it must not modify `node.rs`, `document.rs`,
//! `mod.rs` or the sibling `text_content.rs`. Dependency rules:
//! [`super::document`], [`super::node`].

use crate::arena::NodeId;
use crate::error::CoreError;

use super::Document;

impl Document {
    /// Returns the value of the attribute with the given `name`, or `None` when
    /// the element has no such attribute.
    ///
    /// The returned string borrows the element's arena slot: no copy of the
    /// value is made, and the value is immediately current (a write through
    /// [`Document::set_attribute`] or the payload seam is visible on the next
    /// read). The name is matched byte-for-byte and case-sensitively; an unknown
    /// name is simply absent (`None`), never an error.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    /// * [`CoreError::Hierarchy`] when the node for `id` is not an `Element`.
    pub fn get_attribute(&self, id: NodeId, name: &str) -> Result<Option<&str>, CoreError> {
        let attributes = self
            .get(id)?
            .data()
            .element_attributes()
            .ok_or_else(|| hierarchy("attribute operations require an Element node"))?;
        Ok(attributes
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, value)| value.as_str()))
    }

    /// Returns whether the element has an attribute with the given `name`.
    ///
    /// Follows [`Document::get_attribute`]'s error rules; an unknown name yields
    /// `false` rather than an error.
    pub fn has_attribute(&self, id: NodeId, name: &str) -> Result<bool, CoreError> {
        Ok(self.get_attribute(id, name)?.is_some())
    }

    /// Sets the attribute with the given `name` to `value`.
    ///
    /// When the element already has an attribute with that name, its value is
    /// updated in place, preserving the attribute's position in the ordered
    /// list; otherwise the new `(name, value)` pair is appended. The value is
    /// stored verbatim (see the module docs for string conversion).
    ///
    /// # Errors
    ///
    /// * [`CoreError::InvalidCharacter`] when `name` is not a valid attribute
    ///   name per the happy-dom `validateAttributeName` boundary (empty,
    ///   `-`-led, or containing an HTML-invalid character); the storage is
    ///   left unchanged.
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    /// * [`CoreError::Hierarchy`] when the node for `id` is not an `Element`.
    pub fn set_attribute(&mut self, id: NodeId, name: &str, value: &str) -> Result<(), CoreError> {
        validate_attribute_name(name)?;
        let old_value = self.get_attribute(id, name)?.map(str::to_owned);
        {
            let attributes = self.element_attributes_mut(id)?;
            match attributes.iter_mut().find(|(n, _)| n == name) {
                Some(slot) => slot.1 = value.to_string(),
                None => attributes.push((name.to_string(), value.to_string())),
            }
        }
        self.bump_attribute_generation();
        // T32: re-key the optional query index when an id/class write changes
        // the tokens an element matches (a no-op when the index is disabled).
        self.index_attribute_changed(id, name, old_value.as_deref(), Some(value))?;
        // T41: every attribute write funnels through this single entry, so the
        // `attributes` record (with the old value, baseline parity) is queued
        // here — both for a fresh attribute (old value `None`) and for an
        // in-place update.
        self.queue_attribute_record(id, name, old_value.as_deref());
        // T42: the `attributeChangedCallback` reaction fires for a custom
        // element whose observed snapshot contains the attribute (the same
        // single-write chokepoint rule, enqueued synchronously).
        self.enqueue_attribute_changed(id, name, old_value.as_deref(), Some(value));
        Ok(())
    }

    /// Removes the attribute with the given `name` and returns whether it was
    /// present.
    ///
    /// Returns `true` when an attribute was removed and `false` when the element
    /// had no such attribute (a no-op). The relative order of the surviving
    /// attributes is unchanged. The DOM-facing binding maps the boolean result to
    /// the WebIDL `undefined` return; the Core keeps the boolean so deletion and
    /// failure atomicity can be verified directly.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    /// * [`CoreError::Hierarchy`] when the node for `id` is not an `Element`.
    pub fn remove_attribute(&mut self, id: NodeId, name: &str) -> Result<bool, CoreError> {
        let old_value = self.get_attribute(id, name)?.map(str::to_owned);
        let removed = {
            let attributes = self.element_attributes_mut(id)?;
            match attributes.iter().position(|(n, _)| n == name) {
                Some(index) => {
                    attributes.remove(index);
                    true
                }
                None => false,
            }
        };
        if removed {
            self.bump_attribute_generation();
            // T32: drop the id/class tokens of the removed attribute from the
            // optional query index (a no-op when the index is disabled).
            self.index_attribute_changed(id, name, old_value.as_deref(), None)?;
            // T41: queue the `attributes` record for the removal (only when an
            // attribute was actually removed).
            self.queue_attribute_record(id, name, old_value.as_deref());
            // T42: the `attributeChangedCallback` reaction for an observed
            // attribute removal.
            self.enqueue_attribute_changed(id, name, old_value.as_deref(), None);
        }
        Ok(removed)
    }
}

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

/// Whether `c` is forbidden in an HTML attribute name.
///
/// Mirrors happy-dom's `validateAttributeName` boundary (the
/// `HTML_INVALID_ATTRIBUTE_NAME_CHARACTER_REGEX` over the lowercased name):
/// ASCII control characters and C1 controls, the ASCII space, the HTML
/// syntax characters `" ' > < = /`, and the Unicode noncharacters. It accepts
/// digit-led names, a leading `.`, `:` and non-ASCII characters.
fn is_invalid_attribute_name_char(c: char) -> bool {
    let code = u32::from(c);
    matches!(code, 0x00..=0x1F | 0x7F | 0x80..=0x9F)
        || matches!(c, ' ' | '"' | '\'' | '>' | '<' | '=' | '/')
        || (0xFDD0..=0xFDEF).contains(&code)
        || (code & 0xFFFE) == 0xFFFE
}

/// Validates an attribute name against happy-dom's `validateAttributeName`
/// boundary.
///
/// The check mirrors happy-dom's observable rule: an empty name, a name
/// starting with `-`, or a name containing any character of
/// [`is_invalid_attribute_name_char`] is rejected with
/// [`CoreError::InvalidCharacter`]; everything else — digit-led names,
/// `.`-led names, `:` and non-ASCII characters — is accepted.
fn validate_attribute_name(name: &str) -> Result<(), CoreError> {
    if name.is_empty() {
        return Err(CoreError::InvalidCharacter {
            what: "attribute name",
            character: None,
        });
    }
    if name.starts_with('-') {
        return Err(CoreError::InvalidCharacter {
            what: "attribute name",
            character: Some('-'),
        });
    }
    if let Some(c) = name.chars().find(|&c| is_invalid_attribute_name_char(c)) {
        return Err(CoreError::InvalidCharacter {
            what: "attribute name",
            character: Some(c),
        });
    }
    Ok(())
}
