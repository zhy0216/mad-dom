# 协调器独立复验与流程账本

本目录归档协调器（herdr-finish-plan/finish-todo 执行线）在各任务合入 main 前、
于任务 worktree 内亲自运行的仓库级校验，以及全流程串行门账本。所有命令均经
`/tmp/mad-dom-bun-native-performance-efaa64b/activity.py` 单一 activity EX 串行
（`--priority-integration`，不打断任何在跑 campaign），JSON spec 驱动见各目录
`validation.json` 的 `groupedIntegrationReservation` 字段。

| 目录 | 对象 commit | 内容 |
| --- | --- | --- |
| `coordinator-01-validation/` | fe77b7e（01 baseline） | 8 项：双 runtime check/harness/runtime/tiny smoke + 历史证据只读复核 |
| `coordinator-04-validation/` | 24d8912（04 checksums） | 7 项：latest 完整 validate、双 runtime IO 专项/selftest/ledger |
| `coordinator-01-metadata-validation/` | 5cf2163（01-meta followup） | 8 项：双 runtime check/harness/runtime + `*-tiny/` 全新 smoke 批次 |
| `coordinator-01-metadata-baseline-tiny/` `…-latest-tiny/` | 同上 | 协调器重跑的 tiny 批次原始样本（validation.json 按 file+sha256 引用） |
| `coordinator-02-validation/` | fd03009→834f5ff（02） | 7 项：latest 完整 validate + 双 runtime native 专项/runtime/selftest，image `6b7e7398…` 稳定 |
| `coordinator-03-validation/` | 09c6a68（03） | 7 项：同上（03 侧专项），组合镜像与 02 相同（02 已先合入） |
| `coordinator-05-validation/` | 3f82c4f（05） | 9 项：双 runtime × FFI on/off 完整 `bun run validate`（off 即 06-offlane 修复后的终验）、harness×2、probe/native/IO selftest |
| `reservation-journal.jsonl` | 全流程 | activity.py 原始预约账本（535 行，append-only，未重写） |
| `session-recovery-20260908.json`、`orphan-guard.json` | 2026-09-08 事故 | Codex 会话中断后的恢复记录：15 条 stale 预约、guard 持锁窗口、不可认证区间 |
| `final-audit.json` | 收尾时点 | `audit-gate.py` 结合 journal/recovery/guard/proc 锁的最终审计：172 完成预约、记录区间零重叠；unresolved 条目即上述 09-08 中断窗口，保持单列 |

限制与如实声明：账本只能证明记录区间内互斥，不证明共享 VM 无外部负载；09-08
中断留下的两个 unverified granted 窗口不用于任何收益论证（对应旧 campaign 数据
整体排除在验收外，05 已在最终组合独立重测）。协调器进程曾有一次
`coordinator-01-metadata` 请求（pid 3538129）因 shell 超时被终止于队列中、未获锁、
无残留；重跑为 pid 3590750 通过。原始 `.cpuprofile` 与双 runtime 归档保留在
`/tmp/mad-dom-bun-native-performance-efaa64b/final-profiles/`、
`/tmp/mad-dom-bun-performance-01/`（runtimes/profiles），哈希见
`../final/profiles/INDEX.json` 与各 validation manifest。
