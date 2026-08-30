//! `CharacterData` and extended-node Core module (T33).
//!
//! Implements the remaining public behavior of the extended node types on top
//! of the payload and mutation seams:
//!
//! * the WHATWG `CharacterData` surface (`data` getter/setter, `length`,
//!   `substringData`, `appendData`, `insertData`, `deleteData`,
//!   `replaceData`) for `Text` and `Comment` nodes;
//! * the same mutators for `ProcessingInstruction` nodes (happy-dom parity —
//!   happy-dom models `ProcessingInstruction` as a `CharacterData` subclass,
//!   so the data string participates in the same surface);
//! * `Text.splitText` (the WHATWG split algorithm, valid for offsets in
//!   `0..=length`);
//! * the read-only `ProcessingInstruction.target` / `DocumentType`
//!   (`name`, `publicId`, `systemId`) payload reads.
//!
//! # Offset semantics
//!
//! DOM offsets are measured in UTF-16 code units (the JS string model). Every
//! operation below converts the stored UTF-8 string to UTF-16 code units,
//! performs the slice/splice, and converts back, so `length`, `substringData`
//! and the mutators agree with happy-dom for the BMP (including CJK) and
//! differ only in the exotic case of an offset that splits a surrogate pair
//! (which is lossy-converted; never a panic).
//!
//! # Atomicity
//!
//! All validation (node kind, offset bounds, NUL well-formedness) happens
//! before the single data-field replacement, which is done through the
//! validated [`Document::set_character_data`] entry — a failed call leaves the
//! node byte-for-byte unchanged and never touches the tree relations.
//!
//! # Split
//!
//! [`Document::split_text`] clones the tail of a `Text` node into a freshly
//! allocated text node, shortens the original to the head, and inserts the new
//! node immediately after the original inside the original's parent (a
//! detached node's split stays detached). It fails with
//! [`CoreError::IndexOutOfBounds`] when `offset` exceeds the length, and with
//! [`CoreError::Hierarchy`] on a non-`Text` receiver.

use crate::arena::NodeId;
use crate::error::CoreError;

use super::node::{NodeData, NodeType};
use super::Document;

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

/// Returns the number of UTF-16 code units in `s` (the DOM `length` unit).
fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Returns the substring of `s` starting at UTF-16 `offset` with up to
/// `count` UTF-16 code units, clamped to the end of `s`.
///
/// An offset past the end yields the empty string. The result is
/// lossy-converted when an offset splits a surrogate pair (a DOM operation is
/// allowed to split code units); this never panics.
fn utf16_substring(s: &str, offset: usize, count: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    let start = offset.min(units.len());
    let end = offset.saturating_add(count).min(units.len());
    String::from_utf16_lossy(&units[start..end])
}

/// Inserts `insert` at UTF-16 `offset` into `s`.
///
/// `offset` must be `<= utf16_len(s)`; inserting at the length appends.
fn utf16_insert(s: &str, offset: usize, insert: &str) -> String {
    let mut units: Vec<u16> = s.encode_utf16().collect();
    units.splice(offset..offset, insert.encode_utf16());
    String::from_utf16_lossy(&units)
}

/// Deletes up to `count` UTF-16 code units starting at `offset` from `s`.
///
/// `offset` must be `<= utf16_len(s)`; the deletion is clamped to the end.
fn utf16_delete(s: &str, offset: usize, count: usize) -> String {
    let mut units: Vec<u16> = s.encode_utf16().collect();
    let end = offset.saturating_add(count).min(units.len());
    units.drain(offset..end);
    String::from_utf16_lossy(&units)
}

impl Document {
    /// Returns the character data of a `Text`, `Comment` or
    /// `ProcessingInstruction` node, or `None` for any other node kind.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    pub fn character_data(&self, id: NodeId) -> Result<Option<&str>, CoreError> {
        match self.get(id)?.data() {
            NodeData::Text { data } => Ok(Some(data)),
            NodeData::Comment { data } => Ok(Some(data)),
            NodeData::ProcessingInstruction { data, .. } => Ok(Some(data)),
            _ => Ok(None),
        }
    }

    /// Returns the character data of a `Text`, `Comment` or
    /// `ProcessingInstruction` node, or fails with [`CoreError::Hierarchy`]
    /// for any other node kind.
    fn require_character_data(&self, id: NodeId) -> Result<&str, CoreError> {
        match self.character_data(id)? {
            Some(data) => Ok(data),
            None => Err(hierarchy(
                "character data operations require a Text, Comment or ProcessingInstruction node",
            )),
        }
    }

    /// Returns the UTF-16 `length` of the character data of a `Text`,
    /// `Comment` or `ProcessingInstruction` node, or `None` for other kinds.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    pub fn character_data_length(&self, id: NodeId) -> Result<Option<usize>, CoreError> {
        Ok(self.character_data(id)?.map(utf16_len))
    }

    /// Sets the character data of a `Text`, `Comment` or
    /// `ProcessingInstruction` node to `value`.
    ///
    /// For any other node kind this is a no-op (the WHATWG `data` / `nodeValue`
    /// setters on non-`CharacterData` nodes do nothing; happy-dom reads them
    /// as absent). The write is atomic through
    /// [`Document::set_character_data`]: a NUL byte in `value` fails with
    /// [`CoreError::InvalidCharacter`] and leaves the node unchanged.
    pub fn set_data(&mut self, id: NodeId, value: &str) -> Result<(), CoreError> {
        match self.get(id)?.data().node_type() {
            NodeType::Text | NodeType::Comment | NodeType::ProcessingInstruction => {
                self.set_character_data(id, value)
            }
            _ => Ok(()),
        }
    }

    /// Returns the WHATWG `substringData(offset, count)` of the node for `id`.
    ///
    /// An offset past the end returns the empty string (the WHATWG "return the
    /// empty string" step); the count is clamped to the end of the data.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `id` is not a `Text`, `Comment` or
    ///   `ProcessingInstruction` node.
    pub fn substring_data(
        &self,
        id: NodeId,
        offset: usize,
        count: usize,
    ) -> Result<String, CoreError> {
        let data = self.require_character_data(id)?;
        let len = utf16_len(data);
        if offset > len {
            return Ok(String::new());
        }
        Ok(utf16_substring(data, offset, count))
    }

    /// Appends `data` to the character data of the node for `id`.
    ///
    /// The combined value is validated before the single data-field write, so
    /// a NUL byte in `data` fails with [`CoreError::InvalidCharacter`] and
    /// leaves the node unchanged.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `id` is not a character-data node.
    /// * [`CoreError::InvalidCharacter`] when `data` contains a NUL.
    pub fn append_data(&mut self, id: NodeId, data: &str) -> Result<(), CoreError> {
        let current = self.require_character_data(id)?.to_string();
        self.set_character_data(id, &format!("{current}{data}"))
    }

    /// Inserts `data` at UTF-16 `offset` into the character data of the node
    /// for `id`.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `id` is not a character-data node.
    /// * [`CoreError::IndexOutOfBounds`] when `offset` is greater than the
    ///   data length (the WHATWG `IndexSizeError`).
    /// * [`CoreError::InvalidCharacter`] when `data` contains a NUL.
    pub fn insert_data(&mut self, id: NodeId, offset: usize, data: &str) -> Result<(), CoreError> {
        let current = self.require_character_data(id)?;
        let len = utf16_len(current);
        if offset > len {
            return Err(CoreError::IndexOutOfBounds { index: offset, len });
        }
        self.set_character_data(id, &utf16_insert(current, offset, data))
    }

    /// Deletes up to `count` UTF-16 code units starting at `offset` from the
    /// character data of the node for `id`.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `id` is not a character-data node.
    /// * [`CoreError::IndexOutOfBounds`] when `offset` is greater than the
    ///   data length (the WHATWG `IndexSizeError`).
    pub fn delete_data(
        &mut self,
        id: NodeId,
        offset: usize,
        count: usize,
    ) -> Result<(), CoreError> {
        let current = self.require_character_data(id)?;
        let len = utf16_len(current);
        if offset > len {
            return Err(CoreError::IndexOutOfBounds { index: offset, len });
        }
        self.set_character_data(id, &utf16_delete(current, offset, count))
    }

    /// Replaces up to `count` UTF-16 code units starting at `offset` with
    /// `data` in the character data of the node for `id`.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `id` is not a character-data node.
    /// * [`CoreError::IndexOutOfBounds`] when `offset` is greater than the
    ///   data length (the WHATWG `IndexSizeError`).
    /// * [`CoreError::InvalidCharacter`] when `data` contains a NUL.
    pub fn replace_data(
        &mut self,
        id: NodeId,
        offset: usize,
        count: usize,
        data: &str,
    ) -> Result<(), CoreError> {
        let current = self.require_character_data(id)?;
        let len = utf16_len(current);
        if offset > len {
            return Err(CoreError::IndexOutOfBounds { index: offset, len });
        }
        let reduced = utf16_delete(current, offset, count);
        self.set_character_data(id, &utf16_insert(&reduced, offset, data))
    }

    /// Splits the `Text` node for `id` at UTF-16 `offset` and returns the new
    /// tail node.
    ///
    /// The original node keeps the first `offset` code units and the returned
    /// node — a fresh detached-to-parent `Text` node holding the remainder —
    /// is inserted immediately after the original inside the original's
    /// parent. A detached original stays detached (the new node is also
    /// detached). An `offset` of `0` empties the original, an `offset` equal
    /// to the length produces an empty tail.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    /// * [`CoreError::Hierarchy`] when `id` is not a `Text` node.
    /// * [`CoreError::IndexOutOfBounds`] when `offset` is greater than the
    ///   node's length (the WHATWG `IndexSizeError`).
    pub fn split_text(&mut self, id: NodeId, offset: usize) -> Result<NodeId, CoreError> {
        let node = self.get(id)?;
        if node.data().node_type() != NodeType::Text {
            return Err(hierarchy("splitText requires a Text node"));
        }
        let data = node.data().text_data().unwrap_or_default();
        let len = utf16_len(data);
        if offset > len {
            return Err(CoreError::IndexOutOfBounds { index: offset, len });
        }
        let parent = node.parent();
        let head = utf16_substring(data, 0, offset);
        let tail = utf16_substring(data, offset, len - offset);

        // Allocate the tail clone and validate the head before touching the
        // original's payload, so a failure leaves both nodes unchanged.
        let tail_id = self.create_text(&tail)?;
        self.set_character_data(id, &head)?;

        if let Some(p) = parent {
            let next = self.get(id)?.next_sibling();
            match next {
                Some(n) => self.insert_before(p, tail_id, n)?,
                None => self.append_child(p, tail_id)?,
            }
        }
        Ok(tail_id)
    }

    /// Returns the `ProcessingInstruction` target of the node for `id`, or
    /// `None` for any other node kind.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    pub fn processing_instruction_target(&self, id: NodeId) -> Result<Option<&str>, CoreError> {
        match self.get(id)?.data() {
            NodeData::ProcessingInstruction { target, .. } => Ok(Some(target)),
            _ => Ok(None),
        }
    }

    /// Returns the `DocumentType` payload `(name, public_id, system_id)` of
    /// the node for `id`, or `None` for any other node kind.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] / [`CoreError::Arena`] for a foreign or
    ///   stale handle.
    pub fn doctype_payload(
        &self,
        id: NodeId,
    ) -> Result<Option<(String, String, String)>, CoreError> {
        Ok(self
            .get(id)?
            .data()
            .doctype_data()
            .map(|(name, public_id, system_id)| {
                (name.to_owned(), public_id.to_owned(), system_id.to_owned())
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_len_counts_code_units() {
        assert_eq!(utf16_len(""), 0);
        assert_eq!(utf16_len("abc"), 3);
        assert_eq!(utf16_len("中文"), 2);
        // An astral character is two UTF-16 code units (the DOM length unit).
        assert_eq!(utf16_len("😀"), 2);
    }

    #[test]
    fn utf16_substring_clamps_and_empty_out_of_range() {
        assert_eq!(utf16_substring("hello", 0, 5), "hello");
        assert_eq!(utf16_substring("hello", 1, 2), "el");
        assert_eq!(utf16_substring("hello", 6, 3), "");
        assert_eq!(utf16_substring("hello", 3, 100), "lo");
        assert_eq!(utf16_substring("hello", 5, 0), "");
    }

    #[test]
    fn utf16_substring_handles_bmp_and_astral() {
        assert_eq!(utf16_substring("中文abc", 0, 2), "中文");
        // Splitting inside a surrogate pair is lossy, never a panic.
        let units = utf16_len("😀");
        assert_eq!(units, 2);
        let _ = utf16_substring("😀", 1, 1);
    }

    #[test]
    fn utf16_insert_and_delete_match_dom_semantics() {
        assert_eq!(utf16_insert("abc", 0, "X"), "Xabc");
        assert_eq!(utf16_insert("abc", 1, "X"), "aXbc");
        assert_eq!(utf16_insert("abc", 3, "X"), "abcX");
        assert_eq!(utf16_delete("abcdef", 0, 2), "cdef");
        assert_eq!(utf16_delete("abcdef", 2, 100), "ab");
        assert_eq!(utf16_delete("abcdef", 2, 0), "abcdef");
    }
}
