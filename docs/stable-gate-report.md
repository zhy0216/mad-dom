# MAD DOM stable gate & release candidate report (T50)

- 状态：发布候选（release candidate）验证报告
- 条目：`T50` — 完成安全、性能、文档与 stable 门禁
- 分支：`herdr/todo-50-stable`（base `main` @ `b1a029b`，含 T44/T48/T49）
- 生成时间：本报告由 T50 校验命令在生成 commit 的同一工作区生成；所有数字可重放。

## 验收逐条

### 1. 无已知崩溃、use-after-free、数据损坏或未说明 unsafe 风险

- **Core 零 unsafe 且编译器强制**：`crates/mad-dom-core/src` 无任何
  `unsafe` 块；T50 在 crate 根加入 `#![forbid(unsafe_code)]`
  （`crates/mad-dom-core/src/lib.rs`），任何回归都无法静默编译通过。
  核验：`scripts/check-core-safety.sh scan`。
- **绑定层 unsafe 清单固定并逐条说明前提**：`crates/mad-dom-bun` 恰有 **4 处**
  `unsafe { …cast() }`（napi `Unknown`/`Reference` → `Function` 幻影类型擦除
  放宽），位于 `events_api.rs`（监听器）、`mutation_observer_api.rs`（调度器
  与观察回调）、`traversal_api.rs`（TreeWalker 过滤器）。每处内联记录
  "facade 恒传函数包装、运行时类型擦除因此 sound" 前提；完整安全模型见
  `crates/mad-dom-bun/src/lib.rs` 与 `crates/mad-dom-core/SAFETY.md`。
- **Miri 代表性子集通过**（nightly + miri 组件，本机
  `aarch64-apple-darwin`）：`dangling_handle_can_never_read_new_node`、
  `generation_mismatch_errors`、`retired_slot_is_never_reused` 全部 ok。
  核验：`scripts/check-core-safety.sh miri`。
- **AddressSanitizer 通过**：`scripts/check-core-safety.sh asan` 对
  `mad-dom-core` 全套测试以 nightly host target 运行，全绿。
- **无崩溃/数据损坏**：`npm run validate` 全绿（含 Rust 测试、Bun 603 测试、
  属性/压力套件、GC 生命周期测试）；CI 新增 `safety` job 固化上述检查。
- 结论：满足"无已知崩溃、use-after-free、数据损坏或未说明 unsafe 风险"。

### 2. 锁定 happy-dom 兼容套件 100% 通过；目标平台安装验证

- **happy-dom 兼容套件 100%**：`compat/ledger.json` 43/43 全部 `pass`，
  0 `known-gap`、0 `not-applicable`（types 10 + diff 33；快照为整体表面比较，
  无按场景条目）。`compat:ledger` 活体差分零回归。完整数据见
  `docs/compat-report.md`。
- **宿主平台安装验证通过**：`npm run smoke:install` 四项断言全绿
  （happy path / missing-platform / unsupported-platform / ABI mismatch），
  无 Cargo 环境的干净 `bun add` 流程。
- **跨平台安装验证（blocker，依赖 CI）**：非宿主平台（darwin-x64、
  linux-x64/arm64-gnu、win32-x64、linux-x64/arm64-musl）的构建与安装 smoke
  由 `.github/workflows/release.yml` 矩阵在各自 native runner 完成，本机无
  交叉工具链无法复现；`release.yml` 已在该矩阵每个平台跑
  `install-smoke.mjs`。**该部分验收依赖 CI 运行，未在本机全部验证** —— 与
  T49 相同的 blocker，是本条目标为「部分完成」的原因。

### 3. 性能退化门禁可重复，文档与实际包内容一致

- **性能/内存基线已建立并提交**：`bench/baseline.json` 覆盖 arena、
  mutation、parser、serializer、selector、FFI、GC 共 19 项指标
  （`scripts/bench.mjs` 合并 Core bench `crates/mad-dom-core/examples/bench.rs`
  与 FFI/GC bench `scripts/bench-ffi-gc.mjs`）。`npm run bench:check` 按
  每指标阈值门禁：吞吐类低于基线 0.5× 判失败，内存增长超 2× 判失败，
  身份/释放命中率必须恒为 1.0。
- **门禁可重复**：固定工作负载 + 提交的基线，同 host 上 `git checkout` +
  `dev:build` + `bench:check` 可复现；跨 host 自动记录 host-specific 基线
  并 git-ignore，不做无意义跨机比较。CI 新增 `bench` job。
- **文档与实际包内容一致**：`npm pack --dry-run` 37 文件，含
  `index.js`/`index.d.ts`/`js/`/`README.md`/`LICENSE`，无 `.node`；平台包
  元数据与支持矩阵一致（ADR-0005 §5）。README 支持矩阵与
  `scripts/platform-matrix.mjs` 一致。`npm run release:draft -- --stage alpha`
  演练通过且不触碰 registry。

### 4. 最终工作区和发布候选可由独立 checkout 复现

- 固定工具链：Rust `1.93.1`（`rust-toolchain.toml`）、Bun `1.4.0`
  （`.bun-version`）；`npm ci` 锁定依赖。
- 独立复现路径（干净 checkout）：
  `npm ci` → `npm run dev:build` → `npm run validate` → `scripts/check-core-safety.sh {scan,miri,asan}`
  → `npm run bench:check` → `npm run smoke:install` → `npm run release:draft -- --stage alpha`。
- 本报告所有命令均在该路径下实际运行通过（见下方"专属校验结果"）。

## 专属校验结果

| 校验 | 命令 | 结果 |
| --- | --- | --- |
| 完整统一校验 | `npm run validate` | 通过（603 bun tests / 0 fail；cargo fmt/clippy/test、compat:types、compat:ledger、wpt 全绿） |
| `git diff --check` | — | 通过 |
| unsafe 清单 | `scripts/check-core-safety.sh scan` | Core 零 unsafe；bun 4 处文档化 cast |
| Miri 子集 | `scripts/check-core-safety.sh miri` | 3 代表测试 ok |
| ASan | `scripts/check-core-safety.sh asan` | 全套 ok（host nightly target） |
| 兼容/WPT 报告 | `npm run compat:differential`、`npm run compat:ledger`、`bun compat/ledger-report.js --json`、`npm run wpt:json` | ledger 43/43 pass；WPT 39.8%（独立统计） |
| 性能/内存回归 | `npm run bench:record` + `npm run bench:check` | 19 指标全 pass（基线已提交） |
| 全平台安装 smoke | `npm run smoke:install` | 宿主平台全绿；其余平台待 CI 矩阵 |

## Blockers / 剩余风险

1. **跨平台安装验证依赖 CI**：非宿主平台原生产物与安装 smoke 只能由
   `release.yml` 矩阵验证；本机无法完成，故本条目为「部分完成」。
2. **glibc 下限与 Bun 1.4 `libc` 裁剪行为待首个 linux CI release build
   实测后回填** `docs/release.md`（方法学与 TBD 已记录，见
   `docs/release.md` "Measured verification points"）。
3. **WPT 为独立统计轨道**：当前 39.8%，不构成 stable 门禁（ADR-0002 §8）；
   不阻塞，但属于后续提升面。

## 边界确认

本条目只完成发布候选与门禁；未 push、未创建 PR、未发布 npm、未迁移
`latest` dist-tag（迁移属 ADR-0005 §10 的 stable 发布执行，不在本条目）。
