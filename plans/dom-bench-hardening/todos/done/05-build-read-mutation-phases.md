difficulty: medium

# 05 · 新负载相位：build 分解 / read-heavy / mutation churn

## 目标

对准 mad-dom 最大热点（build ≈ 总耗时 80%）与完全缺失的逐节点属性读取、结构突变覆盖。
对应 plan.md 拆解 T5。只改 `benchmark/dom-bench/worker.mjs` 与 `benchmark/dom-bench/run.mjs`。

## 要做什么

worker.mjs（基于 04 的轮主循环与相位集合）：

- 现有 `build` 改名 `buildMixed`（口径不变，向后兼容参照）。
- 新增分解相位（各自每轮新建 window，规模 = 现 BUILD_NODES 的构建量，节点命名 `nb-<phase>-<i>`
  避免与 buildMixed 的 id 冲突）：
  - `buildCreate`：只 `createElement` 20k 个，不挂载；
  - `buildAttr`：createElement + `setAttribute`（每个 1 个 id + 1 个 class）不挂载；
  - `buildAppend`：createElement 后 appendChild 到浅树（全部挂 root 下，纯 reparent 成本）；
  - `buildText`：createTextNode 20k；
  - `buildBulk`：一次性 `div.innerHTML = <20k 元素的片段>`（片段由 worker 启动时拼好常量）。
- 新增 `readHeavy`：对共享 parsed 文档（parse 阶段产物，warm 驻留态）遍历固定 5000 个
  元素节点（`querySelectorAll("li")` 取样），逐项读 `nodeName` + `id` + `className` +
  `getAttribute("class")` + `firstChild.textContent`；计时只含读取，取样查询在窗口外。
- 新增 `mutationChurn`：对共享文档（结构突变会 bump epoch 使 memo 失效——属预期，相位自身
  重复轮次间不共享文档：每轮重新 parse 一个专用文档再突变，与 traverseCold 同一手法）。
  每轮 N=2000 次：`setAttribute("data-x", i)` 覆写、`removeAttribute("class")`、
  `removeChild` 后重新 `appendChild`（先取够引用，避开 handle.rs 崩溃纪律：快照数组在窗口内
  由 `querySelectorAll("li")` 一次取回）、`replaceChild`。sink 为突变成功计数。
- report.phases 追加键：`buildCreate, buildAttr, buildAppend, buildText, buildBulk,
  readHeavy, mutationChurn`（buildMixed 保持在 build 原位）。
- 每相位 sink/checks 进 checks，跨引擎可比（readHeavy 读到的属性拼接哈希；
  mutationChurn 终态抽查若干节点 getAttribute 指纹）。

run.mjs：

- PHASES 同步全量键；表格分组打印：主 9 相位一组、build 分解一组、read/mutation 一组
  （组间空行 + 组标题行，padEnd 风格沿用）。

## 预计修改的文件

- `benchmark/dom-bench/worker.mjs`
- `benchmark/dom-bench/run.mjs`

## 验收条件

- `bun benchmark/dom-bench/run.mjs --runs 3` 打印含全部相位（分节）的表且退出 0；
  `--json` 所有新相位 samples 齐全、`valid: true`。
- mad-dom 侧 `buildCreate` 显著小于 `buildMixed`（差值即 attribute+append+text 的 FFI 成本，
  数字上可解释）。
- 引擎侧行为零改动（`git diff` 不含 js/ 与 crates/）。

## 前置依赖

依赖 04-cold-warm-split（同一批文件、同轮主循环结构，必须串行）。
