difficulty: medium

# 04 · cold/warm 相位拆分（traverse / query / getById / getByTag）

## 目标

消除 cold/warm 混测，让铸造成本可单独观察。对应 plan.md 拆解 T4。只改
`benchmark/dom-bench/worker.mjs` 与 `benchmark/dom-bench/run.mjs`。

## 要做什么

worker.mjs（基于 03 的轮主循环；warmup 轮同结构跳过计量）：

- 现有 `traverse` 改名 `traverseWarm`（语义：共享文档已被 elementCount + 前轮遍历驻留 memo，
  代码路径不变）。
- 新增 `traverseCold`：每轮 `document.write(HTML)` 重新解析出**全新文档**后立刻
  `countNodes(doc.body)`（`firstChild`/`nextSibling` 走树，wrapper 现铸、memo 未命中）。
  计时窗口只含遍历本身；解析耗时计入 parse 之外的独立 `coldParse` 计时（不进 total 也行，
  实现取简：traverseCold 计时窗口 = 遍历，不含解析）。sink/checks.traverseCount 与 warm 相同值。
- 现有 `query` 改名 `queryHot`（同文档重复查询，现状不变）。
- 新增 `queryCold`：对 `traverseCold` 用的同一新文档，先跑 elementCount 之外的选择器组
  （`.item-3`、`section > ul > li`，即未被新文档任何先前查询命中的），计时窗口只含查询。
- `getById` 独立相位：`document.querySelector("#node-1234")`（从 query 组移出）——对共享文档
  每轮 100 次不同 id（`node-0 … node-2500` 步长均匀取 100 个）计时；现 queryHot 内的单发
  id 查询移除。
- `getByTag` 独立相位：`document.getElementsByTagName("li").length` × 20 次计时——让
  liveCollection 双原生查询成本（live-collections.js:272 急切校验 + .length 再查）单独可见。
  从 queryHot/queryCold 选择器组里移出。
- checks.queryHits 相应拆分（byTag 计数、byId 命中数照旧跨引擎比对）。
- report.phases 键序：`parse, build, queryHot, queryCold, getById, getByTag, serialize, traverseWarm, traverseCold`。

run.mjs：

- PHASES 常量同步为新键集合；表打印、total 不变（total 用 worker 每轮 pipeline 计时——
  worker 的 roundTotal 计时窗口相应扩到新相位集合）。

## 预计修改的文件

- `benchmark/dom-bench/worker.mjs`
- `benchmark/dom-bench/run.mjs`

## 验收条件

- `bun benchmark/dom-bench/run.mjs --runs 3` 打印含全部 9 相位的表。
- mad-dom 侧 `traverseWarm.medianMs << traverseCold.medianMs`（预期 warm ~0.4 ms vs cold ≥5 ms 量级），
  证明驻留/memo 语义被如实分离；happy-dom 侧两者接近属正常。
- `--json` 各相位 samples 数量 = runs；`valid: true` 保持。
- 引擎侧行为零改动（`git diff` 不含 js/ 与 crates/）。

## 前置依赖

依赖 03-round-major-stats（轮主循环与 report 结构是其基础）。
