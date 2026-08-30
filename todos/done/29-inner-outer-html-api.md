# 29 接入 innerHTML、outerHTML 与文档结构 API

- 状态：待复核
- 优先级：P1
- 里程碑：M5
- 条目 ID：`T29`
- 依赖：T27, T28
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 document/fragment parser 和 serializer 暴露为 JavaScript HTML API。

## 条目

- [x] **T29 — 接入 innerHTML、outerHTML 与文档结构 API**
  - 实现：
    - 实现 innerHTML getter/setter、outerHTML getter/setter。
    - 实现 documentElement、head、body 的首批行为。
    - 校准上下文、替换原子性、异常和 wrapper 身份。
  - 验收：
    - 用户可解析、修改并序列化常见 HTML。
    - setter 失败不会留下部分替换。
    - 相关公开 API、类型和差分清单同步。

## 预期改动

- Core/绑定/facade/type
- `tests/bun/**`
- `tests/compat/**`

## 专属校验

- HTML API Bun 测试
- parser/serializer 测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现 selector 或未在本条目列出的 HTML 元素专属行为。
