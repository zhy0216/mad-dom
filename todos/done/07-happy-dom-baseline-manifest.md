# 07 建立 happy-dom 基线清单

- 状态：待办
- 优先级：P0
- 里程碑：M1
- 条目 ID：`T07`
- 依赖：T03
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把兼容 ADR 中锁定的版本信息写入机器可读清单，并提供可重复验证。

## 条目

- [ ] **T07 — 建立 happy-dom 基线清单**
  - 实现：
    - 创建 `compat/happy-dom-baseline.json`，记录 npm 版本、commit、Bun 版本、生成器版本和生成时间。
    - 增加 schema/校验脚本，验证版本和 commit 不为空且格式正确。
    - 记录基线升级操作说明。
  - 验收：
    - 清单与 ADR 精确一致。
    - 篡改或遗漏关键字段会让校验失败。
    - 生成过程不读取上游 `main` 作为发布门禁。

## 预期改动

- `compat/happy-dom-baseline.json`
- `compat/schema/**` 或校验脚本
- `README.md` 或 `compat/README.md`

## 专属校验

- 基线清单校验命令
- 统一仓库校验

## 边界

不生成公开 API 快照。
