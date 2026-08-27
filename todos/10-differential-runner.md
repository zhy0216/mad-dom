# 10 建立黑盒差分 runner

- 状态：待办
- 优先级：P0
- 里程碑：M1
- 条目 ID：`T10`
- 依赖：T07
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

在隔离进程中用相同场景分别运行 happy-dom 和 MAD DOM，并输出可比较结果。

## 条目

- [ ] **T10 — 建立黑盒差分 runner**
  - 实现：
    - 定义场景协议和子进程隔离方式。
    - 规范化原始值、DOM/HTML、异常、描述符、身份关系和事件顺序。
    - 提供至少一组通过与故意失败的自测场景。
  - 验收：
    - runner 能准确标明场景 ID、两侧结果和差异路径。
    - 异常名称、稳定消息与抛出阶段可比较。
    - 两侧全局状态不会相互污染。

## 预期改动

- `tests/compat/runner/**`
- `tests/compat/scenarios/**`

## 专属校验

- 差分 runner 自测
- 统一仓库校验

## 边界

不通过隐藏 normalizer 掩盖真实兼容差异。
