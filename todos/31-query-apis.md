# 31 实现 selector 查询 API

- 状态：待复核
- 优先级：P1
- 里程碑：M6
- 条目 ID：`T31`
- 依赖：T30
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现 querySelector、querySelectorAll、matches、closest 和 getElementById。

## 条目

- [x] **T31 — 实现 selector 查询 API**
  - 实现：
    - 在 Core 提供文档顺序查询和匹配 API。
    - 绑定并暴露静态 NodeList、matches 与 closest。
    - 校准结果顺序、无结果、语法错误、身份和描述符。
  - 验收：
    - querySelectorAll 返回静态集合，后续 mutation 不改变既有结果。
    - 结果顺序与文档顺序一致。
    - 全部 API 有 Core、Bun、类型和差分测试。

## 预期改动

- Core/绑定/facade/type
- `tests/rust/**`
- `tests/bun/**`
- `tests/compat/**`

## 专属校验

- selector/query 测试
- 差分/类型测试
- 统一仓库校验

## 边界

不加入 id/class/tag 索引或 live getElementsBy*。
