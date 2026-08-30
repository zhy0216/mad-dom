# 40 实现 template 与首批表单契约

- 状态：待复核
- 优先级：P1
- 里程碑：M7
- 条目 ID：`T40`
- 依赖：T27, T34, T39
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现 HTMLTemplateElement.content 以及锁定基线中首批表单元素和表单关联行为。

## 条目

- [x] **T40 — 实现 template 与首批表单契约**
  - 实现：
    - 实现 template content 的独立 fragment、解析、克隆和序列化。
    - 按兼容清单实现 form、input、button、select、option、textarea 的基础 value/name/disabled/checked/selected 行为。
    - 实现首批 form.elements、提交/重置和相关事件顺序。
  - 验收：
    - template 内容不作为普通子节点暴露，clone/import 行为正确。
    - 表单控件状态、集合 live 行为和事件顺序通过目标差分场景。
    - 未实现的高级校验能力必须明确列为 gap。

## 预期改动

- Core/绑定/facade/type
- parser/serializer 适配
- 表单测试与兼容清单

## 专属校验

- template/form 测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现布局、原生 UI 或真实导航提交。
