# 24A 实现原生 append/insert mutation contract

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T24A
- 依赖：T23
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把已有 Core append/insert 语义通过独立 native extension 暴露出来；remove/replace 由 T24B 独占，避免 native 文件冲突。

## 条目

- [ ] **T24A — 实现原生 append/insert mutation contract**
  - 实现：
    - 接入 appendChild、insertBefore 的参数转换、返回值和错误传播。
    - 覆盖 detached、移动、DocumentFragment、非法层级和错误 reference node。
    - 复用 T21 的错误/affinity 接线协议，失败时不修改树。
  - 验收：
    - native mutation API 通过 Core 统一 mutation 入口，未在 binding 重写树规则。
    - 成功和失败路径、跨文档误用、wrapper identity 均有测试证据。
    - 不重复导出 handle.rs 中已有的同名 N-API；迁移时有符号和回归检查。

## 预期改动

- crates/mad-dom-bun/src/extensions/mutation_insert_api.rs
- tests/bun/mutation-insert-api.test.js
- mutation native fixture

## 专属校验

- native append/insert 测试
- Core mutation 回归测试
- cargo test -p mad-dom-bun
- npm run validate
- git diff --check

## 并发边界

依赖 T23 gate；可与 T24B 并发，因为两者拥有不同的 native extension 文件且 mutation contract 已冻结。不得修改共享 registry、handle.rs、lib.rs、api.rs、根入口或其他能力模块。
