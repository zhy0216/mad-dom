# 36 实现 Range 与 Selection

- 状态：待办
- 优先级：P1
- 里程碑：M7
- 条目 ID：`T36`
- 依赖：T33, T35
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现边界点、内容操作、比较和 Selection 的公开可观察行为。

## 条目

- [ ] **T36 — 实现 Range 与 Selection**
  - 实现：
    - 实现 Range 边界校验、clone/extract/delete/insert/surround 与字符串化。
    - 让 mutation 正确调整或失效边界点。
    - 实现 Document/Window 侧 Selection、range 集合和方向行为。
  - 验收：
    - 跨文档、非法 offset 和层级错误符合基线。
    - 树 mutation 后 Range/Selection 不持有悬空句柄。
    - subsystem 差分和类型清单达到当前阶段门禁。

## 预期改动

- Core/绑定/facade/type
- 相关测试与兼容清单

## 专属校验

- Range/Selection 测试
- mutation 交互测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现布局相关几何测量，除非基线公开行为可由无布局环境稳定定义。
