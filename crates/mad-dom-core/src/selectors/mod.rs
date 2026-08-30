//! CSS selector parsing and arena matching (T30).
//!
//! Implements the "basic selector syntax" the selector ADR selected
//! (ADR-0004, validated by the T05 spike) on top of servo's `selectors` 0.40 +
//! `cssparser` 0.37 (used as unmodified MPL-2.0 dependencies):
//!
//! * type selectors with namespaces (`div`, `svg|circle`, `*|circle`) matched
//!   against the string-cache name/namespace atoms the HTML parser stores;
//! * class, id and attribute selectors (`[attr]`, `[attr=value]`, `~=`, `|=`,
//!   `^=`, `$=`, `*=`, with the `i`/`s` case flags);
//! * the descendant (` `), child (`>`), next-sibling (`+`) and later-sibling
//!   (`~`) combinators, matched directly on the arena's node/ancestor/sibling
//!   relations — no mirror tree is ever built.
//!
//! The parsed selector AST holds only this crate's identifier newtypes and
//! cssparser tokens, so it never depends on Bun or JavaScriptCore types.
//! Selector syntax errors are preserved as structured
//! [`CoreError::Syntax`](crate::error::CoreError::Syntax) values carrying the
//! source location and a stable description.
//!
//! Query traversal (`querySelector` / `querySelectorAll` / `closest` /
//! `getElementById`) lives in [`query`] (T31): a single document-order walk of
//! the arena against the pre-parsed selector list, with no index and no second
//! tree. Live collections and id/class/tag indexes remain out of scope (T32).
//! Matching entry points live in [`matcher`]; the `Element` trait view lives in
//! [`element`].

mod element;
mod matcher;
mod parser;
mod query;

pub use element::DomElement;
pub use matcher::{match_selector_list, matches};
pub use parser::{
    parse_selector_list, DomAttrValue, DomIdent, DomNamespace, DomParseError, DomSelectorImpl,
    DomSelectorParser,
};
