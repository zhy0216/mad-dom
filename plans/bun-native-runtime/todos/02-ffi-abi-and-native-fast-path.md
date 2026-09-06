difficulty: hard
agent: inherit

## T1 · 增加 Bun FFI cdylib 与 Rust 快路径

### 要做什么

- 在不破坏现有 `mad-dom-bun` Node-API surface 的前提下增加 Bun FFI 可加载的 C ABI symbols；必要时拆出清晰的 `ffi` module/crate，但 Rust Core 不能依赖 Bun 类型。
- 实现独立 `ffiAbiVersion` 与 capability bitset；所有入口检查 document generation、token 所属文档和 destroy 状态。
- 按 01 的基准决策实现第一批 token/batch/query/snapshot/traversal/序列化数据入口，优先使用 caller-owned TypedArray/byte buffers，不返回长期裸指针。
- 保持 Node-API fallback；FFI ABI 与对象 ABI 分开递增和验证。
- 为每个入口补 Rust 单元/边界测试，覆盖空输入、容量不足、stale token、wrong document、destroy、错误码和 panic containment。

### 预计修改文件

- `crates/mad-dom-bun/Cargo.toml`
- `crates/mad-dom-bun/src/lib.rs`
- `crates/mad-dom-bun/src/api.rs`
- `crates/mad-dom-bun/src/handle.rs`
- `crates/mad-dom-bun/src/extensions/query_api.rs`
- `crates/mad-dom-bun/src/extensions/collection_api.rs`
- 新增 `crates/mad-dom-bun/src/ffi/` 或等价模块
- `crates/mad-dom-bun/build.sh`
- `scripts/build-platform-package.mjs`
- `tests/` 或 Rust tests 对应的 native ABI 测试

### 验收条件

- 现有 Node-API tests 不回归，现有 `.node` 产物仍能加载并通过 ABI probe。
- Bun FFI cdylib 能导出第一批 capability 宣布的 symbols，并可被 01 的 probe 加载。
- FFI 路径没有跨调用保存 JS/raw pointer；输入输出所有权和容量错误均有稳定错误码。
- query/snapshot/serialization 至少有一个真实 DOM workload 的结果等价测试和 benchmark。
- `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace` 和 native smoke 通过。

### 前置依赖

依赖 `01-capability-matrix-and-benchmarks.md` 的 ABI、capability 和第一阶段入口决策。
