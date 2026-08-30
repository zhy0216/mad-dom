# 25E 接入属性与 textContent binding/facade

- 状态：待复核
- 优先级：P0
- 里程碑：M4
- 条目 ID：T25E
- 依赖：T23, T24, T25A, T25B, T25C, T25D
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 T25B/T25C 的 Core contract 接到现有 wrapper 和 JavaScript facade，完成属性与 textContent 的跨层垂直切片。

## 条目

- [x] **T25E — 接入属性与 textContent binding/facade**
  - 实现：
    - 在独立 binding extension 中实现 get/set/remove/has attribute 和 textContent 的参数、返回值、错误转换。
    - 在独立 facade extension 中安装属性和 textContent 的原型方法/访问器；所有状态来自 native handle。
    - 覆盖字符串转换、非 Element 行为、空值、深树、失败原子性和 wrapper identity。
  - 验收：
    - Bun 可观察到属性和 textContent 的即时变化，既有导航与 childNodes 结果同步。
    - 异常名称/code、描述符和返回值有 Bun 与差分测试证据。

## 预期改动

- crates/mad-dom-bun/src/extensions/attributes_api.rs
- crates/mad-dom-bun/src/extensions/text_api.rs
- js/facade/extensions/attributes.js
- js/facade/extensions/text-content.js
- tests/bun/attributes-text.test.js
- tests/compat/scenarios/dom-attributes.js
- tests/compat/scenarios/dom-text-content.js

## 专属校验

- 属性与 textContent Bun 测试
- 对应差分/类型子集
- npm run validate
- git diff --check

## 并发边界

依赖 T25A/T25B/T25C/T25D、T23 和 T24，不与 Core contract 或 live collection 并发。不得修改 Core 生产模块、collection/mutation extension、共享 registry 或根入口；T25 gate 负责最终接线。
