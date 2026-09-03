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

- `.github/workflows/ci.yml` 与 `release.yml` 用 `oven-sh/setup-bun@v2` + `.bun-version` 固定 Bun 版本，
  Rust 固定 1.93.1（`rust-toolchain.toml`）。
- 坑：若 `node_modules/@mad-dom/` 下有残留空目录时执行 `bun install`，`bun.lock` 会被写成
  `file:node_modules/@mad-dom/platform-*` 条目，clean checkout（CI）会直接 install 失败。
  重新生成锁文件前先 `rm -rf node_modules/@mad-dom bun.lock`。
