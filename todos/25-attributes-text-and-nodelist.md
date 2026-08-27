# 25 实现属性、textContent 与 live childNodes

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：`T25`
- 依赖：T24
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

完成首个基础 DOM 垂直切片的属性、文本和 live NodeList 行为。

## 条目

- [ ] **T25 — 实现属性、textContent 与 live childNodes**
  - 实现：
    - 实现基础 get/set/remove/has attribute。
    - 实现 Node.textContent 的读取和设置语义。
    - 实现 childNodes 的 live NodeList、长度、索引、迭代和身份行为。
  - 验收：
    - 树或文本变化会立刻反映到既有 childNodes 对象。
    - 属性和 textContent 的异常、字符串转换与描述符符合基线。
    - M4 范围内兼容清单无未解释跳过项。

## 预期改动

- Core/绑定/facade/type
- `tests/rust/**`
- `tests/bun/**`
- `tests/compat/**`
- 兼容清单

## 专属校验

- Core 与 Bun 测试
- M4 差分/类型测试
- 兼容清单退化检查
- 统一仓库校验

## 边界

不提前实现 NamedNodeMap、DOMTokenList 或查询索引。
