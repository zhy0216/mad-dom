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


### 完成记录（2026-09-08 UTC）

状态：全部验收完成。以 `git cherry-pick --no-commit
85742758755966fc8a61f6e4284445320c892ccf` 承接 PR #3 WIP，与修复合成一个
`feat(bun): ...` 本地任务提交。父提交为
`4093c79ebe5ee25404d9f6954202af83223f39c2`；本任务没有切换/修改 main、
rebase、merge、push 或操作旧 PR 分支。

#### 逐条验收

1. **所有权、generation、length/capacity、释放路径**：FFI 仍只返回
   caller-owned TypedArray。原生在借用前拒绝 input/output/written 重叠；
   JS 使用 intrinsic view length，拒绝 shared/resizable/detached 输入和
   非 u32 参数；createElements 精确预分配且异常成功长度不能再次 mutation。
   destroy 释放 arena、wrapper/token/epoch 容器的容量，保留 handle 的 Rust
   测试也验证 capacity=0。caller-owned 和 Node-API snapshot 在 transfer、
   GC、destroy 后仍可读，token 使用仍通过 owner/generation 检查。
2. **baseline/latest GC/finalizer**：实测 Bun 1.4.0 (`34cbb9a40`) 与官方
   latest 1.4.2 (`744846f84`)，N-API document finalizer 均在 macrotask
   后释放；Native wrapper/external buffer 的 FinalizationRegistry 均观察到。
   重复 materialize、旧 finalizer 延后、保留 wrapper、显式 destroy 不依赖 GC
   均通过。原 native-node-contract 的全套运行 GC 基线漂移以同版本子进程
   隔离修复，仍严格验证 counters `[0,0,0] → [1,1,1] → [0,0,0]`。
3. **Worker affinity 与 diagnostics 域**：Worker 与 main 的 document 同时
   存活时双向复用 FFI credentials 均返回 INVALID_DOCUMENT(3)，各自正向
   调用成功。`memoryDiagnostics(): number[]` 的 docs/cache 为 process-wide，
   registrations 为 calling-thread local；通过活 Worker 两文档握手实测，
   destroy 和 finalizer 后计数按各自域恢复。
4. **heap/RSS/GC/native allocation**：两版 × FFI on/off 四组，各 20 轮 ×
   100 Windows（另 10 个 warmup），每轮 docs/registration/cache 回到原始
   baseline；后 10 轮 heap/RSS 有界。原生 external spike 每版 258 次分配、
   258 次回调、258 次 free，8 轮 churn 后 liveBytes=0；两次人为重复释放
   被 atomic guard 拦截。记录完整样本，明确 lifecycle counter 不是 malloc
   字节账本，有限压力测试不等于任意工作负载的无泄漏证明。
5. **全部 gate 与 FFI benchmark**：两版 `bun run validate` 完整 exit 0；
   Rust 691 tests、Bun 1127 tests/0 fail，compat types、ledger（449 entries、
   180 real-pair scenarios、0 regressions）、hdunit rewrite/triage（298 files）、
   WPT gate 均通过。最终产物再次运行全部相关 ffi/gc/safety/native/lazy-token
   tests，两版各 86 pass/0 fail。`bench-ffi-gc.mjs --json --require-ffi` 两版
   都实际调用全部 6 个 FFI operation，三个 lifecycle delta=0；
   `bench-bun-native.mjs --json` 两版 Node-API/FFI 的各 6 workload result check
   全通过。最后一次 benchmark baseline 取样修正后再次通过两版专项及四组压测。

#### External / JSC spike 的真实边界

- Bun 官方已有 `toArrayBuffer(..., context, callback)` 和第四参 callback
  overload；已更正 WIP 的“无 deallocator”错误，不以 API 缺失跳过验收。
- 使用真实 malloc + C deallocator，不用 JSCallback 代替 native GC callback。
  保留 TypedArray 时 GC/destroy 不提前释放；offset=8 时 callback 收到
  base+8，所以真正 free 必须使用独立 allocation metadata 保存的原始 base。
  generation 过期阻止访问，却不能阻止清理。atomic guard 必须有独立存活的
  metadata；对已释放 metadata 做 atomic swap 仍是 UAF。
- spike 是单独编译的测试 image，使用有限且不复用的 static tombstones，
  no-context overload 仅使用独立单槽，callback image 保留到进程退出。
  它证明 API 与协议原型，尚不承担生产 metadata 回收/transfer/Worker/VM teardown。
  FFI ABI v1 没有 external allocator/deallocator capability；默认复制策略保留。
- 两版 Linux binary 的三项 JSC constructor 符号 dlsym 均不可见；记录
  `bun:jsc` 实际 exports。没有伪造 JSContextRef 或绑定私有 VM wrapper，
  默认 private JSC path=false。跨平台结果和稳定 context/lifetime 契约留给后续。

协议、官方来源、复现命令与 raw JSON：
[ffi-memory-protocol](../../../../docs/ffi-memory-protocol.md)、
[ADR-0009](../../../../adr/0009-bun-ffi-memory-and-gc-protocol.md)、
[完整 evidence](../../../../docs/ffi-memory-evidence.json)。

#### 校验命令

先 `bun install --frozen-lockfile`、`CARGO_BUILD_JOBS=3 bun run dev:build`，
所有 native/FFI 都显式指向本 worktree 的 `build/mad-dom.node`（同一 image）。
ledger 前执行 `bun run compat:hdunit:rewrite`。Baseline 仅下载到任务专用
`/tmp/mad-dom-task04-memory/baseline/bun-linux-x64/bun`，不替换全局 Bun；
运行 baseline `bun run` 时仅对当前命令将该目录放在 PATH 最前。

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
bun run check
bun run validate
bun run docs:build
bun test tests/bun/ffi-memory.test.js tests/bun/gc.test.js tests/bun/safety.test.js tests/bun/native-node-contract.test.js tests/bun/ffi-loader.test.js tests/bun/ffi-fast-path.test.js tests/bun/ffi-facade-hot-path.test.js tests/bun/lazy-token-fast-path.test.js tests/bun/native.test.js
MAD_DOM_FFI_DISABLED=0 bun scripts/probe-ffi-memory.mjs
MAD_DOM_FFI_DISABLED=0 bun scripts/bench-ffi-gc.mjs --json --require-ffi
MAD_DOM_FFI_DISABLED=0 bun scripts/bench-bun-native.mjs --json
MAD_DOM_FFI_DISABLED=0 bun tests/bun/fixtures/ffi-memory-digest.mjs --rounds 20 --windows-per-round 100
MAD_DOM_FFI_DISABLED=1 bun tests/bun/fixtures/ffi-memory-digest.mjs --rounds 20 --windows-per-round 100
git diff --check
```

以上全部通过。初始缺 cc 已补齐环境；release build 的 5 条 Core
unused-variable warning 为已有问题，严格 dev clippy 无 warning。没有依赖升级。
按协调器额外授权，`tests/compat/runner.test.js` 仅将 Darwin arm64 硬编码
改为 happy-dom 的实际 nav-platform 结果对照，两版完整 gate 均验证通过。
`bun run docs:build` 在 Bun 1.4.2 下 exit 0，保留默认 dead-link check。
ADR/ABI 引用改为 GitHub source 绝对链接；确认 VitePress 没有复制 evidence
JSON 后，也将其改为 GitHub source 链接，并检查生成 HTML 的三个目标，
避免发布站点 404。最后文档链接修复后再次构建通过，未重复完整 validate。
无剩余 blocker；empirical evidence 限于 Linux x64/shared 8-CPU host，
不宣称跨平台 zero-copy 安全性或稳定的性能收益。06 的 CI/release/version 文件未改。

#### 修改文件

- `crates/mad-dom-bun/src/ffi/{ABI.md,buffer.rs,mod.rs,tests.rs}`
- `crates/mad-dom-bun/src/handle.rs`
- `js/native-loader.js`
- `scripts/{bench-ffi-gc.mjs,probe-ffi-memory.mjs}`
- `tests/bun/{ffi-memory.test.js,gc.test.js,safety.test.js,native-node-contract.test.js}`
- `tests/bun/fixtures/{ffi-memory-digest.mjs,ffi-memory-spike.c,ffi-output-faults.mjs,native-gc-lifetime.mjs}`
- `tests/compat/runner.test.js`（协调器追加授权的单行 gate 修复）
- `adr/0009-bun-ffi-memory-and-gc-protocol.md`
- `docs/{ffi-memory-protocol.md,ffi-memory-evidence.json}`
- 04 todo 归档与 `plans/bun-native-runtime/todos/README.md` 的 04 条目
