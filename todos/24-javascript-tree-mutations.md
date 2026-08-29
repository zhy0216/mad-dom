# 24 集成 JavaScript 树 mutation API

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：`T24`
- 依赖：T24A, T24B, T24C
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 T24A/T24B 的 native mutation 和 T24C 的 facade 接到统一 Core mutation API。本文件是集成闸门。

## 条目

- [ ] **T24 — 实现 JavaScript 树 mutation API**
  - 实现：
    - 接入两个 native 模块和 facade 模块，更新唯一 registry、入口、类型和差分场景。
    - 校准异常类型、时机、返回值和对象身份。
  - 验收：
    - JS 可完成基础树的插入、移动、删除和替换。
    - 所有树规则仍由 Core 决定。
    - 失败调用不改变可观察树状态。

## 预期改动

- registry/入口/类型的集成改动
- Core/Bun/compat mutation 测试

## 专属校验

- Core mutation 测试
- Bun mutation 测试
- 差分场景
- 统一仓库校验

## 边界

不得在 JavaScript facade 重写树不变量；T25D 只能依赖本闸门提供的 mutation contract。
