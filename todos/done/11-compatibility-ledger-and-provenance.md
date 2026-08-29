# 11 建立兼容清单、退化门禁与上游来源映射

- 状态：已完成
- 优先级：P0
- 里程碑：M1
- 条目 ID：`T11`
- 依赖：T08, T09, T10
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把每个兼容场景记录为 pass、known-gap 或 not-applicable，并追踪移植测试来源。

## 条目

- [x] **T11 — 建立兼容清单、退化门禁与上游来源映射**
  - 实现：
    - 定义稳定 ID、状态、原因和 subsystem 字段。
    - 创建 `compat/upstream-map.json`，记录路径、commit、许可证和本地 ID。
    - 生成按 subsystem 汇总的机器可读报告。
    - 在 CI 中禁止已有 pass 退化。
  - 验收：
    - 所有差分场景都能映射到唯一清单项。
    - known-gap/not-applicable 缺少原因时校验失败。
    - 模拟 pass 退化会让 CI 失败。
    - 上游移植用例保留 MIT 来源信息且不引用私有 API。

## 预期改动

- `compat/**`
- `tests/compat/**`
- CI 配置

## 专属校验

- 兼容清单 schema/退化自测
- 差分与类型测试
- 统一仓库校验

## 边界

不把跳过项计为 pass，也不把 WPT 与 happy-dom 通过率混为一个指标。
