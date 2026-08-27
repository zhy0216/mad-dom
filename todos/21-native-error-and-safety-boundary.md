# 21 完成异常、panic、线程与输入安全边界

- 状态：待办
- 优先级：P0
- 里程碑：M3
- 条目 ID：`T21`
- 依赖：T19, T20
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 Core 错误稳定映射到 JavaScript，并阻止 panic、错误 isolate/线程和无效输入破坏进程。

## 条目

- [ ] **T21 — 完成异常、panic、线程与输入安全边界**
  - 实现：
    - 映射 TypeError、SyntaxError、DOMException 和普通 Error。
    - 捕获 Rust panic 并转成受控失败。
    - 验证字符串、数字范围、索引、对象类型、文档和 NodeId。
    - 加入 isolate/线程归属断言。
  - 验收：
    - 错误类型、时机和稳定消息有 Bun 测试。
    - panic、极端索引、悬空句柄和跨文档误用不会崩溃。
    - 第一阶段跨线程访问明确失败。

## 预期改动

- `crates/mad-dom-bun/**`
- `tests/bun/errors*`、`tests/bun/safety*`

## 专属校验

- 异常与安全边界测试
- `cargo test --workspace`
- 统一仓库校验

## 边界

不增加内部锁或跨线程 DOM 支持。
