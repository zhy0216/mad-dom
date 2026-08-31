# 50 完成安全、性能、文档与 stable 门禁

- 状态：部分完成
- 优先级：P2
- 里程碑：M9
- 条目 ID：`T50`
- 依赖：T18, T20, T21, T48, T49
- 来源：[ADR-0001 实现计划](../plans/0001-basic-technical-architecture-implementation-plan.md)

## 目标

把内存安全、性能回归、兼容率、平台验证和文档收敛为首个 stable 发布门禁。

## 条目

- [x] **T50 — 完成安全、性能、文档与 stable 门禁**
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

## 结果

- 本机可完成的安全、性能、文档与 stable 门禁全部落地并逐条验证通过；
  跨平台安装验证依赖 CI（与 T49 相同 blocker），故状态为「部分完成」，
  不误标完成。完整证据见 `docs/stable-gate-report.md`。
- 验收逐条：
  1. **无已知崩溃、use-after-free、数据损坏或未说明 unsafe 风险**——Core 零
     `unsafe` 且 T50 新增 `#![forbid(unsafe_code)]`（`src/lib.rs`）编译器级
     强制；绑定层恰 4 处文档化 `cast()` 放宽（events/mutation-observer/
     traversal）逐条记录前提；Miri 代表性子集（`check-core-safety.sh miri`）
     与 ASan（`asan`）本机全绿；`npm run validate` 全绿。
  2. **锁定 happy-dom 兼容套件 100% 通过且目标平台全部通过安装验证**——兼容
     清单 43/43 pass、0 known-gap/not-applicable（types 10 + diff 33）；
     `compat:differential`/`compat:ledger` 零回归；宿主平台 `smoke:install`
     四项断言全绿。非宿主平台安装验证依赖 `release.yml` CI 矩阵（blocker）。
  3. **性能退化门禁可重复，文档与实际包内容一致**——`bench/baseline.json`
     提交 19 项指标基线（arena/mutation/parser/serializer/selector/FFI/GC），
     `npm run bench:check` 通过；`npm pack --dry-run` 37 文件与发布文档一致；
     `release:draft --stage alpha` 演练通过且不触碰 registry。
  4. **最终工作区和发布候选可由独立 checkout 复现**——固定工具链
     （Rust 1.93.1 / Bun 1.4.0）+ 上述命令路径全部在本报告生成时实际跑通。
- Blockers（待补齐，不构成本任务误标完成的理由）：
  - 非宿主平台（darwin-x64、linux-*-gnu、win32-x64、linux-*-musl）原生产物
    与安装 smoke 只能由 `release.yml` 矩阵在 native runner 验证，本机无交叉
    工具链无法复现。
  - glibc 下限与 Bun 1.4 对 optional 依赖 `libc` 字段的安装裁剪行为需在首个
    linux CI release build 实测后回填 `docs/release.md`（方法学与 TBD 已记录）。
  - WPT 子集当前 ~39.8%，为独立统计轨道（ADR-0002 §8），不阻塞 stable。
