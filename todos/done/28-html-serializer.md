# 28 实现统一 DOM serializer

- 状态：待复核
- 优先级：P1
- 里程碑：M5
- 条目 ID：`T28`
- 依赖：T26
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 Document、Fragment、Element、Text、Comment 和属性序列化为 HTML。

## 条目

- [x] **T28 — 实现统一 DOM serializer**
  - 实现：
    - 实现节点类型分派、void/raw-text 规则、文本和属性转义。
    - 覆盖 namespace、doctype、template 等已支持结构。
    - 建立 parse→serialize 与 serialize→parse 往返测试。
  - 验收：
    - serializer 只读取统一 arena。
    - 固定 fixture 输出与 happy-dom 规范化结果一致或记录 gap。
    - 往返测试能定位结构性丢失。

## 预期改动

- `crates/mad-dom-core/src/serialize/**`
- serializer fixtures/tests

## 专属校验

- serializer 单元/往返测试
- 差分场景
- 统一仓库校验

## 边界

不实现 JavaScript innerHTML/outerHTML 属性。
