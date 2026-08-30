# 25B 实现 Core 基础属性模块

- 状态：待复核
- 优先级：P0
- 里程碑：M4
- 条目 ID：T25B
- 依赖：T25A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

独立实现 Element 基础 attribute 的读写契约，为后续 binding 和 DOMTokenList 留出边界。

## 条目

- [x] **T25B — 实现 Core 基础属性模块**
  - 实现：
    - 在预留 attributes 模块中接入 getAttribute、setAttribute、removeAttribute、hasAttribute 及字符串转换。
    - 复用 T25A 提供的 Core payload seam 和错误模型，不在 binding/facade 保存第二份属性状态。
    - 覆盖未知属性、重复设置、删除、无效名称和失败原子性。
  - 验收：
    - 属性变化立即由 Core 读取观察到，失败操作不改变状态。
    - 属性 API 的异常、转换、顺序和类型 fixture 有固定证据。

## 预期改动

- crates/mad-dom-core/src/dom/attributes.rs
- crates/mad-dom-core/tests/t25_attributes.rs

## 专属校验

- cargo test -p mad-dom-core --test t25_attributes
- cargo test -p mad-dom-core
- npm run validate
- git diff --check

## 并发边界

可与 T25D 并发；只允许修改 attributes.rs 及其专属测试。不得修改 node.rs、document.rs、共享 registry、binding、facade 或根入口。
