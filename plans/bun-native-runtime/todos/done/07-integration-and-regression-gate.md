difficulty: hard
agent: inherit

## T1 · 集成 Bun-native 通道并完成回归门禁

### 要做什么

- 在最新原分支上逐项整合 FFI ABI、loader/facade、memory/GC、host IO 和 latest CI/release 改动；解决冲突时保持公开 facade、Node-API fallback 和 Core 约束。
- 运行完整仓库校验和所有新增 capability/FFI/memory/IO/latest 场景；对失败进行最小修复并保持每个任务的验收证据。
- 运行代表性 `bench:dom`、FFI microbenchmark、GC/RSS/heap benchmark、integration test 和 install smoke，记录 cold/warm、boundary、结果校验、内存和 fallback 状态。
- 复核发布包内容、平台包选择、ABI mismatch、FFI disabled、latest capability failure 和 clean checkout 安装路径。
- 更新 plan 执行结果和 todos 状态；只归档真正完成且校验通过的任务。

### 预计修改文件

- 仅在前置任务集成冲突或验收缺口时修改对应实现/测试文件
- `plans/bun-native-runtime/plan.md`
- `plans/bun-native-runtime/todos/README.md`
- `plans/bun-native-runtime/todos/done/` 中归档已完成 todo
- 必要时新增 `docs/` 性能/兼容结果记录

### 验收条件

- 以下命令全部通过：

  ```sh
  bun run check
  cargo fmt --check
  cargo clippy --workspace --all-targets -- -D warnings
  cargo test --workspace
  bun run compat:types
  bun run test
  bun run compat:ledger
  bun run compat:hdunit:rewrite
  bun run compat:hdunit:validate
  bun run wpt:test
  bun run test:native
  bun run smoke:install
  bun run bench:check
  ```

- latest Bun、baseline Bun、FFI-enabled、FFI-disabled 和 Node-API fallback 的结果都有明确记录。
- 公开 DOM 结果、错误码、wrapper identity、destroy、affinity 和 platform loader 没有回归。
- benchmark 报告 FFI/IO 迁移的真实收益和任何退化；不能只报告单个快路径。
- 原分支工作区干净，所有任务各自只有一个已 rebase 的本地 commit，合并使用 `git merge --ff-only`。

### 前置依赖

依赖 `03-bun-ffi-loader-and-facade.md`、`04-memory-gc-and-external-buffers.md`、`05-bun-host-io.md`、`06-latest-bun-ci-and-release-policy.md`。

### 执行与验收记录

本地实现和规定门禁已完成，2026-09-07/08 UTC。实际基点为
`4a90f51bb6f98cbaf4ceab43579fb12da951ef35`（06），父提交为
`49351d2c346bab2156ac029345f5e95995f379f2`（04）；没有以旧 PR/WIP 猜测最终状态。
完整证据见[集成报告](../../../../docs/bun-native-runtime-results.md)、
[逐条命令/环境/结果/原始日志](../../../../docs/bun-native-runtime-evidence/validation.json)
与[plan 执行结果](../../plan.md#执行结果07-本地验收完成)。

| 验收项 | 实际结果 |
| --- | --- |
| 全部规定命令 | baseline 1.4.0 与 latest 1.4.2 均通过；Rust 691/0、最终 Bun 1194/0，完整 validate 检查点各为 691/1192，v2 新增两项后完整 Bun/native/integration 再验通过 |
| 安装与构建 | 新目录、任务专用空缓存、原 frozen lockfile；复现并最小修复 integration hoisted file dependency 递归，isolated linker 两版成功，JS 源码哈希一致；native/FFI 使用当前同一 image |
| 模式与公开合约 | 两版 enabled/disabled/unavailable capability 和公开 DOM digest 一致；错误码、identity、destroy、affinity、ABI/platform/fallback、IO-disabled integration 均通过 |
| 发布包 | 真实 npm pack 本地 main/platform tgz、内容与 checksum 复核，五组 installed smoke 通过；无 publish |
| benchmark | DOM 9 轮/2 warmup；FFI boundary、host IO 分别 cold + 2 warmup + 5 样本；4 组 facade/FFI GC 内存 workload，均保留结果校验、原始数据和退化 |
| RSS 统计缺口 | 原历史负值乘法与初始零上限失败均保留；v2 独立正数 warm-stock 预算、分块趋势/全程 RSS 信号相对噪声及严格零 counters；首次主机也验证有效数据和内存，失败不落 baseline |
| 内存敏感性 | 最终规则重评 43 份完整曲线：22 正常通过、21 增长拒绝；固定最终两版各 3 正常 + 3 纯原生增长全部符合预期，父/子计数为零、24 块全部 free；Buffer/heap 对照与协调器独立 C 对照补充保留 |
| 失败与局限 | 原 portable RSS 漏检无曲线，仅保留 AssertionError；后续 with-log 是另一轮。原同进程 native 压力后 FFI registration=1 是诊断生命周期失败，不是 RSS 漏检；隔离后的成功不证明原 GC/JIT 根因或生产缺陷已修复 |
| 文档与 YAML | 两版 docs:build、生成 HTML/dist 证据 source URL 检查通过；actionlint 1.7.12 检查三份 workflow 通过 |

生产继续 caller-owned copies。Bun deallocator API 存在，真实 C spike 两版已验证；
试验性 lease metadata、VM rooting/affinity 与 library lifetime 限制仍有效。
当前本地 gate 不再 blocked；历史失败、性能退化和有限内存窗口检测范围不隐藏。
仅验证 Linux x64/glibc；未触发 hosted matrix，也未本地验证 musl/其他平台，未扩大
alpha 或选定 compat/WPT/integration 的结论范围。

按协调器指令，本任务只形成一个本地 commit，并保持自己的 worktree 干净。验收条件
中的最终 rebase、原分支 ff-only/工作区与资源清理由协调器后续执行并独立记录，07
自身实际合入 hash 不写入自身提交；本归档不声称这些协调步骤已经发生。
