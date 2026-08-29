# 25D 实现 live childNodes 集合模块

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T25D
- 依赖：T24, T23
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现不引入索引的 live childNodes/NodeList 观察行为，并验证 mutation 后的实时一致性。

## 条目

- [ ] **T25D — 实现 live childNodes 集合模块**
  - 实现：
    - 通过 T23/T24 已冻结的读取和 mutation contract 实现 NodeList 的 live 长度、索引、迭代和 wrapper identity。
    - 明确快照集合与 live 集合的边界；本条目只处理 childNodes，不实现查询索引或 HTMLCollection。
    - 覆盖 append/insert/remove/replace、节点移动、空集合和 GC 生命周期。
  - 验收：
    - 已有 childNodes 对象在树变化后立即反映最新结果，顺序与 Core 文档顺序一致。
    - 集合读取不缓存第二份权威树状态，不访问悬空 NodeId。

## 预期改动

- crates/mad-dom-bun/src/extensions/collection_api.rs
- js/facade/extensions/child-nodelist.js
- tests/bun/nodelist-live.test.js
- tests/compat/scenarios/dom-child-nodelist.js

## 专属校验

- live NodeList 测试
- mutation + collection 交互测试
- npm run validate
- git diff --check

## 并发边界

依赖 T24 gate；可与 T25A 并发，因为拥有独立 collection 文件且只读取已冻结的 node/mutation contract；T25A 归档后也可与 T25B/T25C 并发。不得修改 mutation extension、Core payload seam、共享 registry、handle.rs、lib.rs 或根入口。
