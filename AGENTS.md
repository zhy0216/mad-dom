# AGENTS.md

## 包管理与运行：一律用 Bun

- 包管理只用 `bun install`（CI 用 `bun install --frozen-lockfile`），锁文件是唯一提交物 `bun.lock`。
  不要运行 `npm install` / `pnpm` / `yarn`，不要提交 `package-lock.json`。
- 运行脚本 / 测试用 `bun run <script>`、`bun test`。`package.json` scripts 内部也只允许 `bun` 调用。
- 例外：npm registry 的打包与发布走 `npm`——CI smoke 用 `npm pack`，发布用 `npm publish --provenance`
  （provenance 只能由 npm + GitHub Actions 生成）。发布细节见 `.agents/skills/mad-dom-publish/SKILL.md`。
- `optionalDependencies` 里的 `@mad-dom/platform-*` 在对应版本发布前 registry 是 404，
  `bun install` 会以 optional 警告跳过（exit 0），属预期行为。

## CI

- 日常开发与新 benchmark 采样一律用最新稳定版 Bun；运行前执行 `bun upgrade`，记录实际
  `bun --version` / `bun --revision`。`.bun-version` 仅用于专门的 baseline 验证或历史复现，
  不作为新 benchmark 的默认版本；更新文档时提交带日期的原始样本与环境信息，保留历史实测记录。
- Bun 版本分三层：`package.json.engines.bun` 是最低支持版本；`.bun-version`（当前 1.4.0）是可复现 baseline；
  CI latest lane 与 release 用 `oven-sh/setup-bun@v2` 显式 `bun-version: latest`，不得用 baseline 代替 latest。
  baseline lane 单独用 `bun-version-file: .bun-version`；记录实际 Bun version/revision、平台/libc、Node-API ABI、FFI ABI 与 capability。
  Rust 固定 1.93.1（`rust-toolchain.toml`）。历史 benchmark 的实测 Bun 版本保持原样；FFI 缺失时允许 Node-API fallback。
- 坑：若 `node_modules/@mad-dom/` 下有残留空目录时执行 `bun install`，`bun.lock` 会被写成
  `file:node_modules/@mad-dom/platform-*` 条目，clean checkout（CI）会直接 install 失败。
  重新生成锁文件前先 `rm -rf node_modules/@mad-dom bun.lock`。
