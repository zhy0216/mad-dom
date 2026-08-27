# 27 实现 HTML fragment parsing

- 状态：待办
- 优先级：P1
- 里程碑：M5
- 条目 ID：`T27`
- 依赖：T26
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

支持基于上下文元素的 fragment parsing，并直接写入统一 arena。

## 条目

- [ ] **T27 — 实现 HTML fragment parsing**
  - 实现：
    - 实现 context element/namespace 与 fragment root 处理。
    - 覆盖 table、template、raw text 等上下文差异。
    - 保证解析失败或替换过程不留下部分状态。
  - 验收：
    - 相同输入在不同上下文元素下产生正确差异。
    - fragment 节点属于目标文档且句柄有效。
    - 与锁定 happy-dom 的首批 fragment 场景可差分。

## 预期改动

- `crates/mad-dom-core/src/html/**`
- fragment fixtures/tests

## 专属校验

- fragment parser 测试
- 差分场景
- 统一仓库校验

## 边界

不实现序列化或 innerHTML setter。
