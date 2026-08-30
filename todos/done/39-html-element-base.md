# 39 实现 HTMLElement 基类与属性反射

- 状态：待复核
- 优先级：P1
- 里程碑：M7
- 条目 ID：`T39`
- 依赖：T29, T34, T37
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

建立 HTMLElement 基类、常用反射属性、dataset 和基础交互行为。

## 条目

- [x] **T39 — 实现 HTMLElement 基类与属性反射**
  - 实现：
    - 实现 HTMLElement 原型层级与常用字符串/布尔/数字属性反射。
    - 实现 dataset/DOMStringMap 的 live 映射。
    - 接入基础 focus/blur/click 等 happy-dom 可观察行为。
  - 验收：
    - 反射属性与 attribute 双向同步。
    - 原型、描述符、字符串转换和异常通过基线测试。
    - 不依赖布局或绘制状态。

## 预期改动

- Core/绑定/facade/type
- HTML element 测试与兼容清单

## 专属校验

- HTMLElement 测试
- API 快照/差分/类型测试
- 统一仓库校验

## 边界

不实现具体表单元素或 CSSOM。
