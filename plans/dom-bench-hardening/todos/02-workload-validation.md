difficulty: easy

# 02 · sink 与跨引擎有效性校验强化

## 目标

让"两引擎跑了同一份正确负载"成为可证事实，而不是长度巧合。对应 plan.md 拆解 T2。
只改 `benchmark/dom-bench/worker.mjs` 与 `benchmark/dom-bench/run.mjs`。

## 要做什么

worker.mjs：

- query 命中判定修复（现 worker.mjs:156 `acc += document.querySelector("#node-1234") === null ? 0 : 1`
  把 undefined 也算命中）：改为 `const hit = document.querySelector("#node-1234"); acc += hit && hit.id === "node-1234" ? 1 : 0;`
- build sink 真校验：runBuild 停止计时后（测量窗口外，沿用现 145-148 行注释的 transient-gap 规避纪律——
  新文档构建完成后立即读一次、之后不再读），返回 `treeNodes` = root 子树元素数
  （`document.querySelectorAll(...)` 不可用——build 文档没有独立 document 入口，直接用
  `countNodes(root) - 1`（已有 countNodes 辅助，现 167 行））与 `probeIds` = 
  `["node-0","node-9999","node-19999"].map(id => root.querySelector("#"+id) ? 1 : 0).join("")`。
  sink.build 累加改用真实值：`acc: treeNodes + probeIdSum`。
- serialize 内容指纹：runSerialize 在测量窗口内只 `html.length` 进 acc（保持计时公平），
  窗口外算一次全串指纹。指纹不加依赖：纯 JS 累加哈希
  （`let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;`）。
  report.sink.serialize 保持长度；新增 `report.checks.serializeHash`。
- 每相位输出结构化 `checks` 对象进 report：
  `checks = { queryHits: {item3, descendant, idHit, byTag} 实际命中数, build: {treeNodes, probeIds},
  serializeHash, traverseCount, elementCount }`（选择器命中数由现有 runQuery 拆分返回，不影响计时值）。

run.mjs：

- 跨引擎有效性比较（现 66 行只比 elementCount + serialize 长度）升级为逐项比较
  `mad.workload.elementCount`、`mad.checks.queryHits`、`mad.checks.build.treeNodes`、`mad.checks.build.probeIds`、
  `mad.checks.serializeHash`、`mad.checks.traverseCount` 与 happy 对应值，任一不等 → 打印
  WARNING "engines saw different workloads — comparison is invalid"（保留现有措辞）并在 --json 输出里带
  `valid: false`（全等时 `valid: true`）。
- host 一致性：比较两 report 的 `host.os` 与 `host.arch`，不一致时 console.error 并以退出码 1 终止
  （同一台机器跑两引擎是硬前提；bun 版本允许不同但要打印出来——现有 header 已打印 mad 侧 bun 版本，
  改为 `mad.host.bun === happy.host.bun` 时打印一个版本号，否则打印两个）。

## 预计修改的文件

- `benchmark/dom-bench/worker.mjs`
- `benchmark/dom-bench/run.mjs`

## 验收条件

- `bun benchmark/dom-bench/run.mjs --runs 3 --json` 输出中每个 report 含 `checks` 对象，
  顶层含 `valid: true`。
- 手工构造 happy-dom 侧不匹配（如临时把 generateHtml 的 ITEMS_PER_SECTION 只对 happy-dom 生效不可能——
  因此改为：临时在本地把 worker 的 checks.queryHits 任一值 +1 跑一次，确认 WARNING + valid:false 后还原）。
  最终提交不含该临时改动。
- mad-dom 侧 `checks.build.probeIds === "111"` 且 `checks.build.treeNodes` 与
  builtElements 数一致（100 sections × 25 items 结构下 = 20000 元素子树；root 直下子树计数为 20000）。
- `git diff` 仅限上述两文件。

## 前置依赖

依赖 01-reliability-fixes（median/参数校验先落地，避免同文件冲突）。
