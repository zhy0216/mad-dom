# 37 实现 EventTarget 与事件传播

- 状态：待复核
- 优先级：P1
- 里程碑：M7
- 条目 ID：`T37`
- 依赖：T25
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现监听器注册、移除、捕获/目标/冒泡传播和取消语义。

## 条目

- [ ] **T37 — 实现 EventTarget 与事件传播**
  - 实现：
    - 实现 add/removeEventListener 与 dispatchEvent。
    - 构建基于 DOM 树的传播路径和重入安全行为。
    - 支持 once、capture、passive、signal 等基线公开选项。
  - 验收：
    - 监听器顺序、重复注册、移除、stopPropagation 和 preventDefault 与基线一致。
    - 传播中 mutation/reentrancy 不破坏内部状态。
    - 异常和返回值有差分测试。

## 预期改动

- Core/绑定/facade/type
- 事件测试与兼容清单

## 专属校验

- 事件顺序/重入测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现具体事件子类或 MutationObserver。
