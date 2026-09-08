# Bun native performance：减少边界开销，验证公开 API 收益

## 意图

用户通过 `$auto-dev bun native, performance` 要求继续推进 Bun 原生能力与性能。
本轮按性能优化任务处理：在已经完成的 `bun-native-runtime` 之上，定位并减少
公开 DOM API 的 FFI 分配、复制、重复工作和 IO 开销。先建立可信对照，再实施
能保留 DOM 语义和内存协议的优化，最后以实际公开 API 的耗时和资源表现验收。

这是带 prompt 的定向规划，不是全仓库改进扫描。原 `bun-native-runtime` 七项
均已归档；新建本计划承接其中的性能限制，不重开已完成队列。

## 仓库依据与当前状态

分析起点：`main`，`3aba5cb94057919b1c272c6a1e75ccdb75142f26`；开始时工作区干净。
本机 Bun 为 `1.4.2`（CLI 显示 revision `744846f84`），Rust 约束为 `1.93.1`。

| 位置 | 已观察事实 | 对本轮的意义 |
| --- | --- | --- |
| `docs/bun-native-runtime-results.md` 性能章节 | 历史 Linux 样本 latest FFI on/off 的 Core 为 442.86/375.87 ms，Testing 为 318.42/287.76 ms；固定测量顺序，没有平衡顺序审计 | +17.8%/+10.7% 是需要复核的退化信号，尚不能归因为 Bun 版本或 FFI 本身 |
| 同报告 `serialize` | latest on/off 为 4.6638/2.2286 ms，baseline 为 3.9078/2.3988 ms | 两版均有序列化退化信号，应优先测完整 UTF-8 生成、传输及 JS 解码 |
| `js/native-loader.js` 的 `outputWords`、`outputBytes`、`ffiBytes` | 每次从 256 words/1024 bytes 起分配；扩容会重新调用原生操作；成功后 `slice()` 再复制；字符串输入每次创建 encoder | 可以降低分配和重复计算；不得破坏返回 buffer 独立拥有的协议 |
| `crates/mad-dom-bun/src/ffi/mod.rs`、`handle.rs::token_snapshot` | 快照先收集节点/descriptor，再生成完整 packed Vec，最后复制至 caller buffer；批量属性读取还会复制 borrowed strings | 原生打包有可消除的中间分配；容量检查已经先于 token 注册，必须保留 |
| `js/facade/extensions/node.js` | 创建池优先 FFI token 数组，其次 Node-API 连续 range；preorder 经 adapter 返回 packed 数组再 hydrate | 原始 FFI 调用更快，不等于优于已有标量 range；需要以完整 facade 操作选择路径 |
| `js/facade/extensions/html.js`、`query.js`、`child-nodelist.js` | FFI 字节解码、快照转 wrapper 都属于公开 API 成本；document-root 查询仍有既定 Node-API 语义 | 优化必须包含消费结果的成本，并保持 implied skeleton 与 wrapper identity |
| `scripts/checksums.mjs` | tarball 逐个读入并散列；verify 在每个 entry 内重复 `readdirSync(dir)` | 可在实际工具链上减少重复目录遍历，评估有界的读/散列吞吐 |
| `scripts/bench-bun-io.mjs`、上一轮 IO 报告 | 1 MiB 重复 Bun.write 在历史样本约慢 4 倍；实际 checksum manifest 很小 | 先测真实 generate/verify；不以大文件微基准直接决定小 manifest 写入策略 |
| `tests/bun/ffi-memory.test.js`、`ffi/ABI.md` | 返回数组在后续调用、transfer、GC、destroy 后仍有效；创建 single-shot；输入须拒绝 shared/resizable/detached buffers | 缓冲复用只能位于内部并有明确借用边界；不能直接把复用 subarray 交给原有 adapter 消费者 |
| `docs/bun-native-runtime-coordinator-results.md` | v2 RSS 对四次注入增长漏检一次，另有 combined pressure/FFI diagnostic 的限制 | 保留现有事实，不把 RSS smoke 当成完整泄漏证明，不通过放宽阈值换绿 |

规划阶段已运行：`bun run check`，以及使用两个 native override 指向本仓库
`build/mad-dom.node` 的 `bun test tests/bun/ffi-fast-path.test.js
benchmark/dom-bench/report.test.js benchmark/dom-bench/testing-worker.test.js`。
结果为 29 pass / 0 fail；使用现有 native artifact，未重新构建、未跑完整 validate，
也未在规划阶段宣称测出新的性能提升。

## 目标 / 非目标

目标：

1. 在 `.bun-version` baseline 和执行时实际 latest 上，区分 raw C ABI、JS adapter、
   public facade 三层耗时，建立同源码对 FFI on/off、同运行时对改造前后的有效对照。
2. 减少 Rust snapshot 打包以及 JS adapter 中可以明确证明的分配、复制、重复工作。
3. 使公开 API 的默认路径避免可重复的明显退化；选择依据包括实际结果消费和内存成本。
4. 优化 checksum generate/verify 的真实文件处理成本，保留 Bun 原生 IO 的能力检测与回退。
5. 保存完整样本、命令、实际路径、版本、artifact hash、校验结果和不足，给出可复核结论。

非目标：新增 DOM 功能、重写 Rust arena/parser/selectors、迁移到私有 JSC API、
启用 external ArrayBuffer/原生回调生产协议、修改 ABI v1 的符号或布局、修改平台范围、
推版本或发布、重做历史 RSS 判定器、改造 sync-fetch 为长期 worker/daemon。
不进行全量 IO 迁移或无证据的逐节点 FFI 扩面。

## 方案

### 1. 先冻结对照和采样方法

新增 `benchmark/bun-performance/` 下的 runner、worker、方法说明及报告校验测试。
复用现有 runtime metadata、DOM benchmark workload/结果校验和 boundary 基准；
不复制成一套较弱的 DOM oracle，也不修改历史 JSON 的 schema/数字。
runner 可选择明确的 source root、原生 artifact、Bun 可执行文件和 FFI 模式，
让同一份采样代码测冻结 reference 与 candidate。所有子进程由指定 Bun 启动，
不通过 PATH 中碰巧命中的另一个 Bun 执行。

01 保存 reference source SHA、源码路径与 artifact SHA256；原生 Node-API/FFI
必须使用同一 image。reference 保留于执行器管理的独立 checkout/build 位置，
不能在 02/03 构建时被覆盖。只共享不可变证据，不共享可写 build 输出。

测量至少覆盖：小/大作用域 querySelectorAll、child/preorder 冷遍历、完整
innerHTML/outerHTML 字符串、创建池（1/8/32/128/256 档）、既有 16 Core/13 Testing
场景。raw、adapter、facade 计时单独标注，后两层不能漏掉编码/复制/解码或 wrapper。
query 的冷/热缓存状态显式控制，断言、hash、强制 GC 在计时外，正常 GC 在计时内。
针对 serialization/快照额外覆盖非 ASCII、大结果和缓冲增长后的回落。

每个主要对照预先规定至少两组完整 ABBA（A/B 均为新进程），进程内部 2 次 warmup、
9 次 measured；保留全部原始样本、顺序、退出码、匹配的 workload 指纹、median/p90/MAD。
ABBA 分别用于同运行时 FFI on/off 及 reference/candidate；不要混合不同 Bun 版本求比值。
完整 DOM 默认 size 1，辅助 size 0.1 和 2；微小 correctness smoke 单独标记。
CPU profile 在独立诊断进程采集，不把带 profiler 的时间用于正式对比。

正式采样由协调器预约串行窗口；其他任务可继续读代码，但暂停本流程的 build/test/benchmark。
当前 Herdr 还有其他仓库在工作，不能停止它们；记录可见竞争和系统负载，不以共享 VM
噪声制造结论。数据不稳定时执行预先声明的补充采样并保留全部结果，不能挑最快一次。

### 2. Rust 保持 ABI，减少快照中间打包

以 `SharedDocument::token_snapshot` 为共同语义入口抽取 checked fill/packing helper。
FFI 在验证 caller 输出范围及完整所需容量后，将 token/descriptor/continuation
直接填入该 buffer，避免中间 packed Vec 与其复制。Node-API 保留 owned
`Uint32Array` 返回，可复用同一填充逻辑，避免两套 token/fresh-bit 算法。

原始指针转换只放在 `ffi/buffer.rs`，使用有界 borrow/写入 API；不得从安全函数
制造不受约束生命周期。容量不足时不写输出、不注册 token，不改变错误优先级；
保留单次 registry lock、continuation、已有 token 稳定性、fresh proof 和 overflow 检查。
若 profile 支持，再在 `read_batch` 中移除 id/class 的多余 owned String，保留
null/empty/UTF-8 length prefix 合约；不为这一步新增 cache 或全局状态。

### 3. JS 有界复用与操作级路径选择

先处理 encoder/decoder、长度 scratch、容量提示等低风险分配；可引入内部有界
scratch，但必须规定作用域、异常后的释放、重入时的隔离，以及大结果不永久占用
最大 buffer 的策略。容量提示/缓存上限在保留 before 样本后声明，不能无限增长。

原有 `loadNativeFfi()` adapter 返回的数组继续独立拥有，可以跨调用/transfer/GC/destroy。
如为 facade 新增同步消费内部 buffer 的 helper，必须完成编码、FFI、解码/hydrate
后释放 lease，`try/finally` 处理异常；用户可见数组、StaticNodeList、创建 token 池
不能保存复用 scratch view。保持 intrinsic length、安全输入检查、数值验证与
错误 taxonomy。创建仍为 exact-capacity single-shot，不为省一次分配重复 mutation。

针对序列化与创建池，用 01 的端到端证据选择 FFI 或已有 Node-API/range。
允许有限、可解释的操作级静态选择或大小策略；先优化再比较，不在运行时自动
benchmark，不使用 Bun 版本字符串白名单，不全局关闭 FFI 冒充速度提升。
实际 capability 与所选操作路径分别记录，保留 forced-disabled/partial/oversize 回退。
未证明收益的复杂分支移除；不能将正确性异常静默变成性能回退。

02/03 共用现有 ABI v1，可并行开发，各自对原实现保持兼容，最后交叉验收。

### 4. 实际 checksum IO 优化

在 `scripts/checksums.mjs` 的 verify 中每轮只枚举一次目录并构造 Set。
对 generate/verify 评估小固定并发或有界批次，避免无界 `Promise.all` 同时读完全部
大 tarball；保留文件名排序、manifest 字节、digest、诊断顺序和退出码。
并发数及内存上限基于实际 workload 预先记录，Bun 与强制 fallback 行为一致。

在现有 IO benchmark 中补 checksum CLI 的实际 generate/verify 场景，包含少量小包、
多包、较大包和小 manifest；区分整进程时间与内部 IO 时间。若有必要改变 manifest
读写策略，仅根据这类真实测量决定。1 MiB 重复写的回退优势不能直接外推到它。
不修改 virtual-server/sync-fetch 的业务协议、release 脚本、registry 或依赖版本。

### 5. 合并后验证与证据

05 等待所有实现合入，针对最终 candidate 重新构建，并使用冻结 reference 跑完整
对照。目标是重点 facade 操作出现至少 10% 的稳定收益，或消除已确认的显著退化；
这是要验证的目标，不是对结果的预先承诺。收益低于噪声则明确标记无定论。

默认路径 Core/Testing 聚合以 per-round sum 再取 median；全部 phase 必须展示。
同运行时 reference/candidate 聚合或主要未优化 phase 出现超过 5% 的重复退化时，
检查原始分布、做预先约定的复测并定位；不通过删 workload、改权重、更新 baseline
或改阈值掩盖。确认的回归返回原任务修复，不能只写进报告就判为优化完成。
热点的小差值以 MAD/独立进程重复为上下文，不报告虚假的精确收益或因果结论。

运行现有内存/生命周期与 bench gate，增加针对新 buffer 复用的确定性行为验证。
保留 v2 RSS 已知漏检说明，不承诺检测任意 native leak。新证据写入本计划
`evidence/` 与 `results.md`，文档添加独立新结果链接，不覆写 2026-09-05 或前轮报告。

## 拆解

| 顺序 | 任务 | 优先级 | 难度 | 依赖 | 文件所有权 |
| --- | --- | --- | --- | --- | --- |
| 01 | 对照 runner、公开 API profiles 与冻结 baseline | P0 | hard | 无 | 新 `benchmark/bun-performance/`、本计划 `evidence/baseline/` |
| 02 | Rust caller-buffer snapshot packing | P1 | hard | 01 | `crates/mad-dom-bun/src/handle.rs`、`ffi/`、`tests/bun/ffi-fast-path.test.js` |
| 03 | JS adapter 有界缓冲和 facade 路径优化 | P1 | hard | 01 | `js/native-loader.js`、受影响 facade 文件、loader/memory/facade 专项测试 |
| 04 | checksum 真实 IO 吞吐与目录扫描 | P1 | medium | 01 | `scripts/checksums.mjs`、`scripts/bench-bun-io.mjs`、`tests/bun/bun-host-io.test.js` |
| 05 | 最终矩阵、性能验收、回归门禁及报告 | P0 | hard | 01、02、03、04 | 本计划最终证据、性能文档、benchmark 使用入口 |

执行图：`01 → (02 ∥ 03 ∥ 04) → 05`。实现工作可并行，正式计时串行。
01 定义测量协议后，各实现任务只补各自 `evidence/task-02|03|04/`，不同时修改
公共 runner。必要的公共 harness 修复由协调器分派回其所有者完成。

## 执行偏好

- `default_agent: codex`，来源为本次 Codex 宿主；用户未指定全局或单任务 agent。
- 用户未指定 model/reasoning override；todo 写 `agent: inherit`，不固定具体 agent。
- 按共享规则解析：hard → `gpt-6-astra` / `max`；medium → `gpt-6-astra` / `xhigh`。
- 新协调器为 Codex `gpt-6-astra` / `high`；所有协调器/任务按 skill 显式使用 YOLO 参数。
- 本流程由 `auto-dev` 提交计划后在同级 Herdr pane 启动 `$herdr-finish-plan bun-native-performance`。
  实现、独立 worktree、rebase、校验、ff-only 合并和清理由新协调器负责。

## 校验

所有 JS 命令使用 Bun；安装仅 `bun install --frozen-lockfile`。遵守根 `AGENTS.md`
的 optional package/lockfile 约束，不重生成或更新锁文件。进入每个 worktree 后先构建
`bun run dev:build`，并将以下两个变量都设为该 checkout 的 `build/mad-dom.node`：

```sh
export MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node"
export MAD_DOM_FFI_PATH="$PWD/build/mad-dom.node"
bun run check
bun run report:runtime
bun run validate
bun test benchmark/dom-bench/report.test.js benchmark/dom-bench/testing-worker.test.js
bun test tests/bun/native-loader.test.js tests/bun/ffi-fast-path.test.js tests/bun/ffi-memory.test.js
bun run bench:bun-native:selftest
bun run bench:bun-io:selftest
bun run bench:check
```

新 runner 的命令由 01 在 `benchmark/bun-performance/README.md` 完整定义并验证；
05 增加 `bun run bench:bun-performance`，script 内只用 Bun。完整 validate 包含
syntax、Rust fmt/clippy/test、types、Bun、ledger、hdunit rewrite/validate、WPT；
Rust 变更另跑 `bash scripts/check-core-safety.sh`。全部 native 专项须真实运行而非 skip。
05 在 baseline 与实际 latest 均做 FFI enabled/disabled/partial 专项和源码验证，
必要的 integration 安装遵守 `benchmark/mad-dom-integration-test/README.md` 的
isolated file-dependency snapshot 规则；运行 `bun run test:integration`、`bun run docs:build`。

baseline 必须从 `.bun-version` 读取（当前 1.4.0），latest 在执行时独立核实。
不要改 CI/release 的 `bun-version: latest` 为固定版本，不把本机 1.4.2 永久称作 latest。
性能比较和 gate 避免并发运行；不得以首台主机自动记录 baseline 的通过替代真实对照。

## 风险与假设

- 简短 prompt 默认指现有 Bun native 路径的增量性能优化，保留公共 API/平台/生命周期合约；
  当前代码和历史报告已足以确定方向，无需在启动前引入额外产品决策。
- FFI adapter 全局实例与 per-document 状态的生命周期不同。scratch 不得强引用已销毁
  Document，不得累积每个 document 的大容量；exception/reentrant 使用必须可审计。
- Rust direct fill 涉及 unsafe 边界；使用最小 checked borrow，Core 继续 forbid unsafe。
- 性能结果依赖 Bun/JIT/allocator/宿主负载。两版结果不一致时保持真实差异，静态选择
  应可解释且跨平台保守；未测平台只宣称逻辑兼容，不宣称实测加速。
- checksum 的有限并发可能增加峰值 RSS；需要同时报告吞吐与内存，不采用全量并发读取。
- 若某候选无可重复收益，优先缩小/撤销该优化并记录证据；不得用微基准提升充当 facade 收益。
- 规划阶段只写并提交本计划目录；业务实现由执行器处理。若提交前出现其他用户改动，
  按 auto-dev 明文约束停止启动并说明具体文件，不自行 stash/提交/丢弃。

## 参考

- 仓库：`adr/0007-facade-native-boundary-performance.md`、
  `adr/0009-bun-ffi-memory-and-gc-protocol.md`、`crates/mad-dom-bun/src/ffi/ABI.md`、
  `benchmark/README.md`、`bench/README.md`、前述两份 Bun-native 结果报告。
- [Bun FFI 文档](https://bun.com/docs/runtime/ffi)：输入转换与 buffer/string 生命周期；
  新 API 先用实际 baseline/latest probe 验证，不因文档存在就跳过兼容/ownership 检查。
- [Bun 文件 IO 文档](https://bun.com/docs/runtime/file-io)：Bun.file/Bun.write/FileSink 的
  不同使用方式；实际策略以本仓库 workload 为准。
- [Bun profiling 文档](https://bun.com/docs/project/benchmarking)：独立运行 CPU profile；
  本机 `bun --help` 已确认 `--cpu-prof`、`--cpu-prof-dir` 与 `--cpu-prof-md`。
