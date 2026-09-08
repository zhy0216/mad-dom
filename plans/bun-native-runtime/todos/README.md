# Bun-native runtime and fast-path todo queue

default_agent: codex

## 优先级

| 文件 | 优先级 | 难度 | agent | 模型 / 推理强度 | 说明 |
| --- | --- | --- | --- | --- | --- |
| ~~`01-capability-matrix-and-benchmarks.md`~~ | P0 | hard | inherit → codex | `gpt-6-astra` / `max` | ✅ 已完成 · Bun FFI/JSC/GC/IO capability matrix 和 N-API 对照基准 |
| ~~`02-ffi-abi-and-native-fast-path.md`~~ | P0 | hard | inherit → codex | `gpt-6-astra` / `max` | ✅ 已完成 · Rust C ABI/FFI cdylib、token/batch/snapshot/serialization 快路径与边界测试 |
| ~~`03-bun-ffi-loader-and-facade.md`~~ | P0 | hard | inherit → codex | `gpt-6-astra` / `max` | ✅ 已完成 · Bun FFI loader/probe、按能力位 facade 快路径、Node-API fallback 与平台布局 |
| `04-memory-gc-and-external-buffers.md` | P0 | hard | inherit → codex | `gpt-6-astra` / `max` | 完成外部 buffer 所有权、deallocator、GC/finalizer/affinity 安全门禁 |
| ~~`05-bun-host-io.md`~~ | P1 | medium | inherit → codex | `gpt-6-astra` / `xhigh` | ✅ 已完成 · virtual server/sync fetch/checksums 迁移 Bun IO，capability-gated 回退与行为/性能/校验和对照 |
| `06-latest-bun-ci-and-release-policy.md` | P1 | medium | inherit → codex | `gpt-6-astra` / `xhigh` | 增加 latest/baseline CI、版本 capability 文档和发布回退策略 |
| `07-integration-and-regression-gate.md` | P0 | hard | inherit → codex | `gpt-6-astra` / `max` | 集成全部通道，运行全量校验、兼容性、WPT、安装 smoke 和 benchmark |

模型与推理强度按 `herdr-finish-plan` 的共享分发规则解析；todo 使用 `agent: inherit`，继承本队列的 Codex 默认值。

## 文件

1. `01-capability-matrix-and-benchmarks.md`
2. `02-ffi-abi-and-native-fast-path.md`（依赖 01）
3. `03-bun-ffi-loader-and-facade.md`（依赖 01、02）
4. `04-memory-gc-and-external-buffers.md`（依赖 02、03）
5. `05-bun-host-io.md`（依赖 01；可与 02、04、06 并行）
6. `06-latest-bun-ci-and-release-policy.md`（依赖 01、03；可与 04、05 并行）
7. `07-integration-and-regression-gate.md`（依赖 03、04、05、06）

01、02、03、05 已归档于 `done/`（capability matrix/benchmark、FFI ABI v1、
Bun FFI loader/facade 与宿主 IO）。FFI ABI v1 与 Node-API 共用同一 cdylib；
未通过 capability probe 时继续使用 Node-API，partial capability 按入口独立
回退。05 宿主 IO 迁移按 capability 门控（`MAD_DOM_BUN_IO_DISABLED` 强制回退），
迁移前后字节/格式/退出码与性能对照见 `scripts/bench-bun-io.mjs`
（schema `mad-dom/bun-host-io-bench/1`）。

## 依赖与并行

- 01 必须先完成，因为它定义 FFI capability、ABI 和基准 workload。
- 02 先落地 Rust ABI；03 才能接入 JS loader/facade。
- 04 依赖 02/03 的实际 buffer 协议，不能与它们并行修改同一 binding surface。
- 05 在 01 完成后可与 02 并行，只修改指定宿主 IO 文件与 `scripts/checksums.mjs`；不修改 release/build/install-smoke/bench-ffi-gc 脚本。
- 06 必须等 03 完成，避免同时修改 install-smoke/packaging；之后可与 04、05 并行。
- 07 是唯一最终集成任务，必须等待前面所有实现任务完成。
