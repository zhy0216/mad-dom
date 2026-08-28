//! `selectors` crate（servo/stylo）最小集成：在同一份 [`SpikeTree`] 上解析并
//! 匹配 CSS 选择器。
//!
//! 验证点（对应 T05）：
//! - 匹配通过 `Element` trait 直接 dispatch 到槽位存储，**不要求长期镜像树**；
//! - 覆盖 tag / class / id / 后代组合器命中与未命中；
//! - namespace 选择器（`svg|circle`、`*|circle`）作用于存储中的 `QualName`；
//! - 选择器语法错误经结构化 `ParseError` 上抛（映射到 String 仅是原型简化）。
//!
//! 原型未覆盖（生产 T30 需要补齐）：`:hover` 等 non-TS 伪类、伪元素、
//! `:has()`、bloom filter 快速拒绝、query index。

use std::borrow::Borrow;
use std::fmt;

use cssparser::{
    ParseError, ParseErrorKind, Parser as CssParser, ParserInput, SourceLocation, ToCss,
};
use precomputed_hash::PrecomputedHash;
use selectors::attr::{AttrSelectorOperation, CaseSensitivity, NamespaceConstraint};
use selectors::context::{
    MatchingContext, MatchingForInvalidation, MatchingMode, NeedsSelectorFlags, QuirksMode,
    SelectorCaches,
};
use selectors::matching::matches_selector_list;
use selectors::parser::{
    ParseRelative, Parser, Selector, SelectorImpl, SelectorList, SelectorParseError,
    SelectorParseErrorKind,
};
use selectors::{Element, OpaqueElement};

use crate::store::{Handle, NodeData, SpikeTree};

// ---------------------------------------------------------------------------
// SelectorImpl 与配套类型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpikeSelectorImpl;

/// Identifier / LocalName / NamespacePrefix 的承载类型。
/// `selectors` 要求 `ToCss + From<&str> + PrecomputedHash + Eq + Clone`；
/// cssparser 0.37 已不再为 `String` 提供 `ToCss`，因此用 newtype 自己实现。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SpikeIdent(String);

impl From<&str> for SpikeIdent {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

impl Borrow<str> for SpikeIdent {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl ToCss for SpikeIdent {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}

impl PrecomputedHash for SpikeIdent {
    fn precomputed_hash(&self) -> u32 {
        hash_str(&self.0)
    }
}

/// NamespaceUrl：额外要求 `Default + Borrow<str>`。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SpikeNamespace(String);

impl Borrow<str> for SpikeNamespace {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl ToCss for SpikeNamespace {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}

impl PrecomputedHash for SpikeNamespace {
    fn precomputed_hash(&self) -> u32 {
        hash_str(&self.0)
    }
}

/// AttrValue：`Clone + Eq + ToCss + From<&str>`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpikeAttrValue(String);

impl From<&str> for SpikeAttrValue {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

impl AsRef<str> for SpikeAttrValue {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl ToCss for SpikeAttrValue {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}

/// 本 spike 不支持任何伪类/伪元素：空类型让匹配分支不可达，
/// 同时 `Parser` 的默认实现会直接拒绝它们。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoPseudoClass {}

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
    type Impl = SpikeSelectorImpl;

    fn is_active_or_hover(&self) -> bool {
        match *self {}
    }

    fn is_user_action_state(&self) -> bool {
        match *self {}
    }
}

impl selectors::parser::PseudoElement for NoPseudoElement {
    type Impl = SpikeSelectorImpl;
}

fn hash_str(s: &str) -> u32 {
    // 只用于 selector 的 bloom/缓存哈希，不承担安全职责。
    let mut h: u64 = 5381;
    for b in s.as_bytes() {
        h = h.wrapping_mul(0x100000001b3) ^ u64::from(*b);
    }
    (h >> 32) as u32 ^ h as u32
}

impl SelectorImpl for SpikeSelectorImpl {
    type ExtraMatchingData<'a> = ();
    type AttrValue = SpikeAttrValue;
    type Identifier = SpikeIdent;
    type LocalName = SpikeIdent;
    type NamespaceUrl = SpikeNamespace;
    type NamespacePrefix = SpikeIdent;
    type BorrowedNamespaceUrl = str;
    type BorrowedLocalName = str;
    type NonTSPseudoClass = NoPseudoClass;
    type PseudoElement = NoPseudoElement;
}

// ---------------------------------------------------------------------------
// 选择器字符串解析
// ---------------------------------------------------------------------------

/// `Parser::Error` 要求 `From<SelectorParseErrorKind>`；包一层以绕过孤儿规则。
#[derive(Debug, Clone, PartialEq)]
pub struct SpikeSelectorError<'i>(pub SelectorParseError<'i>);

impl<'i> From<SelectorParseErrorKind<'i>> for SpikeSelectorError<'i> {
    fn from(kind: SelectorParseErrorKind<'i>) -> Self {
        Self(ParseError {
            kind: ParseErrorKind::Custom(kind),
            location: SourceLocation { line: 0, column: 0 },
        })
    }
}

pub struct SpikeParser;

impl<'i> Parser<'i> for SpikeParser {
    type Impl = SpikeSelectorImpl;
    type Error = SpikeSelectorError<'i>;

    fn default_namespace(&self) -> Option<SpikeNamespace> {
        // 与 CSS in HTML 一致：无前缀类型选择器限定在 HTML namespace。
        Some(SpikeNamespace("http://www.w3.org/1999/xhtml".to_owned()))
    }

    fn namespace_for_prefix(&self, prefix: &SpikeIdent) -> Option<SpikeNamespace> {
        // 原型只内置 svg / mathml 两个前缀，验证 namespace 选择器能力。
        match &*prefix.0 {
            "svg" => Some(SpikeNamespace("http://www.w3.org/2000/svg".to_owned())),
            "mathml" => Some(SpikeNamespace(
                "http://www.w3.org/1998/Math/MathML".to_owned(),
            )),
            _ => None,
        }
    }
}

/// 解析选择器字符串；错误以字符串呈现仅是原型简化（生产映射见 ADR-0004 错误模型）。
pub fn parse_selector_list(input: &str) -> Result<SelectorList<SpikeSelectorImpl>, String> {
    let mut parser_input = ParserInput::new(input);
    let mut parser = CssParser::new(&mut parser_input);
    SelectorList::parse(&SpikeParser, &mut parser, ParseRelative::No)
        .map_err(|e| format!("invalid selector `{input}`: {e:?}"))
}

// ---------------------------------------------------------------------------
// Element trait：把匹配 dispatch 到 SpikeTree
// ---------------------------------------------------------------------------

/// 借用树 + 槽位下标的元素视图。`Clone` 仅复制这两个值（零分配）。
#[derive(Clone)]
pub struct SpikeElement<'a> {
    tree: &'a SpikeTree,
    slot: u32,
}

impl<'a> fmt::Debug for SpikeElement<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SpikeElement")
            .field("slot", &self.slot)
            .finish()
    }
}

impl<'a> SpikeElement<'a> {
    pub fn new(tree: &'a SpikeTree, handle: Handle) -> Self {
        debug_assert!(tree.is_element(handle));
        Self {
            tree,
            slot: handle.0,
        }
    }

    fn handle(&self) -> Handle {
        Handle(self.slot)
    }

    fn element(&self) -> &'a crate::store::ElementData {
        self.tree
            .element_data(self.handle())
            .expect("not an element")
    }

    fn attr(&self, name: &str) -> Option<&'a str> {
        self.element()
            .attrs
            .iter()
            .find(|(n, _)| &*n.local == name && n.ns.is_empty())
            .map(|(_, v)| v.as_str())
    }
}

impl<'a> Element for SpikeElement<'a> {
    type Impl = SpikeSelectorImpl;

    fn opaque(&self) -> OpaqueElement {
        // 身份锚定到树内槽位（匹配期间为只读借用），等价于 servo 用 DOM 节点指针。
        OpaqueElement::new(&self.tree.slot(self.handle()))
    }

    fn parent_element(&self) -> Option<Self> {
        let p = self.tree.slot(self.handle()).parent?;
        self.tree.is_element(p).then_some(Self {
            tree: self.tree,
            slot: p.0,
        })
    }

    fn parent_node_is_shadow_root(&self) -> bool {
        false
    }

    fn containing_shadow_host(&self) -> Option<Self> {
        None
    }

    fn is_pseudo_element(&self) -> bool {
        false
    }

    fn prev_sibling_element(&self) -> Option<Self> {
        self.sibling_element(-1)
    }

    fn next_sibling_element(&self) -> Option<Self> {
        self.sibling_element(1)
    }

    fn first_element_child(&self) -> Option<Self> {
        self.tree
            .element_children(self.handle())
            .first()
            .map(|&h| Self {
                tree: self.tree,
                slot: h.0,
            })
    }

    fn is_html_element_in_html_document(&self) -> bool {
        self.element().name.ns == html5ever::ns!(html)
    }

    fn has_local_name(&self, local_name: &str) -> bool {
        &*self.element().name.local == local_name
    }

    fn has_namespace(&self, ns: &str) -> bool {
        &*self.element().name.ns == ns
    }

    fn is_same_type(&self, other: &Self) -> bool {
        let a = &self.element().name;
        let b = &other.element().name;
        a.local == b.local && a.ns == b.ns
    }

    fn attr_matches(
        &self,
        ns: &NamespaceConstraint<&SpikeNamespace>,
        local_name: &SpikeIdent,
        operation: &AttrSelectorOperation<&SpikeAttrValue>,
    ) -> bool {
        self.element().attrs.iter().any(|(name, value)| {
            let ns_ok = match ns {
                NamespaceConstraint::Any => true,
                NamespaceConstraint::Specific(url) => *name.ns == url.0,
            };
            ns_ok
                && *name.local == local_name.0
                && match operation {
                    AttrSelectorOperation::Exists => true,
                    AttrSelectorOperation::WithValue { .. } => operation.eval_str(value),
                }
        })
    }

    fn match_non_ts_pseudo_class(
        &self,
        pc: &NoPseudoClass,
        _context: &mut MatchingContext<Self::Impl>,
    ) -> bool {
        match *pc {}
    }

    fn match_pseudo_element(
        &self,
        pe: &NoPseudoElement,
        _context: &mut MatchingContext<Self::Impl>,
    ) -> bool {
        match *pe {}
    }

    fn apply_selector_flags(&self, _flags: selectors::matching::ElementSelectorFlags) {}

    fn is_link(&self) -> bool {
        false
    }

    fn is_html_slot_element(&self) -> bool {
        false
    }

    fn has_id(&self, id: &SpikeIdent, case_sensitivity: CaseSensitivity) -> bool {
        self.attr("id")
            .map(|v| case_sensitivity.eq(v.as_bytes(), id.0.as_bytes()))
            .unwrap_or(false)
    }

    fn has_class(&self, name: &SpikeIdent, case_sensitivity: CaseSensitivity) -> bool {
        self.attr("class")
            .map(|v| {
                v.split_ascii_whitespace()
                    .any(|token| case_sensitivity.eq(token.as_bytes(), name.0.as_bytes()))
            })
            .unwrap_or(false)
    }

    fn has_custom_state(&self, _name: &SpikeIdent) -> bool {
        false
    }

    fn imported_part(
        &self,
        _name: &SpikeIdent,
    ) -> Option<<Self::Impl as SelectorImpl>::Identifier> {
        None
    }

    fn is_part(&self, _name: &SpikeIdent) -> bool {
        false
    }

    fn is_empty(&self) -> bool {
        self.tree
            .children(self.handle())
            .iter()
            .all(|&c| match &self.tree.slot(c).data {
                NodeData::Text(s) => s.is_empty(),
                NodeData::Element(_) => false,
                _ => true,
            })
    }

    fn is_root(&self) -> bool {
        match self.tree.slot(self.handle()).parent {
            Some(p) => matches!(self.tree.slot(p).data, NodeData::Document),
            None => false,
        }
    }

    fn ignores_nth_child_selectors(&self) -> bool {
        false
    }

    fn add_element_unique_hashes(&self, _filter: &mut selectors::bloom::BloomFilter) -> bool {
        // 无祖先哈希；仅在 :has() 的 filter 路径被调用，而本 spike 未启用 :has()。
        false
    }
}

impl<'a> SpikeElement<'a> {
    fn sibling_element(&self, delta: i32) -> Option<Self> {
        let h = self.handle();
        let parent = self.tree.slot(h).parent?;
        let siblings = self.tree.slot(parent).children.clone();
        let pos = siblings.iter().position(|&c| c == h)?;
        let next = match delta {
            -1 => pos.checked_sub(1)?,
            1 => pos + 1,
            _ => unreachable!(),
        };
        let s = *siblings.get(next)?;
        self.tree.is_element(s).then_some(Self {
            tree: self.tree,
            slot: s.0,
        })
    }
}

// ---------------------------------------------------------------------------
// 匹配入口
// ---------------------------------------------------------------------------

/// 单元素匹配：`element.matches(selector)` 的原型形态。
pub fn matches(tree: &SpikeTree, element: Handle, selector: &str) -> Result<bool, String> {
    let list = parse_selector_list(selector)?;
    let el = SpikeElement::new(tree, element);
    Ok(matches_with_list(&list, &el))
}

/// 子树范围匹配：`scope.querySelectorAll(selector)` 的原型形态（文档序）。
pub fn query_selector_all(
    tree: &SpikeTree,
    scope: Handle,
    selector: &str,
) -> Result<Vec<Handle>, String> {
    let list = parse_selector_list(selector)?;
    let mut out = Vec::new();
    for h in tree.descendant_elements(scope) {
        let el = SpikeElement::new(tree, h);
        if matches_with_list(&list, &el) {
            out.push(h);
        }
    }
    Ok(out)
}

fn matches_with_list(list: &SelectorList<SpikeSelectorImpl>, el: &SpikeElement<'_>) -> bool {
    let mut caches = SelectorCaches::default();
    let mut context = MatchingContext::new(
        MatchingMode::Normal,
        None,
        &mut caches,
        QuirksMode::NoQuirks,
        NeedsSelectorFlags::No,
        MatchingForInvalidation::No,
    );
    matches_selector_list(list, el, &mut context)
}

/// 导出单个选择器以便测试右端组合器语义（保持与 crate 内部一致的匹配路径）。
pub fn matches_single(selector: &Selector<SpikeSelectorImpl>, el: &SpikeElement<'_>) -> bool {
    let mut caches = SelectorCaches::default();
    let mut context = MatchingContext::new(
        MatchingMode::Normal,
        None,
        &mut caches,
        QuirksMode::NoQuirks,
        NeedsSelectorFlags::No,
        MatchingForInvalidation::No,
    );
    selectors::matching::matches_selector(selector, 0, None, el, &mut context)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse_document_tree;
    use html5ever::QualName;

    const DOC: &str = concat!(
        "<!DOCTYPE html>",
        "<html><body>",
        "<div id=\"a\" class=\"container box\"><p class=\"x\">1</p><span>2</span></div>",
        "<svg viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"2\"/></svg>",
        "</body></html>"
    );

    /// 在树中按 local name 找第一个元素。
    fn first_by_name(tree: &SpikeTree, name: &str) -> Handle {
        tree.descendant_elements(tree.document())
            .into_iter()
            .find(|&h| tree.local_name(h) == Some(name))
            .unwrap_or_else(|| panic!("element `{name}` not found"))
    }

    #[test]
    fn selectors_hit_and_miss_on_tag_class_id_and_combinators() {
        let tree = parse_document_tree(DOC);
        let div = first_by_name(&tree, "div");
        let p = first_by_name(&tree, "p");
        let span = first_by_name(&tree, "span");

        // 类型 / 类 / id / 通配：命中。
        assert!(matches(&tree, div, "div").unwrap());
        assert!(matches(&tree, div, "*.container").unwrap());
        assert!(matches(&tree, div, ".box.container").unwrap());
        assert!(matches(&tree, div, "#a").unwrap());
        assert!(matches(&tree, div, "*|*").unwrap());

        // 后代与子组合器：body 下的 div 命中，div 下的 span 经 `div > *` 命中。
        assert!(matches(&tree, div, "body div").unwrap());
        assert!(matches(&tree, span, "div > *").unwrap());
        assert!(matches(&tree, p, "div p.x").unwrap());

        // 未命中：类型不符 / id 不符 / 类不符 / 祖先链不符。
        assert!(!matches(&tree, div, "p").unwrap());
        assert!(!matches(&tree, div, "#b").unwrap());
        assert!(!matches(&tree, div, ".missing").unwrap());
        assert!(!matches(&tree, p, "body > p").unwrap());
    }

    #[test]
    fn namespace_selectors_match_storage_qualnames() {
        let tree = parse_document_tree(DOC);
        let circle = first_by_name(&tree, "circle");
        let div = first_by_name(&tree, "div");

        // 前缀 `svg` 映射到 SVG namespace：svg|circle 命中，无前缀（默认 HTML
        // namespace）的 circle 未命中；*|* 与 *|div 跨 namespace 命中。
        assert!(matches(&tree, circle, "svg|circle").unwrap());
        assert!(matches(&tree, circle, "*|circle").unwrap());
        assert!(!matches(&tree, circle, "circle").unwrap());
        assert!(matches(&tree, div, "*|div").unwrap());
        assert!(!matches(&tree, div, "svg|div").unwrap());
    }

    #[test]
    fn query_selector_all_returns_document_order_hits() {
        let tree = parse_document_tree(DOC);
        let div = first_by_name(&tree, "div");

        // div 子树内两个元素按文档序返回（p 在 span 前）。
        let hits = query_selector_all(&tree, div, "*|*").unwrap();
        let names: Vec<&str> = hits.iter().map(|&h| tree.local_name(h).unwrap()).collect();
        assert_eq!(names, ["p", "span"]);

        // 未命中返回空列表；svg 子树里同样能查到 circle
        //（无前缀时受默认 HTML namespace 约束，需 `*|circle` 跨 namespace）。
        assert!(query_selector_all(&tree, div, "svg|circle")
            .unwrap()
            .is_empty());
        let svg = first_by_name(&tree, "svg");
        let in_svg = query_selector_all(&tree, svg, "*|circle").unwrap();
        assert_eq!(in_svg.len(), 1);
    }

    #[test]
    fn invalid_selector_is_a_structured_parse_error() {
        let tree = parse_document_tree(DOC);
        let div = first_by_name(&tree, "div");

        // 语法错误（多余冒号）→ Err；未知前缀 → Err；不存在的伪类 → Err。
        for bad in ["div:::", "unknown|div", "div:totally-bogus"] {
            assert!(
                matches(&tree, div, bad).is_err(),
                "`{bad}` should not parse"
            );
        }
        // 解析失败不产生部分匹配结果。
        assert!(query_selector_all(&tree, div, "div:::").is_err());
    }

    #[test]
    fn matches_single_uses_rightmost_combinator_semantics() {
        let tree = parse_document_tree(DOC);
        let list = parse_selector_list("body > div.container").unwrap();
        let selector = list.slice().first().expect("one selector");

        // div 命中右端 `div.container`，body 是其父 → 整条链命中。
        let div = SpikeElement::new(&tree, first_by_name(&tree, "div"));
        assert!(matches_single(selector, &div));

        // p 的右端不匹配 → 链不成立（body 后代但右端不符）。
        let p = SpikeElement::new(&tree, first_by_name(&tree, "p"));
        assert!(!matches_single(selector, &p));

        // SelectorList 解析器接受逗号分隔多选择器。
        let multi = parse_selector_list("span, svg|circle").unwrap();
        assert_eq!(multi.slice().len(), 2);
    }

    #[test]
    fn context_element_fragment_nodes_match_selectors() {
        // fragment（tr 上下文）解析出的 td 同样可被选择器命中——
        // 匹配不要求节点来自 document 解析。
        let ctx = QualName::new(None, html5ever::ns!(html), html5ever::local_name!("tr"));
        let (tree, tr) = crate::parse::parse_fragment_tree(&ctx, "<td class=\"cell\">x</td>");
        let td = tree.element_children(tr)[0];
        assert!(matches(&tree, td, "td.cell").unwrap());
        assert!(!matches(&tree, td, "svg|td").unwrap());
    }
}
