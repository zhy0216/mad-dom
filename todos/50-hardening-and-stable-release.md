# 50 完成安全、性能、文档与 stable 门禁

- 状态：待办
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T50`
- 依赖：T18, T20, T21, T48, T49
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把内存安全、性能回归、兼容率、平台验证和文档收敛为首个 stable 发布门禁。

## 条目

- [ ] **T50 — 完成安全、性能、文档与 stable 门禁**
  - 实现：
    - 运行并固定 Miri/sanitizer 或目标平台等价检查，审计全部 unsafe 前提。
    - 保存 arena、mutation、parser、serializer、selector、FFI、GC 的性能/内存基线与退化阈值。
    - 完成支持矩阵、兼容率、已知限制、上游署名和发布/回滚文档。
    - 验证 stable 条件并生成发布候选报告。
  - 验收：
    - 无已知崩溃、use-after-free、数据损坏或未说明 unsafe 风险。
    - 锁定 happy-dom 兼容套件 100% 通过且目标平台全部通过安装验证。
    - 性能退化门禁可重复，文档与实际包内容一致。
    - 最终工作区和发布候选可由独立 checkout 复现。

## 预期改动

- 安全/基准/CI 配置
- 兼容与发布报告
- `README.md` 及发布文档

## 专属校验

- 完整统一校验
- Miri/sanitizer 套件
- 完整兼容/WPT 报告
- 性能与内存回归
- 全平台安装 smoke

## 边界

本条目只完成发布候选和门禁；不自动 push、创建 PR 或发布 npm。
