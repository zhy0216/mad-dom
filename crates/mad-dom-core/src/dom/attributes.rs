//! Element attribute payload seam (T25A contract placeholder).
//!
//! **T25B** owns the implementation of this module after T25A archives; the
//! integration gate is **T25**. T25A only pre-registers this file and freezes
//! the contract below; it implements no public attribute API.
//!
//! # Frozen contract (T25A)
//!
//! * Element attribute storage is the ordered list of `(name, value)` pairs
//!   carried by [`NodeData::Element`]; `mad-dom-core` keeps exactly one copy of
//!   it, inside the node's arena slot. Order is preserved: re-setting an
//!   existing attribute updates its value in place, and a new attribute is
//!   appended.
//! * Reads use the public [`NodeData::element_attributes`] accessor. Writes go
//!   through the crate-internal [`Document::element_attributes_mut`] entry,
//!   which validates document ownership and element kind before exposing the
//!   list; no other code may reach the attribute storage and no DOM state is
//!   copied anywhere. No raw arena pointer or
//!   [`Arena`](crate::arena::Arena) handle escapes this crate.
//! * Failure atomicity: every attribute operation must validate its arguments
//!   (ownership, element kind, attribute name) before touching the list, so a
//!   failed call leaves the storage byte-for-byte unchanged. Error boundary:
//!   a foreign handle fails with [`CoreError::WrongDocument`], a stale handle
//!   with [`CoreError::Arena`], a non-element with [`CoreError::Hierarchy`],
//!   and an invalid attribute name with [`CoreError::InvalidCharacter`].
//! * Attribute updates never go through the tree mutation API: attributes live
//!   in the element's own payload, so they are written only via the attribute
//!   seam and the tree structure is untouched by attribute operations.
//!
//! T25B may only edit this file and its dedicated tests
//! (`tests/t25_attributes.rs`); it must not modify `node.rs`, `document.rs`,
//! `mod.rs` or the sibling `text_content.rs`. Dependency rules:
//! [`super::document`], [`super::node`].
