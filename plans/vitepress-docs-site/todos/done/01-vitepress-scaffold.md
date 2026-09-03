difficulty: medium

# 01 · VitePress 站点脚手架

在 `docs/` 内搭好 VitePress 站点，复用现有三篇文档，`bun run docs:build`
本地构建通过。不引入额外主题/插件/搜索。

## T1 · 依赖与脚本

- 根 `package.json`：`bun add -d vitepress`（只进 devDependencies，同步更新
  `bun.lock`）；scripts 增加：
  - `docs:dev`: `vitepress dev docs`
  - `docs:build`: `vitepress build docs`
  - `docs:preview`: `vitepress preview docs`
- `.gitignore` 增加 `docs/.vitepress/cache/`（`dist/` 已有规则覆盖产物）。
- 预计修改：`package.json`、`bun.lock`、`.gitignore`
- 验收：`bun install --frozen-lockfile` 成功；scripts 存在。
- 依赖：无

## T2 · 站点配置与落地页

- `docs/.vitepress/config.mjs`：
  - `title: 'MAD DOM'`，`description` 用 README 定位语，`base: '/mad-dom/'`，
    `themeConfig` nav/sidebar 收录 `compat-report`、`release`、
    `stable-gate-report` 三篇与 Quick start 页；GitHub 链接指向
    `https://github.com/zhy0216/mad-dom`。
  - 不开 `ignoreDeadLinks`。
- `docs/index.md`：VitePress hero 落地页，复用 README 的定位（"Not happy.
  Just native."、drop-in happy-dom replacement、1.6× faster 数字），
  features 三条（native arena / one-import migration / verified
  compatibility），actions 指向 GitHub 与 Quick start。
- `docs/quick-start.md`：安装（`bun add -d mad-dom`）+ README 里的迁移
  diff + `bun test` 说明，约 20-40 行，内容取自 README，不新造事实。
- 预计修改：`docs/.vitepress/config.mjs`、`docs/index.md`、
  `docs/quick-start.md`（新建）
- 验收：`bun run docs:build` 成功，`docs/.vitepress/dist/index.html` 存在；
  `git status` 无 `.vitepress/cache` 或 `dist` 泄漏。
- 依赖：T1

## T3 · 修 release.md 的跨边界死链

- `docs/release.md` 中指向站点外的相对链接改写为绝对 GitHub URL
  （`https://github.com/zhy0216/mad-dom/blob/main/...`）：
  `../adr/0005-native-build-and-release-architecture.md`、
  `../README.md#support-matrix`、`../rust-toolchain.toml`。
  站内链接（`./compat-report.md`、`./stable-gate-report.md`）保持不变。
  不改动其他正文。
- 预计修改：`docs/release.md`
- 验收：`bun run docs:build` 无 dead link 报错。
- 依赖：T2

## 本文件整体验证

`bun install --frozen-lockfile && bun run docs:build` 成功；
`test -f docs/.vitepress/dist/index.html`；`git status --porcelain` 干净
（构建产物不入库）。全部完成后归档本文件到 `todos/done/`。
