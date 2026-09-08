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

## 完成记录

- `js/native-loader.js` 增加了惰性 Bun FFI loader：`bun:ffi` 通过 `createRequire`
  延迟解析（Node-API-only 运行时不会被静态 `bun:ffi` import 破坏），对同一
  `.node` image 打开独立 FFI ABI v1 符号并做 capability probe。`MAD_DOM_FFI_PATH`、
  `MAD_DOM_FFI_DISABLED`、ABI mismatch、partial capability 与 missing symbol
  都返回结构化 report，facade 按 report 逐入口回退 Node-API。
- `js/facade/window.js` 在 docState 上挂载文档局部的 `ffi` adapter 与
  `ffiContext`；`node.js`/`query.js`/`child-nodelist.js`/`html.js` 将
  token batch、preorder/child snapshot、query snapshot 与 serialize 接入 FFI
  热路径，wrapper identity、WHATWG 返回形状、错误码、destroy 与跨文档语义保持
  不变；FFI 只接受 symbol 级可用（childSnapshot 与 preorderSnapshot 共享一个
  capability bit，也必须逐 symbol 探测，missing symbol 不会挂载会调用
  undefined 的方法）。
- `createElementToken` token pool 改为游标消费，批容器不再每次出池做 O(batch)
  slice/拷贝（TypedArray 与旧 Node-API 数组都走同一 cursor）。
- `querySelector` 保持原生单结果 early-exit 语义，不因接入 FFI 而改走全量
  snapshot + `.item(0)`。
- FFI image 与 Node-API image 必须同一文件（ABI.md 契约）：`ffiForDocument`
  对第二份同 ABI 库拒绝绑定并记录 `imageReason`，facade 回到 Node-API，避免
  独立 registry 把合法文档当 INVALID_DOCUMENT 抛给用户。
- platform package 的 `madDomFfi` metadata 指向其 `main` image，不复制第二份
  cdylib；install smoke 增加 FFI-disabled 进程级回退场景，未破坏 `.node`
  安装 smoke 与 libc fallback。
- `tests/bun/ffi-loader.test.js`、`tests/bun/ffi-facade-hot-path.test.js` 及
  fixtures 覆盖 FFI-enabled/disabled/missing/ABI mismatch/partial capability/
  missing symbol/第二 image 的独立进程场景，并用 workload digest 证明各场景
  公开结果逐字节一致、FFI 路径真实命中。
- Validation：`bun run check`、`bun run compat:types`、相关 Bun tests、
  `bun run test:native`、`bun run smoke:install` 在 Bun 1.4.2 通过；FFI 场景
  测试在 baseline Bun 1.4.0 亦通过。
