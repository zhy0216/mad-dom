//! Selector parser: `SelectorImpl`, identifier types and the cssparser bridge.
//!
//! This module adapts servo's `selectors` 0.40 + `cssparser` 0.37 (ADR-0004,
//! validated by the T05 spike) into `mad-dom-core`. The `selectors` crate
//! requires its identifier types to implement `ToCss + From<&str> +
//! PrecomputedHash`, and cssparser 0.37 no longer implements `ToCss` for
//! `String`/`str`, so every identifier is a small newtype written in this
//! crate (the MPL-2.0 dependencies are consumed unmodified).
//!
//! The element *name* and *namespace* stay the existing string-cache atoms
//! ([`LocalName`] / [`Namespace`]) that the HTML parser (T26) stores on each
//! element: matching compares against those atoms in the sibling `element`
//! module instead of duplicating the element's identity here. The newtypes in
//! this module only carry the *selector* side of the comparison (the local
//! name, class, id and namespace URI written in the selector string).

use std::borrow::Borrow;
use std::fmt;

use cssparser::{
    ParseError, ParseErrorKind, Parser as CssParser, ParserInput, SourceLocation, ToCss,
};
use precomputed_hash::PrecomputedHash;
use selectors::parser::{
    ParseRelative, Parser, SelectorImpl, SelectorList, SelectorParseError, SelectorParseErrorKind,
};

use crate::error::CoreError;

// ---------------------------------------------------------------------------
// SelectorImpl 与配套 newtype
// ---------------------------------------------------------------------------

/// The `SelectorImpl` for `mad-dom-core`: no pseudo-classes or pseudo-elements
/// are supported, matching the "basic selector syntax" scope of T30.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomSelectorImpl;

/// Identifier / LocalName / NamespacePrefix carrier.
///
/// `selectors` requires `ToCss + From<&str> + PrecomputedHash + Eq + Clone`;
/// cssparser 0.37 no longer provides `ToCss` for `String`/`str`, so this newtype
/// implements the surface itself.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DomIdent(pub(crate) String);

impl From<&str> for DomIdent {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

impl Borrow<str> for DomIdent {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl ToCss for DomIdent {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}

impl PrecomputedHash for DomIdent {
    fn precomputed_hash(&self) -> u32 {
        hash_str(&self.0)
    }
}

/// Namespace URL carrier: additionally requires `Default + Borrow<str>`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DomNamespace(pub(crate) String);

impl Borrow<str> for DomNamespace {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl ToCss for DomNamespace {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}

impl PrecomputedHash for DomNamespace {
    fn precomputed_hash(&self) -> u32 {
        hash_str(&self.0)
    }
}

/// Attribute value carrier: requires `Clone + Eq + ToCss + From<&str>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomAttrValue(String);

impl From<&str> for DomAttrValue {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

impl AsRef<str> for DomAttrValue {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl ToCss for DomAttrValue {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}

/// No pseudo-class is supported: the empty enum makes the matching branches
/// unreachable and the `Parser` default implementation rejects every
/// pseudo-class, so `:hover` and friends stay parse errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoPseudoClass {}

/// No pseudo-element is supported (same reasoning as [`NoPseudoClass`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoPseudoElement {}

impl ToCss for NoPseudoClass {
    fn to_css<W: fmt::Write>(&self, _dest: &mut W) -> fmt::Result {
        match *self {}
    }
}

impl ToCss for NoPseudoElement {
    fn to_css<W: fmt::Write>(&self, _dest: &mut W) -> fmt::Result {
        match *self {}
    }
}

impl selectors::parser::NonTSPseudoClass for NoPseudoClass {
    type Impl = DomSelectorImpl;

    fn is_active_or_hover(&self) -> bool {
        match *self {}
    }

    fn is_user_action_state(&self) -> bool {
        match *self {}
    }
}

impl selectors::parser::PseudoElement for NoPseudoElement {
    type Impl = DomSelectorImpl;
}

/// Selector-side string hash (used by the `selectors` bloom/caching paths).
///
/// Not a security primitive — it only feeds the selector engine's internal
/// hashing, so a simple FNV is sufficient and deterministic.
fn hash_str(s: &str) -> u32 {
    let mut h: u64 = 5381;
    for b in s.as_bytes() {
        h = h.wrapping_mul(0x100000001b3) ^ u64::from(*b);
    }
    (h >> 32) as u32 ^ h as u32
}

impl SelectorImpl for DomSelectorImpl {
    type ExtraMatchingData<'a> = ();
    type AttrValue = DomAttrValue;
    type Identifier = DomIdent;
    type LocalName = DomIdent;
    type NamespaceUrl = DomNamespace;
    type NamespacePrefix = DomIdent;
    type BorrowedNamespaceUrl = str;
    type BorrowedLocalName = str;
    type NonTSPseudoClass = NoPseudoClass;
    type PseudoElement = NoPseudoElement;
}

// ---------------------------------------------------------------------------
// 选择器字符串解析
// ---------------------------------------------------------------------------

/// `Parser::Error` requires `From<SelectorParseErrorKind>`; wrapping the
/// `selectors` parse error in a newtype avoids the orphan rule.
#[derive(Debug, Clone, PartialEq)]
pub struct DomParseError<'i>(pub SelectorParseError<'i>);

impl<'i> From<SelectorParseErrorKind<'i>> for DomParseError<'i> {
    fn from(kind: SelectorParseErrorKind<'i>) -> Self {
        Self(ParseError {
            kind: ParseErrorKind::Custom(kind),
            location: SourceLocation { line: 0, column: 0 },
        })
    }
}

/// The selector `Parser`: maps namespace prefixes to URIs and fixes the default
/// namespace for unprefixed type selectors.
///
/// The default namespace is the HTML namespace, matching CSS in HTML documents:
/// `div` selects HTML `div` elements, while `svg|circle` selects the SVG
/// `circle`. Only the `svg` and `mathml` prefixes are built in (the same pair
/// the T05 spike validated).
pub struct DomSelectorParser;

impl<'i> Parser<'i> for DomSelectorParser {
    type Impl = DomSelectorImpl;
    type Error = DomParseError<'i>;

    fn default_namespace(&self) -> Option<DomNamespace> {
        Some(DomNamespace(crate::dom::HTML_NAMESPACE.to_owned()))
    }

    fn namespace_for_prefix(&self, prefix: &DomIdent) -> Option<DomNamespace> {
        match &*prefix.0 {
            "svg" => Some(DomNamespace(crate::dom::SVG_NAMESPACE.to_owned())),
            "mathml" => Some(DomNamespace(crate::dom::MATHML_NAMESPACE.to_owned())),
            _ => None,
        }
    }
}

/// Parses `input` as a comma-separated selector list.
///
/// On success the returned [`SelectorList`] is runtime-agnostic: it holds only
/// this crate's identifier newtypes and cssparser tokens, so the parsed AST
/// never depends on Bun or JavaScriptCore types. On failure the selector
/// syntax error is preserved as a structured [`CoreError::Syntax`] carrying the
/// source location and a stable description of the offending construct.
pub fn parse_selector_list(input: &str) -> Result<SelectorList<DomSelectorImpl>, CoreError> {
    let mut parser_input = ParserInput::new(input);
    let mut parser = CssParser::new(&mut parser_input);
    SelectorList::parse(&DomSelectorParser, &mut parser, ParseRelative::No).map_err(|e| {
        CoreError::Syntax {
            message: describe_parse_error(&e),
        }
    })
}

/// Renders a stable, human-readable description of a selector parse error,
/// including the 1-based line / 1-based column of the offending construct.
fn describe_parse_error(e: &ParseError<'_, DomParseError<'_>>) -> String {
    let location = e.location;
    let at = format!("line {}, column {}", location.line + 1, location.column);
    match &e.kind {
        ParseErrorKind::Basic(basic) => format!("invalid selector at {at}: {basic}"),
        ParseErrorKind::Custom(DomParseError(inner)) => match &inner.kind {
            ParseErrorKind::Basic(basic) => format!("invalid selector at {at}: {basic}"),
            ParseErrorKind::Custom(selector_kind) => format!(
                "invalid selector at {at}: {}",
                describe_selector_kind(selector_kind)
            ),
        },
    }
}

/// Stable short descriptions for every [`SelectorParseErrorKind`] variant.
fn describe_selector_kind(kind: &SelectorParseErrorKind<'_>) -> &'static str {
    match kind {
        SelectorParseErrorKind::NoQualifiedNameInAttributeSelector(_) => {
            "missing qualified name in attribute selector"
        }
        SelectorParseErrorKind::EmptySelector => "empty selector",
        SelectorParseErrorKind::DanglingCombinator => "dangling combinator",
        SelectorParseErrorKind::NonCompoundSelector => {
            "selector contains more than one compound at this position"
        }
        SelectorParseErrorKind::NonPseudoElementAfterSlotted => {
            "expected a pseudo-element after ::slotted()"
        }
        SelectorParseErrorKind::InvalidPseudoElementAfterSlotted => {
            "invalid pseudo-element after ::slotted()"
        }
        SelectorParseErrorKind::InvalidPseudoElementInsideWhere => {
            "invalid pseudo-element inside :where()"
        }
        SelectorParseErrorKind::InvalidState => "invalid selector state",
        SelectorParseErrorKind::UnexpectedTokenInAttributeSelector(_) => {
            "unexpected token in attribute selector"
        }
        SelectorParseErrorKind::PseudoElementExpectedColon(_) => "expected ':' in pseudo-element",
        SelectorParseErrorKind::PseudoElementExpectedIdent(_) => {
            "expected identifier in pseudo-element"
        }
        SelectorParseErrorKind::NoIdentForPseudo(_) => {
            "expected identifier for pseudo-class or pseudo-element"
        }
        SelectorParseErrorKind::UnsupportedPseudoClassOrElement(_) => {
            "unsupported pseudo-class or pseudo-element"
        }
        SelectorParseErrorKind::UnexpectedIdent(_) => "unexpected identifier",
        SelectorParseErrorKind::ExpectedNamespace(_) => "expected a namespace prefix",
        SelectorParseErrorKind::ExpectedBarInAttr(_) => "expected '|' in attribute selector",
        SelectorParseErrorKind::BadValueInAttr(_) => "bad value in attribute selector",
        SelectorParseErrorKind::InvalidQualNameInAttr(_) => {
            "invalid qualified name in attribute selector"
        }
        SelectorParseErrorKind::ExplicitNamespaceUnexpectedToken(_) => {
            "unexpected token in explicit namespace"
        }
        SelectorParseErrorKind::ClassNeedsIdent(_) => "expected an identifier after '.'",
    }
}
