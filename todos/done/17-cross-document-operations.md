# 17 实现 clone、import 与 adopt 的 Core 操作

- 状态：已完成
- 优先级：P0
- 里程碑：M2
- 条目 ID：`T17`
- 依赖：T16
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

为克隆和跨文档迁移提供显式 API，禁止复用另一 arena 的 NodeId。

## 条目

- [x] **T17 — 实现 clone、import 与 adopt 的 Core 操作**
  - 实现：
    - 实现 shallow/deep clone。
    - 实现 import 到目标文档并分配全新 NodeId。
    - 实现 adopt 的所有权迁移语义及失败回滚。
  - 验收：
    - 源文档和目标文档句柄永不混用。
    - 深克隆保持顺序、类型、文本和属性但不共享可变状态。
    - 跨文档非法直接 mutation 返回结构化错误。

## 预期改动

- `crates/mad-dom-core/src/dom/**`
- Core 测试

## 专属校验

- 跨文档测试
- `cargo test -p mad-dom-core`
- 统一仓库校验

## 边界

不实现 JavaScript cloneNode/importNode/adoptNode facade。
