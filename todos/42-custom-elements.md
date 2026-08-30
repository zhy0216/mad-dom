# 42 实现 Custom Elements

- 状态：待复核
- 优先级：P2
- 里程碑：M8
- 条目 ID：`T42`
- 依赖：T37, T39, T40, T41
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现 CustomElementRegistry、定义/升级流程和生命周期 callback 顺序。

## 条目

- [ ] **T42 — 实现 Custom Elements**
  - 实现：
    - 实现 define/get/whenDefined/upgrade 与名称/构造器校验。
    - 在 parser、createElement、adopt/insert/remove 中接入升级和生命周期反应。
    - 处理 observedAttributes、异常和 reaction queue。
  - 验收：
    - 升级时机、constructor 限制和 callback 顺序通过基线差分。
    - 失败定义不会留下部分 registry 状态。
    - 与 MutationObserver/microtask 顺序有组合测试。

## 预期改动

- Core/绑定/facade/type
- parser/mutation 适配
- 兼容测试

## 专属校验

- Custom Elements 单元/顺序测试
- 差分/类型测试
- 统一仓库校验

## 边界

不静默忽略未实现生命周期。
