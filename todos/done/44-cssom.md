# 44 实现 CSSOM 与样式相关 API

- 状态：已完成
- 优先级：P2
- 里程碑：M8
- 条目 ID：`T44`
- 依赖：T34, T39, T43
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

按锁定基线实现 style、CSSStyleDeclaration、stylesheet/rule、媒体查询和可稳定的 computed style 行为。

## 条目

- [x] **T44 — 实现 CSSOM 与样式相关 API**
  - 实现：
    - 先从兼容清单拆出 CSSOM 数据模型、解析和序列化范围。
    - 实现 Element.style、style 属性双向同步和首批 stylesheet/rule API。
    - 实现 matchMedia 与无布局条件下可稳定定义的 getComputedStyle。
  - 验收：
    - style 与属性只保留一份权威状态或有明确同步边界。
    - CSS 文本、描述符、异常和 live 行为通过目标差分。
    - 不伪造依赖真实布局的值。

## 预期改动

- Core/绑定/facade/type
- CSS fixtures/tests
- 兼容清单

## 专属校验

- CSSOM parser/serialization 测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现 CSS layout、painting 或视觉渲染。
