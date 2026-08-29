# 22A 实现原生 Window/Document binding

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T22A
- 依赖：T21
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

在 T20A 的 seam 和 T21 的安全边界上实现最小原生 Window/Document 能力，并冻结供 JavaScript facade 使用的 native contract。

## 条目

- [ ] **T22A — 实现原生 Window/Document binding**
  - 实现：
    - 在预登记的 window_document 模块中实现 createWindow 所需的 document 创建、销毁和 Window→Document 强拥有关系。
    - 冻结 DocumentContext、native handle 到 wrapper 的唯一转换入口、错误出口和后续 node/mutation 模块可调用的最小签名。
    - 复用 T19/T20 的 wrapper cache、生命周期和 Core delegation；不在本模块实现节点导航或 mutation。
  - 验收：
    - native smoke 可创建和销毁一个 Window/Document，且销毁后所有句柄按 T21 规则失败。
    - T22B、T23A 和后续 native 子任务可以只依赖本条目公开的内部 contract。
    - 不重复导出 handle.rs 中已有的低层方法；需要迁移时保留既有行为和测试证据。

## 预期改动

- crates/mad-dom-bun/src/extensions/window_document.rs
- tests/bun/native-window-document.test.js
- native Window/Document contract fixture

## 专属校验

- cargo test -p mad-dom-bun
- cargo test --workspace
- npm run validate
- git diff --check

## 并发边界

T22A 必须先于 T22B，避免 native handle 签名和 facade wrapper 协议漂移。不得修改 handle.rs、lib.rs、api.rs、根 index.js、根 index.d.ts 或其他扩展模块；registry 接线由 T22 集成闸门统一完成。
