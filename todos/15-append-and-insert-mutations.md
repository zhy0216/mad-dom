# 15 实现 append 与 insert_before mutation

- 状态：待办
- 优先级：P0
- 里程碑：M2
- 条目 ID：`T15`
- 依赖：T14
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

通过统一 mutation API 原子实现节点追加和指定位置插入。

## 条目

- [ ] **T15 — 实现 append 与 insert_before mutation**
  - 实现：
    - 实现 append 与 insert_before，包括从原父节点脱离。
    - 拒绝祖先插入后代、无效 reference node 和错误文档。
    - 每次成功或失败后验证树不变量。
  - 验收：
    - 首/中/尾插入、重新排序和 DocumentFragment 插入均有测试。
    - 失败操作不留下部分修改。
    - 调用者无法绕过 mutation API 写树关系。

## 预期改动

- `crates/mad-dom-core/src/dom/mutation*`
- Core 测试

## 专属校验

- mutation 单元测试
- `cargo test -p mad-dom-core`
- 统一仓库校验

## 边界

不实现 remove/replace 或 JavaScript API。
