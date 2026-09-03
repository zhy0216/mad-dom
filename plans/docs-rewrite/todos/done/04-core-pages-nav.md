difficulty: medium

# 04 · 重写 index / quick-start / compat-report 并重建 nav

## T1 · 重写三个核心页面

要做什么（全英文，用户向，零 ADR）：

- `docs/index.md`（重写）：保留 `layout: home`。hero：name "MAD DOM"、
  text "Not happy. Just native."、tagline 保持"drop-in replacement for
  happy-dom — one import is the whole migration, and your DOM tests get
  1.6× faster"；actions = Quick start（/quick-start）+ View on GitHub
  （https://github.com/zhy0216/mad-dom）。features 三条改写为：
  One-import migration（一行 diff 迁移）/ Speed you can measure（1.6×，
  链 /performance）/ Compatibility you can verify（locked happy-dom baseline，
  100% pass on the compatibility contract，链 /compat-report）。
- `docs/quick-start.md`（重写）：Install（`bun add -d mad-dom`，一句话说明
  平台包自动处理，详见 /platforms）；One import is the whole migration
  （diff 代码块）；最小例子（`new Window()` + `document.body.innerHTML = ...`
  + `querySelector`，取材 `examples/wiki-getting-started*.mad-dom.mjs`）；
  Run your tests（`bun test` + 1.6× 一行 + `bun benchmark/run.mjs` 复现，
  链 /performance）；Status（alpha，别上生产）。
- `docs/compat-report.md`（原地重写，文件名不变）：用户视角兼容性页，
  数字只能用事实基准：
  1. 契约：锁定基线 happy-dom `20.11.11`，black-box differential suite，
     43/43 pass（100%），0 known-gap；
  2. 更大口径诚实披露：hdunit —— 298 个 vendored happy-dom 单测文件，
     68 个实跑通过（23%），22 个声明 expected-fail，208 个带 reason skip，
     无静默缺席；
  3. WPT 子集 39.8%（37/93）为独立测量轨，不构成门禁；
  4. 复现命令：`bun run compat:differential`、`bun run compat:hdunit:report`、
     `bun run wpt:json`；
  5. 不提 ADR、不提 ledger schema / validate-ledger 等内部机制细节。

## T2 · 重建 config.mjs nav/sidebar

- `docs/.vitepress/config.mjs`：nav 与 sidebar 改为
  Quick start → Examples → Performance → Compatibility → Platforms；
  移除 Release、Stable gate 条目；`base`、title、description、socialLinks 不动。
- `docs/release.md`、`docs/stable-gate-report.md` 文件本身不动（成为站内孤儿页）。

预计修改文件：`docs/index.md`、`docs/quick-start.md`、`docs/compat-report.md`、
`docs/.vitepress/config.mjs`。

验收条件：

- `bun run docs:build` 成功（dead-link 检查开启，五个页面互相链接全部有效），
  `docs/.vitepress/dist/index.html` 存在；
- `grep -ri adr docs/index.md docs/quick-start.md docs/examples.md docs/performance.md docs/compat-report.md docs/platforms.md`
  零命中；
- `git status` 只含上述四个文件；README 对 `docs/compat-report.md`、
  `docs/release.md` 的链接路径仍然有效。

前置依赖：01、02、03（`/examples`、`/performance`、`/platforms` 页面必须已存在）。
