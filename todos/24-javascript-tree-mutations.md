# 24 实现 JavaScript 树 mutation API

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：`T24`
- 依赖：T23
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 appendChild、insertBefore、removeChild 和 replaceChild 接到统一 Core mutation API。

## 条目

- [ ] **T24 — 实现 JavaScript 树 mutation API**
  - 实现：
    - 实现参数转换、返回对象和异常映射。
    - 覆盖 detached、移动、DocumentFragment、非法层级和错误 reference node。
    - 校准异常类型、时机和对象身份。
  - 验收：
    - JS 可完成基础树的插入、移动、删除和替换。
    - 所有树规则仍由 Core 决定。
    - 失败调用不改变可观察树状态。

## 预期改动

- `crates/mad-dom-bun/**`
- `js/**`
- `index.*`
- Core/Bun/compat 测试

## 专属校验

- Core mutation 测试
- Bun mutation 测试
- 差分场景
- 统一仓库校验

## 边界

不得在 JavaScript facade 重写树不变量。
