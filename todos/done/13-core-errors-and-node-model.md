# 13 实现 Core 错误与基础节点模型

- 状态：待办
- 优先级：P0
- 里程碑：M2
- 条目 ID：`T13`
- 依赖：T12
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

定义结构化 Core 错误以及 Document、DocumentFragment、Element、Text、Comment 数据模型。

## 条目

- [ ] **T13 — 实现 Core 错误与基础节点模型**
  - 实现：
    - 建立错误分类：无效句柄、层级、错误文档、无效字符、语法和索引等。
    - 定义节点类型、名称、文本与属性存储，不包含运行时对象。
    - 建立 Document 对 arena 的独立所有权。
  - 验收：
    - Core 公共入口使用 `Result` 表达可恢复输入错误。
    - 节点模型不依赖 Bun/JSC。
    - 跨文档句柄可被识别而不是误读。

## 预期改动

- `crates/mad-dom-core/src/error.rs`
- `crates/mad-dom-core/src/dom/**`

## 专属校验

- 相关 Core 单元测试
- `cargo test -p mad-dom-core`
- 统一仓库校验

## 边界

不实现树 mutation 或异常到 JavaScript 的映射。
