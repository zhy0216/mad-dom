# 45 实现 Window 平台对象、Storage 与 Cookie

- 状态：待复核
- 优先级：P2
- 里程碑：M8
- 条目 ID：`T45`
- 依赖：T22, T37
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

实现 URL/Location/History/Navigator、local/session storage 和 cookie 的 happy-dom 公开契约。

## 条目

- [ ] **T45 — 实现 Window 平台对象、Storage 与 Cookie**
  - 实现：
    - 优先复用 Bun/Web 标准对象，但以锁定 happy-dom 的可观察行为校准包装。
    - 实现 Location/History 状态与 Window/Document URL 联动。
    - 实现 Storage 的隔离、顺序、配额错误和相关事件。
    - 实现 cookie 解析、作用域和 Document.cookie 行为。
  - 验收：
    - 每个 Window/Document 的状态隔离明确。
    - 导航模拟不触发真实浏览器进程行为。
    - Storage/cookie 的字符串转换、异常和事件顺序通过差分。

## 预期改动

- Core/绑定/facade/type
- 平台对象与兼容测试

## 专属校验

- 平台对象/Storage/Cookie 测试
- 差分/类型测试
- 统一仓库校验

## 边界

不实现真实页面导航、浏览器安全沙箱或持久磁盘存储，除非基线明确要求。
