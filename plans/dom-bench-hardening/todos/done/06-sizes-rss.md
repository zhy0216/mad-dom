difficulty: medium

# 06 · 规模曲线（--sizes）+ RSS 内存采样

## 目标

把单点测量扩展为 1k/10k/100k 规模曲线，并把内存代价和速度并排报告（navigation memo 的
wrapper 驻留是有内存成本的特性）。对应 plan.md 拆解 T6。只改 `benchmark/dom-bench/worker.mjs`
与 `benchmark/dom-bench/run.mjs`。

## 要做什么

worker.mjs：

- 新增 `--sizes` 参数（默认 `"1"`），逗号分隔倍率：`1` = 现状规模；`0.1` / `10` 按比例缩放
  SECTIONS / ITEMS_PER_SECTION（保持元素结构比例）与 BUILD_NODES（四舍五入，最小 100）。
  校验：每个倍率为正数，否则 usage 报错 exit 2。
- 每相位结束后采样 `process.memoryUsage().rss`（在 collectAndDrain **之前**读，反映相位峰值驻留；
  drain 后再读一次反映驻留残留）。report 结构新增 `rss: { baseline, perPhase: { <phase>: {peak, after} } }`
  （字节数；baseline = 首轮测量前的采样）。
- 多 size 时 worker 一次进程内按 size 顺序跑完整轮主循环集合，report 外层按 size 分节：
  `results: [{ size, workload, phases, rss, total, checks, sink }]`。单 size 时保持
  `results: [{ size: 1, ... }]` 统一结构（schema 版本 bump 到 `/3`，run.mjs 同步校验）。
- HTML 生成改为按规模参数化的 `generateHtml(scale)`（确定性不变；elementCount 等 checks 按 size 记录）。

run.mjs：

- 新增 `--sizes` 透传（默认 `1`；校验同 worker）。
- 多 size 时每个 size 打印一张现格式对比表，表头加 `size <n>×`；末尾追加规模曲线摘要：
  每相位 mad-dom median 随 size 的 `x.x ms` 一行（行=相位、列=size），用于目测超线性项。
- RSS 列：表内每相位行追加 mad-dom 与 happy-dom 的 after-drain RSS 增量（MB，1 位小数）。
- host/valid 逻辑适配多 size 结构（valid 为所有 size 的与）。

## 预计修改的文件

- `benchmark/dom-bench/worker.mjs`
- `benchmark/dom-bench/run.mjs`

## 验收条件

- `bun benchmark/dom-bench/run.mjs --runs 2 --sizes 0.1,1,10` 打印三张表 + 规模曲线摘要，退出 0；
  `--json` 的 `reports[i].results` 长度为 3、schema 为 `/3`。
- 默认无 `--sizes` 时输出与 05 完成后的单 size 行为一致（仅结构嵌套进 results[0]，打印表不变）。
- `--sizes 0`、`--sizes abc` 非零退出并打印 usage。
- 10× mad-dom 的 readHeavy/build 相位耗时与 RSS 增量同向增长（数值打印可目测核对）。
- 引擎侧行为零改动（`git diff` 不含 js/ 与 crates/）。

## 前置依赖

依赖 05-build-read-mutation-phases（同文件，须串行）。
