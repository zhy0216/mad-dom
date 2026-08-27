# 20 实现 wrapper cache 与 GC 生命周期

- 状态：待办
- 优先级：P0
- 里程碑：M3
- 条目 ID：`T20`
- 依赖：T19
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

保证同一文档同一 NodeId 返回稳定 JavaScript 身份，并让 wrapper 保持所属文档存活。

## 条目

- [ ] **T20 — 实现 wrapper cache 与 GC 生命周期**
  - 实现：
    - 实现每文档弱引用 wrapper cache。
    - 建立 Window→Document 和 wrapper→Document 所有权链。
    - 处理 wrapper 回收、槽位删除复用和文档释放。
  - 验收：
    - 重复读取同一节点严格相等。
    - 仅保留子节点 wrapper 时文档 arena 仍有效。
    - GC 压力与槽位复用下无泄漏、use-after-free 或身份串线。

## 预期改动

- `crates/mad-dom-bun/**`
- `tests/bun/gc*` 或等价测试

## 专属校验

- Bun GC/身份压力测试
- 原生边界测试
- 统一仓库校验

## 边界

不得用强缓存让所有 wrapper 永久存活。
