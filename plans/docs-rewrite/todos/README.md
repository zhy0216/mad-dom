# todos — docs-rewrite

重写 `docs/` VitePress 站点为用户向英文文档（少实现细节、零 ADR、多例子）。
事实基准与页面规格见 `plans/docs-rewrite/plan.md`，所有数字以该文件"事实基准"节为准。

## 优先级

| 文件 | 优先级 | 难度 | 说明 |
| --- | --- | --- | --- |
| 01-examples-page.md | P0 | medium | 新建 `docs/examples.md` API 示例页 |
| 02-performance-page.md | P0 | easy | 新建 `docs/performance.md` 速度页 |
| ~~03-platforms-page.md~~ | — | easy | ✅ 已完成，归档至 `done/03-platforms-page.md` |
| 04-core-pages-nav.md | P0 | medium | 重写 index / quick-start / compat-report，重建 config.mjs nav（依赖 01–03） |

## 文件

1. `01-examples-page.md`
2. `02-performance-page.md`
3. ~~`03-platforms-page.md`~~（已完成，在 `done/`）
4. `04-core-pages-nav.md` —— 依赖 01、02、03（nav 链接的页面必须先存在，否则
   `bun run docs:build` dead-link 检查失败）

01–03 文件不相交，可并行；04 最后。
