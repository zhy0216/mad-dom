difficulty: hard
agent: inherit

## T1 · 接入 FFI loader 与 facade fallback

### 要做什么

- 扩展 `js/native-loader.js`，在 Bun 中发现并加载 FFI binary/symbols，执行 `ffiAbiVersion`/capability probe；失败时明确记录原因并继续使用 Node-API。
- 设计平台包中 FFI artifact 的布局、命名、optional dependency/packaging 规则；不破坏现有 `.node` 安装 smoke 和 libc fallback。
- 将 02 的 token/query/snapshot/serialization 入口接入 facade 热路径，保持 wrapper identity、WHATWG 返回形状、错误码、destroy 和旧平台回退。
- 为 FFI-enabled、FFI-disabled、FFI-missing、ABI mismatch、partial capability 五类场景添加独立进程测试。
- 将 benchmark 结果校验接入 facade，避免 FFI 只改变路径而没有结果等价证明。

### 预计修改文件

- `js/native-loader.js`
- `js/entry.js`
- `js/facade/window.js`
- `js/facade/document.js`
- `js/facade/extensions/node.js`
- `js/facade/extensions/query.js`
- `js/facade/extensions/live-collections.js`
- `scripts/build-platform-package.mjs`
- `scripts/install-smoke.mjs`
- `tests/bun/native-loader.test.js`
- `tests/bun/query-token-fast-path.test.js`
- `tests/bun/lazy-token-fast-path.test.js`
- `tests/bun/` 中新增 fallback/FFI 场景测试

### 验收条件

- Bun 支持 FFI 时，第一阶段热路径实际走 FFI；能力缺失或加载失败时自动回退 Node-API，公开行为一致。
- FFI binary 与 `.node` platform package 可在 clean install smoke 中被正确选择，错误信息包含 ABI/capability 原因。
- 现有 token/lazy wrapper、collection、navigation、destroy 和 cross-document 测试全通过。
- Node-API-only 模式仍可运行；不会因静态 `bun:ffi` import 破坏 lazy import 或错误诊断。
- `bun run test:native`、相关 Bun tests、`bun run smoke:install` 通过。

### 前置依赖

依赖 `01-capability-matrix-and-benchmarks.md` 和 `02-ffi-abi-and-native-fast-path.md`。
