difficulty: medium
agent: inherit
status: done

# 04 · checksum 实际 IO 吞吐与扫描优化

## T1 · 用真实 checksum workload 验证 IO 成本

前置依赖：`01-balanced-baseline.md`。

在现有 `scripts/bench-bun-io.mjs` 增加驱动实际 checksum CLI 的 generate/verify
场景，覆盖少量小 tarball、多 tarball、较大 tarball 及实际小 manifest。
准备 fixture、验证 hash/字节与删除临时文件不算内部 IO 时间；整进程时间明确
包含启动。所有子进程跟随指定 Bun，enabled/disabled 在独立进程选择。

预计修改文件：`scripts/bench-bun-io.mjs`、`tests/bun/bun-host-io.test.js`、
本计划 `evidence/task-04/`。现有报告字段保持兼容；不同时编辑 01 的公共 runner。

验收条件：

- manifest 完整内容、digest、排序、验证结果与错误退出码正确，不只验证最后文件。
- Bun/fallback 与冻结 reference/candidate 的输入和计时窗口一致，记录实际路径。
- 在实现优化前保存两版 raw baseline，按 01 的顺序/重复/采样窗口规范测量。
- 1 MiB 重复写约 4× 的历史差异与真实 checksum 测量分开，结论不能混淆。

## T2 · 减少目录枚举，评估有界文件处理

前置依赖：本文件 T1。

`verify()` 开始验证时只枚举一次目录并构造 Set；保持 manifest 逐 entry 的
诊断顺序。评估小固定并发或有界批次处理 read/hash，要求同时限制大文件在途内存。
不采用同时读取所有 tarball 的无界 Promise.all；若吞吐无明显提升则保留较简单
实现并记录原因，目录重复扫描的消除仍应保留。

预计修改文件：`scripts/checksums.mjs`、`tests/bun/bun-host-io.test.js`、
`evidence/task-04/`。`js/facade/bun-host-io.js` 的能力检测合约沿用，不增设全局
“Bun 一定更快”开关；不修改 virtual-server、sync-fetch、release/install-smoke。

Bun.file/CryptoHasher/write 各能力仍独立 fallback。必要的 manifest IO 选择只依据
T1 实际场景；保持 shasum 格式、文件名排序、stdout/stderr 文案、退出码和异常行为。

验收条件：

- generate/verify 在 Bun enabled/forced fallback/partial 能力组合中产出相同结果。
- 已有篡改 tarball、缺文件、空或无有效 manifest 等错误仍正确失败；并发不能丢失
  异常、留下未 await 写入或改变诊断顺序。
- 多包样本展示目录扫描减少的证据、端到端耗时、RSS/heap 与在途文件量；每次运行
  记录全部样本。吞吐不能通过无界增长内存换取。
- package/bun.lock、发布协议、registry、Bun baseline/latest policy 不变。

## T3 · 本任务验证

前置依赖：本文件 T1、T2。

预计修改文件：`evidence/task-04/` 的方法、raw 样本与验证清单。

验收条件：两版 Bun 下 `bun test tests/bun/bun-host-io.test.js`、
`bun run bench:bun-io:selftest` 通过；`bun run check`、`bun run validate` 通过。
native tests 构建本 worktree image 并显式覆盖路径。性能采样与其余任务构建/测试
串行，报告真实 checksum 收益及任何未解决的性能限制。

## 完成记录 · 2026-09-08

T1/T2/T3 及协调器补充的写入 oracle 复核全部完成，以一个本地任务 commit 交接。
初次交接时未执行 rebase/merge/push/PR，等待协调器独立复核与集成。
随后协调器明确授权的 rebase 与两版串行复验另见
[集成证据](../../evidence/task-04/rebase-validation.md)：rebase 已是最新，无冲突；
两版 host IO 各 44 pass / 513 assertions，0 fail/skip，`check` 均 exit 0。
复验在单个优先独占窗口完成，源码与 image 未变，本 commit 仅 amend 集成证据。

- [逐条验收与完整命令结果](../../evidence/task-04/acceptance.md)、
  [证据索引](../../evidence/task-04/README.md)：两版 check、report:runtime、IO/native
  专项和 selftest、完整 validate 均通过；先生成 hdunit rewritten fixtures。
- [正式结果与限制](../../evidence/task-04/findings.md)、
  [原始及补充样本表](../../evidence/task-04/tables.md)：144 个 ABBA worker，全部
  2 warmup/9 measured，0 失败；保留优化前两版 baseline 和所有补充组。
- 128 包 verify 目录扫描从 128 次降为 1 次；两版、两种 IO 模式实际 CLI 整进程
  耗时下降 29.9%–33.7%。生产仍串行；2 文件/8 MiB 有界原型未达到收益预算，已拒绝。
- [独立写入 probe](../../evidence/task-04/write-proof.json)：删除/毒化 manifest 后，
  reference/candidate × baseline/latest × Bun/fallback 的 16 次实际 CLI 全部写出正确
  完整内容；16 次仅打印成功的 no-op 全部被拒绝。正式 generate 窗口明确是覆盖已有
  manifest，原始样本未重写。最终两版 IO 专项各 44 pass / 513 assertions，0 fail/skip。
- [最终完整性检查](../../evidence/task-04/integrity.json)：reference 的 1498 tracked
  files、被测源码和两个独立 image 均未改变；两个 native override 指向各自同一 image。

无未完成验收或 blocker。共享 VM 竞争、暖 page cache、自然 GC、内部模块解析与
冷进程启动差异、历史 scratch/lifecycle/RSS 限制均保留，不宣称 DOM facade 收益。
