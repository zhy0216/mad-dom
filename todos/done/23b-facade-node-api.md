# 23B 实现 facade 节点创建与导航模块

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T23B
- 依赖：T23A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

根据 T23A 已冻结的 native contract，实现基础节点创建、导航和标识属性的 JavaScript 可观察行为。

## 条目

- [ ] **T23B — 实现 facade 节点创建与导航模块**
  - 实现：
    - 在独立 facade extension 中实现 document.createElement、document.createTextNode 和 Node 导航属性。
    - 校准构造限制、原型链、属性描述符、null 语义和 wrapper identity。
    - 添加只覆盖节点创建/导航的兼容场景，不提前实现 mutation、attributes 或 parser。
  - 验收：
    - Bun 可创建 detached Element/Text 并稳定读取类型、名称和关系。
    - 同一 native 节点的重复读取满足严格身份；异常与类型 fixture 有证据。
    - 模块可由 T23 集成而无需修改根入口或其他能力模块。

## 预期改动

- js/facade/extensions/node.js
- tests/bun/facade-node.test.js
- tests/compat/scenarios/dom-node-navigation.js

## 专属校验

- facade node 测试
- 相关 API、类型、差分子集
- npm run validate
- git diff --check

## 并发边界

依赖 T23A，不与 native node contract 并发，避免两层 contract 漂移。不得修改 index.js、index.d.ts、共享 facade registry 或其他能力模块；T23 gate 负责接线。
