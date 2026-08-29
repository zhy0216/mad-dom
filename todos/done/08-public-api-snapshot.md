# 08 生成 happy-dom 公开 API 快照

- 状态：已完成
- 优先级：P0
- 里程碑：M1
- 条目 ID：`T08`
- 依赖：T07
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

从锁定基线提取包导出、构造函数、原型链、属性名、symbol、描述符和稳定常量。

## 条目

- [x] **T08 — 生成 happy-dom 公开 API 快照**
  - 实现：
    - 实现确定性快照生成器，并在隔离进程加载 happy-dom。
    - 定义不可稳定序列化值的规范化或排除规则。
    - 提交初始快照和自测 fixture。
  - 验收：
    - 同一环境重复生成无无意义 diff。
    - 故意改变导出、原型或描述符会被比较器发现。
    - 快照包含生成器版本和基线引用。

## 预期改动

- `compat/public-api/**`
- `tests/compat/**`
- 生成脚本

## 专属校验

- 快照重生成后 `git diff --exit-code`
- 相关 Bun 测试
- 统一仓库校验

## 边界

只采集公开可观察 API，不读取 happy-dom 私有深层模块。
