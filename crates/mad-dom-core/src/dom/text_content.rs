//! `textContent` payload seam (T25A contract placeholder).
//!
//! **T25C** owns the implementation of this module after T25A archives; the
//! integration gate is **T25**. T25A only pre-registers this file and freezes
//! the contract below; it implements no public `textContent` API.
//!
//! # Frozen contract (T25A)
//!
//! * Text payloads are read from the arena on demand: `Text` and `Comment`
//!   nodes contribute their `data`, and recursion walks the tree through the
//!   public navigation API ([`Document::children`], [`Document::get`]) plus the
//!   read accessors [`NodeData::text_data`] / [`NodeData::comment_data`]. A
//!   read never mutates and never copies DOM state; the concatenated string is
//!   produced on the fly.
//! * Updating a `Text` or `Comment` node's data goes through the crate-internal
//!   [`Document::set_character_data`] entry, which validates ownership, node
//!   kind and text-data well-formedness (rejecting NUL with
//!   [`CoreError::InvalidCharacter`]) before the single data field is written,
//!   so a failed call leaves the node unchanged.
//! * Replacing an `Element`'s or `DocumentFragment`'s content with a single
//!   text node goes through the unified mutation API ([`Document::create_text`],
//!   [`Document::remove_child`], [`Document::append_child`]), which is
//!   all-or-nothing: the text node is created (and its data validated) before
//!   the child list is touched, so a failure never leaves a partial
//!   replacement.
//! * Error boundary: a foreign handle fails with [`CoreError::WrongDocument`],
//!   a stale handle with [`CoreError::Arena`], and the behavior for `Document`
//!   nodes is owned by T25C (defined using the public [`NodeData::node_type`]
//!   and the rules above). No raw arena pointer escapes this crate and there is
//!   no second text state.
//!
//! T25C may only edit this file and its dedicated tests
//! (`tests/t25_text_content.rs`); it must not modify `node.rs`, `document.rs`,
//! `mod.rs` or the sibling `attributes.rs`. Dependency rules:
//! [`super::document`], [`super::node`], [`super::mutation`].
