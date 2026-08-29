# 22 集成 createWindow、Window 与 Document facade

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T22
- 依赖：T22A, T22B
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 T22A 的原生实现和 T22B 的 facade 接到正式包入口，完成 M4 的 Window/Document 集成。本文件是集成闸门。

## 条目

- [ ] **T22 — 实现 createWindow、Window 与 Document facade**
  - 实现：
    - 在 js/entry.js 与根 index.js/index.d.ts 接入 T22A/T22B，维护单一入口和类型来源。
    - 完成 registry 安装顺序、构造/原型边界和公开导出同步。
    - 加入跨层 smoke、API 快照和类型 fixture；失败必须走 T21 的错误协议。
  - 验收：
    - `createWindow()` 不再抛占位错误。
    - Window 与 Document 的构造方式、原型链和描述符符合基线范围。
    - 根入口与类型声明由单一来源维护。

## 预期改动

- js/entry.js
- index.js
- index.d.ts
- 构建脚本
- tests/bun/window-document*

## 专属校验

- Bun facade 测试
- API 快照差分子集
- 类型兼容子集
- 统一仓库校验

## 边界

facade 只做协议适配，不保存第二份 DOM 状态。T23 及后续任务必须以本闸门的入口和类型为依赖，不得另建入口。
