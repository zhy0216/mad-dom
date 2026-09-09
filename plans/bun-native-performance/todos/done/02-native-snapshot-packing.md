difficulty: hard
agent: inherit
status: done

# 02 · Rust 快照直接填充 caller buffer

## T1 · 统一 packed snapshot 语义，移除中间传输 Vec

前置依赖：`01-balanced-baseline.md`。

从 `handle.rs::SharedDocument::token_snapshot` 抽取可供 Node-API 和 FFI 共用的
checked fill helper。FFI query/preorder/child 快照在完成全部输入/容量检查后，
直接填充 caller-owned 输出；Node-API 仍返回独立 owned Uint32Array。保留节点
收集的语义，避免扩展成 parser/selector/traversal 重写。

预计修改文件：`crates/mad-dom-bun/src/handle.rs`、`src/ffi/mod.rs`、
`src/ffi/buffer.rs`、`src/ffi/tests.rs`、`src/ffi/ABI.md`（说明实现，不改 ABI）。

原始内存操作集中在 buffer.rs，以真实容量绑定 slice 生命周期，不返回泛型任意
生命周期的安全引用。无 alias/input/written overlap，防整数溢出；保留一个
registry lock、fresh marker、已有 token、continuation、panic/error 映射。
容量不足时不填输出也不铸造 token；禁止改变 single-shot creation 协议。

验收条件：

- C 符号、ABI 版本、capability bits、layout、status、required/written 长度均不变。
- Node-API 和 FFI 同一树快照的 topology/descriptor/continuation 相同；比较不能
  把不透明 token 数值相同当成跨文档 oracle，fresh proof 要单独验证。
- 真实 exact/不足/零容量、深/宽树及 >65,535 节点续块、Unicode、foreign/stale/
  destroyed token、overlap/overflow 的测试通过；失败不产生 token 注册副作用。
- 现有 Node-API 分配返回协议不受改变，Core 继续 `#![forbid(unsafe_code)]`。

## T2 · 基于 profile 的局部读取分配优化与性能验证

前置依赖：`01-balanced-baseline.md`；本文件 T1。

预计修改文件：同 T1、`tests/bun/ffi-fast-path.test.js`、本计划 `evidence/task-02/`。

若 01 的诊断显示有价值，在 `mad_dom_ffi_read_batch` 去掉 id/class 的中间
`str::to_owned`，直接消费 borrowed 属性字节；保留 textContent/null/empty/
length-prefix 的行为。没有证据时不扩大任务，只完成快照打包优化。

使用 01 runner 对冻结 reference 和本任务 candidate 做相同运行时的 raw/adapter/
facade 对照。先预约串行测量，记录分配/复制减少的证据及端到端结果；不靠只测
输出指针写入隐藏 query、token 注册和 wrapper 成本。

验收条件：Node-API fallback 也有效；新实现没有确定性内存问题或稳定性能回归；
收益与噪声据实报告。若直接填充增加复杂度而没有可重复收益，缩小实现并交代结论。
03 还未合入时必须兼容旧 JS adapter；02 不修改任何 JS facade/loader 文件。

## T3 · 本任务验证

前置依赖：本文件 T1、T2。

预计修改文件：`evidence/task-02/` 的命令与测试记录。

运行 `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、
`cargo test --workspace`、`bash scripts/check-core-safety.sh`、`bun run dev:build`，
然后两个 native override 指向本 artifact，运行：

```sh
bun test tests/bun/ffi-fast-path.test.js tests/bun/ffi-memory.test.js tests/bun/native-loader.test.js
bun test tests/bun/lazy-token-fast-path.test.js tests/bun/navigation-memo.test.js
bun run bench:bun-native:selftest
bun run validate
```

验收条件：上述检查通过，baseline/latest 的真实 FFI 专项和 public digest 均通过；
保留错误/容量/identity 的回归证据，Rust 安全扫描不是 FFI 内存安全的充分证明。
