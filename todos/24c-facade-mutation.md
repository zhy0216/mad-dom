# 24C 实现 facade 树 mutation 模块

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：T24C
- 依赖：T24A, T24B
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

在两个 native mutation contract 都冻结后，实现 JavaScript facade 的插入、移动、删除和替换行为。

## 条目

- [ ] **T24C — 实现 facade 树 mutation 模块**
  - 实现：
    - 在独立 facade extension 中实现 appendChild、insertBefore、removeChild、replaceChild 的 wrapper 参数转换和返回对象。
    - 覆盖异常类型、移动/DocumentFragment、reference node、失败原子性和对象身份。
    - 只调用 T24A/T24B 提供的 native API，不在 JavaScript 侧维护树不变量。
  - 验收：
    - Bun 可完成基础树插入、移动、删除和替换。
    - 失败调用前后可观察树一致，异常和返回值有差分证据。

## 预期改动

- js/facade/extensions/mutation.js
- tests/bun/facade-mutation.test.js
- tests/compat/scenarios/dom-mutations.js

## 专属校验

- facade mutation 测试
- mutation 差分场景
- npm run validate
- git diff --check

## 并发边界

依赖 T24A、T24B，不与两个 native mutation 任务并发。不得修改 native extension、index.js、index.d.ts 或共享 facade registry；T24 gate 负责最终接线。
