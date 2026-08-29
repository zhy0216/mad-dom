# 14 实现树关系读取与不变量检查

- 状态：已完成
- 优先级：P0
- 里程碑：M2
- 条目 ID：`T14`
- 依赖：T13
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

用 NodeId 保存父、子和兄弟关系，并提供只读导航及内部一致性检查器。

## 条目

- [x] **T14 — 实现树关系读取与不变量检查**
  - 实现：
    - 实现 parent、first/last child、previous/next sibling 关系。
    - 提供只读遍历 API 和文档归属检查。
    - 实现测试可调用的不变量检查：双向一致、兄弟链无环、顺序唯一。
  - 验收：
    - 空树、深树和宽树读取结果正确。
    - 人工构造的断链、环和错误归属能被检查器发现。
    - 关系字段不暴露给绑定层直接修改。

## 预期改动

- `crates/mad-dom-core/src/dom/**`
- Core 测试

## 专属校验

- 树关系单元测试
- `cargo test -p mad-dom-core`
- 统一仓库校验

## 边界

只建立读取和校验，不开放任意字段写入。
