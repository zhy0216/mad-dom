# 22 实现 createWindow、Window 与 Document facade

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：`T22`
- 依赖：T19, T20, T21
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

替换 pre-alpha 占位实现，让用户能在 Bun 创建持有原生 Document 的 Window。

## 条目

- [ ] **T22 — 实现 createWindow、Window 与 Document facade**
  - 实现：
    - 在 `js/` 实现最小 ESM facade 并接入原生入口。
    - 实现 `createWindow()`、Window.document 与构造/原型边界。
    - 建立从源码到根 `index.js`/`index.d.ts` 的同步方式。
  - 验收：
    - `createWindow()` 不再抛占位错误。
    - Window 与 Document 的构造方式、原型链和描述符符合基线范围。
    - 根入口与类型声明由单一来源维护。

## 预期改动

- `js/**`
- `index.js`
- `index.d.ts`
- 构建脚本
- `tests/bun/**`

## 专属校验

- Bun facade 测试
- API 快照差分子集
- 类型兼容子集
- 统一仓库校验

## 边界

facade 只做协议适配，不保存第二份 DOM 状态。
