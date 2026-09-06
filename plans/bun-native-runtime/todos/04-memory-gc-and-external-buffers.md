difficulty: hard
agent: inherit

## T1 · 建立 Bun memory/GC 安全协议

### 要做什么

- 实现 02/03 约定的 caller-owned buffer、外部 ArrayBuffer/deallocator 和 document generation 协议；默认路径优先复制到调用者提供的 TypedArray。
- 为 FFI 输出增加 owner token、capacity/length 校验、destroy/stale generation 检查和 deallocator 只执行一次的保护。
- 扩展 Bun GC/finalizer 测试：同步/延迟 N-API finalizer、`Bun.gc(true)` 后 macrotask、FinalizationRegistry、external buffer、保留 wrapper、document destroy、重复 materialize、cross-thread/Worker affinity。
- 对 direct JSC/private integration 做实际 capability spike；如果最新 Bun 没有稳定契约，记录拒绝默认生产路径的理由和后续边界。
- 记录并运行 heap/GC/RSS 压测，确认 FFI fast path 不引入 wrapper/cache/native buffer 泄漏。

### 预计修改文件

- `crates/mad-dom-bun/src/ffi/` 或 02 新增的 FFI module
- `crates/mad-dom-bun/src/handle.rs`
- `crates/mad-dom-bun/src/affinity.rs`
- `js/facade/window-tasks.js`
- `tests/bun/gc.test.js`
- `tests/bun/native-node-contract.test.js`
- `tests/bun/safety.test.js`
- 新增 `tests/bun/ffi-memory.test.js` / fixture
- `scripts/bench-ffi-gc.mjs`
- `adr/` 或 `docs/` 中的 memory protocol 记录

### 验收条件

- 所有 native buffer 都有可证明的 owner、generation、length/capacity 和释放路径；未发现 use-after-free、double-free 或 stale document 访问。
- Bun GC/finalizer 延迟行为在 latest 与 baseline capability matrix 中有结果；业务正确性不依赖 `Bun.gc()`。
- cross-thread/Worker 调用仍被 affinity guard 拒绝或安全失败，不允许 FFI 绕过现有隔离规则。
- heap/RSS/GC 压测没有持续增长的 native allocation、wrapper cache 或 external buffer。
- `cargo test --workspace`、全部相关 Bun safety/GC tests 和 FFI-enabled benchmark 通过。

### 前置依赖

依赖 `02-ffi-abi-and-native-fast-path.md`、`03-bun-ffi-loader-and-facade.md`。
