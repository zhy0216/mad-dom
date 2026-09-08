difficulty: hard
agent: inherit
status: done

# 01 · 冻结 baseline，定位公开 API 的 Bun native 成本

## T1 · 定义并实现有效的三层对照

前置依赖：无。

阅读 plan 的仓库依据、采样要求和现有 `benchmark/dom-bench/`、
`scripts/bench-bun-native.mjs`、`js/runtime-metadata.js`。新建 runner/worker，
把 raw ABI、JS adapter、public facade 分层报告；复用已有 DOM oracle 与 workload。
不要改 DOM、loader、Rust 或宿主 IO 实现，也不要修改历史 baseline/报告。

预计修改文件：新增 `benchmark/bun-performance/run.mjs`、`worker.mjs`、
`report.test.js`、`README.md`；必要的 helper 放在同一新目录。

runner 接受明确 Bun executable、source root、native image、FFI mode/reference
和 candidate。worker 通过指定 root 导入实现；缺少原生 image、意外 fallback、
非零退出、无效结果、缺失 capability 信息时不能生成有效 speedup。
原有 DOM workers 从指定源码位置运行；同一配置的各对照使用完全相同 workload。
不要用随 PATH 变化的 `bun` 启动测量子进程。

至少覆盖作用域 querySelectorAll 冷/热、child/preorder、完整 innerHTML/outerHTML、
创建池各档及既有 Core/Testing。大小、非 ASCII、UTF-8 字节量、结果消费、
缓存状态和 correctness checks 全部显式。必要的调用数/分配诊断仅在独立诊断
进程或测试中启用，不给生产热路径增加无条件 instrumentation。

验收条件：

- 存在从 source root 到 artifact、runtime、operation path 的完整 provenance；
  Node-API 与 FFI 使用同一个 image，不能误加载 npm 或其他 worktree 的包。
- `report.test.js` 用明确的错误样本验证拒绝 missing/NaN/infinite/negative timing、
  指纹不匹配、跳过 workload、运行时不一致和失败子进程；不能只有 snapshot/自证测试。
- tiny workload 能实际跑通 FFI on/off，并证明两端的有效结果一致；错误样例不能退出 0。
- `--help` 与 README 列出真实可执行的 baseline/candidate、mode、profile、采样命令；
  profile 使用独立运行，不计入正式 timing。

## T2 · 保留不可变 reference、采样协议和实际 baseline

前置依赖：本文件 T1。

预计修改文件：本计划 `evidence/baseline/` 下的方法、运行清单、raw samples、
profile 摘要与 baseline 结论。大的 CPU profile 可放执行期 artifact 位置，但要有
校验和、可复跑命令和足够的可提交热点证据，不提交 native binary。

使用协调器允许的独立 reference checkout/build 保存优化前源码与 artifact；
记录 source SHA、路径与 hash，不能与后续 build 共用可写文件。baseline 从
`.bun-version` 获取；latest 独立核实实际版本，两者均记录 executable/revision。
01 的 source 可以包含新 harness，但生产实现必须仍为优化前版本。

在改造前声明顺序、重复数、大小、统计/噪声处理与补充采样规则。遵循 plan 的
两组 ABBA、新进程、2 warmup/9 measured；同运行时比较 FFI on/off，保留所有
失败和样本。完整跑既有 16/13 workload；profile 重点解释 serializer、snapshot
及创建池的 raw/adapter/facade 差异。不要只重抄历史 +17.8% 作为新测量。

验收条件：

- 两版各有 runtime/capability、FFI on/off 正确性一致、完整原始样本及 profile 结论。
- 表格区分已证实热点、仅相关的 signal、无定论项；给 02/03 明确优化顺序，
  不改变计划的 ABI/ownership 边界，也不要求结果必须符合先验判断。
- 冻结 reference 的复用方法交给协调器与 02/03/04，直到 05 完成前不得删除。
- 01 完成前公共 runner 和测量协议已提交；后续任务不争抢这些文件。

## T3 · 本任务验证

前置依赖：本文件 T1、T2。

预计修改文件：`evidence/baseline/validation.json` 或等价命令清单。

验收条件：`bun run check`、`bun test benchmark/bun-performance`、既有两个
DOM harness 测试、`bun run bench:bun-native:selftest`、`bun run report:runtime`
和 `bun run validate` 通过；native 使用本 worktree 显式路径。baseline/latest
均通过新 harness 校验和 correctness smoke。性能采样本身不得与其它 build/test 并发。

## 完成记录 · 2026-09-08

T1/T2/T3 全部完成；本任务以一个本地 commit 交接，等待协调器独立复核与集成，
未执行 rebase/merge/push/PR 或 reference 清理。

- [逐条验收与命令索引](../../evidence/baseline/README.md)、
  [完整验证结果](../../evidence/baseline/validation.json)：两版指定 gate 通过，
  Rust 各 691 pass、类型 24 fixtures、Bun 各 1194 pass + WPT 5 pass，
  最终新 harness 各 18 tests / 102 assertions。
- [预先声明的协议](../../evidence/baseline/method.md)、
  [完整原始批次及负载清单](../../evidence/baseline/campaign.json)：两版各初始两组
  ABBA，按噪声规则全部 suite 各补充两组；共 160 正式新进程，2 warmup / 9
  measured，size 1/0.1/2，全 16 Core/13 Testing/三层各 19 热点；无失败或丢样。
- [热点/信号/无定论与 02/03 顺序](../../evidence/baseline/findings.md)、
  [12 个独立 profile 摘要与校验和](../../evidence/baseline/profiles.json)。
- [不可变 reference 及复用步骤](../../evidence/baseline/reference-reuse.md)：
  source efaa64b，独立 build/target 与 Bun executable；全部保留至 05 完成。
- [采样后修验记录](../../evidence/baseline/post-campaign.md)：正式运行未改 harness；
  原始 harness 已按字节归档；实际路径独立 audit、未跟踪 production helper 和
  protocol/config 不一致的回归验证通过。生产实现、依赖和锁文件未改。

无未完成验收或 blocker。共享 VM 竞争、profile 扰动、未稳定的小幅差异及历史
Linux gate 的 CPU/负载可比性限制已明确记录，不降低原计划阈值。
