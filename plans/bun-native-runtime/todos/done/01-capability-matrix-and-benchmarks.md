difficulty: hard
agent: inherit

## T1 · 盘点 Bun capability 与 native boundary

### 要做什么

- 完整盘点当前 `js/native-loader.js`、`crates/mad-dom-bun`、facade token/batch/snapshot、GC/finalizer、virtual server、sync fetch 和测试工具，标出 Node-API 必须保留的对象/生命周期路径与适合 FFI 的数据路径。
- 在 Bun 中建立 `bun:ffi`、TypedArray/ArrayBuffer、外部 buffer deallocator、`Bun.gc`、`Bun.spawn`、`Bun.serve`、`Bun.file`、latest version 的 capability probe；direct JSC/private API 只做可行性记录，不允许无证据进入默认实现。
- 设计独立的 FFI ABI version、capability bitset、buffer ownership/generation 约定和 Node-API fallback 矩阵。
- 添加最小 N-API vs FFI microbenchmark，覆盖单次调用、token batch、query snapshot、序列化、字符串/字节输出和大文档规模；输出可机器读取的结果，不能以猜测替代测量。

### 预计修改文件

- `scripts/` 下新增 capability probe / benchmark 脚本
- `tests/bun/` 下新增 probe / microbenchmark 测试
- `package.json`（仅新增必要脚本）
- `docs/` 或 `adr/` 下新增 capability/benchmark 记录
- 本 todo 相关的 plan 文档（如需记录决策）

### 验收条件

- Bun 当前环境能报告 FFI、GC、ArrayBuffer、IO、spawn/server 和版本 capability；缺失能力有明确结果而不是异常退出。
- 基准能在相同输入下比较现有 Node-API 和候选 FFI 路径，并输出边界调用成本、吞吐、RSS/分配和结果校验。
- 明确列出哪些接口进入 FFI 第一阶段、哪些继续 Node-API，以及 direct JSC 是否仅保留 spike。
- 方案包含最新 Bun、baseline Bun、FFI disabled、FFI unavailable 四种矩阵语义。
- `bun run check`、新增 probe/microbenchmark 自测通过。

### 前置依赖

无。
