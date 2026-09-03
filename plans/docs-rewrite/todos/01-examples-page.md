difficulty: medium

# 01 · 新建 docs/examples.md（API 示例页）

## T1 · 编写 examples 页

要做什么：

- 新建 `docs/examples.md`，全英文，用户向，短段落 + 短代码块。
- 代码块只能取材于仓库 `examples/wiki-*.mad-dom.mjs`（55 个可运行示例）与
  `index.d.ts` 声明的面，不得凭印象编造 API；import 一律 `from "mad-dom"`。
- 建议章节（可按素材微调，保持节奏轻快）：
  1. Window + document：`new Window()`、`document.body.innerHTML`、
     `textContent`（取材 `examples/wiki-getting-started*.mad-dom.mjs`）；
  2. Query & events：`querySelector`、`addEventListener`、`dispatchEvent`
     （对齐 `tests/bun/events.test.js` 的用法）；
  3. Browser & pages：`new Browser()`、`newPage()`、`page.url` / `page.content`、
     `page.mainFrame.document`（取材 `examples/wiki-browser.mad-dom.mjs`）；
  4. GlobalWindow：`new GlobalWindow(...)` + `document.write` + `globalThis`
     （取材 `examples/wiki-globalwindow.mad-dom.mjs`）；
  5. `window.happyDOM`：`waitUntilComplete()`、`setViewport()`、`close()`
     （取材 `examples/wiki-detachedwindowapi-*.mad-dom.mjs`）。
- 结尾一段指向 `examples/` 目录：55 个脚本，每个都有 `.happy-dom.mjs` 对照版，
  可用 `bun examples/wiki-browser.mad-dom.mjs` 直接跑（链接用绝对 GitHub URL
  `https://github.com/zhy0216/mad-dom/tree/main/examples`，避免站内死链）。
- 不提及 ADR、不提内部实现（arena 等细节留给 performance 页一句话）。

预计修改文件：`docs/examples.md`（新建）。

验收条件：

- `bun run docs:build` 成功（新页面为孤儿页也须能构建，不得引入死链）；
- 页面内无 "ADR" / "adr/" 字样；
- 每个代码块都能在 `examples/` 或 `index.d.ts` 中找到对应面（抽查核对）。

前置依赖：无。
