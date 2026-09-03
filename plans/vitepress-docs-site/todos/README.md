# todos: vitepress-docs-site

方案：`plans/vitepress-docs-site/plan.md`。串行队列，02 依赖 01。

## 优先级

| 文件 | 优先级 | 难度 | 说明 |
| --- | --- | --- | --- |
| `01-vitepress-scaffold.md` | P0 | medium | ✅ 已完成 · VitePress 站点脚手架：依赖、配置、落地页、侧边栏、死链修正，`bun run docs:build` 通过 |
| `02-pages-workflow.md` | P0 | easy | `docs.yml` 发布 workflow + `gh` 开启 Pages（workflow 源）+ 确认首次部署 |

## 文件（执行顺序）

1. ~~`01-vitepress-scaffold.md`~~ ✅ 已完成（归档于 `done/`）— 依赖：无
2. `02-pages-workflow.md` — 依赖 01（需要 `docs:build` script 与站点源）
