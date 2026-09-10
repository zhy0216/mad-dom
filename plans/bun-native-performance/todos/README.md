# Bun native performance todo queue

方案：[plan.md](../plan.md)。目标是减少已存在 Bun-native 路径的边界开销，并以
公开 API 的完整操作和实际 checksum IO 验收。

## 执行偏好

default_agent: codex

来源：发起本流程的 Codex 宿主。用户未指定全局 model/reasoning override，也没有
单任务 agent 指定；全部 todo 使用 `agent: inherit`。按共享分发规则解析实际模型，
不把协调器的 high 推理强度作为任务默认值。

协调器：Codex / `gpt-6-astra` / `high`。执行 hard：Codex / `gpt-6-astra` / `max`；
medium：Codex / `gpt-6-astra` / `xhigh`。启动时逐任务显式传模型、推理强度及
`--dangerously-bypass-approvals-and-sandbox`，包括补位/restart。

## 优先级

| 文件 | 优先级 | 难度 | agent | 模型 / Codex 推理强度 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `done/01-balanced-baseline.md` | P0 | hard | inherit → codex（继承默认） | `gpt-6-astra` / `max` | 已完成：公共 runner、完整 ABBA/profiles 与不可变 reference；待协调器复核集成 |
| `done/02-native-snapshot-packing.md` | P1 | hard | inherit → codex（继承默认） | `gpt-6-astra` / `max` | 已完成：无可复现公开收益，保留最小实现并如实披露；逐条证据在 ../evidence/task-02/ |
| `done/03-ffi-adapter-performance.md` | P1 | hard | inherit → codex（继承默认） | `gpt-6-astra` / `max` | 已完成：保留有界 scratch 复用 + UTF-8 解码优化；不引入新静态路径，materialize-state 路由被 probe 证伪；null control 归因位点效应；证据在 ../evidence/task-03/ |
| `done/04-checksum-io-performance.md` | P1 | medium | inherit → codex（继承默认） | `gpt-6-astra` / `xhigh` | 已完成：单次目录扫描、真实 CLI ABBA 与写入 oracle；有界并发未纳入生产 |
| `done/05-integrated-performance-validation.md` | P0 | hard | inherit → codex（继承默认） | `gpt-6-astra` / `max` | 已完成：公开 facade 收益达标（HTML getter 与 large cold query 稳定 −27…−44%，双 runtime，默认 FFI-on）；无归因本轮改动的确认回归，mode 内部成本与 ±6–16% 布局漂移如实披露；T1 两版 on/off validate 1209/0；证据在 ../evidence/final/ |

## 文件

1. [done/01-balanced-baseline.md](done/01-balanced-baseline.md) — 已完成；[逐条验收证据](../evidence/baseline/README.md)
2. [done/02-native-snapshot-packing.md](done/02-native-snapshot-packing.md) — 已完成；[逐条验收证据](../evidence/task-02/README.md)
3. [done/03-ffi-adapter-performance.md](done/03-ffi-adapter-performance.md) — 已完成；[逐条验收证据](../evidence/task-03/README.md)
4. [done/04-checksum-io-performance.md](done/04-checksum-io-performance.md) — 已完成；[逐条验收证据](../evidence/task-04/acceptance.md)
5. [done/05-integrated-performance-validation.md](done/05-integrated-performance-validation.md) — 已完成；[逐条验收证据](../evidence/final/README.md)。依赖 01-balanced-baseline、02-native-snapshot-packing、03-ffi-adapter-performance、04-checksum-io-performance，以及 test-only offlane followup `050a685`

## 依赖、并行与文件所有权

`01 → (02 ∥ 03 ∥ 04) → 05`。最多三个实现任务并行；02/03 保持现有 ABI，
不得增加对对方尚未完成实现的依赖。05 必须在四个前置 commit 均合入后启动。

- 01 独占新 `benchmark/bun-performance/` 与 `evidence/baseline/`；保留冻结 reference
  checkout/artifact，告诉协调器路径、SHA、Bun executable；到 05 完成后才清理。
- 02 独占 `crates/mad-dom-bun/src/handle.rs`、`src/ffi/` 和 `tests/bun/ffi-fast-path.test.js`。
- 03 独占 loader、相关 facade 文件、`native-loader.test.js`/`ffi-memory.test.js`
  及对应 JS fixtures；不修改 02 的 Rust/FFI 专项文件。
- 04 独占 checksum/IO benchmark 和 `bun-host-io.test.js`；不改 release、平台、包元数据。
- 05 负责最终 evidence、`results.md`、性能文档和 package script 入口；实现缺陷分派回
  原 agent 修复，不跨 task 混入新业务设计。
- 各实现任务只写 `evidence/task-02/`、`task-03/`、`task-04/`；共享 runner 的修复
  由协调器安排原 owner 完成，避免多个 worktree 同时改变采样协议。

## 执行约束与验收摘要

每个 todo = 独立 worktree = 一个最终 commit。遵守根 `AGENTS.md`，用 Bun 安装/运行
JS，Rust 固定 1.93.1，保持 bun.lock、ABI v1、caller-owned 返回值、destroy/transfer/
Worker 语义及 Node-API fallback。native 两个 override 指向本 worktree 同一个 image。

正式计时先向协调器预约；同一时间只跑一组本流程的 benchmark，暂停本流程其它
build/test。不要中断其他仓库的 agent。记录共享 VM 竞争和负载；不稳定结论注明限制。
全部结果含 runtime version/revision、平台/libc、ABI、实际能力与操作路径、source SHA、
artifact SHA256、命令、顺序、退出码、完整样本与 correctness 指纹。

收益目标和回归处理见方案：重点 facade 操作争取至少 10% 稳定改善，或消除已确认退化；
全部 16 Core/13 Testing workload 保留，确认的 >5% 回归返修，不改权重/阈值洗绿。
仅有 raw FFI 的速度优势不能完成公开 API 优化验收。保持现有 RSS 漏检记录。
依赖完成、专项测试通过且仓库 `bun run validate` 通过后，协调器再独立复验和合入。

手动续跑：`$herdr-finish-plan bun-native-performance`；执行偏好已保存于此。

## 01 交接 · 2026-09-08

01 的正式/补充采样及独立 profile 已结束，T1/T2/T3 全部通过，以单个本地任务
commit 交接；未执行集成。02/03/04 在协调器复核并集成 01 后复用公共 runner，
继续遵守各自文件所有权。完整说明见 [baseline evidence](../evidence/baseline/README.md)。

冻结 reference：
`/home/ubuntu/.herdr/worktrees/mad-dom/bun-native-performance-reference-efaa64b`，
detached source `efaa64b3b9d90cf1988d8092d7de08e97e929630`；原生 image SHA256
`2d1f85d40ea55e79d2564004716cd9b68c48cde31baea3b9335d63a7c102fa96`。
[manifest](../evidence/baseline/reference-manifest.json) 与
[复用步骤](../evidence/baseline/reference-reuse.md) 记录两个 Bun executable/revision、
完整 source/artifact hashes、独立 build/target 和 source comparison 命令。
reference、专用运行时和外部 profile 均保留至 05 完成，不能重建 reference。

后续优先级依据 [实际结果](../evidence/baseline/findings.md)：03 先完整 serializer
再 query 的 adapter/路径选择，创建池尚无稳定公开收益；02 先检查 preorder
packing，再 query/child，保留未知 descriptor 的 wrapper 分类与 ABI v1 ownership。
共享 VM 噪声和无定论项已保留，05 仍按原阈值独立验收。
