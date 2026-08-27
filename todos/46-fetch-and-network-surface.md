# 46 实现 Fetch 网络表面

- 状态：待办
- 优先级：P2
- 里程碑：M8
- 条目 ID：`T46`
- 依赖：T38, T45
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现或适配 Headers、Request、Response、Fetch、Abort 与 cookie 交互的公开契约。

## 条目

- [ ] **T46 — 实现 Fetch 网络表面**
  - 实现：
    - 比较 Bun 原生 Web API 与基线差异，决定直接复用或兼容包装。
    - 实现构造、body 使用状态、clone、错误和重定向等可观察行为。
    - 建立确定性测试 transport，避免兼容测试依赖公网。
  - 验收：
    - 测试无需外网即可覆盖成功、失败、中止、流和 header 行为。
    - 异常类型、Promise 时序和 bodyUsed 等状态通过差分。
    - 不会在 Core DOM 中复制网络状态。

## 预期改动

- facade/type
- 测试 transport
- 网络与兼容测试

## 专属校验

- 离线 Fetch 测试
- 异步差分/类型测试
- 统一仓库校验

## 边界

不构建浏览器网络栈；优先适配 Bun 能力。
