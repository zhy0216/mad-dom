# 33 补齐扩展节点类型与 JavaScript API

- 状态：待办
- 优先级：P1
- 里程碑：M7
- 条目 ID：`T33`
- 依赖：T17, T25, T29
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现 CharacterData、DocumentType、ProcessingInstruction 和 DocumentFragment 的剩余公开行为。

## 条目

- [ ] **T33 — 补齐扩展节点类型与 JavaScript API**
  - 实现：
    - 补齐节点创建、数据修改、split/substring 等基线公开 API。
    - 将 clone/import/adopt 暴露为 cloneNode/importNode/adoptNode。
    - 校准节点名称、类型、所有权和异常。
  - 验收：
    - 本 subsystem 的基线清单项全部 pass 或保留有原因的明确 gap。
    - 跨文档操作不复用 NodeId。
    - 类型和运行时 API 同步。

## 预期改动

- Core/绑定/facade/type
- 相关测试与兼容清单

## 专属校验

- Core/Bun 测试
- subsystem 差分/类型测试
- 统一仓库校验

## 边界

不实现 Attr/NamedNodeMap、遍历器或事件。
