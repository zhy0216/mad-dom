# 09 建立 TypeScript 双目标兼容测试

- 状态：已完成
- 优先级：P0
- 里程碑：M1
- 条目 ID：`T09`
- 依赖：T07
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

让同一组 TypeScript fixture 分别使用 happy-dom 和 MAD DOM 类型检查。

## 条目

- [x] **T09 — 建立 TypeScript 双目标兼容测试**
  - 实现：
    - 建立两套 tsconfig/路径映射，共享正向与负向 fixture。
    - 输出可比较的诊断结果并避免依赖编辑器行为。
    - 接入统一校验。
  - 验收：
    - MAD DOM 拒绝 happy-dom 接受的公开用法时测试失败。
    - 负向 fixture 能证明测试确实在执行。
    - 类型测试不依赖 happy-dom 私有声明路径。

## 预期改动

- `tests/compat/types/**`
- TypeScript 配置
- `package.json`

## 专属校验

- 双目标 typecheck 命令
- 统一仓库校验

## 边界

不提前扩充 MAD DOM 类型来伪造未实现的运行时能力。
