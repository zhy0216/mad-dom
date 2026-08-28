# mad-dom-core 安全检查记录（T18）

本目录记录 Core 的 `unsafe` 清单、适用的 Miri/sanitizer 命令，以及属性/压力测试的可重放与资源上限约定。对应 ADR-0001 测试章节“为后续 Miri/sanitizer 检查隔离并记录全部 `unsafe` 使用点”。

## unsafe 清单（T18 时点）

- `crates/mad-dom-core/src/**`：**零 `unsafe` 块**。核验命令（限定 Rust 源文件，避免命中本目录文档自身）：

  ```sh
  rg -n '\bunsafe\b' crates/ --glob '*.rs'     # 无匹配
  rg -n '^\s*unsafe\b' crates/ --glob '*.rs'    # 无匹配（实际块）
  ```

- `crates/mad-dom-bun/src/**`：零 `unsafe`（尚无 FFI；绑定层 unsafe 归属在 M3 的 T19/T21 审计）。
- ADR-0001 §7 约定 unsafe 保持最小化；本里程碑只做“记录”，编译器级 `#![forbid(unsafe_code)]` 与 CI 门禁留待 T50 硬化。

## Miri smoke

Miri 需要 nightly 工具链 + `miri` 组件：

```sh
rustup component add --toolchain nightly miri
cargo +nightly miri test -p mad-dom-core --lib arena::tests::dangling_handle_can_never_read_new_node
```

只 smoke 少量代表测试（`dangling_handle_can_never_read_new_node` 覆盖 generation 槽位复用的核心安全属性；`allocate_and_get` 亦可）。带 seed 的属性/压力测试在 Miri 下极慢（数十分钟级），不纳入 smoke，完整套件走常规 `cargo test`。

## Sanitizer smoke

macOS 稳定工具链没有可用的 ASAN/TSAN Rust 支持；在 Linux 或 nightly 上可做 ASAN smoke：

```sh
RUSTFLAGS="-Z sanitizer=address" cargo +nightly test -p mad-dom-core --lib --target x86_64-unknown-linux-gnu
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
