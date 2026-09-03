difficulty: easy

# 02 · GitHub Pages 发布 workflow 与仓库配置

新增 `docs.yml`：文档变更推送到 main 时用 Bun 构建 VitePress 并部署到
GitHub Pages；然后用 `gh` 把仓库 Pages 源设为 GitHub Actions。

**本任务授权 push 与远端配置**：用户明确要求"用 gh 配置仓库支持从 GitHub
Action 构建"，故允许 `git push origin main` 与 `gh api` 修改 Pages 设置；
这是本 todo 唯一允许的远端写操作，不做其他远端变更。

## T1 · docs.yml workflow

- 新建 `.github/workflows/docs.yml`，参照 `.github/workflows/ci.yml` 的
  checkout/setup-bun 写法：
  - 触发：`push` branches [main] + `paths: ['docs/**', 'package.json',
    'bun.lock', '.github/workflows/docs.yml']`；`workflow_dispatch`。
  - `concurrency: { group: pages, cancel-in-progress: true }`。
  - build job（`runs-on: ubuntu-latest`）：`actions/checkout@v4` →
    `oven-sh/setup-bun@v2`（`bun-version-file: .bun-version`）→
    `bun install --frozen-lockfile` → `bun run docs:build` →
    `touch docs/.vitepress/dist/.nojekyll` → `actions/configure-pages@v4` →
    `actions/upload-pages-artifact@v3`（`path: docs/.vitepress/dist`）。
  - deploy job：`needs: build`，`environment: { name: github-pages,
    url: ${{ steps.deployment.outputs.page_url }}`，
    `permissions: { pages: write, id-token: write }`，
    `actions/deploy-pages@v4`（id: deployment）。
- 预计修改：`.github/workflows/docs.yml`（新建）
- 验收：文件存在且 YAML 语法正确（可用 `ruby -ryaml -e 'YAML.load_file(".github/workflows/docs.yml")'`
  或等价方式校验）。
- 依赖：无（实现不依赖 01，但合入与触发依赖 01 已在 main 上）

## T2 · 推送并配置 Pages

- 确认 01 的改动已在当前分支（`bun run docs:build` 可跑）；commit 本任务
  的 workflow 文件后 `git push origin main`。
- 配置 Pages 为 workflow 源（当前未开启，404）：
  `gh api -X POST /repos/zhy0216/mad-dom/pages -f build_type=workflow`；
  若返回已存在则改用 `-X PATCH`。
- 验收：`gh api repos/zhy0216/mad-dom/pages` 返回 `build_type: workflow`
  （或 `source` 指向 Actions）。
- 依赖：T1；且 01-vitepress-scaffold 必须已合入（否则构建失败）

## T3 · 验证首次部署

- `gh run list --workflow docs.yml --limit 3` 观察触发的运行；
  `gh run watch` 等待成功（网络抖动导致 `gh` TLS 超时时重试即可）。
  若 push 早于 Pages 配置导致 deploy job 失败，重新触发：
  `gh workflow run docs.yml`（workflow_dispatch）。
- 验收：最近一次 `docs.yml` run 成功；
  `gh api repos/zhy0216/mad-dom/pages` 状态非失败；站点
  `https://zhy0216.github.io/mad-dom/` 返回 200（`curl -sI` 检查，
  部署传播可能需 1-2 分钟，重试几次）。
- 依赖：T2

## 本文件整体验证

`gh api repos/zhy0216/mad-dom/pages` 显示 workflow 源；最近一次
`docs.yml` 运行成功；`curl -sI https://zhy0216.github.io/mad-dom/` 返回
200。全部完成后归档本文件到 `todos/done/`。
