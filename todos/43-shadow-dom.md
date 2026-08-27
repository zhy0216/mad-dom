# 43 实现 Shadow DOM

- 状态：待办
- 优先级：P2
- 里程碑：M8
- 条目 ID：`T43`
- 依赖：T31, T37, T42
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现 ShadowRoot、attachShadow、树边界、事件 retargeting 和公开查询行为。

## 条目

- [ ] **T43 — 实现 Shadow DOM**
  - 实现：
    - 定义 shadow tree 在 arena 中的所有权与连接关系。
    - 实现 open/closed mode、host、slot 基础分配和查询边界。
    - 接入 composed path、事件 retargeting、克隆/序列化的基线行为。
  - 验收：
    - 普通 DOM 导航不会错误穿透 shadow boundary。
    - 事件 composed/retargeting 顺序与基线一致。
    - closed root 不通过公开 API 泄漏。

## 预期改动

- Core/绑定/facade/type
- selector/event 适配
- 兼容测试

## 专属校验

- Shadow DOM 树/事件测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现布局、绘制或非公开 shadow internals。
