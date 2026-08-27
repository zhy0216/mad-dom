# 32 实现 live 查询集合与可选索引

- 状态：待办
- 优先级：P1
- 里程碑：M6
- 条目 ID：`T32`
- 依赖：T31
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现 getElementsByTagName/getElementsByClassName 的 live collection，并用数据决定查询索引。

## 条目

- [ ] **T32 — 实现 live 查询集合与可选索引**
  - 实现：
    - 实现 HTMLCollection 的 live、索引、named access、迭代和身份语义。
    - 建立 mutation 前后集合一致性测试。
    - 先保存无索引基准，再仅在有收益时增加 id/class/tag 索引，并由 mutation API 统一维护。
  - 验收：
    - 已有 collection 在树/属性变化后即时反映结果。
    - 启用或禁用索引时结果完全一致。
    - 属性测试能发现树与索引不一致。

## 预期改动

- Core/绑定/facade/type
- benchmark/tests
- 兼容清单

## 专属校验

- live collection 测试
- mutation+index 属性测试
- 查询基准
- 统一仓库校验

## 边界

没有基准证据时不得引入复杂索引。
