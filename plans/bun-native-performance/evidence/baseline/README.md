# 01 balanced baseline evidence

01 建立公共 runner、冻结 reference 并完成实际 baseline。生产实现仍为
`efaa64b3b9d90cf1988d8092d7de08e97e929630`；本任务只增加 harness/evidence 和更新
todo 队列。后续 source comparison 使用同一公共 runner，具体复用步骤见
[reference-reuse.md](reference-reuse.md)。reference、专用 Bun executable 与外部
CPU profile 均保留到 05 完成；本任务不执行集成或清理。

主要结论：[findings.md](findings.md)。完整 HTML getter 和大结果冷查询是本轮
可重复的公开 FFI 退化热点；创建池与多个 snapshot 项仍无定论。结论表区分实际
机制、相关 signal 和无定论项，并给出 02/03 优先级及 ABI/ownership 边界。

| 验收项 | 完成证据 |
| --- | --- |
| T1 source → artifact → runtime → operation provenance；同 image，无 npm/跨 worktree fallback | [公共 runner](../../../../benchmark/bun-performance/run.mjs)、[preload](../../../../benchmark/bun-performance/preload.mjs)、各 batch manifest/metadata；FFI available/disabled 被严格检查，真实 Unicode query/serialize handshake；[独立路径审计](diagnostic-notes.md) |
| T1 明确错误样本拒绝 | [report.test.js](../../../../benchmark/bun-performance/report.test.js)：missing/NaN/Infinity/negative timing、指纹、跳过 workload、runtime/child failure、协议与 config runs/sizes/suites 不一致、未跟踪 helper、profile 混入；两版最终各 18 tests / 102 assertions，坏 CLI 样例实际非零退出 |
| T1 tiny FFI on/off 实跑及结果相等 | 两版 [baseline](baseline-final-reference-smoke/manifest.json) / [latest](latest-final-reference-smoke/manifest.json)；另有 source-on/off 的 reference 与本 task 独立 image 对照，全部 5 suites 真实通过 |
| T1 help/README 可执行命令；独立 profile | 两版 help 命令输出；[runner README](../../../../benchmark/bun-performance/README.md) 列明 executable/root/image、FFI/source mode、smoke、profile、diagnostic、verify 与采样规则 |
| T2 两版 runtime/capability、正确性、所有原始样本及 profile | [reference manifest](reference-manifest.json)、[runtime baseline](commands/010-baseline-runtime.stdout.log) / [latest](commands/017-latest-runtime.stdout.log)、下列四个完整采样批次及 [12 个 profile 摘要](profiles.json) |
| T2 完整统计、热点/信号/无定论、02/03 顺序 | [预先声明的方法](method.md)、[全部 528 行表格](tables.md)、[合并完整样本](combined.json)、[结论与限制](findings.md)；既有 16 Core/13 Testing 和三层各 19 hotspot、所有大小与池档均保留 |
| T2 不可变 reference 交接 | [reference-reuse.md](reference-reuse.md)、[1498 文件清单](reference-source-files.json)、[采样后完整性证明](post-campaign-integrity.json)；原始 reference inventory/file hash 未变，新 inventory 未漏新 helper |
| T2 共享 runner 与协议交接、后续文件所有权 | runner、method 与本 evidence 随 01 唯一任务 commit 提交；队列 README 保留 01 对公共文件的所有权，02/03/04 写各自 evidence |
| T3 指定检查与完整 gate | [validation.json](validation.json)、[全部命令及退出结果](commands/commands.json)；两版完整 gate、最终修订 harness/smoke 和全部历史样本复验通过；计时与本流程 build/test/profile 串行 |

baseline 从 `.bun-version` 选择 1.4.0，revision
`34cbb9a40b4bd1bd767d134a7065e66c2432a676`；latest 于
2026-09-08T06:11:51.224Z 独立查询 [官方 release API](https://api.github.com/repos/oven-sh/bun/releases/latest)，
解析为 [1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)，revision
`744846f844374847c902b5e7fd59b4342a51ef99`。这是实验时的 latest；下一轮必须重新
查询。两个 executable/archive 的完整 SHA256 和下载来源均在 reference manifest。
Rust 固定 1.93.1；两版平台 linux/x64/gnu，项目 Node-API binding ABI 1、FFI ABI 1、
capability 31 / 六个操作符号。Bun 自身的 Node-API runtime version 另在 manifest
记录，不与项目 binding ABI 混淆。

| 正式采样批次 | 进程数 | 起止 UTC（2026-09-08） | 原始证据 |
| --- | ---: | --- | --- |
| baseline 初始 | 40 | 06:35:48–07:27:20 | [manifest](baseline-formal/manifest.json) |
| latest 初始 | 40 | 07:27:20–08:22:29 | [manifest](latest-formal/manifest.json) |
| baseline 补充 | 40 | 08:22:29–09:10:31 | [manifest](baseline-supplemental/manifest.json) |
| latest 补充 | 40 | 09:10:31–09:59:57 | [manifest](latest-supplemental/manifest.json) |

每个 batch 每个 suite 均为 ABBAABBA，每个新进程 2 warmup / 9 measured，sizes
1 → 0.1 → 2。初始噪声触发预先声明的一次完整补充，每版合计 4 组 ABBA，每个
suite/size/phase/mode 共 72 measured rounds。正式进程 160 个、失败 0；独立 audit
和后续 12 个 profile 不计入这 160 个。Core/Testing 的原有 warmup 约定保持不变：
旧 worker 未输出丢弃的 warmup 时长，新热点 worker 同时保存 warmup 和 measured。

`sample-files.json` 给出全部二十个数据目录文件的 SHA256；`manifest.json` 链接
每个 child attempt 和独立 audit，保留 config/完整样本/语义指纹/命令/退出/stdout
哈希/stderr/运行元数据/前后系统负载。正常 stdout 的 JSON 结果完整保存在 attempt
的 `report`，解析错误才单列原始 stdout。未生成失败子进程的有效 speedup。

| 校验命令（均串行、两个 override 指向该 checkout 的同一 image） | baseline 1.4.0 | latest 1.4.2 |
| --- | --- | --- |
| `bun install --frozen-lockfile`、`bun run dev:build` | task 和 reference 各执行一次，exit 0 | 复用已构建且 hash 不变的 image，无重复 reference 构建 |
| `bun run check` | exit 0，修订后复跑 | exit 0，修订后复跑 |
| `bun run report:runtime` | exit 0，FFI available | exit 0，FFI available |
| `bun test benchmark/bun-performance` | exit 0，18 pass / 102 assertions | exit 0，18 pass / 102 assertions |
| `bun test benchmark/dom-bench/report.test.js benchmark/dom-bench/testing-worker.test.js` | exit 0 | exit 0 |
| `bun run bench:bun-native:selftest` | exit 0，真实 FFI correctness | exit 0，真实 FFI correctness |
| `bun run compat:hdunit:rewrite`（完整 gate 准备） | exit 0 | exit 0 |
| `bun run validate` | exit 0 | exit 0 |
| 新 harness reference FFI 开关、source-on、source-off smoke | 三种模式 exit 0 | 三种模式 exit 0 |
| `run.mjs --verify` | 所有 baseline batch 及 development 通过 | 所有 latest batch 通过 |
| `bun run bench:bun-io:selftest`、`bun run bench:check`（补充 gate） | 未另跑跨版本历史比较 | 两项 exit 0 |

两次完整 `validate` 都包括 syntax、Rust fmt/clippy/compile、workspace tests、类型、
Bun、compat ledger、hdunit rewrite/triage、WPT。每版 Rust 691 pass；类型 24 fixtures
（22 positive / 2 negative）、两侧零 diagnostics；Bun 1194 pass / 0 fail，加 WPT
5 pass / 0 fail。hdunit 的 298 文件为 69 enabled、22 expected-fail、207 skipped；
gate 检查现有声明状态，不声称跳过的 upstream 测试通过。完整 stdout/stderr 已保留。

修验工具于 campaign 全部结束后才修改，实际被测 harness 原文/hash 已先归档。
[post-campaign.md](post-campaign.md) 解释未跟踪 production input、HEAD/current digest
含义、独立实际路径 audit，以及不混用新 verifier hash 与旧采样 hash 的方法。

`bench:check` 在 campaign 后使用协调器指出的历史 Linux baseline 原样副本，19
metrics 的原/副本 SHA256 均为
`bc571c411ed1b61efc25b03bb9ad1e06b1d2032460e62ce2127c16943e43d9ff`。
副本仅位于 ignored `bench/baseline.linux-x64.json`；历史文件未改。这是已有历史
guard 的 PASS，不是首次自动记录。OS/arch/Bun/Rust 一致无法证明 CPU/负载一致，
不将它当本轮 ABBA 或 >5% 优化回归门禁的替代品。现有 raw RSS 漏检限制仍保留，
补充 memory stability gate 的实际输出见 [日志](commands/072-latest-bench-check.stdout.log)。

本任务验收没有 blocker。已记录的限制是共享 VM 竞争、未稳定的小幅差异、JS
profile 的扰动与 native allocator 归因不足、历史 gate 的硬件可比性，以及外部
profile/Bun/reference 的保留要求。CPU profile 不是 leak 证明；不改变原计划阈值。

[最终范围/格式复核](review.json) 保留首次检查的两条 help stdout EOF 空行提示。
协调器独立复核后授权添加本目录 [.gitattributes](.gitattributes)，仅对
`commands/041-baseline-help.stdout.log` 和 `commands/046-latest-help.stdout.log`
设置 `whitespace=-blank-at-eof`。日志原始字节及 SHA256 不变，其余路径与空白
检查规则不变；全量 `git diff --check main...HEAD` 通过。

协调器授权进入集成阶段后，`git rebase main` 返回 0（main 仍为 efaa64b，分支
已是最新，无冲突）。通过 `python3 activity.py --task 01 --kind build-test -- …`
串行运行两版 `bun test benchmark/bun-performance`，各 18 pass / 0 fail / 102
assertions；两个 native override 均指向本 task image。预约 granted/released、
完整命令与结果见 [review.json](review.json) 的 `integration` 及 commands 079–080。
首次直接执行无执行权限的包装器在测试启动前报 EACCES，原记录 078 保留；随后
用 Python 执行同一未修改的包装器通过。仅 amend 本任务 commit，仓库级复验由
协调器继续；未 merge/push 或清理 reference。

复核与重算（需要保留的外部 profile 路径仍存在）：

```sh
BASELINE=/tmp/mad-dom-bun-performance-01/runtimes/baseline/bun-linux-x64/bun
"$BASELINE" benchmark/bun-performance/run.mjs --verify \
  "$PWD/plans/bun-native-performance/evidence/baseline/baseline-formal"
"$BASELINE" plans/bun-native-performance/evidence/baseline/analyze.mjs
```

`validation.mjs` 和 `integrity.mjs` 是 task-01 的本地验收脚本，会写派生 JSON；
冻结 source 不含 harness，后续测 candidate 应执行公共 runner 的 `--mode source`，
使用新目录并预约串行计时。不要在已提交 baseline 数据目录重跑采样 driver。
