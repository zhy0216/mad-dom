difficulty: hard
agent: inherit
status: done

# 05 · 集成后的性能、正确性与内存验收

## T1 · 在最终 candidate 上验证两版 Bun 与路径组合

前置依赖：`01-balanced-baseline.md`、`02-native-snapshot-packing.md`、
`03-ffi-adapter-performance.md`、`04-checksum-io-performance.md`。

先读取 plan、01 frozen reference manifest 和三项实现证据。确认前置 commit 已经
合入，然后在自己的 worktree 重建最终 artifact；新旧两个 source/artifact 各自
固定，Node-API/FFI 指向同一 image，避免读取已覆盖的 baseline 二进制。

预计修改文件：本计划 `evidence/final/`、必要的最终 harness 集成测试。
不借最终验收新开 DOM/ABI/IO 架构改造；发现实现缺陷由协调器返回原 agent。

baseline 读取 `.bun-version`，latest 执行时独立核实；记录 version/revision、
executable、OS/CPU/libc、Rust、Node-API/FFI ABI、capability、实际操作选择及
source/artifact SHA256。baseline 与 latest 分别比较，不混算。

验收条件：

- 两版在 FFI enabled/disabled 下完整 `bun run validate` 通过；partial/missing
  symbols、ABI mismatch、oversized result、旧 binding fallback 的专项通过。
- 真实 buffer retain/transfer/destroy/GC/Worker、创建池 single-shot、wrapper
  identity/epoch/live collection 专项通过；Rust 02 + JS 03 的组合被实际执行。
- `bun run report:runtime`、`bun run probe:bun:selftest`、两个 boundary/IO selftest、
  `bun test benchmark/bun-performance` 和既有 DOM harness 两项测试通过。
- `bun run bench:check` 对适用的未改 baseline 通过；保留 benchmark memory gate
  的 raw RSS/lifecycle 数据与已知漏检说明，不更改阈值/计数容忍度换绿。
- 按 integration README 的 isolated file-dependency snapshot 规则刷新本地包后，
  `bun run test:integration` 通过；该测试不是完整 happy-dom 上游兼容声明。

## T2 · 正式测量最终收益并处理回归

前置依赖：本文件 T1；01 的不可变对照与协议。

预计修改文件：本计划 `evidence/final/` raw 结果、对照汇总与 validation manifest。

预约串行窗口，按 01 固定的 ABBA/2 warmup/9 measured 与补充采样规则，对
reference/candidate 及 FFI on/off 完整采样。包含 16 Core、13 Testing、三层
热点 workload、checksum IO，以及辅助大小；profiler 另跑不计入正式时间。
如 public 默认已选择某个 Node-API 操作，表里说明它；不要把 global FFI available
等同于每个操作实际走 FFI。

验收条件：

- 所有 workload 结果指纹匹配，未执行/失败项不能参与 speedup；保留每一 phase，
  aggregate 为各 round timed-phase sum 的 median，不改变权重或混入 untimed setup。
- 重点 facade 目标至少 10% 稳定收益或已确认的明显退化消除，说明是 FFI 优化、
  Node-API/range 选择还是回退修复。raw-only 提升不作为端到端完成标准。
- candidate 的聚合或主要未优化 phase 若重复出现 >5% 回归，保留原始结果并定位；
  确认归因于本轮改动的回归须返修后重测，不以写进报告代替修复。
- 接近噪声/共享 VM 竞争、runtime 间相反结果全部明确标注；必要复测遵循先前
  协议，不选择最快结果，也不要求实现性能必然符合初始历史信号。
- RSS/heap、scratch 预算/增长回落和生命周期证据完整；不对未测平台宣称收益。

## T3 · 可复现报告、文档与执行收尾

前置依赖：本文件 T1、T2。

预计修改文件：本计划 `results.md`、`evidence/final/`，`docs/performance.md`、
`benchmark/README.md`、`benchmark/bun-performance/README.md`、`package.json`
（仅新增 `bench:bun-performance` 的 Bun script）；必要时一份增量 ADR 解释路径策略。

报告按最终行为写明问题、改动、效果、校验与限制；新记录链接独立保存，不能覆盖
历史 macOS headline、旧 Bun-native 数据或 RSS 漏检事实。VitePress 证据链接使用
实际可访问的源码链接，不假设未发布 JSON 会自动作为静态资产复制。

验收条件：

- README/文档里的命令在干净源码安装+构建流程实际验证；
  `bun run bench:bun-performance --help`、tiny smoke、`bun run docs:build` 通过。
- `results.md` 汇总前置 commit、实际测量 source SHA/artifact hash、全部 phase、
  runtime/mode、commands/exits、回归处理以及无法验证项；明确“实现完成”与
  “性能目标有证据支持”的区别，未达成项不得伪装成完成。
- 无版本号/依赖/锁文件/CI latest lane 变更，无 push/发布动作。
- 本任务一个最终 commit；协调器独立复验后按 herdr-finish-plan 完成 rebase、
  ff-only 合并、归档 todo、清理自己创建的任务与 reference 资源。最终主 checkout
  若需运行 native 验证则重建自己的 artifact，不能遗留错版本 native image。
