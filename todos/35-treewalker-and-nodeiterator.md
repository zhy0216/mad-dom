# 35 实现 TreeWalker 与 NodeIterator

- 状态：待办
- 优先级：P1
- 里程碑：M7
- 条目 ID：`T35`
- 依赖：T25, T33
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现基于统一 arena 的 DOM 遍历器、过滤器和 mutation 后行为。

## 条目

- [ ] **T35 — 实现 TreeWalker 与 NodeIterator**
  - 实现：
    - 实现 whatToShow、NodeFilter 和前后/父子遍历。
    - 定义遍历期间节点删除、移动和文档释放的行为。
    - 保持 filter callback 与 wrapper identity 正确。
  - 验收：
    - 遍历顺序和过滤结果与基线一致。
    - mutation 后 iterator/walker 不访问悬空 NodeId。
    - 异常与 callback reentrancy 有测试。

## 预期改动

- Core/绑定/facade/type
- 相关测试与兼容清单

## 专属校验

- 遍历器 Core/Bun 测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现 Range 或 Selection。
