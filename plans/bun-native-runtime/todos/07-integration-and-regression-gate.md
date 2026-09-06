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
