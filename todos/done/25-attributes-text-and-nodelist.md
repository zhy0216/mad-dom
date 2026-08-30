# 25 集成属性、textContent 与 live childNodes

- 状态：待复核
- 优先级：P0
- 里程碑：M4
- 条目 ID：`T25`
- 依赖：T25A, T25B, T25C, T25D, T25E
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 Core 属性/文本、live childNodes 和 binding/facade 接成 M4 的最后一个基础 DOM 垂直切片。本文件是集成闸门。

## 条目

- [x] **T25 — 实现属性、textContent 与 live childNodes**
  - 实现：
    - 接入 T25A、T25B、T25C、T25D、T25E，更新唯一 registry、入口、类型、API 快照和兼容清单。
    - 运行跨模块交互测试，确认 mutation、属性、textContent 和 live childNodes 的观察顺序一致。
  - 验收：
    - 树或文本变化会立刻反映到既有 childNodes 对象。
    - 属性和 textContent 的异常、字符串转换与描述符符合基线。
    - M4 范围内兼容清单无未解释跳过项。

## 预期改动

- registry/入口/类型的集成改动
- tests/rust/**、tests/bun/**、tests/compat/**
- 兼容清单

## 专属校验

- Core 与 Bun 测试
- M4 差分/类型测试
- 兼容清单退化检查
- 统一仓库校验

## 边界

不提前实现 NamedNodeMap、DOMTokenList 或查询索引；只有本闸门归档后，T26/T30/T37 才能被调度。
