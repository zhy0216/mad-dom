# 41 实现 MutationObserver 与 microtask 交付

- 状态：待办
- 优先级：P2
- 里程碑：M7
- 条目 ID：`T41`
- 依赖：T24, T34, T37
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

记录 DOM mutation，并按 Bun microtask 边界交付兼容的 MutationRecord。

## 条目

- [ ] **T41 — 实现 MutationObserver 与 microtask 交付**
  - 实现：
    - 实现 observe/disconnect/takeRecords 与选项校验。
    - 从统一 mutation API 生成 childList/attributes/characterData 记录。
    - 定义批处理、旧值、subtree、回调异常和 microtask 顺序。
  - 验收：
    - 所有 DOM 修改路径都不会绕过 observer 记录。
    - 同一任务内批处理和回调顺序与基线一致。
    - observer/wrapper 生命周期无泄漏或悬空 NodeId。

## 预期改动

- Core/绑定/facade/type
- 异步与兼容测试

## 专属校验

- MutationObserver 顺序/GC 测试
- 差分/类型测试
- 统一仓库校验

## 边界

不创建自有线程或独立事件循环。
