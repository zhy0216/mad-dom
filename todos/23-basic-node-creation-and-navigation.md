# 23 实现基础节点创建与导航 API

- 状态：待办
- 优先级：P0
- 里程碑：M4
- 条目 ID：`T23`
- 依赖：T22
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

从 JavaScript 创建 Element/Text，并读取基础 Node 导航和标识属性。

## 条目

- [ ] **T23 — 实现基础节点创建与导航 API**
  - 实现：
    - 实现 `createElement`、`createTextNode`。
    - 暴露 parentNode、first/lastChild、previous/nextSibling、nodeType、nodeName。
    - 校准构造限制、对象身份和属性描述符。
  - 验收：
    - JavaScript 可构建 detached 节点并稳定读取其类型/名称。
    - 同一关系属性重复读取命中 wrapper identity。
    - 公开 API、类型和差分场景同步更新。

## 预期改动

- Core/绑定所需小幅扩展
- `js/**`
- `index.*`
- `tests/bun/**`
- `tests/compat/**`

## 专属校验

- Core 测试
- Bun API 测试
- 相关兼容与类型测试
- 统一仓库校验

## 边界

不实现 mutation、attributes 或 parser。
