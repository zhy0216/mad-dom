# 30 实现 selector parser 与 arena matcher

- 状态：待复核
- 优先级：P1
- 里程碑：M6
- 条目 ID：`T30`
- 依赖：T05, T17, T25
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

按选择器 ADR 解析 selector 并直接在 arena 节点上执行匹配。

## 条目

- [x] **T30 — 实现 selector parser 与 arena matcher**
  - 实现：
    - 实现选定的基础选择器语法和组合器。
    - 实现 Element.matches 所需的节点/祖先/兄弟匹配。
    - 把语法错误保留为结构化 Core 错误。
  - 验收：
    - selector AST 不依赖 Bun/JSC 类型。
    - 固定选择器 corpus 与生成式 DOM 组合通过。
    - 无效选择器稳定返回语法错误。

## 预期改动

- `crates/mad-dom-core/src/selectors/**`
- selector fixtures/tests

## 专属校验

- selector parser/matcher 测试
- 生成式测试 smoke
- 统一仓库校验

## 边界

不实现查询遍历、live collection 或索引。
