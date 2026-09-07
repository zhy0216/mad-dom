difficulty: medium
agent: inherit

## T1 · 迁移 Bun host IO

### 要做什么

- 在 `virtual-server.js` 中增加 `Bun.file`/ArrayBuffer/text 路径，保留 directory/index、404、URL/path、content type、large file 和 stream 行为；Node fs fallback 只在 capability 不可用时使用。
- 在 `sync-fetch.js` 中增加 Bun-specific `Bun.spawnSync` 分支，避免不必要的 Node child_process shim；保持同步 XMLHttpRequest 的 headers、cookies、redirect、abort、错误和输出 envelope。
- 评估 `Bun.file` / `Bun.write` 用于 `scripts/checksums.mjs` 的输入/manifest 产物路径，保持 checksum 字节和格式不变；不要改动由 02/03/04/06 拥有的 build、release、install-smoke 和 bench-ffi-gc 脚本。
- 保留 `Bun.serve` 作为 Bun 测试服务器路径，并补 server lifecycle cleanup。
- 为每个迁移点补 Node-compatible fallback 与行为/性能对照。

### 预计修改文件

- `js/facade/virtual-server.js`
- `js/facade/sync-fetch.js`
- `js/facade/extensions/fetch.js`
- `scripts/checksums.mjs`
- `tests/bun/browser-lifecycle-parity.test.js`
- `tests/bun/fetch.test.js`
- `tests/bun/xhr.test.js`
- 新增/更新 IO capability 和 regression fixtures

### 验收条件

- Bun latest 下 virtual server 文件、目录、404、large file 和 stream 用例与现有 happy-dom contract 等价。
- sync fetch 不再无条件依赖 Node child_process；Bun 分支、fallback 分支和失败诊断均有测试。
- `Bun.write`/`Bun.spawnSync` 迁移没有改变 release/benchmark 的输出校验和退出码。
- 网络、cookie、redirect、abort、TLS option 和生命周期测试通过，且 benchmark 至少报告迁移前后成本。
- `bun run check`、相关 Bun tests、integration test 通过。

### 前置依赖

依赖 `01-capability-matrix-and-benchmarks.md` 的 capability 约定；可与 04、06 并行。
