# 34 实现 Attr、NamedNodeMap 与 DOMTokenList

- 状态：待办
- 优先级：P1
- 里程碑：M7
- 条目 ID：`T34`
- 依赖：T25, T33
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

补齐属性节点、attributes 集合和 classList/token 操作的可观察契约。

## 条目

- [ ] **T34 — 实现 Attr、NamedNodeMap 与 DOMTokenList**
  - 实现：
    - 实现 Attr 与 NamedNodeMap 的索引、named access、身份和文档归属。
    - 实现 DOMTokenList add/remove/toggle/replace/contains/value/迭代。
    - 把 classList 与底层 class 属性保持双向 live 同步。
  - 验收：
    - 属性 mutation 只更新一份 Core 状态。
    - 保留的 NamedNodeMap/DOMTokenList 在外部属性变化后仍 live。
    - 无效 token 与错误文档异常符合基线。

## 预期改动

- Core/绑定/facade/type
- 相关测试与兼容清单

## 专属校验

- 属性/token 测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现 CSSStyleDeclaration。
