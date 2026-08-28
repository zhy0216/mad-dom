//! html5ever `TreeSink` 实现：把解析结果直接写入 [`SpikeTree`]。
//!
//! 验证点（对应 T05）：
//! - 解析器直接写统一存储：token 流经 `TreeSink` 逐节点写入槽位存储，
//!   中途不存在第二棵 DOM；
//! - document 解析与 fragment 解析（`parse_fragment_for_element` + 上下文元素）；
//! - 解析错误模型：`parse_error` 只收集消息、树照常建立（HTML5 错误恢复语义）。

use std::borrow::Cow;
use std::cell::RefCell;

use html5ever::driver::parse_fragment_for_element;
use html5ever::tendril::fmt::UTF8;
use html5ever::tendril::{Tendril, TendrilSink};
use html5ever::tree_builder::{ElemName, ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::{parse_document, Attribute, LocalName, Namespace, ParseOpts, QualName};

use crate::store::{ElementData, Handle, NodeData, SpikeTree};

/// spike 解析 sink：`RefCell<SpikeTree>` 提供内部可变性
/// （html5ever 0.39 的 `TreeSink` 方法全部是 `&self`）。
pub struct SpikeSink {
    tree: RefCell<SpikeTree>,
}

impl Default for SpikeSink {
    fn default() -> Self {
        Self::new()
    }
}

impl SpikeSink {
    pub fn new() -> Self {
        Self {
            tree: RefCell::new(SpikeTree::new()),
        }
    }

    /// 在文档下创建一个上下文元素（fragment 解析用）。
    pub fn create_context_element(&self, name: &QualName) -> Handle {
        let mut tree = self.tree.borrow_mut();
        let ctx = tree.push_slot(NodeData::Element(ElementData {
            name: name.clone(),
            attrs: Vec::new(),
            template_contents: None,
            mathml_annotation_xml_integration_point: false,
            had_duplicate_attributes: false,
        }));
        let doc = tree.document();
        tree.attach(doc, ctx);
        ctx
    }
}

/// `TreeSink::ElemName` 关联类型要求 `ns()`/`local_name()` 返回借用引用。
/// 我们的句柄只是槽位下标，拿不到数据借用，因此返回持有 string-cache Atom
/// 克隆的 owned 值——Atom 克隆是廉价引用计数操作，且不会让 `RefCell` 借用
/// 逃逸出方法（避免与可变方法冲突导致 panic）。
#[derive(Debug)]
pub struct SpikeElemName {
    ns: Namespace,
    local: LocalName,
}

impl ElemName for SpikeElemName {
    fn ns(&self) -> &Namespace {
        &self.ns
    }

    fn local_name(&self) -> &LocalName {
        &self.local
    }
}

impl TreeSink for SpikeSink {
    type Handle = Handle;
    type Output = SpikeTree;
    type ElemName<'a> = SpikeElemName;

    fn finish(self) -> Self::Output {
        self.tree.into_inner()
    }

    fn parse_error(&self, msg: Cow<'static, str>) {
        self.tree.borrow_mut().parse_errors.push(msg.into_owned());
    }

    fn get_document(&self) -> Self::Handle {
        self.tree.borrow().document()
    }

    fn elem_name<'a>(&'a self, target: &'a Self::Handle) -> Self::ElemName<'a> {
        let tree = self.tree.borrow();
        match &tree.slot(*target).data {
            NodeData::Element(e) => SpikeElemName {
                ns: e.name.ns.clone(),
                local: e.name.local.clone(),
            },
            _ => panic!("elem_name called on non-element"),
        }
    }

    fn create_element(
        &self,
        name: QualName,
        attrs: Vec<Attribute>,
        flags: ElementFlags,
    ) -> Self::Handle {
        let mut tree = self.tree.borrow_mut();
        let attrs = attrs
            .into_iter()
            .map(|a| (a.name, a.value.to_string()))
            .collect();
        // template contents 也是一个槽位（fragment），仅登记不挂树。
        let template_contents = if flags.template {
            Some(tree.push_slot(NodeData::Document))
        } else {
            None
        };
        tree.push_slot(NodeData::Element(ElementData {
            name,
            attrs,
            template_contents,
            mathml_annotation_xml_integration_point: flags.mathml_annotation_xml_integration_point,
            had_duplicate_attributes: flags.had_duplicate_attributes,
        }))
    }

    fn create_comment(&self, text: Tendril<UTF8>) -> Self::Handle {
        self.tree
            .borrow_mut()
            .push_slot(NodeData::Comment(text.to_string()))
    }

    fn create_pi(&self, target: Tendril<UTF8>, data: Tendril<UTF8>) -> Self::Handle {
        self.tree
            .borrow_mut()
            .push_slot(NodeData::ProcessingInstruction {
                target: target.to_string(),
                data: data.to_string(),
            })
    }

    fn append(&self, parent: &Self::Handle, child: NodeOrText<Self::Handle>) {
        let mut tree = self.tree.borrow_mut();
        match child {
            NodeOrText::AppendText(s) => {
                // 相邻文本必须合并（TreeSink 契约）。
                if !tree.merge_text_into_last_child(*parent, &s) {
                    let h = tree.push_slot(NodeData::Text(s.to_string()));
                    tree.attach(*parent, h);
                }
            }
            NodeOrText::AppendNode(h) => tree.attach(*parent, h),
        }
    }

    fn append_based_on_parent_node(
        &self,
        element: &Self::Handle,
        prev_element: &Self::Handle,
        child: NodeOrText<Self::Handle>,
    ) {
        // foster parenting：`element` 有父节点则插到它前面，否则追加到
        // `prev_element` 的子列表末尾（见 html5ever InsertionPoint 文档）。
        let has_parent = self.tree.borrow().slot(*element).parent.is_some();
        if has_parent {
            self.append_before_sibling(element, child);
        } else {
            self.append(prev_element, child);
        }
    }

    fn append_doctype_to_document(
        &self,
        name: Tendril<UTF8>,
        public_id: Tendril<UTF8>,
        system_id: Tendril<UTF8>,
    ) {
        let mut tree = self.tree.borrow_mut();
        let h = tree.push_slot(NodeData::DocType {
            name: name.to_string(),
            public_id: public_id.to_string(),
            system_id: system_id.to_string(),
        });
        let doc = tree.document();
        tree.attach(doc, h);
    }

    fn get_template_contents(&self, target: &Self::Handle) -> Self::Handle {
        self.tree
            .borrow()
            .element_data(*target)
            .and_then(|e| e.template_contents)
            .expect("get_template_contents called on non-template element")
    }

    fn same_node(&self, x: &Self::Handle, y: &Self::Handle) -> bool {
        x == y
    }

    fn set_quirks_mode(&self, mode: QuirksMode) {
        self.tree.borrow_mut().quirks_mode = mode;
    }

    fn append_before_sibling(&self, sibling: &Self::Handle, new_node: NodeOrText<Self::Handle>) {
        let mut tree = self.tree.borrow_mut();
        if let NodeOrText::AppendNode(h) = new_node {
            // NB：new_node 可能已有旧父节点，先摘除再定位，避免位置漂移。
            tree.detach(h);
        }
        let parent = tree
            .slot(*sibling)
            .parent
            .expect("sibling must have a parent");
        let pos = tree
            .index_in_parent(*sibling)
            .expect("sibling must be a child of its parent");
        match new_node {
            NodeOrText::AppendText(s) => {
                // 新文本与其将来的前一个文本兄弟合并（TreeSink 契约）。
                if pos > 0 {
                    let prev = tree.slot(parent).children[pos - 1];
                    if tree.append_text_to(prev, &s) {
                        return;
                    }
                }
                let h = tree.push_slot(NodeData::Text(s.to_string()));
                tree.insert_child_at(parent, pos, h);
            }
            NodeOrText::AppendNode(h) => tree.insert_child_at(parent, pos, h),
        }
    }

    fn add_attrs_if_missing(&self, target: &Self::Handle, attrs: Vec<Attribute>) {
        self.add_attrs_if_missing_impl(target, attrs);
    }

    fn remove_from_parent(&self, target: &Self::Handle) {
        self.tree.borrow_mut().detach(*target);
    }

    fn reparent_children(&self, node: &Self::Handle, new_parent: &Self::Handle) {
        let children = self.tree.borrow().children(*node).to_vec();
        for c in children {
            self.tree.borrow_mut().attach(*new_parent, c);
        }
    }

    fn is_mathml_annotation_xml_integration_point(&self, handle: &Self::Handle) -> bool {
        self.tree
            .borrow()
            .element_data(*handle)
            .map(|e| e.mathml_annotation_xml_integration_point)
            .unwrap_or(false)
    }
}

impl SpikeSink {
    /// `add_attrs_if_missing` 的实际实现（保持 borrow 窗口最小）。
    fn add_attrs_if_missing_impl(&self, target: &Handle, attrs: Vec<Attribute>) {
        let mut tree = self.tree.borrow_mut();
        let Some(elem) = tree.element_data_mut(*target) else {
            return;
        };
        for a in attrs {
            if !elem.attrs.iter().any(|(n, _)| *n == a.name) {
                elem.attrs.push((a.name, a.value.to_string()));
            }
        }
    }
}

/// 解析完整 HTML 文档（document parsing）。
pub fn parse_document_tree(input: &str) -> SpikeTree {
    let parser = parse_document(SpikeSink::new(), ParseOpts::default());
    parser.one(input)
}

/// 在给定上下文元素下解析 fragment（fragment parsing + context element）。
/// 返回树与上下文元素句柄；解析结果节点是上下文元素的子节点。
///
/// html5ever 0.39 的 fragment 流程按 WHATWG 算法新建一个合成 `<html>` 根，
/// 解析结果挂在合成根下，传入的上下文元素只影响 tokenizer 状态与插入模式；
/// 算法的最终输出是"根的子节点"，因此解析完成后把合成根的子节点移交给
/// 上下文元素、并从文档摘除合成根。合成根槽位留在存储里（原型不做槽位
/// 回收，见 store.rs 注释），全程不存在第二棵 DOM。
pub fn parse_fragment_tree(context_name: &QualName, input: &str) -> (SpikeTree, Handle) {
    let sink = SpikeSink::new();
    let ctx = sink.create_context_element(context_name);
    let parser = parse_fragment_for_element(sink, ParseOpts::default(), ctx, false, None);
    let mut tree = parser.one(input);
    let doc = tree.document();
    // fragment 模式下文档子节点 = 上下文元素 + 合成 `<html>` 根。
    let synthetic_roots: Vec<Handle> = tree
        .children(doc)
        .iter()
        .copied()
        .filter(|&h| h != ctx && tree.is_element(h))
        .collect();
    for root in synthetic_roots {
        let children = tree.children(root).to_vec();
        for c in children {
            tree.attach(ctx, c);
        }
        tree.detach(root);
    }
    (tree, ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::NodeData;
    use html5ever::{local_name, ns};

    const DOC: &str = concat!(
        "<!DOCTYPE html>\n",
        "<html>\n",
        "<head><title>T&amp;S</title></head>\n",
        "<body class=\"main\">\n",
        "<div id=\"a\" class=\"container\"><p>hello</p><p class=\"x\">world</p></div>\n",
        "<!-- spike comment -->\n",
        "<svg viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"2\"/></svg>\n",
        "</body>\n",
        "</html>\n"
    );

    fn expect_element(tree: &SpikeTree, h: Handle) -> &ElementData {
        tree.element_data(h)
            .unwrap_or_else(|| panic!("not an element at {:?}", h))
    }

    fn local(tree: &SpikeTree, h: Handle) -> String {
        expect_element(tree, h).name.local.to_string()
    }

    #[test]
    fn document_parse_writes_directly_into_slots() {
        let tree = parse_document_tree(DOC);

        // 文档槽位是 0；直接子节点 = doctype + html（根元素）。
        let doc = tree.document();
        let doc_children = tree.children(doc).to_vec();
        assert_eq!(
            doc_children.len(),
            2,
            "document children: {:?}",
            doc_children
        );
        assert!(matches!(
            tree.data(doc_children[0]),
            NodeData::DocType { .. }
        ));
        assert_eq!(local(&tree, doc_children[1]), "html");

        // doctype 内容被完整记录。
        match tree.data(doc_children[0]) {
            NodeData::DocType { name, .. } => assert_eq!(name, "html"),
            _ => unreachable!(),
        }

        // html > (head, body) 嵌套正确。
        let html = doc_children[1];
        let top = tree.element_children(html);
        assert_eq!(
            top.iter().map(|&h| local(&tree, h)).collect::<Vec<_>>(),
            ["head", "body"]
        );

        // title 文本：实体展开 + 相邻文本合并为单节点。
        let title = tree.element_children(top[0])[0];
        assert_eq!(local(&tree, title), "title");
        let title_children = tree.children(title).to_vec();
        assert_eq!(title_children.len(), 1, "adjacent text must merge");
        assert_eq!(tree.text(title_children[0]), Some("T&S"));

        // body 子结构：div（两个 p）、注释、svg（namespace 见下）。
        let body = top[1];
        let div = tree.element_children(body)[0];
        assert_eq!(local(&tree, div), "div");
        let ps = tree.element_children(div);
        assert_eq!(ps.len(), 2);
        assert_eq!(tree.text(tree.children(ps[0]).to_vec()[0]), Some("hello"));
        assert_eq!(
            expect_element(&tree, ps[1])
                .attrs
                .iter()
                .find(|(n, _)| &*n.local == "class")
                .map(|(_, v)| v.as_str()),
            Some("x")
        );
        let comment = tree
            .children(body)
            .iter()
            .copied()
            .find(|&h| matches!(tree.data(h), NodeData::Comment(_)))
            .expect("comment node");
        assert_eq!(tree.children(comment).len(), 0);

        // namespace 能力：svg/circle 位于 SVG namespace，body 位于 HTML namespace。
        let svg = tree
            .element_children(body)
            .into_iter()
            .find(|&h| local(&tree, h) == "svg")
            .unwrap();
        assert_eq!(expect_element(&tree, svg).name.ns, ns!(svg));
        let circle = tree.element_children(svg)[0];
        assert_eq!(local(&tree, circle), "circle");
        assert_eq!(expect_element(&tree, circle).name.ns, ns!(svg));
        assert_eq!(expect_element(&tree, div).name.ns, ns!(html));

        // 属性、quirks、错误收集。
        assert_eq!(expect_element(&tree, body).attrs[0].1, "main");
        assert_eq!(tree.quirks_mode, QuirksMode::NoQuirks);
        assert!(tree.parse_errors.is_empty(), "{:?}", tree.parse_errors);
    }

    #[test]
    fn fragment_parse_honors_context_element() {
        // 上下文元素 div：p/b 成为它的子节点（innerHTML 语义），不触碰 document。
        let ctx_name = QualName::new(None, ns!(html), local_name!("div"));
        let (tree, ctx) = parse_fragment_tree(&ctx_name, "<p>hi</p><b>bold</b>");

        assert_eq!(local(&tree, ctx), "div");
        let ctx_children = tree.element_children(ctx);
        assert_eq!(
            ctx_children
                .iter()
                .map(|&h| local(&tree, h))
                .collect::<Vec<_>>(),
            ["p", "b"]
        );
        let p = ctx_children[0];
        let p_text = tree.children(p).to_vec();
        assert_eq!(p_text.len(), 1);
        assert_eq!(tree.text(p_text[0]), Some("hi"));

        // fragment 解析不会生成第二个 document 子树：文档槽位只有上下文元素。
        assert_eq!(tree.element_children(tree.document()), [ctx]);

        // 上下文元素语义生效：表格上下文中 tr/td 不会像在 div 里那样被“修复”掉。
        let tr_ctx = QualName::new(None, ns!(html), local_name!("tr"));
        let (tree2, tr) = parse_fragment_tree(&tr_ctx, "<td>x</td>");
        let cells = tree2.element_children(tr);
        assert_eq!(
            cells.iter().map(|&h| local(&tree2, h)).collect::<Vec<_>>(),
            ["td"]
        );
    }

    #[test]
    fn parse_errors_are_collected_and_recovery_builds_a_tree() {
        // 结束标签多余 + 未闭合标签：产生 parse error，但树仍然建立（HTML5 错误恢复）。
        let tree = parse_document_tree("</div><p>unclosed");
        assert!(
            !tree.parse_errors.is_empty(),
            "expected html5ever parse errors, got {:?}",
            tree.parse_errors
        );
        // 错误恢复后 p 与文本仍在树中。
        let found = tree
            .walk(tree.document())
            .into_iter()
            .any(|h| tree.local_name(h) == Some("p"));
        assert!(found);

        // 畸形输入不会破坏树不变量：每个节点 parent 指针与父列表一致。
        for h in tree.walk(tree.document()) {
            if let Some(p) = tree.slot(h).parent {
                assert!(tree.slot(p).children.contains(&h));
            }
        }
    }

    #[test]
    fn template_contents_get_own_fragment_slot() {
        let tree = parse_document_tree("<body><template><p>in</p></template></body>");
        let body = tree
            .walk(tree.document())
            .into_iter()
            .find(|&h| tree.local_name(h) == Some("body"))
            .expect("body element");
        let template = tree.element_children(body)[0];
        assert_eq!(local(&tree, template), "template");
        // 模板元素自身无子节点，内容在独立的 template contents 槽位里。
        assert!(tree.element_children(template).is_empty());
        let contents = expect_element(&tree, template)
            .template_contents
            .expect("template contents slot");
        let inner = tree.element_children(contents);
        assert_eq!(
            inner.iter().map(|&h| local(&tree, h)).collect::<Vec<_>>(),
            ["p"]
        );
    }

    #[test]
    fn whitespace_and_text_merging_stay_consistent() {
        // 标签之间的换行/空格各自成为独立文本节点；同一文本节点内部合并。
        let (tree, ctx) = {
            let ctx_name = QualName::new(None, ns!(html), local_name!("div"));
            parse_fragment_tree(&ctx_name, "a<!--c-->b")
        };
        let kinds: Vec<String> = tree
            .children(ctx)
            .iter()
            .map(|&h| match tree.data(h) {
                NodeData::Text(_) => "text".to_string(),
                NodeData::Comment(_) => "comment".to_string(),
                NodeData::Element(_) => "element".to_string(),
                _ => "other".to_string(),
            })
            .collect();
        assert_eq!(kinds, ["text", "comment", "text"]);
        assert_eq!(tree.text(tree.children(ctx).to_vec()[0]), Some("a"));
        assert_eq!(tree.text(tree.children(ctx).to_vec()[2]), Some("b"));
    }
}
