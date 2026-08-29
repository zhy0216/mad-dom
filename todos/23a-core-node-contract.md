# 23A 实现或审计原生节点创建与导航 contract

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T23A
- 依赖：T22
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

在 T22 gate 冻结的入口和 T20A seam 上，交付 Element/Text 创建与基础 Node 导航的原生 contract。现有 handle.rs 已有的低层方法应优先抽取或审计，不得重复导出同名 N-API。

## 条目

- [ ] **T23A — 实现或审计原生节点创建与导航 contract**
  - 实现：
    - 在独立 node_api 模块中接入或重定位 createElement、createTextNode、parent/child/sibling、nodeType、nodeName。
    - 复用 T19/T20 的 wrapper cache 和文档所有权，所有树读取委托 Core。
    - 覆盖 detached 节点、空关系、跨文档/悬空句柄和重复读取身份。
  - 验收：
    - native API 能创建并读取 Element/Text，关系属性返回稳定的 wrapper identity。
    - 既有低层导出没有重复符号，迁移前后 ABI/错误行为有回归证据。
    - T23B 可以只依赖本条目冻结的方法名、参数和返回值。

## 预期改动

- crates/mad-dom-bun/src/extensions/node_api.rs
- tests/bun/native-node-contract.test.js
- 对应 native API fixture

## 专属校验

- native node API 测试
- cargo test -p mad-dom-bun
- npm run validate
- git diff --check

## 并发边界

依赖 T22 gate；不与 T23B 并发，因为 facade 依赖本条目冻结的 native contract。不得修改共享 extension registry、handle.rs、lib.rs、api.rs、根入口或其他能力模块。
