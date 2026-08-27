# 47 实现定时器、任务调度与脚本执行集成

- 状态：待办
- 优先级：P2
- 里程碑：M8
- 条目 ID：`T47`
- 依赖：T37, T41, T42, T46
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把 Window timer、microtask、异步资源和 happy-dom 脚本执行行为接入 Bun。

## 条目

- [ ] **T47 — 实现定时器、任务调度与脚本执行集成**
  - 实现：
    - 实现 timer/interval/immediate/animation frame 等基线公开表面及取消语义。
    - 固定事件、MutationObserver、Custom Elements、Promise 与 timer 的任务顺序。
    - 实现脚本执行开关、错误传播、document/window 全局绑定和 Bun test 集成。
  - 验收：
    - 使用可控时钟或短时确定性场景验证调度顺序。
    - 释放 Window 后不会遗留无主 timer 或原生资源。
    - 脚本错误和异步结果与基线差分一致。

## 预期改动

- 绑定/facade/type
- 异步调度与 Bun 集成测试

## 专属校验

- timer/task 顺序测试
- 脚本/Bun test 集成测试
- 异步差分/类型测试
- 统一仓库校验

## 边界

不创建独立浏览器事件循环或跨线程可变 DOM。
