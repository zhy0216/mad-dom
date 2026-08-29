# 03 确定 happy-dom 兼容基线与差分协议

- 状态：已完成
- 优先级：P0
- 里程碑：M0/M1
- 条目 ID：`T03`
- 依赖：T01
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

用后续 ADR 锁定首个 happy-dom npm 版本、Git commit、Bun 版本和兼容判定规则。

## 条目

- [x] **T03 — 确定 happy-dom 兼容基线与差分协议**
  - 实现：
    - 记录版本选择依据、公开 API 范围和排除项。
    - 定义快照、类型检查、黑盒差分、结果规范化和稳定测试 ID 规则。
    - 定义 happy-dom 与 Web 标准冲突时的优先级及基线升级流程。
  - 验收：
    - ADR 状态明确，包含精确 npm 版本和 Git commit。
    - 协议覆盖导出、原型/描述符、类型、异常、身份、DOM 快照和事件顺序。
    - 升级基线必须独立提交并恢复完整兼容门禁。

## 预期改动

- `adr/0002-*.md`

## 专属校验

- 检查 ADR 内所有仓库链接
- `bun --check index.js`

## 边界

只做兼容契约决策，不实现兼容 runner。
