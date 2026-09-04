# todos: dom-bench-hardening

来源：`plans/dom-bench-hardening/plan.md`。全部任务只改 `benchmark/dom-bench/run.mjs`、
`benchmark/dom-bench/worker.mjs`、`benchmark/README.md`，不改产品代码。
因 01–06 都改 worker.mjs / run.mjs 同一批文件，队列**严格串行**执行（每步依赖上一步）。

## 优先级

| 文件 | 优先级 | 难度 | 说明 |
| --- | --- | --- | --- |
| 01-reliability-patch.md | P0 | easy | ✅ 参数校验、spawn 健壮性、标准 median、UTF-8 字节数 |
| 02-sink-validation.md | P0 | easy | ✅ 真实 sink：querySelector 命中、build 树计数、serialize 哈希 |
| 03-round-major-stats.md | P0 | hard | worker 轮主循环重构 + 每轮 pipeline total + min/median/p90/MAD |
| 04-cold-warm-split.md | P1 | medium | traverse/query 拆 cold/warm，getById/getByTag 独立相位 |
| 05-new-workloads.md | P1 | medium | build 分解、read-heavy、mutation churn 相位 |
| 06-sizes-rss.md | P1 | medium | --sizes 规模曲线 + RSS 增量采样 |
| 07-readme-rewrite.md | P2 | easy | README dom-bench 节重写，修正失真描述 |

## 文件

执行顺序（全部串行）：

1. 01-reliability-patch.md —已完成（done/）
2. 02-sink-validation.md —已完成（done/，实际文件 02-workload-validation.md）
3. 03-round-major-stats.md —依赖 02
4. 04-cold-warm-split.md —依赖 03
5. 05-new-workloads.md —依赖 04
6. 06-sizes-rss.md —依赖 05
7. 07-readme-rewrite.md —依赖 06

## 校验（每个 todo 通用底线）

前置：native binding 已构建（`bun run dev:build`）。每步完成后至少：

- `bun benchmark/dom-bench/run.mjs --runs 1` 退出 0，两引擎相位键齐全、无 undefined；
- `bun benchmark/dom-bench/run.mjs --runs 3 --json` 可 `JSON.parse`；
- `bun run check` 通过。
