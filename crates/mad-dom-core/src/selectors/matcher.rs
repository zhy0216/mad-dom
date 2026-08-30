//! Matching entry points: `Element.matches` against the arena (T30).
//!
//! [`matches`] is the Core counterpart of `Element.matches`: it parses the
//! selector string and checks whether a single element in a [`Document`]
//! matches. [`match_selector_list`] is the pre-parsed variant, so the query
//! APIs of T31 can parse a selector list once and reuse it for many elements.
//!
//! Query traversal (`querySelector`/`querySelectorAll`), live collections and
//! indexes are deliberately out of scope (T31).

use selectors::context::{
    MatchingContext, MatchingForInvalidation, MatchingMode, NeedsSelectorFlags, QuirksMode,
    SelectorCaches,
};
use selectors::matching::matches_selector_list;
use selectors::parser::SelectorList;

use crate::arena::NodeId;
use crate::dom::Document;
use crate::error::CoreError;

use super::element::DomElement;
use super::parser::{parse_selector_list, DomSelectorImpl};

/// Parses `selector` and returns whether the element `id` matches it.
///
/// # Errors
///
/// * [`CoreError::Syntax`] when `selector` is not a valid selector list.
/// * [`CoreError::WrongDocument`] when `id` belongs to another document.
/// * [`CoreError::Arena`] when `id` is a stale or invalid handle.
/// * [`CoreError::Hierarchy`] when the node for `id` is not an `Element`.
pub fn matches(doc: &Document, id: NodeId, selector: &str) -> Result<bool, CoreError> {
    let list = parse_selector_list(selector)?;
    match_selector_list(&list, doc, id)
}

/// Returns whether the element `id` matches a pre-parsed selector `list`.
///
/// # Errors
///
/// As for [`matches`], except the selector string is never parsed here, so
/// [`CoreError::Syntax`] cannot occur.
pub fn match_selector_list(
    list: &SelectorList<DomSelectorImpl>,
    doc: &Document,
    id: NodeId,
) -> Result<bool, CoreError> {
    let element = DomElement::new(doc, id)?;
    let mut caches = SelectorCaches::default();
    let mut context = MatchingContext::new(
        MatchingMode::Normal,
        None,
        &mut caches,
        QuirksMode::NoQuirks,
        NeedsSelectorFlags::No,
        MatchingForInvalidation::No,
    );
    Ok(matches_selector_list(list, &element, &mut context))
}
