# Plan: docs-rewrite

## 意图

用户要求把文档（`docs/` 下的 VitePress 站点）重新写一遍：

- 技术实现细节少一些；
- 不再提 ADR（现有页面里 ADR-0001~0006 的引用全部从用户可见页面清除）；
- 多提供例子：速度（speed）、兼容性（compatibility）等；
- 全英文；整体结构与节奏由本次规划把握。

现状（已实际核查）：

- 站点已存在（`plans/vitepress-docs-site` 已交付）：`docs/.vitepress/config.mjs`，
  nav = Quick start / Compatibility / Release / Stable gate；GitHub Pages 经
  `.github/workflows/docs.yml` 自动部署（push 到 main 的 `docs/**` 即触发），本次无需动。
- 现有页面偏内部证据而非用户文档：
  - `docs/index.md`（落地页，23 行）、`docs/quick-start.md`（44 行，偏薄）；
  - `docs/compat-report.md`（stable gate 报告腔，满篇 ADR-0002 引用）；
  - `docs/release.md`（维护者发布手册，满篇 ADR-0005）；
  - `docs/stable-gate-report.md`（T50 报告，部分中文）。
- 例子素材充足：`examples/` 有 55 个 `wiki-*.mad-dom.mjs` 可运行示例
  （Window / GlobalWindow / Browser / BrowserPage / BrowserFrame / CookieContainer /
  DetachedWindowAPI…）；API 面以 `index.d.ts`（2969 行）与 `js/entry.js` 导出为准。

## 目标

- 站点重构为 6 页用户文档（全英文）：landing、Quick start、Examples、
  Performance、Compatibility、Platforms。
- 用户可见页面零 ADR 引用、零内部流程细节（发布脚本、checksum、gate 证据链等不进用户页面）。
- 所有数字必须来自下方"事实基准"（仓库内可核查），不得编造。

## 非目标

- 不改业务代码、`package.json` scripts、依赖、workflow。
- 不删除/重写 `docs/release.md` 与 `docs/stable-gate-report.md`：它们是
  `plans/roadmap-001` 仍在维护的维护者证据文档，文件留在原处（README 还链接
  `docs/release.md`），仅从站点 nav/sidebar 移除，成为不可达的孤儿页。
- 不改 `README.md`（其链接 `docs/compat-report.md`、`docs/release.md` 路径均不变）。
- 不引入搜索、i18n、自定义主题。
- 不为文档例子新建可运行测试基建（例子取材自 `examples/` 与 `index.d.ts`，肉眼对齐）。

## 方案

### 站点结构（新 nav 顺序）

Quick start → Examples → Performance → Compatibility → Platforms。
`config.mjs` 保留 `base: '/mad-dom/'`、title、socialLinks，仅重写 nav/sidebar。

### 页面内容

1. **`docs/index.md`**（重写）：hero 保持定位语（"Not happy. Just native."、
   drop-in happy-dom replacement、1.6× faster）；features 三条改为
   One-import migration / Speed you can measure / Compatibility you can verify；
   actions 指向 /quick-start 与 GitHub。
2. **`docs/quick-start.md`**（重写）：`bun add -d mad-dom`；migration diff
   （happy-dom → mad-dom 一行）；一个最小可跑例子（`new Window()` + document
   操作）；`bun test`；benchmark 一行复现命令；alpha status 提示。
3. **`docs/examples.md`**（新建）：API tour，每节一个短代码块，全部取材
   `examples/`：Window + document（wiki-getting-started）、querySelector 与
   events、Browser + pages（wiki-browser）、GlobalWindow（wiki-globalwindow）、
   `window.happyDOM`（waitUntilComplete / setViewport / close，wiki-detachedwindowapi*）。
   结尾指向 `examples/` 目录（55 个成对脚本，每个都有 happy-dom 对照版）。
4. **`docs/performance.md`**（新建）：速度叙事。1.6× 表格（128 ms vs 206 ms，
   median of 3，macOS arm64，Bun 1.4.0，确定性 DOM 负载）；方法一句话：
   vendored happy-dom 自家 integration suite，只改 import；为什么快用一段话
   带过（Rust memory arena + native parser/selector，不展开实现）；
   `bun benchmark/run.mjs` 复现；末尾一小节说明内部有性能回归门禁
   （`bench/baseline.json`，一句话，不展开）。
5. **`docs/compat-report.md`**（原地重写，文件名不变以保 README 链接）：
   用户视角的兼容性页。锁定基线（happy-dom 20.11.11）+ black-box differential
   = 43/43 pass（100%）；hdunit 诚实披露：298 个 vendored happy-dom 单测文件，
   68 个实跑通过（23%）、22 个声明 expected-fail、208 个带 reason skip；
   WPT 子集 39.8% 为独立测量轨；给出复现命令（`bun run compat:differential`、
   `bun run compat:hdunit:report`、`bun run wpt:json`）。
6. **`docs/platforms.md`**（新建）：平台矩阵表（Available now (alpha): macOS
   arm64/x64、Linux x64/arm64 glibc；Coming in beta: Windows x64、Linux musl）；
   安装机制一句话（平台二进制 = optional npm 包 `@mad-dom/platform-*`，
   nothing to compile）；要求：Bun >= 1.4.0，Linux glibc >= 2.39；
   troubleshooting 小节：`MAD_DOM_UNSUPPORTED_PLATFORM`（含 `--no-optional`
   提示）与 `MAD_DOM_ABI_MISMATCH` 两个错误名及含义。

### 事实基准（页面数字唯一来源，不得编造）

- 1.6× = 128 ms vs 206 ms（median of 3 runs，macOS arm64，Bun 1.4.0，
  deterministic DOM workload，vendored happy-dom integration suite）。
- 兼容契约：`compat/ledger.json` 43/43 pass（types 10 + diff 33），0 known-gap，
  基线 happy-dom `20.11.11`。
- hdunit：298 文件 / 68 enabled（23%）/ 22 expected-fail / 208 skip（带 reason）
  （`tests/happy-dom/COVERAGE.md`）。
- WPT 子集：39.8%（37 pass / 56 fail / 93 assertions），仅测量不门禁。
- 平台：alpha = darwin-arm64/x64、linux-x64/arm64-gnu；beta = win32-x64、
  linux musl ×2。glibc floor 2.39。`engines.bun >= 1.4.0`。
- 错误契约：`MAD_DOM_UNSUPPORTED_PLATFORM`、`MAD_DOM_ABI_MISMATCH`。
- Status：alpha，不建议生产使用。

## 拆解

四个任务；01–03 文件不相交可并行，04 依赖 01–03（nav 链接到新页面，
dead-link 检查开启，页面必须先存在）：

1. `01-examples-page`（medium）：新建 `docs/examples.md`。
2. `02-performance-page`（easy）：新建 `docs/performance.md`。
3. `03-platforms-page`（easy）：新建 `docs/platforms.md`。
4. `04-core-pages-nav`（medium，依赖 01–03）：重写 `docs/index.md`、
   `docs/quick-start.md`、`docs/compat-report.md`，改 `docs/.vitepress/config.mjs`
   nav/sidebar。

## 校验

- `bun install --frozen-lockfile` 成功（无依赖变更，锁文件不动）；
- `bun run docs:build` 成功（dead-link 检查保持开启），`docs/.vitepress/dist/index.html` 存在；
- 用户六页（index / quick-start / examples / performance / compat-report / platforms）
  `grep -ri "adr" docs/*.md` 剔除 release.md 与 stable-gate-report.md 后零命中；
- `git status` 只显示 `plans/` 与 `docs/` 下改动；业务代码、脚本、锁文件零改动。

## 风险与假设

- **孤儿页**：`release.md` / `stable-gate-report.md` 仍会被 VitePress 构建但
  无入口链接；若用户后续希望彻底移出站点，是另一个小改动，不在本次。
- **数字冲突**：执行者若发现仓库文件数字与"事实基准"不一致，以仓库文件为准，
  并在 commit message 注明。
- **示例 API 保真**：examples.md 的代码块必须从 `examples/` 或 `index.d.ts`
  取材，不得凭印象写 happy-dom API。
- **自动部署**：合并进 main 后 docs.yml 会自动重建 Pages 站点，无需额外操作。
