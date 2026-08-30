//! Attribute-node and token-list Core contract (T34).
//!
//! This module implements the Core half of the T34 attribute-node and
//! `DOMTokenList` surface on top of the T25B attribute storage and the T25A
//! payload seam. It owns two families of entries on [`Document`]:
//!
//! * **the `NamedNodeMap`/`Attr` reads** — [`Document::attribute_pairs`]
//!   (the ordered `(name, value)` list behind `element.attributes`),
//!   [`Document::element_namespace_uri`] (the element namespace read) and
//!   [`Document::validate_attribute_name`] (the `createAttribute` qualified-name
//!   check);
//! * **the `DOMTokenList` contract** — [`Document::attribute_token_set`],
//!   [`Document::attribute_token_contains`], [`Document::attribute_token_add`],
//!   [`Document::attribute_token_remove`], [`Document::attribute_token_toggle`]
//!   and [`Document::attribute_token_replace`], which operate on the *ordered
//!   token set* of a named attribute (the `class` attribute from
//!   `Element.classList`).
//!
//! # Single source of attribute state
//!
//! Attribute state continues to live in exactly one place — the ordered
//! `(name, value)` list of the element's arena slot. Every read here is
//! produced on demand from that storage and every `DOMTokenList` write funnels
//! back through the single attribute write entry ([`Document::set_attribute`]
//! / [`Document::remove_attribute`]), so a `classList.add` is indistinguishable
//! from an `element.setAttribute("class", …)` at the storage level, the T32
//! query index stays in lock step, and no second attribute state can drift.
//!
//! # The token set (WHATWG ordered set)
//!
//! A `DOMTokenList` works over the *ordered set* of the attribute value: the
//! value is split on ASCII whitespace and de-duplicated preserving
//! first-occurrence order ([`ordered_set_parse`], the WHATWG
//! "split-on-ascii-whitespace" + "ordered set parse" pair). The raw attribute
//! string round-trips verbatim through `getAttribute`; only the token-set
//! operations go through the set. All token-set entries validate every token
//! *before* touching storage, so a failed call leaves the attribute
//! byte-for-byte unchanged (failure atomicity).
//!
//! # Token validation and errors
//!
//! Per the WHATWG `DOMTokenList` contract the mutators ([`add`] / [`remove`] /
//! [`toggle`] / [`replace`]) reject an empty token with a `SyntaxError`
//! DOMException and a token containing ASCII whitespace with an
//! `InvalidCharacterError` DOMException, mapped through the frozen Core
//! taxonomy ([`CoreError::Syntax`] / [`CoreError::InvalidCharacter`]).
//! [`Document::attribute_token_contains`] never throws: per the spec an empty
//! token is simply absent (`false`), and a whitespace token can never be a
//! member of an ordered set.
//!
//! # Empty-token-set update
//!
//! After a mutator, the WHATWG update steps remove the attribute when the
//! token set is empty and otherwise set it to the space-joined set. The
//! `value` accessor is deliberately *not* a token-set write: it stores the raw
//! string verbatim through [`Document::set_attribute`], exactly like
//! `setAttribute`.
//!
//! # Errors
//!
//! Every entry follows the established boundary: a foreign handle fails with
//! [`CoreError::WrongDocument`], a stale handle with [`CoreError::Arena`] and a
//! non-element node with [`CoreError::Hierarchy`]. Attribute *reads*
//! ([`Document::attribute_pairs`]) treat an unknown name as absence (`None`);
//! only the token-set *mutators* validate their tokens.
//!
//! # Tree structure is untouched
//!
//! Like the T25B module, these entries are payload-only: none of them touches
//! tree relations, so [`Document::check_invariants`] keeps passing.

use crate::arena::NodeId;
use crate::error::CoreError;

use super::document::validate_name;
use super::Document;

impl Document {
    /// Returns the element's ordered `(name, value)` attribute pairs.
    ///
    /// This is the read behind the `NamedNodeMap` (`element.attributes`):
    /// length, `item(i)`, `getNamedItem` and iteration all derive from this
    /// single ordered read, produced on demand from the element's arena slot so
    /// a retained collection reflects later attribute writes immediately. The
    /// pairs are owned copies; attribute values are small and the read is the
    /// convenience surface for the binding, which needs owned strings to cross
    /// the FFI boundary.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    /// * [`CoreError::Hierarchy`] when the node for `id` is not an `Element`.
    pub fn attribute_pairs(&self, id: NodeId) -> Result<Vec<(String, String)>, CoreError> {
        let attributes = self
            .get(id)?
            .data()
            .element_attributes()
            .ok_or_else(|| hierarchy("attribute operations require an Element node"))?;
        Ok(attributes
            .iter()
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect())
    }

    /// Returns the element's namespace URI, or `None` for a non-element node.
    ///
    /// The read behind `Element.namespaceURI` (T34 closes the snapshot leaf
    /// that previously read as `null`). A fresh `createElement` element carries
    /// the WHATWG HTML namespace.
    pub fn element_namespace_uri(&self, id: NodeId) -> Result<Option<&str>, CoreError> {
        Ok(self.get(id)?.data().element_namespace())
    }

    /// Validates `name` against the WHATWG "Name" production for `createAttribute`.
    ///
    /// A pure check (no storage is touched): it rejects empty, digit-led and
    /// whitespace-containing qualified names with
    /// [`CoreError::InvalidCharacter`], mirroring the `setAttribute` name rule
    /// shared by the crate.
    pub fn validate_attribute_name(&self, name: &str) -> Result<(), CoreError> {
        validate_name(name, "attribute name")
    }

    /// Returns the ordered token set of the attribute with the given `name`.
    ///
    /// The WHATWG ordered-set parse of the attribute value: split on ASCII
    /// whitespace and de-duplicate preserving first-occurrence order. An
    /// absent attribute (or an empty value) yields the empty set, never an
    /// error. This is the read behind the `DOMTokenList` length / `item` /
    /// iteration surface.
    ///
    /// # Errors
    ///
    /// * [`CoreError::WrongDocument`] when `id` belongs to another document.
    /// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
    /// * [`CoreError::Hierarchy`] when the node for `id` is not an `Element`.
    pub fn attribute_token_set(&self, id: NodeId, name: &str) -> Result<Vec<String>, CoreError> {
        let value = self.get_attribute(id, name)?.unwrap_or("");
        Ok(ordered_set_parse(value))
    }

    /// Returns whether the ordered token set of the attribute with `name`
    /// contains `token`.
    ///
    /// Never throws: an empty `token` is simply absent (`false`), and a token
    /// containing ASCII whitespace can never be a member of the set.
    pub fn attribute_token_contains(
        &self,
        id: NodeId,
        name: &str,
        token: &str,
    ) -> Result<bool, CoreError> {
        if token.is_empty() {
            return Ok(false);
        }
        Ok(self
            .attribute_token_set(id, name)?
            .iter()
            .any(|member| member == token))
    }

    /// Adds `tokens` to the ordered token set of the attribute with `name`.
    ///
    /// Every token is validated before the storage is touched; already-present
    /// tokens are left in place (the set is deduplicated). The attribute is
    /// then updated atomically: removed when the set is empty, otherwise set to
    /// the space-joined set through [`Document::set_attribute`].
    ///
    /// # Errors
    ///
    /// * [`CoreError::Syntax`] when any token is the empty string.
    /// * [`CoreError::InvalidCharacter`] when any token contains ASCII
    ///   whitespace. Both leave the attribute unchanged.
    /// * The usual handle/lifecycle errors from the attribute entries.
    pub fn attribute_token_add(
        &mut self,
        id: NodeId,
        name: &str,
        tokens: &[&str],
    ) -> Result<(), CoreError> {
        for token in tokens {
            validate_token(token)?;
        }
        let mut set = self.attribute_token_set(id, name)?;
        for token in tokens {
            if !set.iter().any(|member| member == token) {
                set.push((*token).to_string());
            }
        }
        self.update_token_attribute(id, name, &set)
    }

    /// Removes `tokens` from the ordered token set of the attribute with `name`.
    ///
    /// Tokens are validated first; absent tokens are a no-op. The attribute is
    /// then updated atomically (see [`Document::attribute_token_add`]).
    pub fn attribute_token_remove(
        &mut self,
        id: NodeId,
        name: &str,
        tokens: &[&str],
    ) -> Result<(), CoreError> {
        for token in tokens {
            validate_token(token)?;
        }
        let mut set = self.attribute_token_set(id, name)?;
        for token in tokens {
            set.retain(|member| member != token);
        }
        self.update_token_attribute(id, name, &set)
    }

    /// Toggles `token` in the ordered token set of the attribute with `name`
    /// and returns whether it is present afterwards.
    ///
    /// With `force` absent the token is added when missing and removed when
    /// present; `force` makes the operation one-way (`Some(true)` adds,
    /// `Some(false)` removes). The attribute update follows the same
    /// empty-set rule as the other mutators.
    ///
    /// # Errors
    ///
    /// [`CoreError::Syntax`] for an empty token and
    /// [`CoreError::InvalidCharacter`] for a whitespace token; both leave the
    /// attribute unchanged. Plus the usual handle/lifecycle errors.
    pub fn attribute_token_toggle(
        &mut self,
        id: NodeId,
        name: &str,
        token: &str,
        force: Option<bool>,
    ) -> Result<bool, CoreError> {
        validate_token(token)?;
        let set = self.attribute_token_set(id, name)?;
        let present = set.iter().any(|member| member == token);
        let should_add = match force {
            Some(true) => true,
            Some(false) => false,
            None => !present,
        };
        let mut set = set;
        if should_add {
            if !present {
                set.push(token.to_string());
            }
        } else {
            set.retain(|member| member != token);
        }
        self.update_token_attribute(id, name, &set)?;
        Ok(should_add)
    }

    /// Replaces `old_token` with `new_token` in the ordered token set of the
    /// attribute with `name`, returning whether the replacement happened.
    ///
    /// Returns `false` (without touching the attribute) when `old_token` is not
    /// in the set. Both tokens are validated before any mutation; when
    /// `new_token` already appears elsewhere in the set the result collapses to
    /// one occurrence (the set stays deduplicated).
    ///
    /// # Errors
    ///
    /// [`CoreError::Syntax`] for an empty token and
    /// [`CoreError::InvalidCharacter`] for a whitespace token; both leave the
    /// attribute unchanged. Plus the usual handle/lifecycle errors.
    pub fn attribute_token_replace(
        &mut self,
        id: NodeId,
        name: &str,
        old_token: &str,
        new_token: &str,
    ) -> Result<bool, CoreError> {
        validate_token(old_token)?;
        validate_token(new_token)?;
        let mut set = self.attribute_token_set(id, name)?;
        match set.iter().position(|member| member == old_token) {
            None => Ok(false),
            Some(index) => {
                set[index] = new_token.to_string();
                self.update_token_attribute(id, name, &set)?;
                Ok(true)
            }
        }
    }
}

/// Builds a [`CoreError::Hierarchy`] with `message`.
fn hierarchy(message: impl Into<String>) -> CoreError {
    CoreError::Hierarchy {
        message: message.into(),
    }
}

/// The WHATWG ordered-set parse of an attribute value.
///
/// Splits `value` on ASCII whitespace and de-duplicates the tokens preserving
/// first-occurrence order ("split-on-ascii-whitespace" followed by the
/// "ordered set parse" of the WHATWG DOM/Infra standards). An empty or
/// whitespace-only value yields the empty set.
fn ordered_set_parse(value: &str) -> Vec<String> {
    let mut set: Vec<String> = Vec::new();
    for token in value.split_ascii_whitespace() {
        if !set.iter().any(|member| member == token) {
            set.push(token.to_string());
        }
    }
    set
}

/// Validates one `DOMTokenList` token per the WHATWG contract.
///
/// An empty token fails with [`CoreError::Syntax`] (the `SyntaxError`
/// DOMException), a token containing ASCII whitespace with
/// [`CoreError::InvalidCharacter`] (the `InvalidCharacterError` DOMException).
fn validate_token(token: &str) -> Result<(), CoreError> {
    if token.is_empty() {
        return Err(CoreError::Syntax {
            message: "the provided token is empty".to_string(),
        });
    }
    if let Some(c) = token.chars().find(|&c| c.is_ascii_whitespace()) {
        return Err(CoreError::InvalidCharacter {
            what: "DOMTokenList token",
            character: Some(c),
        });
    }
    Ok(())
}

/// Applies the WHATWG update steps for a token set to the named attribute.
///
/// The attribute is removed when the set is empty; otherwise it is set to the
/// space-joined ordered set through [`Document::set_attribute`], the single
/// attribute write entry, so the T32 query index and every reader see the
/// change immediately.
impl Document {
    fn update_token_attribute(
        &mut self,
        id: NodeId,
        name: &str,
        set: &[String],
    ) -> Result<(), CoreError> {
        if set.is_empty() {
            self.remove_attribute(id, name)?;
        } else {
            let joined = set.join(" ");
            self.set_attribute(id, name, &joined)?;
        }
        Ok(())
    }
}
