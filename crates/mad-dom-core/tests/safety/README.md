# mad-dom-core 安全检查记录（T18，T50 硬化）

本目录记录 Core 的 `unsafe` 清单、适用的 Miri/sanitizer 命令，以及属性/压力测试的可重放与资源上限约定。对应 ADR-0001 测试章节“为后续 Miri/sanitizer 检查隔离并记录全部 `unsafe` 使用点”。

## unsafe 清单（T50 时点）

- `crates/mad-dom-core/src/**`：**零 `unsafe` 块**，且 T50 起由编译器级
  `#![forbid(unsafe_code)]` 强制（`crates/mad-dom-core/src/lib.rs`），清单无法
  静默退化。核验命令：

  ```sh
  scripts/check-core-safety.sh scan
  ```

- `crates/mad-dom-bun/src/**`：**固定 4 处** `unsafe { …cast() }`（napi
  `Unknown`/`Reference` → `Function` 幻影类型擦除放宽），分别位于
  `events_api.rs`（监听器注册，T37）、`mutation_observer_api.rs`（调度器与
  观察回调，T41）、`traversal_api.rs`（TreeWalker 过滤器，T35）；每个站点都
  内联记录“facade 恒传函数包装、运行时擦除的 `Function` 幻影类型因此 sound”
  的前提。绑定层完整安全模型见 `crates/mad-dom-bun/src/lib.rs` 与
  `crates/mad-dom-core/SAFETY.md`。核验命令同 `scan`（mad-dom-bun 分支仅输出
  清单，不作零判定）。

## Miri smoke

Miri 需要 nightly 工具链 + `miri` 组件：

```sh
rustup component add --toolchain nightly miri
scripts/check-core-safety.sh miri
```

T50 起 Miri 门禁运行**代表性子集**（`dangling_handle_can_never_read_new_node`、
`generation_mismatch_errors`、`retired_slot_is_never_reused`），覆盖 generation
槽位复用与悬空句柄的核心安全属性。带 seed 的属性/压力测试在 Miri 下极慢
（数十分钟级），不纳入 Miri，完整套件走常规 `cargo test`。

## Sanitizer smoke

macOS 稳定工具链没有可用的 ASAN/TSAN Rust 支持；在 Linux 或 nightly 上可做 ASAN
smoke（本机 `aarch64-apple-darwin` nightly 可用）：

```sh
scripts/check-core-safety.sh asan
```

## 属性测试可重放约定

- PRNG：手写 splitmix64（见 `../common/mod.rs`），固定 seed 完全复现，无外部 RNG crate 的版本漂移。
- 失败输出：seed + 失败步 + 最小复现前缀（`smallest_failing_prefix` 二分找到最短失败前缀）。
- 资源上限（常规 CI 数秒内完成）：
  - 单文档属性：4 个 seed × 400 步；跨文档属性：4 个 seed × 300 步；
  - 压力：深树 20k、宽树 20k（经公开 mutation API 构建，单步含 `is_descendant_of` 与 debug `check_invariants`）、槽位复用 50k、跨文档误用 2k 迭代。

## 运行

```sh
cargo test -p mad-dom-core
bash crates/mad-dom-core/tests/safety/run-safety-smoke.sh
```
