difficulty: hard
status: done

# 03 · worker 轮主循环重构 + 原始 samples / pipeline total / min-p90-MAD 统计

## 目标

把 worker 从"相位主循环"重构为"轮主循环"，消除 total=Σmedian 的失真，保留原始样本并输出稳健统计。
对应 plan.md 拆解 T3。只改 `benchmark/dom-bench/worker.mjs` 与 `benchmark/dom-bench/run.mjs`。

## 要做什么

worker.mjs：

- 重构 main()：外层按轮循环（`warmups + runs` 轮，warmup 数保持现各相位的最大值 = 2，全轮丢弃）。
  每轮内顺序执行现有五相位：
  1. `parse`：新 Window + `document.write(HTML)`，得本轮 sharedDocument；
  2. `elementCount`：解析后立即 `querySelectorAll("*").length` 一次（保留现 193-195 行的窗口注释逻辑，
     每轮重做，值应相同，取第一轮记录进 report）；
  3. `build`：现 runBuild（自含 window，无需共享文档）；
  4. `query` / `serialize` / `traverse`：对 sharedDocument 执行（warm 语义，现状不变——
     相位改名与 cold 拆分由 04 做，本步只换循环结构，相位名与现行为保持）；
  5. 每轮从进入 parse 前计时到 traverse 后，记 `roundTotal`。
- 每相位每轮计时 samples 全量收集；相位结束调 `collectAndDrain()`（现 95 行）保持公平纪律；
  轮与轮之间也 `collectAndDrain()`。
- report 结构升级，schema 改 `"mad-dom-dom-bench/2"`（run.mjs 校验同步）：
  `phases.<name> = { samples: number[], medianMs, minMs, p90Ms, madMs }`；
  新增 `total = { samples: roundTotals, medianMs, minMs, p90Ms, madMs }`；
  `sink`/`checks`（02 落地的结构）保留，checks 取测量轮均值或首值（确定性负载，各轮应相同；
  不同时在 checks 里输出 `roundsIdentical: false` 供 run.mjs 并入 valid）。
  p90 = 排序后 `sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * n) - 1)]`（小样本取高位即可）；
  MAD = median(|x − median|)，median 用 01 落地的标准实现。
- 移除相位主循环时代的 benchPhase 用法（函数可保留改造为接收 samples push 回调，或内联——实现者定，
  保持代码短）。

run.mjs：

- PHASES 循环读值改为 `report.phases[p].medianMs`；total 行读 `report.total.medianMs`，
  并注明 `median of N per-round pipeline totals`。
- 打印表加列：`min/p90/MAD`（每相位一行展示 `med · [min–p90] · MAD x.xx`；保持现有 padEnd 表格风格，
  列宽可加到 28）。
- UNSTABLE 警告：任一相位任一引擎 `madMs > 0.2 * medianMs` 时，表后打印
  `WARNING: <engine> <phase> unstable (MAD > 20% of median)`。
- schema 校验串同步为 `mad-dom-dom-bench/2`。

## 预计修改的文件

- `benchmark/dom-bench/worker.mjs`
- `benchmark/dom-bench/run.mjs`

## 验收条件

- `bun benchmark/dom-bench/run.mjs --runs 5` 正常打印含 min/p90/MAD 的表与 total 行；
  total ≠ Σ相位 median（结构上不同，打印口径为每轮总耗时）。
- `bun benchmark/dom-bench/run.mjs --runs 2 --json | bun -e 'const j=await new Response(Bun.stdin.stream()).json();
  for (const r of j.reports) for (const p of Object.values(r.phases)) console.assert(p.samples.length===2 && Number.isFinite(p.medianMs));'`
  无 assertion 失败；`r.total.samples.length === 2`。
- `--runs 1` 时各相位 samples 长度为 1、median/min/p90/MAD 全部为数字（MAD=0）。
- 同负载两轮跑出的 `checks` 一致（valid: true）。
- 全部现有输出信息（workload、host header、WARNING 机制）不回归。

## 前置依赖

依赖 02-workload-validation（checks/sink 结构先就位；同文件改动须串行）。
