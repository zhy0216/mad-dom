# 16 实现 remove 与 replace mutation

- 状态：已完成
- 优先级：P0
- 里程碑：M2
- 条目 ID：`T16`
- 依赖：T15
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

通过统一 mutation API 原子实现删除和替换，并保持句柄与关系安全。

## 条目

- [x] **T16 — 实现 remove 与 replace mutation**
  - 实现：
    - 实现 remove 与 replace，校验父子关系和 replacement 合法性。
    - 定义 detached node、arena 槽位释放和 wrapper 未来可观察行为的 Core 语义。
    - 覆盖自身替换、相邻替换和失败回滚。
  - 验收：
    - 删除/替换后父子与兄弟关系一致。
    - 旧 NodeId 的有效性符合明确语义，槽位复用不会别名到旧句柄。
    - 失败操作保持原树不变。

## 预期改动

- `crates/mad-dom-core/src/dom/mutation*`
- Core 测试

## 专属校验

- mutation 单元测试
- `cargo test -p mad-dom-core`
- 统一仓库校验

## 边界

不实现跨文档 adopt/import。
