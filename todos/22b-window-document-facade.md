# 22B 实现 JavaScript Window/Document facade

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T22B
- 依赖：T22A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

根据 T22A 已冻结的 native contract，实现不保存第二份 DOM 状态的 Window/Document facade，并为后续能力保留独立扩展入口。

## 条目

- [ ] **T22B — 实现 JavaScript Window/Document facade**
  - 实现：
    - 在 js/facade/window.js 与 document.js 实现 createWindow、Window.document 和基础生命周期转发。
    - 定义每个能力模块的 install、导出、原型和属性描述符注册方式，以及 native handle 到 wrapper 的唯一转换入口。
    - 为后续 node、mutation、attributes、text 和 child-nodelist 模块预留独立文件边界与测试入口。
    - 明确 facade 不缓存或重建第二棵 DOM；所有状态来自 native handle。
  - 验收：
    - Bun 可创建 Window 并读取其 Document；重复读取遵守 T20 的 wrapper identity。
    - 构造限制、原型链、描述符、销毁后的异常和导出形状有固定测试。
    - 后续 facade 子任务可以只新增或修改自己的 extension 文件，不修改根入口。

## 预期改动

- js/facade/window.js
- js/facade/document.js
- js/facade/extensions/index.js（仅契约）
- tests/bun/facade-window-document.test.js
- facade 契约说明或 fixture

## 专属校验

- bun test tests/bun/facade-window-document.test.js
- facade/API 契约快照
- npm run validate
- git diff --check

## 并发边界

依赖 T22A，不与其并发。不得修改根 index.js、根 index.d.ts、Rust 绑定或具体 DOM 能力实现；T22 负责把基础 facade 接入包入口。
