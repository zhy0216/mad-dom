# 26 实现 HTML document parser

- 状态：待复核
- 优先级：P1
- 里程碑：M5
- 条目 ID：`T26`
- 依赖：T05, T17, T25
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

按解析器 ADR 把完整 HTML 文档直接解析进目标 Document arena。

## 条目

- [x] **T26 — 实现 HTML document parser**
  - 实现：
    - 实现 tokenizer/tree builder 适配与节点创建回调。
    - 处理 doctype、html/head/body、畸形标记、实体、Raw Text/RCDATA 和命名空间边界。
    - 建立固定 corpus、错误与资源上限测试。
  - 验收：
    - 解析过程不保留第二棵长期 DOM。
    - 常见和畸形文档得到稳定树结果。
    - 大文档/深嵌套输入有明确资源行为且不崩溃。

## 预期改动

- `crates/mad-dom-core/src/html/**`
- parser fixtures/tests

## 专属校验

- parser 固定用例
- Core parser 测试
- 解析基准 smoke
- 统一仓库校验

## 边界

不实现 fragment parsing、序列化或 JS innerHTML。
