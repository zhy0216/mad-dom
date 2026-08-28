//! 字符串存储方案对比：owned `String`（方案 A 基线）vs interning（方案 B）。
//!
//! 验证点（对应 T05）：
//! - owned 基线：[`crate::store`] 的槽位已直接持有 `String`，零间接层；
//! - interning：最小 intern 表（去重 + 紧凑下标），验证 API 形态与去重收益；
//! - 收益完全取决于重复率，因此对比必须同时覆盖"重复语料"与"唯一语料"，
//!   这直接构成 ADR-0004"字符串驻留优化的启用条件"。

use std::collections::HashMap;

/// intern 表中的字符串句柄（下标，原型期不含代际信息）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct StrId(pub u32);

/// 最小 intern 表：`Vec` 存字符串本体，`HashMap` 提供去重索引。
///
/// 原型的 map 键独立分配一份（每唯一字符串 2 次分配）；生产实现（若启用）
/// 会换成单一所有权的结构，见 ADR-0004"字符串存储"。
pub struct SpikeInterner {
    map: HashMap<Box<str>, StrId>,
    arena: Vec<Box<str>>,
}

impl Default for SpikeInterner {
    fn default() -> Self {
        Self::new()
    }
}

impl SpikeInterner {
    pub fn new() -> Self {
        Self {
            map: HashMap::new(),
            arena: Vec::new(),
        }
    }

    /// 返回字符串的规范 `StrId`；重复字符串只存一份。
    pub fn intern(&mut self, s: &str) -> StrId {
        if let Some(&id) = self.map.get(s) {
            return id;
        }
        let id = StrId(self.arena.len() as u32);
        self.arena.push(s.into());
        self.map.insert(s.into(), id);
        id
    }

    /// 按句柄读回字符串。
    pub fn get(&self, id: StrId) -> &str {
        &self.arena[id.0 as usize]
    }

    /// 已驻留的唯一字符串个数。
    pub fn len(&self) -> usize {
        self.arena.len()
    }

    /// 是否为空（clippy 要求两者成对出现）。
    pub fn is_empty(&self) -> bool {
        self.arena.is_empty()
    }

    /// 估算驻留内存：arena 字符串字节 + map 键字符串字节 + map 项均摊开销
    /// （HashMap 项按 `Box<str>` 键指针 + `StrId` 值 + 装载因子余量粗估）。
    pub fn memory_bytes(&self) -> usize {
        let arena = self.arena.iter().map(|s| s.len()).sum::<usize>();
        let map_keys = self.map.keys().map(|s| s.len()).sum::<usize>();
        let per_entry = std::mem::size_of::<Box<str>>() + std::mem::size_of::<StrId>();
        arena + map_keys + self.map.len() * per_entry * 2
    }
}

/// owned 基线的内存估算：每份字符串独立分配（不去重）。
pub fn owned_memory_bytes(strings: &[String]) -> usize {
    strings.iter().map(|s| s.capacity()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interning_dedups_repeated_names() {
        let mut interner = SpikeInterner::new();
        let inputs = ["div", "p", "div", "container", "div", "p"];
        let ids: Vec<StrId> = inputs.iter().map(|s| interner.intern(s)).collect();

        // 6 次写入只产生 3 份唯一字符串，且相同输入得到相同 id。
        assert_eq!(interner.len(), 3);
        assert_eq!(ids[0], ids[2]);
        assert_eq!(ids[0], ids[4]);
        assert_eq!(ids[1], ids[5]);

        // 读回内容正确；id 与写入顺序一致（下标语义）。
        assert_eq!(interner.get(ids[0]), "div");
        assert_eq!(interner.get(ids[1]), "p");
        assert_eq!(interner.get(ids[3]), "container");
        assert_eq!(ids[3], StrId(2));

        // 空 intern 表的边界。
        assert!(SpikeInterner::new().is_empty());
    }

    #[test]
    fn owned_vs_interning_comparison_is_runnable() {
        // 模拟真实 HTML 语料：标签名/属性名/类名高度重复（每元素重复引用）。
        let tags = ["div", "span", "p", "a", "li"];
        let attrs = ["class", "id", "href", "data-index"];
        let classes = ["container", "item", "active", "hidden"];
        let elements = 2000;

        // owned 基线：每个槽位独立持有 String（同 store.rs 的方案 A）。
        let mut owned = Vec::new();
        for i in 0..elements {
            owned.push(tags[i % tags.len()].to_string());
            owned.push(attrs[i % attrs.len()].to_string());
            owned.push(classes[i % classes.len()].to_string());
        }
        let owned_bytes = owned_memory_bytes(&owned);
        let owned_copies = owned.len();

        // interning：同一语料走 intern 表。
        let mut interner = SpikeInterner::new();
        let mut interned_refs = 0usize;
        for i in 0..elements {
            for src in [
                tags[i % tags.len()],
                attrs[i % attrs.len()],
                classes[i % classes.len()],
            ] {
                let _id = interner.intern(src);
                interned_refs += 1;
            }
        }
        let interned_bytes = interner.memory_bytes();

        // 重复语料下 interning 明显更省：唯一字符串远少于引用数，
        // 驻留内存也小于 owned 的散装 String。
        assert_eq!(owned_copies, interned_refs, "两个方案处理同一份引用语料");
        assert!(
            interner.len() < owned_copies / 100,
            "唯一字符串应远少于引用数：{} vs {}",
            interner.len(),
            owned_copies
        );
        assert!(
            interned_bytes < owned_bytes,
            "interning {interned_bytes} B 应小于 owned {owned_bytes} B"
        );

        // 反向边界：语料几乎全唯一时，interning 反而更贵（map 开销叠加）。
        let unique: Vec<String> = (0..2000).map(|i| format!("u{i}")).collect();
        let mut uni_interner = SpikeInterner::new();
        for s in &unique {
            uni_interner.intern(s);
        }
        assert!(
            uni_interner.memory_bytes() > owned_memory_bytes(&unique),
            "全唯一语料下 interning 开销应高于 owned（启用条件依据）"
        );
    }
}
