# Plan: dom-bench hardening (reliability, cold/warm methodology, engine-hotspot workloads)

## 意图

一份外部 AI 审计报告指出了 `benchmark/dom-bench/`（mad-dom vs happy-dom 引擎对比基准）的三类问题。
逐项对照代码核实后**全部成立**：

- **可靠性**：`--runs` 无校验（`--runs 0 --json` 静默产出空 phases，普通模式打印时 throw，run.mjs:32）；
  `median()` 偶数轮取上中位数，与同仓库 `benchmark/run.mjs:88` 的标准中位数不一致（worker.mjs:82）；
  子进程硬编码 `"bun"` 且不检查 `spawnSync().error/signal` 与 JSON/host 一致性（run.mjs:39）；
  `htmlBytes` 用 `HTML.length`（worker.mjs:215）；build 阶段 sink 只累加固定常量 `BUILD_NODES`
  （worker.mjs:148），不能证明树建对了；`querySelector` 命中判断把 `undefined` 也算命中
  （worker.mjs:156 `=== null ? 0 : 1`）；序列化跨引擎只比长度。
- **方法学（核心缺陷）**：`elementCount` 在 traverse 之前用 `querySelectorAll("*")` 走完整棵树
  （worker.mjs:197），把 ~10.3k 个 wrapper 全部钉进 `DOC_STATES.pinned`（window.js:106，强 Map，
  文档可达期间不失效）并预热导航 memo（epoch 守卫，window.js:86-111）。因此 traverse 实际测的是
  **warm**（驻留 + memo 命中 + 零 FFI），而 README:88 仍在描述"每轮 wrapper 全部失效重新铸造"的
  旧实现——文档与代码矛盾。query 同理：同一 selector 反复跑，混入缓存效应。
  另外 `getElementsByTagName("li").length` 因 `liveCollection` 的急切作用域校验付**两次**原生查询
  （live-collections.js:272-279 先查一次丢弃结果，`.length` 再查一次），现有 query 相位口径被污染。
- **引擎热点**：mad-dom 总耗时 build 占 ~80%，但当前只有一个混合的 build 相位
  （createElement + setAttribute + append + text 搅在一起），且缺逐节点属性读取（read-heavy FFI 成本）
  与 mutation churn 的覆盖。

目标：把 dom-bench 修成可信、可解释、对准 build/FFI 热点的长期性能依据。**只改 benchmark/ 与
benchmark/README.md，不改产品代码**。

## 已核实的报告结论（作为依据）

| 报告说法 | 核实结果 |
| --- | --- |
| `--runs 0` 静默/throw | ✅ run.mjs:32 无校验；`median([])` → `undefined`，JSON 里键被 stringify 掉 |
| 偶数轮上中位数不一致 | ✅ worker.mjs:84 `sorted[Math.floor(n/2)]` vs benchmark/run.mjs 标准 `(mid-1+mid)/2` |
| query sink undefined 算命中 | ✅ worker.mjs:156 |
| build sink 固定常量 | ✅ worker.mjs:148 `acc: BUILD_NODES` |
| 序列化只比长度 | ✅ run.mjs:66 比的是 `sink.serialize`（= `html.length` 数字） |
| cold/warm 混测 | ✅ worker.mjs:197 预走全树 → traverse(206) 全 warm；README:84-95 描述已失真 |
| liveCollection 双查询 | ✅ live-collections.js:275/235 —— 这是**产品侧**行为，本 plan 不改，只把 getElementsByTagName 拆成独立相位让成本可见 |
| build 节点数口径 | ✅ 20,000 元素 + 4,000 文本 + root，标签"20k-node"不准 |
| CI 不跑 dom-bench | ✅ ci.yml:161 bench job 只跑 `bench:check`（scripts/bench.mjs 的 core 基线） |

## 目标

1. 可靠性：参数校验、`process.execPath` + spawn/输出健壮性、标准中位数、UTF-8 字节数、真实 sink 校验。
2. 统计口径：worker 保留原始 samples；主进程报告 min / median / p90 / MAD；total 改为**每轮整条
   pipeline 的实测总耗时**的中位数（轮主循环重构），不再是"各相位中位数之和"。
3. 方法学：相位拆 cold/warm——`traverse-warm`（现状，如实命名）+ `traverse-cold`（每轮全新解析
   后立即遍历，wrapper 现铸）；`query-hot`（同文档重复）+ `query-cold`（每轮新文档）；
   `getById`、`getByTag` 独立计量。
4. 新负载：build 分解（createElement / setAttribute / append+reparent / createTextNode /
   innerHTML bulk 一次建 20k）；read-heavy（nodeName、id/className、getAttribute、textContent、
   parentNode/firstChild 逐节点读）；mutation churn（setAttribute 覆写、removeAttribute、
   removeChild+重新 append、replaceChild）；规模曲线（1k/10k/100k，用 `--sizes` 参数化）；
   RSS 内存随相位增量。
5. README：dom-bench 一节重写——cold/warm 定义、pinned wrapper 驻留语义（memo 是特性不是噪声）、
   统计口径；删除与实现矛盾的"每轮全部失效重铸"描述。

## 非目标

- 不改产品代码。`liveCollection` 双原生查询、`build` 逐节点铸造 FFI 是**引擎后续优化输入**，
  本 plan 只负责把它们准确计量出来。
- 不把 dom-bench 接入 CI 基线门禁（标注 `roadmap`：等 cold/warm 与统计口径稳定后再做，
  需要 baseline 记录/比较格式设计）。
- 不改 `benchmark/run.mjs`（集成 wall-clock 基准）与 `scripts/bench.mjs`（core 基线门禁）。

## 方案

全部改动集中在 `benchmark/dom-bench/worker.mjs`、`benchmark/dom-bench/run.mjs`、
`benchmark/README.md` 三个文件。worker 重写为**轮主循环**：

```
每轮 = [parse → build 分解各相 → query-hot/cold → getById → getByTag
        → serialize → traverse-warm/cold → read-heavy → mutation] 计一轮总耗时
warmup 轮丢弃；测量轮收集每相位 samples + 每轮 total
```

关键设计决策：

1. **cold 语义 = 每轮新解析的文档上首次遍历/首查**，即真实测 wrapper 铸造 + 未命中 memo 的 FFI 路径；
   warm = 复用已走过的共享文档（现状）。两者并列为独立相位，README 说清 mad-dom 的 pinned/memo
   是设计特性（T47/导航 memo），warm 数字快是诚实的，cold 数字才是铸造成本。
2. **跨引擎有效性校验升级**：worker 每相位输出结构化 `checks`——build 用测量窗口外
   `getElementById` 抽查若干 id + 一次全树 `querySelectorAll("*")` 计数（parse 后立刻读、
   避开 handle.rs "transient gap" 崩溃窗口，沿用 worker.mjs:145-148 注释里的规避纪律）；
   query 相位 sink 断言每个 selector 命中数与预期值（由确定性 HTML 静态推出）精确相等，
   `querySelector` 命中判定改为 `node && node.id === "node-1234"`；serialize 输出全串哈希
   （`Bun.hash` / 长度兜底纯 JS 累加），run.mjs 比对哈希而非长度；两引擎 `host.os/arch` 必须一致否则报错退出。
3. **median 统一**为标准实现（照抄 `benchmark/run.mjs:88` 的三行函数）。
4. **--runs / --sizes 校验**：整数 ≥ 1，NaN/非正即 `usage 报错 + exit 2`；worker 与 run.mjs 两侧都校验。
5. **spawn**：`process.execPath`；`result.error` 或 `signal` 非空时报错退出；`JSON.parse` 包 try/catch
   附 stderr 上下文；校验 `schema` 字段版本。
6. **统计**：JSON 输出含原始 `samples`；打印表每相位一行 `med`，另附 `min/p90/MAD` 列
   （MAD = median(|x−median|)，两引擎差异大到 build MAD > 20% median 时打印 UNSTABLE 警告——
   直接回应观察到的 build 波动）。total = 每轮 pipeline 总耗时数组的中位数。
7. **RSS**：每相位结束后 `process.memoryUsage().rss` 采样，报告相对基线的增量；
   规模曲线经 `--sizes 1k,10k,100k` 缩放 build/read/mutation 三个家族的节点数（parse HTML 按 0.1×/1×/10× sections 缩放）。

## 拆解

按依赖排序；同文件（worker.mjs）改动**串行**执行避免并行 agent 冲突。

1. **T1 可靠性修补**（easy，无依赖）：`--runs`/`--sizes` 参数校验、`process.execPath` +
   spawnSync error/signal/JSON parse/schema/host 校验、标准 median、`Buffer.byteLength` UTF-8 字节数、
   buildNodes 标签如实改为分拆计数（elements/text/root）。
2. **T2 sink 与跨引擎校验强化**（easy，依赖 T1）：querySelector 真命中判定、build 树实际计数 sink
   （测量窗口外）、serialize 全内容哈希比对、`checks` 结构进 JSON。
3. **T3 worker 轮主循环重构 + 统计**（hard，依赖 T2）：warmup/测量轮改为轮主循环，
   每轮 pipeline total，samples 全保留，min/median/p90/MAD 报告，UNSTABLE 警告。
4. **T4 cold/warm 相位拆分**（medium，依赖 T3）：`traverse-warm`/`traverse-cold`、
   `query-hot`/`query-cold`、独立 `getById`/`getByTag` 相位。
5. **T5 新负载相位**（medium，依赖 T4）：build 分解五相、read-heavy、mutation churn。
6. **T6 规模曲线 + RSS**（medium，依赖 T5）：`--sizes`、RSS 增量采样。
7. **T7 README 重写 dom-bench 节**（easy，依赖 T6）：相位表、cold/warm 定义、pinned/memo 驻留语义、
   统计口径、build 热点结论；修正 traverse 剖析段落的失真描述。

roadmap（只记录，不拆 todo）：dom-bench 接入 CI 独立 baseline 门禁；`liveCollection` 双查询与
build 逐节点 FFI 两个引擎侧优化（以本基准新数据为输入）。

## 校验

- 仓库级：`bun run check`（不碰产品代码，validate 全链与本改动无关；native binding 需已
  `bun run dev:build` 才能跑 worker）。
- 功能验收（每个 todo 至少满足相关项）：
  - `bun benchmark/dom-bench/run.mjs --runs 3` 退出 0，打印含新相位表与 min/p90/MAD；
  - `--runs 0`、`--runs abc`、`--runs -1`、`--sizes 0` 全部非零退出且报错清晰；
  - `--json` 输出含 `schema`、每相位原始 samples、`checks`、两引擎 host；
  - `bun benchmark/dom-bench/run.mjs --json | node -e ...`（或 bun 等价）可解析且相位键齐全——
    `--runs 1` 不再出现空/undefined phases；
  - 故意改坏一侧引擎版本不可能，故以 happy-dom 侧哈希一致 + mad-dom 侧 `checks` 全过为正确性代理；
  - traverse-cold 与 traverse-warm 在 mad-dom 上显著分离（warm 明显更快），验证方法学拆分生效。

## 风险与假设

- **假设** native binding 开发产物已构建（`dev:build`），happy-dom 在 devDependencies 可用
  （现状即如此，run.mjs 已依赖）。
- **风险**：`traverse-cold`/`query-cold` 每轮重新 parse 会加时长——可接受，cold 轮只在需要的相位跑。
- **风险**：全树 `querySelectorAll("*")` sink 校验可能重新踩 handle.rs transient gap——规避方式与
  现状相同（解析/构建完成后立刻读，之后不再读；worker.mjs:145-148、193-195 注释即纪律）。
- **风险**：worker.mjs 大重构在 T3 一次吃掉较多改动；拆解上 T2→T3 顺序执行、每步独立可验收。
- **假设**：MAD/p90 用纯 JS 手写（数组已排序，几行），不引入统计依赖。
