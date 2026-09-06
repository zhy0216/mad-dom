difficulty: medium
agent: inherit

## T1 · 追随 latest Bun 的 CI 与发布策略

### 要做什么

- 将当前 `.bun-version=1.4.0`、README/docs/ADR/benchmark 中的版本语义拆成最低支持版本、baseline 版本和 latest 验证版本；不要把 baseline 描述成产品精确绑定。
- 用户明确要求跟随最新 Bun，覆盖当前 `AGENTS.md` 中固定 1.4.0 的旧策略；同步修正该指引。历史 benchmark/ADR 的实测版本必须保留为历史事实，不能批量把历史 1.4.0 替换成 latest。
- 增加 latest Bun CI lane，覆盖 check、Rust、native build、FFI capability、native tests、compat、WPT、integration、install smoke 和 benchmark sanity；保留 baseline lane 供回归定位。
- 让 release/package metadata、platform package、Node-API ABI、FFI ABI 和 capability level 一致；FFI 不可用时主包仍能发布 Node-API fallback。
- 更新 loader/release 文档，说明 latest capability failure、FFI disabled、ABI mismatch、platform binary missing 的区别。
- 避免通过固定 Bun 小版本规避问题；新增失败报告要包含 Bun version、capability matrix、platform/libc、native ABI 和 FFI ABI。

### 预计修改文件

- `.bun-version`
- `AGENTS.md`（仅 Bun 版本策略段）
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `README.md`
- `docs/platforms.md`
- `docs/release.md`
- `docs/performance.md`
- `adr/` 中版本/capability 记录
- `scripts/release.mjs`
- `scripts/install-smoke.mjs`

### 验收条件

- CI 明确区分 latest 与 baseline；latest lane 不再隐式使用 1.4.0 伪装为最新。
- package engines 表示最低支持版本，文档不再把开发基线写成精确运行时锁定。
- latest 下 FFI enabled、FFI unavailable、Node-API fallback 三种发布/安装 smoke 都能给出稳定结果。
- release 产物中 main/platform/FFI ABI 和 capability 元数据版本一致，错误可诊断。
- workflow YAML 校验、`bun run smoke:install`、release draft/checksum dry run 和相关 docs checks 通过。

### 前置依赖

依赖 `01-capability-matrix-and-benchmarks.md`、`03-bun-ffi-loader-and-facade.md`（避免 install-smoke/packaging 文件并行冲突）；可与 04、05 并行。
