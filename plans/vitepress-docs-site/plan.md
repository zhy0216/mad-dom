# Plan: vitepress-docs-site

## 意图

给 mad-dom 建一个 VitePress 文档网站，内容复用仓库已有的 `docs/*.md`，
通过 GitHub Actions 构建并发布到 GitHub Pages（用 `gh` 把仓库 Pages 源配置为
GitHub Actions workflow）。这是一个基建任务：不改动业务代码，只加文档站点、
构建脚本和发布 workflow。

仓库现状（已实际核查）：

- 文档源已存在：`docs/compat-report.md`、`docs/release.md`、
  `docs/stable-gate-report.md`；README 以 migration landing page 形式存在；
  `adr/`、`benchmark/README.md` 等是补充材料。
- `docs/` 目录已存在且被 README 相对链接引用（`docs/compat-report.md` 等），
  GitHub 上可点击 —— 所以 VitePress 根目录直接选 `docs/`，不动已有文件位置，
  README 链接全部保持有效。
- Pages 尚未开启（`gh api repos/zhy0216/mad-dom/pages` 返回 404）。
- CI 用 `oven-sh/setup-bun@v2` + `.bun-version`（1.4.0）固定 Bun；
  仓库纪律（AGENTS.md）：脚本一律 `bun` 调用，锁文件 `bun.lock`。
- `.gitignore` 已有 `dist/`（任意深度匹配，覆盖 `.vitepress/dist`），
  缺 `.vitepress/cache`。

## 目标

- `docs/` 成为 VitePress 站点源：`docs/.vitepress/config.mjs` + `docs/index.md`
  落地页，侧边栏收录现有三篇文档。
- `bun run docs:build` 本地可构建，产物在 `docs/.vitepress/dist/`。
- `.github/workflows/docs.yml`：push 到 main（限文档路径）或手动触发时，
  用 Bun 构建并通过 actions/deploy-pages 发布到 GitHub Pages。
- 用 `gh api` 把仓库 Pages 配置为 `build_type=workflow`。

## 非目标

- 不重写/美化现有文档正文（只修构建必需的死链，见下）。
- 不收录 `adr/`、`benchmark/`、`bench/`（在 README 保持 GitHub 链接即可；
  收录它们需要把 srcDir 抬到仓库根或复制文件，属过度设计）。
- 不引入 i18n、搜索插件、自定义主题（默认主题够用）。
- 不把 `docs:build` 塞进 `bun run validate`（文档构建由独立 workflow 把关）。

## 方案

### 站点结构

- VitePress 项目根 = `docs/`（config 在 `docs/.vitepress/config.mjs`）。
- `base: '/mad-dom/'`（project pages，仓库名 mad-dom）。
- 落地页 `docs/index.md`：hero 复用 README 的定位语（"Not happy. Just
  native."、drop-in happy-dom replacement、1.6× faster），features 三条
  （Native arena / One-import migration / Verified compatibility），
  actions 指向 GitHub 仓库与快速开始。
- 侧边栏/导航：Compatibility report、Release manual、Stable gate report
  三个已有文件，加一页 Installation/Quick start（内容取自 README 的安装与
  迁移 diff，约 20 行）。
- 死链修正：`docs/release.md` 里有 4 处指向站点外的相对链接
  （`../adr/0005-...`、`../README.md#support-matrix`、`../rust-toolchain.toml`），
  VitePress 构建会因 dead link 报错。把它们改写为绝对 GitHub URL
  （`https://github.com/zhy0216/mad-dom/blob/main/...`）。站内链接
  （`./compat-report.md` 等）保持不变。不开 `ignoreDeadLinks`，保留检查。

### 依赖与脚本

- `bun add -d vitepress`（进根 `package.json` devDependencies，更新
  `bun.lock`）。vitepress 只进 devDependencies，不影响 `npm publish` 的
  `files` 白名单。
- `package.json` scripts（内部 bun 调用，符合 AGENTS.md）：
  - `docs:dev`: `vitepress dev docs`
  - `docs:build`: `vitepress build docs`
  - `docs:preview`: `vitepress preview docs`
- `.gitignore` 增加 `docs/.vitepress/cache/`（dist 已被现有 `dist/` 规则覆盖）。

### CI/发布（`.github/workflows/docs.yml`）

- 触发：`push` 到 main 且 paths 命中 `docs/**`、`package.json`、
  `bun.lock`、workflow 自身；加 `workflow_dispatch`。
- concurrency：group `pages`，cancel-in-progress。
- build job：checkout@v4 → `oven-sh/setup-bun@v2`（bun-version-file:
  `.bun-version`）→ `bun install --frozen-lockfile` → `bun run docs:build`
  → `touch docs/.vitepress/dist/.nojekyll` →
  `actions/configure-pages@v4` + `actions/upload-pages-artifact@v3`
  （path: `docs/.vitepress/dist`）。
- deploy job：`needs: build`，`environment: github-pages`，
  `permissions: { pages: write, id-token: write }`，
  `actions/deploy-pages@v4`。

### 仓库配置（`gh`）

- 当前 Pages 未开启（404），创建为 workflow 源：
  `gh api -X POST /repos/zhy0216/mad-dom/pages -f build_type=workflow`
  （若执行时已存在则改 `PATCH`）。
- 推送代码后等首次 workflow 运行，用 `gh run list --workflow docs.yml` /
  `gh api repos/zhy0216/mad-dom/pages` 确认部署成功，站点应为
  `https://zhy0216.github.io/mad-dom/`。

## 拆解

两个任务，串行（2 依赖 1）：

1. **vitepress-scaffold**（easy/medium）：依赖 + config + 落地页 + 侧边栏 +
   死链修正 + gitignore + scripts；验收 `bun run docs:build` 成功。
2. **pages-workflow**（easy）：`docs.yml` workflow；提交推送后用 `gh` 开启
   Pages（workflow 源）并确认首次部署成功。

## 校验

仓库级校验（确认没弄坏任何东西）：`bun run check`、`bun test tests/bun tests/compat tests/wpt`
不必全跑 —— 本改动不碰业务代码，最低要求：

- `bun install --frozen-lockfile` 成功（锁文件一致）；
- `bun run docs:build` 成功且 `docs/.vitepress/dist/index.html` 存在；
- `git status` 干净，无生成物泄漏；
- workflow 推上去后 `gh run watch` 显示成功，`gh api .../pages` 显示
  `build_type=workflow` 且部署完成后站点可访问。

## 风险与假设

- **Bun 跑 vitepress**：vitepress CLI 由 Bun 执行，通常可行；若 `docs:build`
  在 Bun 下有兼容性问题，降级方案是 docs.yml 里改用 `actions/setup-node`，
  本地脚本保持 `bun run`（vitepress 内部仍调 node）。执行者遇到时按此降级，
  不必回来问。
- **base 路径**：`/mad-dom/` 是 project pages 的必需配置，写错会白屏 +
  404 静态资源；验收时注意。
- **gh 网络**：本机访问 api.github.com 偶发 TLS 超时（已实测重试即恢复），
  `gh api` 失败时重试即可。
- **假设**：`zhy0216` 账号对仓库有管理员权限（开 Pages 需要），`gh` 已登录
  （已验证 `gh api user` = zhy0216）。
- **假设**：站点语言用英文（与现有文档一致）。
