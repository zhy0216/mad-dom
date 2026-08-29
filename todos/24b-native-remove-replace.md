# 24B 实现原生 remove/replace mutation contract

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T24B
- 依赖：T23
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把已有 Core remove/replace 语义通过独立 native extension 暴露出来；append/insert 由 T24A 独占。

## 条目

- [ ] **T24B — 实现原生 remove/replace mutation contract**
  - 实现：
    - 接入 removeChild、replaceChild 的参数转换、返回值和错误传播。
    - 覆盖错误 reference、非法层级、跨文档句柄、失败原子性和对象身份。
    - 复用 T21 的错误/affinity 接线协议，不在 native 侧重写树规则。
  - 验收：
    - native API 可完成删除和替换，并与 T24A 的 append/insert contract 兼容。
    - 既有低层导出没有重复符号，成功/失败路径有回归证据。

## 预期改动

- crates/mad-dom-bun/src/extensions/mutation_remove_api.rs
- tests/bun/mutation-remove-api.test.js
- mutation native fixture

## 专属校验

- native remove/replace 测试
- Core mutation 回归测试
- cargo test -p mad-dom-bun
- npm run validate
- git diff --check

## 并发边界

依赖 T23 gate；可与 T24A 并发，因为两者拥有不同的 native extension 文件。不得修改 mutation_insert_api.rs、handle.rs、lib.rs、api.rs、根入口或共享 registry；T24C 负责 JavaScript facade。
