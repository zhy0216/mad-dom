# Bun-native runtime and fast-path plan

## 意图

将 mad-dom 从“在 Bun 上验证的 Rust + Node-API DOM”推进为“以 Bun 为正式运行时、充分利用 Bun 能力的原生 DOM”。用户要求同时推进四条线：Bun 专属原生绑定/快路径、Bun GC 与 JSC 内存能力、Bun 文件/网络/进程 IO、以及跟随最新 Bun 的版本与 CI 策略。

当前架构不能直接把全部 Node-API 替换成裸 C ABI：Window/Document/Node wrapper、finalizer、wrapper identity、异常映射和 destroy 生命周期都依赖现有 Node-API 对象层；`bun:ffi` 目前仍是 experimental，且不自动管理原生内存。因此本计划采用双通道架构：Node-API 保留为对象生命周期与兼容后备层，`bun:ffi` 增加面向批量数据和热路径的 Bun 快速通道；Rust DOM Core 继续保持与运行时无关。直接 JavaScriptCore 私有接口只做能力验证，不在没有稳定契约和回退机制前进入默认生产路径。

## 目标

1. 增加可测量的 Bun FFI 快速通道，优先覆盖现有 token、snapshot、批量查询、属性/文本批量读写和序列化路径，避免跨边界逐节点调用。
2. 建立 Bun/JSC 内存与 GC 集成协议：显式 destroy 仍是确定性生命周期，Bun GC、FinalizationRegistry、外部 ArrayBuffer/deallocator 和 heap/GC 压测用于快路径资源回收与验证。
3. 将适合的宿主 IO 改为 Bun 原生实现：文件读取/写入、子进程、测试 HTTP 服务和同步 fetch 兼容路径分别评估并迁移，保持 happy-dom 可观察行为。
4. 让开发和发布流程跟随最新 Bun：区分最低支持版本、latest CI、可复现基线和运行时 capability probe；不把 native ABI 绑定到某个精确 Bun 版本。
5. 保持公开 DOM API、错误码、wrapper identity、document affinity、现有平台包和 Rust Core 语义不变；所有 Bun 快路径都有能力缺失时的 Node-API 回退。

## 非目标

- 不把 `mad-dom-core` 引入 Bun/JSC 类型、`bun:ffi` 或 Node-API 依赖。
- 不在没有独立安全审计、生命周期模型和性能证据的情况下把 Rust 裸指针长期暴露给 JavaScript。
- 不把 Bun native plugin 当作 Window/Document 运行时绑定；它属于 bundler plugin hook，只有相关工具链需要时才另行处理。
- 不为了追求 Bun 专属性而删除现有 Node-API 对象层、显式 destroy 或兼容回退。
- 不在本轮扩展 DOM 语义、happy-dom 兼容范围或平台矩阵；新增 ABI/产物只服务本计划的运行时通道。

## 现状证据与关键约束

- Rust Core 已明确不依赖 Bun/JSC；native binding 当前使用 `napi-rs` / Node-API，公开 native surface 已有 `Uint32Array` token/snapshot 和 batch 入口，可作为 FFI 候选。
- `js/facade` 当前主要使用 `node:*` 模块和 `globalThis` Web API；生产路径没有 `bun:*` import，也没有普遍使用 `Bun.*`。
- `fetch.js` 通过 `globalThis.fetch` 做 HTTP，`virtual-server.js` 使用 `node:fs.promises`，`sync-fetch.js` 用 `node:child_process.spawnSync` 启动子进程；这些是优先 IO 审计点。
- 现有 Node-API wrapper/finalizer 和 Bun 的 finalizer 延迟行为已经由测试覆盖；任何 FFI 内存方案必须补充同等的 destroy、GC、延迟 finalizer、跨线程和 stale handle 测试。
- Bun 官方将 `bun:ffi` 标为 experimental，并说明 Node-API 是更稳定的原生扩展方式；因此 FFI 必须是 capability-gated 的 additive fast path，而不是无条件替换。

## 方案

### 1. 双通道 native ABI

保留现有 `.node` Node-API 模块作为 object/lifecycle ABI；在同一 Rust binding crate 或明确分出的 Bun-only cdylib 中增加 C ABI symbols，供 `bun:ffi` 加载。FFI ABI 只接受调用期间有效的标量、UTF-8/byte buffer、TypedArray-backed input/output 和 document-local token，不保存 JS 指针。

为 FFI 增加独立的 `ffiAbiVersion` 与 capability bitset；主包 loader 在 Bun 中尝试加载 FFI symbols 并验证版本，缺失、加载失败或行为探针失败时回退到 Node-API。现有 `ABI_VERSION` 继续保护 `.node` 对象 ABI，不能用一个数字掩盖两种协议。

优先顺序：

1. query result / preorder snapshot / child token 批量读取；
2. 固定属性、文本和导航批量读取；
3. 序列化到 caller-owned byte buffer；
4. token-based create/mutation batch；
5. 只有在生命周期和错误语义稳定后，才评估更多 FFI 入口。

JS facade 的公开类和对象身份仍由现有对象层维护。FFI 返回 token 或 packed buffer，facade 负责按既有 weak wrapper cache 物化对象；旧平台包或能力探针失败时沿用 Node-API 路径。

### 2. Bun/JSC memory and GC

定义三类所有权：

- Document/Node native state：由现有 Rust `Arc`、显式 destroy 和 wrapper finalizer 管理；
- FFI 输入：始终由调用者持有，native 只在同步调用期间读取；
- FFI 输出：优先写入调用者提供的 TypedArray；确需零拷贝时使用带 deallocator 的外部 ArrayBuffer，并绑定 document generation/owner token。

所有 FFI 输出都要覆盖：调用后继续访问、destroy 后访问、GC 后访问、重复 materialize、跨 Window/document、跨 Worker/thread、异常中断和 ABI mismatch。`Bun.gc()` 只用于测试/benchmark 和泄漏诊断，不进入业务正确性路径。

直接 JSC 私有对象包装作为独立 spike：如果无法在最新 Bun 上获得稳定公开契约和可回退实现，就记录为不可进入默认生产路径，保留 capability probe 和后续升级入口。

### 3. Bun host IO

- `virtual-server.js`：评估 `Bun.file(path)`、`arrayBuffer()`/`text()` 替换 `node:fs.promises.readFile`，保留目录/stat/路径兼容逻辑；用真实 workload 对比大文件、404 和 stream 行为。
- `sync-fetch.js`：优先消除每次同步请求启动子进程的固定成本；先实现 Bun-specific `Bun.spawnSync` 分支并保留 Node-compatible fallback，再评估 Rust/native transport 是否能保持同步 XMLHttpRequest 的错误、header、cookie 和 redirect 语义。
- release/benchmark/test 工具：将适合的 `node:child_process`、文件写入和临时产物迁移到 Bun API；`Bun.serve` 继续只用于测试服务器，不让测试专用 API 渗入 Core。
- `fetch`/WebSocket：保留 facade 兼容包装，但明确 host capability contract，增加 Bun latest 行为探针，避免依赖注释而没有可执行检查。

### 4. Latest Bun policy

- `package.json.engines.bun` 表示最低支持版本，不表示开发/CI 精确版本。
- 增加 latest CI lane，运行完整 native/compat/WPT/integration smoke；保留一个可复现 baseline lane 仅用于回归定位。
- 将 Bun 版本相关行为变成 capability probe：`bun:ffi` 是否可加载、所需 symbols 是否存在、TypedArray/ArrayBuffer deallocator 行为、N-API finalizer 语义、fetch/WebSocket/serve 行为。
- release 在 latest lane 通过且 FFI capability ABI 匹配时打包快路径；否则发布仍可使用 Node-API，且错误信息明确指出被禁用的能力。
- 更新 `.bun-version`、README、docs、ADR 和 benchmark 元数据，使“最低支持版本、当前 latest 验证版本、baseline 版本”不再混写。

## 任务拆解

1. **能力矩阵与基准**：盘点现有 Node-API/FFI 候选入口、Bun latest 行为，建立 N-API vs FFI 微基准、ABI/capability 设计和安全测试矩阵。
2. **Bun FFI 数据快路径**：实现 FFI cdylib、loader capability probe、token/query/snapshot/serialization 的 additive fast path 及 Node-API fallback。
3. **Bun 内存与 GC 集成**：实现 caller-owned buffer / 外部 ArrayBuffer 所有权协议、deallocator 和生命周期测试；补 Bun GC、heap、destroy、Worker/affinity 压测；完成 JSC 私有路径 spike 结论。
4. **Bun host IO 迁移**：迁移 virtual server 文件 IO、同步 fetch 子进程路径和适合的工具产物 IO，保留兼容 fallback，补行为与性能测试。
5. **Latest Bun CI/release 策略**：增加 latest/baseline capability matrix，更新版本文档和 workflow，确保平台包、FFI ABI、Node-API ABI 的发布/回退一致。
6. **集成验收**：合并各快路径，运行完整 validate、native smoke、compat、WPT、integration 和 benchmark；记录性能收益、内存风险、latest 版本结果与遗留限制。

队列将上述阶段拆成 7 个文件：01 capability；02 Rust FFI ABI；03 JS loader/facade；04 memory/GC；05 IO；06 latest CI/release；07 integration。01 完成后可并行推进 02 与 05；03 依赖 02；04 依赖 03；06 依赖 03，因为它与 loader/packaging 阶段共享 install-smoke 文件；04、05、06 的具体文件范围相互隔离，可并行。07 等待所有实现完成。

## 执行偏好

- 默认 agent：`codex`，来源为当前 Codex 宿主；不指定单任务 agent。
- 任务按难度使用共享分发规则：跨 ABI、生命周期、并发和发布策略的任务标为 `hard`；单模块 IO 迁移标为 `medium`。
- 每个任务使用独立 Herdr worktree、单个本地 commit；协调器负责 rebase、仓库级校验、ff-only 合并和清理。
- 不 push、不创建 PR、不修改本轮之外的 workspace/worktree。

## 校验

仓库级校验：

先按实际任务建立干净 worktree 的验证环境：`bun install --frozen-lockfile`，`bun run dev:build`，并将 `MAD_DOM_NATIVE_PATH` 指向当前 worktree 的 `build/mad-dom.node`，避免安装的旧平台包覆盖当前源码产物。新 checkout 在 ledger 验证前先运行 `bun run compat:hdunit:rewrite`。安装 smoke 必须先按实际脚本参数生成本地 main/platform tarball，再传入所需路径；不得把缺少构建产物误报为功能失败，也不得真的 publish。

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
```

新增/重点校验：

- Bun latest 与 baseline 的 FFI capability probe；
- Node-API-only、FFI-enabled、FFI-missing 三种 loader 场景；
- FFI ABI mismatch、platform mismatch、destroy/stale token、GC/finalizer 延迟、external buffer deallocator、跨 Worker/线程 affinity；
- virtual server 404/directory/large file、sync fetch 的 headers/cookies/redirect/error/abort 行为；
- `bun run test:native`、`bun run smoke:install`、`bun run bench:check` 和代表性 `bench:dom` A/B；
- latest CI 下完整 compat/WPT/integration 结果；
- `git diff --check` 与无残留临时产物。

## 风险与假设

- `bun:ffi` 的 experimental 状态、签名/行为变化和最新 Bun 回归是最高风险；FFI 必须可关闭并回退。
- 直接 JSC 私有 API 与“跟随最新版本”存在天然冲突；除非建立版本适配层，否则只保留 spike，不把它作为默认产物。
- FFI 调用更快不等于 DOM workload 一定更快；必须分别测量 boundary、parse/build/query/serialize、memory 和完整 test workflow。
- 外部 ArrayBuffer 和 deallocator 的生命周期错误可能造成崩溃；默认优先 caller-owned buffers 和显式 destroy。
- Bun host IO 与 happy-dom 的同步/异步时序可能不同；所有迁移必须以现有差分契约为验收标准。
- 最新版本策略会降低单一 baseline 的可复现性；通过 baseline lane、lockfile 和完整 capability 记录保留定位能力。
- 当前仓库仍有 `.bun-version=1.4.0` 及相应文档；本计划把它视为需要修正的验证策略，而不是产品运行时的精确版本限制。
