# 21 集成异常、panic、线程与输入安全边界

- 状态：待办
- 优先级：P0
- 里程碑：M3
- 条目 ID：`T21`
- 依赖：T21A, T21B
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 T21A 的错误分类和 T21B 的 affinity guard 接入所有原生入口，形成可由 Bun 观察的安全边界。本文件是集成闸门，不重复定义子任务规则。

## 条目

- [ ] **T21 — 完成异常、panic、线程与输入安全边界**
  - 实现：
    - 在 handle/api/lib 的唯一接线点接入 T21A 的分类器和 T21B 的 guard。
    - 捕获 Rust panic 并转成受控失败。
    - 验证字符串、数字范围、索引、对象类型、文档和 NodeId。
    - 加入 isolate/线程归属断言，并为错误/安全边界增加 Bun 端到端 fixture。
  - 验收：
    - 错误类型、时机和稳定消息有 Bun 测试。
    - panic、极端索引、悬空句柄和跨文档误用不会崩溃。
    - 第一阶段跨线程访问明确失败，且错误名称/code 与 T21A/T21B 契约一致。

## 预期改动

- crates/mad-dom-bun/src/handle.rs
- crates/mad-dom-bun/src/api.rs
- crates/mad-dom-bun/src/lib.rs
- tests/bun/errors*、tests/bun/safety*

## 专属校验

- 异常与安全边界测试
- `cargo test --workspace`
- 统一仓库校验

## 边界

这是 T22A/T22B 的唯一安全边界集成前置。不得增加内部锁或跨线程 DOM 支持；不得修改 T21A/T21B 的分类和 token 语义。
