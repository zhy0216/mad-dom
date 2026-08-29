# 21B 建立 isolate/thread affinity guard

- 状态：待办
- 优先级：P0
- 里程碑：M3
- 条目 ID：`T21B`
- 依赖：T20A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

提供一个窄而明确的线程/isolate 归属检查器，让后续绑定入口可以拒绝跨线程或跨 isolate 使用，而不引入可变 DOM 共享。本条目冻结纯模块语义，实际 FFI 接线由 T21 完成。

## 条目

- [ ] **T21B — 建立 isolate/thread affinity guard**
  - 实现：
    - 在独立模块中定义创建归属 token、检查当前调用归属和稳定失败错误的 API。
    - 明确 Bun/Node-API 环境无法读取的 isolate 身份如何表示，以及哪些情况必须保守拒绝。
    - 覆盖同一归属成功、伪造/不匹配 token 失败、token 生命周期和并发调用的纯 Rust 测试。
    - 为后续 FFI 接线保留不改变 `Document` 所有权的调用约束。
  - 验收：
    - 同归属检查稳定通过，跨线程或跨 isolate 误用稳定失败并带有可断言的 guard 错误；错误 code 到 JavaScript 的映射由 T21 统一处理。
    - guard 不实现锁、跨线程 DOM 或第二份文档状态。
    - T21 可在不改变 guard 语义的情况下把检查插入现有入口。

## 预期改动

- crates/mad-dom-bun/src/affinity.rs（接管 T20A 的占位文件）
- affinity.rs 内的纯 Rust/并发测试
- 本条目安全前提说明

## 专属校验

- affinity guard Rust 单元/并发测试
- cargo test -p mad-dom-bun
- 统一仓库校验

## 并发边界

可与 T21A 并发。只允许修改 affinity.rs 及其单元测试；不得修改 T20A 已登记的 module declaration、error.rs、handle.rs、api.rs、lib.rs 或现有入口。T21 负责注册 guard 并接线。
