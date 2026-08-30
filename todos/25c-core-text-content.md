# 25C 实现 Core textContent 模块

- 状态：待复核
- 优先级：P0
- 里程碑：M4
- 条目 ID：T25C
- 依赖：T25A
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

独立实现 Node.textContent 的读取、设置和错误/原子性契约。

## 条目

- [x] **T25C — 实现 Core textContent 模块**
  - 实现：
    - 在预留 text_content 模块中接入 Element、Text、Comment、DocumentFragment 的 textContent 读取与设置。
    - setter 通过统一 Core mutation/文本更新入口工作，失败不留下部分替换。
    - 覆盖空值、空字符串、深树、Document 节点、评论节点和递归顺序。
  - 验收：
    - 文本读取/设置结果与 Core 树一致，既有 child/navigation 观察立即反映变化。
    - 非法对象、错误文档和边界输入稳定失败且不崩溃。

## 预期改动

- crates/mad-dom-core/src/dom/text_content.rs
- crates/mad-dom-core/tests/t25_text_content.rs

## 专属校验

- cargo test -p mad-dom-core --test t25_text_content
- cargo test -p mad-dom-core
- npm run validate
- git diff --check

## 并发边界

可与 T25B、T25D 并发；只允许修改 text_content.rs 及其专属测试。不得修改 node.rs、document.rs、共享 registry、binding、facade 或根入口。
