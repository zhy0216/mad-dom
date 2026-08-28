//! 最小槽位存储（原型，非生产 arena）。
//!
//! `Vec<Slot>` + 简单句柄索引，用来验证两个假设：
//! 1. html5ever 的 `TreeSink` 能把解析结果直接写进自定义存储（不需要先建
//!    html5ever 自己的 DOM 再转换）；
//! 2. `selectors` crate 能在这样的存储上完成匹配（不需要第二棵镜像树）。
//!
//! 明确不做（留给 T12/T13）：代际句柄、槽位复用/回收、generation 校验、
//! 悬空句柄检测。生产 arena 将按 ADR-0001 第 3 节实现 `NodeId { slot, generation }`。

use html5ever::tree_builder::QuirksMode;
use html5ever::QualName;

/// 槽位下标类型。原型里 `Handle` 只是裸下标，没有任何代际信息。
pub type SlotId = u32;

/// 简单句柄：槽位下标。仅为原型服务；生产句柄见 ADR-0004“替换成本”。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Handle(pub SlotId);

/// 元素槽位数据。名字与属性名保留 `QualName`（namespace + local name），
/// 这是 namespace 能力验证的基础；属性值暂用 owned `String`。
pub struct ElementData {
    pub name: QualName,
    pub attrs: Vec<(QualName, String)>,
    /// `<template>` 的 template contents（一个 fragment 槽位）。
    pub template_contents: Option<Handle>,
    /// MathML annotation-xml integration point 标记（来自 html5ever ElementFlags）。
    pub mathml_annotation_xml_integration_point: bool,
    /// tokenizer 遇到重复属性（CSP nonce 相关，ElementFlags 原样记录）。
    pub had_duplicate_attributes: bool,
}

/// 节点数据。字符串字段一律 owned `String`（本 spike 的方案 A 基线）。
pub enum NodeData {
    Document,
    DocType {
        name: String,
        public_id: String,
        system_id: String,
    },
    Element(ElementData),
    Text(String),
    Comment(String),
    ProcessingInstruction {
        target: String,
        data: String,
    },
}

/// 一个槽位：数据 + 父指针 + 有序子列表。
pub struct Slot {
    pub data: NodeData,
    pub parent: Option<Handle>,
    pub children: Vec<Handle>,
}

/// 原型树：槽位数组 + quirks mode + 解析错误收集。
pub struct SpikeTree {
    slots: Vec<Slot>,
    pub quirks_mode: QuirksMode,
    /// html5ever `parse_error` 上报的原始消息（错误模型验证：非致命、可收集）。
    pub parse_errors: Vec<String>,
}

impl Default for SpikeTree {
    fn default() -> Self {
        Self::new()
    }
}

impl SpikeTree {
    /// 新建一棵树；槽位 0 恒为 `Document`。
    pub fn new() -> Self {
        Self {
            slots: vec![Slot {
                data: NodeData::Document,
                parent: None,
                children: Vec::new(),
            }],
            quirks_mode: QuirksMode::NoQuirks,
            parse_errors: Vec::new(),
        }
    }

    /// 文档槽位（恒为 0）。
    pub fn document(&self) -> Handle {
        Handle(0)
    }

    pub fn slot(&self, h: Handle) -> &Slot {
        &self.slots[h.0 as usize]
    }

    pub fn data(&self, h: Handle) -> &NodeData {
        &self.slot(h).data
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    /// 是否已用满（`is_empty` 的反义）。clippy 要求两者成对出现。
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    pub fn children(&self, h: Handle) -> &[Handle] {
        &self.slot(h).children
    }

    pub fn element_data(&self, h: Handle) -> Option<&ElementData> {
        match &self.slot(h).data {
            NodeData::Element(e) => Some(e),
            _ => None,
        }
    }

    pub fn element_data_mut(&mut self, h: Handle) -> Option<&mut ElementData> {
        match &mut self.slots[h.0 as usize].data {
            NodeData::Element(e) => Some(e),
            _ => None,
        }
    }

    pub fn is_element(&self, h: Handle) -> bool {
        matches!(self.slot(h).data, NodeData::Element(_))
    }

    /// 元素 local name（string-cache Atom 可直接按 `&str` 读出）。
    pub fn local_name(&self, h: Handle) -> Option<&str> {
        match &self.slot(h).data {
            NodeData::Element(e) => Some(&e.name.local),
            _ => None,
        }
    }

    /// 元素 namespace URL（`&str`）。
    pub fn namespace(&self, h: Handle) -> Option<&str> {
        match &self.slot(h).data {
            NodeData::Element(e) => Some(&e.name.ns),
            _ => None,
        }
    }

    pub fn text(&self, h: Handle) -> Option<&str> {
        match &self.slot(h).data {
            NodeData::Text(s) => Some(s),
            _ => None,
        }
    }

    // ---- 供 TreeSink 使用的结构操作（原型期没有统一 mutation API 的约束）----

    /// 追加一个新槽位（未挂到树上），返回句柄。
    pub fn push_slot(&mut self, data: NodeData) -> Handle {
        let id = self.slots.len() as SlotId;
        self.slots.push(Slot {
            data,
            parent: None,
            children: Vec::new(),
        });
        Handle(id)
    }

    /// 把 `child` 挂为 `parent` 的最后一个子节点；若 child 已有父节点先摘除。
    pub fn attach(&mut self, parent: Handle, child: Handle) {
        debug_assert!(parent.0 != child.0);
        self.detach(child);
        self.slots[child.0 as usize].parent = Some(parent);
        self.slots[parent.0 as usize].children.push(child);
    }

    /// 把节点从父节点摘除（不动槽位本身）。
    pub fn detach(&mut self, child: Handle) {
        if let Some(p) = self.slots[child.0 as usize].parent.take() {
            self.slots[p.0 as usize].children.retain(|&c| c != child);
        }
    }

    /// 把 `child` 插到 `parent` 的子列表 `index` 位置。
    pub fn insert_child_at(&mut self, parent: Handle, index: usize, child: Handle) {
        debug_assert!(parent.0 != child.0);
        self.detach(child);
        self.slots[child.0 as usize].parent = Some(parent);
        self.slots[parent.0 as usize].children.insert(index, child);
    }

    /// `parent` 的最后一个子节点句柄。
    pub fn last_child(&self, parent: Handle) -> Option<Handle> {
        self.slot(parent).children.last().copied()
    }

    /// 文本节点合并：若 `parent` 最后一个子节点是文本，则把 `s` 追加进去。
    pub fn merge_text_into_last_child(&mut self, parent: Handle, s: &str) -> bool {
        if let Some(last) = self.last_child(parent) {
            self.append_text_to(last, s)
        } else {
            false
        }
    }

    /// 文本合并：若 `h` 是文本节点，则把 `s` 追加进去（TreeSink 契约用）。
    pub fn append_text_to(&mut self, h: Handle, s: &str) -> bool {
        match &mut self.slots[h.0 as usize].data {
            NodeData::Text(prev) => {
                prev.push_str(s);
                true
            }
            _ => false,
        }
    }

    /// `child` 在其父节点子列表中的位置。
    pub fn index_in_parent(&self, child: Handle) -> Option<usize> {
        let p = self.slot(child).parent?;
        self.slot(p).children.iter().position(|&c| c == child)
    }

    /// 从 `start` 开始的前序（文档序）遍历，包含 `start` 自身。
    pub fn walk(&self, start: Handle) -> Vec<Handle> {
        let mut out = Vec::new();
        self.walk_inner(start, &mut out);
        out
    }

    fn walk_inner(&self, h: Handle, out: &mut Vec<Handle>) {
        out.push(h);
        for &c in &self.slot(h).children {
            self.walk_inner(c, out);
        }
    }

    /// `start` 子树内（不含 `start`）按文档序的元素句柄。
    pub fn descendant_elements(&self, start: Handle) -> Vec<Handle> {
        self.walk(start)
            .into_iter()
            .skip(1)
            .filter(|&h| self.is_element(h))
            .collect()
    }

    /// 去掉树中所有空白文本节点后的元素子节点（测试辅助）。
    pub fn element_children(&self, h: Handle) -> Vec<Handle> {
        self.children(h)
            .iter()
            .copied()
            .filter(|&c| self.is_element(c))
            .collect()
    }
}
