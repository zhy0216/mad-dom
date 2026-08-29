# 12 实现 generational arena

- 状态：已完成
- 优先级：P0
- 里程碑：M2
- 条目 ID：`T12`
- 依赖：T01
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现不透明 NodeId、槽位分配/读取/删除/复用和 generation 有效性检查。

## 条目

- [x] **T12 — 实现 generational arena**
  - 实现：
    - 定义 `NodeId { slot, generation }`，对 crate 外隐藏内部字段。
    - 实现 allocate/get/get_mut/remove/reuse 与容量观测。
    - 定义 generation 溢出策略并测试悬空句柄。
  - 验收：
    - 删除并复用槽位后旧 NodeId 永远不能读取新节点。
    - 越界、空槽和 generation 不匹配均返回结构化结果。
    - 无未经说明的 unsafe。

## 预期改动

- `crates/mad-dom-core/src/arena/**`

## 专属校验

- arena 单元测试
- `cargo test -p mad-dom-core`
- `cargo clippy --workspace --all-targets -- -D warnings`

## 边界

不加入 DOM 树关系或 JavaScript wrapper。
