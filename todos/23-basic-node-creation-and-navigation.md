# 23 集成基础节点创建与导航 API

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T23
- 依赖：T23A, T23B
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 Core contract、native node 模块和 facade node 模块接成一个可发布的基础节点垂直切片。本文件是集成闸门。

## 条目

- [ ] **T23 — 集成基础节点创建与导航 API**
  - 实现：
    - 接入 T23A 的 native contract 和 T23B 的 facade API，更新唯一 registry、公开入口、类型声明、API 快照和差分场景。
    - 校准构造限制、对象身份、属性描述符和错误时机。
  - 验收：
    - JavaScript 可构建 detached Element/Text 并读取 nodeType、nodeName 和基础关系。
    - 共享入口只保留一套导出，Core 仍是唯一树状态来源。

## 预期改动

- registry/入口/类型的集成改动
- index.js、index.d.ts、js/entry.js
- tests/bun/**（节点集成）
- tests/compat/**（节点场景）

## 专属校验

- Core 测试
- Bun API 测试
- 相关兼容与类型测试
- npm run validate
- git diff --check

## 并发边界

这是 T24、T25 的前置闸门。不得实现 mutation、attributes 或 parser；共享 registry、根入口、类型和 compat ledger 只能由本闸门串行维护。
