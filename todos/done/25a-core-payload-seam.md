# 25A 建立 Core 属性与 textContent payload seam

- 状态：待复核
- 优先级：P0
- 里程碑：M4
- 条目 ID：T25A
- 依赖：T24, T20A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

解决 NodeData 和 Document arena 访问的私有边界，为属性和 textContent 子任务提供不争用 node.rs/document.rs 的最小 Core contract。

## 条目

- [x] **T25A — 建立 Core 属性与 textContent payload seam**
  - 实现：
    - 在 node.rs/document.rs 中一次性补齐后续属性、文本读取和更新所需的 crate 内访问 trait 或方法。
    - 预登记 attributes.rs 与 text_content.rs 模块，并明确所有更新仍经由统一 mutation/文本入口。
    - 为 Element 属性有序存储、Text/Comment 数据和递归 textContent 读取定义错误与原子性边界，但不实现完整公开 API。
  - 验收：
    - T25B、T25C 可以只修改各自模块文件和专属测试，不再触碰 node.rs/document.rs。
    - seam 不暴露裸 arena 指针、不复制 DOM 状态，Core 单测保持通过。

## 预期改动

- crates/mad-dom-core/src/dom/node.rs
- crates/mad-dom-core/src/dom/document.rs
- crates/mad-dom-core/src/dom/mod.rs
- crates/mad-dom-core/src/dom/attributes.rs（契约占位）
- crates/mad-dom-core/src/dom/text_content.rs（契约占位）
- Core seam 单元测试

## 专属校验

- cargo fmt --all -- --check
- cargo test -p mad-dom-core
- npm run validate
- git diff --check

## 并发边界

这是 T25B/T25C 的结构性前置，必须串行完成并归档。它独占 node.rs、document.rs 和 dom/mod.rs；后续子任务不得回写这些文件。
