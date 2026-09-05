# Benchmarks: mad-dom vs happy-dom

仓库中有三种不同口径的性能测量：

| 命令 | 测量内容 | 用途 |
| --- | --- | --- |
| `bun run bench:dom` | 16 个 DOM 操作阶段 + 13 个小型测试工作流 | 比较两个引擎的确定性 DOM 工作负载 |
| `bun run bench:integration` | 两份集成测试的进程墙钟时间 | 观察模块加载、runner、DOM 和网络叠加的端到端成本 |
| `bun run bench:check` | Rust Core + raw binding 的内部指标 | 对照适用基线检查 mad-dom 自身的大幅退化，详见 [bench/README.md](../bench/README.md) |

## 最新记录：2026-09-05

| 计时工作量 | mad-dom | happy-dom 20.11.11 | happy-dom / mad-dom |
| --- | ---: | ---: | ---: |
| Core：16 阶段的操作合计 | **141.70 ms** | 401.60 ms | **2.83×** |
| Testing：13 场景的工作量合计 | **91.10 ms** | 143.08 ms | **1.57×** |

这次测量使用 Apple M3 Max、48 GiB 内存、macOS 26.6.2 arm64、Bun 1.4.0、
Rust 1.93.1；size 1×，2 轮 warmup + 9 轮正式计量。
源码版本为 [`2fda7ea`](https://github.com/zhy0216/mad-dom/commit/2fda7eaf75572a29618f9443527011886a970e0b)
（package.json 版本 `0.0.1-alpha.3`），通过 `dev:build` 构建并显式加载本地
native artifact。这里的数字对应源码构建，不代表已发布 npm 二进制的测量。

[原始 JSON](results/2026-09-05-dom.json) 保留本次完整输出；
[性能页](../docs/performance.md) 列出全部 29 个阶段的时间及 RSS。
两个引擎的工作量和结果校验匹配，13 个 testing 场景全部通过，顶层 `valid: true`。
mad-dom 在 15/16 个 core 阶段、8/13 个 testing 场景中位数更低；
较慢项目也计入合计，不能据此宣称每类测试都会加速。

合计均为**先按轮相加，再对这些轮次总和取中位数**。Core JSON 直接提供
`operations`；testing runner 只报告单项，表中合计由全部通过的场景 samples
计算。两者都不是把各相位中位数相加，也不是整套测试进程的运行时间。
这些阶段及其用例数量构成固定的混合负载，合计没有额外按场景权重归一化。

## 从源码复现

以下命令在仓库根目录运行，需要 Bun `1.4.0` 和 Rust `1.93.1`：

```sh
bun install --frozen-lockfile
bun run dev:build
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun run bench:dom --runs 9 --sizes 1 --json > dom-bench.json
```

`MAD_DOM_NATIVE_PATH` 保证使用刚构建的原生模块，即使已安装平台 npm 包。
对比不同源码版本时，每次重建并使用同样的路径覆盖。其余常用命令：

```sh
bun run bench:dom                                     # all，默认 5 轮、size 1×
bun run bench:dom --suite testing                     # 只跑单测工作流
bun run bench:dom --suite core                        # 只跑 16 个操作阶段
bun run bench:dom --suite core --runs 9 --sizes 0.1,1,2 # 规模曲线
bun run bench:dom --runs 1 --sizes 0.01                # 两组最小工作量冒烟
bun test benchmark/dom-bench                          # fixture、计量器与报告校验
```

这些命令也可加相同的 native-path 前缀。省略 `--json` 会打印对比表；
`--runs` 必须为 ≥ 1 的整数，`--sizes` 是逗号分隔的有限正数。
非法参数返回 exit 2。冒烟规模和单轮样本只适合检查能否运行。

### 从原始 samples 复算合计

下面的命令使用 runner 共用的统计函数。将文件名改为 `dom-bench.json`
即可汇总自己刚跑出的结果：

```sh
bun -e '
import { summarizeOperations } from "./benchmark/dom-bench/stats.mjs";
const report = await Bun.file("benchmark/results/2026-09-05-dom.json").json();
if (!report.valid || !report.testing?.valid) throw new Error("Invalid comparison");
for (const [suite, reports] of [["core", report.reports], ["testing", report.testing.reports]]) {
  for (const engine of reports) {
    for (const result of engine.results) {
      if (suite === "testing" && Object.values(result.phases).some(p => p.status !== "passed")) {
        throw new Error("Incomplete testing workload");
      }
      console.log(suite, engine.engine, result.size, summarizeOperations(result.phases));
    }
  }
}
'
```

## DOM benchmark 的计量与有效性

`dom-bench/run.mjs` 按固定顺序启动独立 Bun worker：
core mad-dom → core happy-dom → testing mad-dom → testing happy-dom。
不同 suite 使用不同进程，多种 size 则在同一 worker 内按给定顺序执行。
这次记录没有使用 ABBA 交替顺序，也没有计算置信区间；需要判断窄差值时，
应在目标机器上重复测量并检查全部样本，避免只选有利轮次。

- 每个 size 丢弃 2 轮 warmup，保留全部正式 samples。表格显示
  `median [min-p90] MAD`，p90 使用 nearest-rank，MAD 为中位绝对偏差。
  MAD 超过中位数 20% 会警告；`[min-p90]` 不是置信区间。
- 每阶段后都执行 `Bun.gc(true)` 和两次事件循环排空，让延迟的 Node-API
  finalizer 有机会运行。这些显式 GC/等待位于单项操作计时窗口外；
  窗口内发生的普通运行时 GC 仍会计入耗时。
- Core 检查完整 workload 元数据、逐选择器命中数、真实树节点计数、id 抽查、
  序列化哈希、遍历计数和 read/mutation 指纹；正式轮次必须一致，两引擎也必须匹配。
  无效时该规模不展示 core speedup。
- Testing 每例在计时后检查明确的期望值，包括 cleanup 后空 body；warmup 也检查。
  同引擎跨轮指纹必须相同，两引擎的用例数和 SHA-256 结果指纹也必须相同。
- Testing 场景失败后标为 `FAIL`、清空 samples、保留首个失败轮次和原因，并继续
  其他场景；失败场景不重试，也不展示 speedup 或参与合计。
- 任一 workload 失败、结果不匹配或 core 跨轮不一致，runner 输出诊断后返回
  exit 1；worker 启动失败、信号退出或无效 JSON/schema 也会终止比较。
- 只跑 core 时对比 schema 为 `mad-dom-dom-bench-comparison/1`，core worker
  为 `mad-dom-dom-bench/3`。包含 testing 时对比 schema 为
  `mad-dom-dom-bench-comparison/2`，原 core 数据仍在 `reports`，testing 数据在
  `testing: { phases, reports, valid }`，testing worker 为 `mad-dom-testing-bench/1`。
  `--suite testing` 时顶层 core 的 `reports` / `phases` 为空。

## 大树与底层操作：core

`dom-bench/worker.mjs` 以轮为主循环，每轮运行完整 pipeline。
以下负载为 size 1×；`--sizes` 缩放 sections 及 build/read/mutation 节点数。
各阶段独立计时，分解构建阶段都是另外执行的实验，不是从 `buildMixed` 中拆分时间。

| 阶段 | 负载与计时窗口 |
| --- | --- |
| `parse` | `document.write` 一份生成的 ~10.3k 元素 / ~320 KB 页面（每次全新 window，只计 write） |
| `buildMixed` | 20k 元素 `createElement` + `setAttribute` + `appendChild` 建树（另 +4k 文本节点，只计建树循环） |
| `queryHot` | 在共享文档上先于计时预跑同一组类 / 复合后代选择器，再计量第二次查询 |
| `queryCold` | 同一批量在每轮全新解析文档上首查（现铸 wrapper、选择器缓存未命中） |
| `getById` | 100 个不同 id 的 document `querySelector("#id")` 单点命中（首查含 Core id-only 索引构建，步长覆盖全量 id 区间） |
| `getByTag` | 20 次 `getElementsByTagName("li").length`（live-collection 成本单独计量） |
| `serialize` | `body.innerHTML` 全量读取（计时为纯读取；内容哈希在窗口外计算） |
| `traverseWarm` | 共享文档第二次 `firstChild` / `nextSibling` 全树遍历（驻留 + 导航 memo 命中） |
| `traverseCold` | 全新解析文档的首次全树遍历（wrapper 现铸、memo 未命中） |
| `buildCreate` | 20k `createElement`，无属性、不挂载（纯创建成本） |
| `buildAttr` | `createElement` + 每节点 id/class `setAttribute`，不挂载（属性 FFI） |
| `buildAppend` | `createElement` + `appendChild` 到浅根，无属性（纯挂载成本） |
| `buildText` | 20k `createTextNode`，不挂载 |
| `buildBulk` | 一次 `div.innerHTML` 解析 20k 元素片段再挂载（native 解析路径，无逐节点 FFI） |
| `readHeavy` | 5000 采样节点逐节点读 `nodeName` / `id` / `className` / `getAttribute` / 首子节点 `textContent` |
| `mutationChurn` | 2000 采样节点 ×（`setAttribute` 覆写、removeAttribute、remove+append、replaceChild 出入对；每轮独立新文档） |
| `operations` | 每轮 16 个计时窗口之和的中位数，排除 fixture 准备、验证、强制 GC 与事件循环等待 |
| `total` | 每轮整条 pipeline 实测墙钟时间的中位数，包含准备、验证、相位间 GC 与等待（保留原有口径） |

`queryHot` 的同一组选择器预跑和 `traverseWarm` 的第一次完整遍历都在计时外。
Cold 使用另行新建、解析后未作 element-count 预读的文档；`queryCold`
查询后再运行 `traverseCold`，所以 cold 指首次遍历，不代表完全没有先前查询。
文档存活时 wrapper/token 和导航缓存驻留是实现成本的一部分，需要连同 RSS 看。

`getById` 名称指单点 ID 查询，但实际 API 是 `querySelector("#id")`，
不是 `getElementById()`。第一条查询建立 Core 的 ID-only 索引，
其后的 99 条使用索引；一般 class/后代选择器不会因此开启完整查询索引。

## 小型单测工作流：testing

场景定义在 `dom-bench/testing-scenarios.mjs`。它们执行
setup → mount → query/interact → inspect → cleanup，使用确定性数据和小组件。
`--sizes` 只缩放独立用例数（四舍五入、最少 1 例），不放大单个组件。
每个时间样本是该场景**整批用例**的耗时，不能直接跨场景比较单次操作速度。

| 阶段 | 1× 每轮用例数 | 场景与验证 |
| --- | ---: | --- |
| `fixtureLifecycle` | 100 | 共享 Window 中反复挂载计数器、点击更新、读取结果、卸载和移除监听器；验证卸载后的监听器不会继续更新组件 |
| `windowLifecycle` | 25 | 每例创建独立 Window、挂载/查询、localStorage 写入、清理并关闭；验证初始 DOM/storage 无前例残留 |
| `testingLibraryText` | 50 | 20 行项目列表，真实 `within` / `getByTestId` / `getByText` / `queryByText` 查询与缺失元素检查 |
| `testingLibraryEvents` | 50 | 真实 `fireEvent.click` 分发两次，验证 `{ once: true }` 监听器只执行一次 |
| `testingLibraryRole` | 25 | 真实 `getByRole` / `getAllByRole`，含 heading level、按钮 accessible name 和默认可见性检查 |
| `testingLibraryLabel` | 25 | 真实 `getByLabelText` 查找 `<label for>` 关联输入框，`fireEvent.input` 后通过 `getByDisplayValue` 查询 |
| `todoInteractions` | 50 | 创建 12 条 Todo、Fragment 批量挂载、嵌套点击事件委托、完成/删除、class/dataset/aria 更新及 live collection 失效 |
| `formSubmission` | 50 | 填写 input/textarea/select/checkbox，冒泡事件、requestSubmit、FormData 成功控件筛选和 reset 恢复默认值 |
| `templateClone` | 50 | 深克隆 template.content，填充 20 张卡片，Fragment 挂载，验证模板保持原样及所有卡片内容 |
| `keyedReconcile` | 50 | 20 行列表删掉偶数项、逆序移动保留节点并更新文本；验证顺序、节点身份、live collection 与静态 NodeList |
| `asyncObserver` | 25 | Promise 模拟请求返回、更新 loading 组件、等待 MutationObserver 通知，验证最终文本及属性/子节点记录 |
| `shadowComponent` | 50 | Shadow DOM 计数器挂载、slot 分配、内部查询、composed 事件冒泡、状态更新与 light/shadow 查询隔离 |
| `snapshotRoundTrip` | 50 | 克隆组件、修改副本、outerHTML 快照、重解析，验证原树未变以及实体、属性和注释的完整内容 |

Testing Library 使用锁定的 `@testing-library/dom@10.4.1` 实际 API，保留默认
可见性检查。场景不包含 React/Vue renderer、`user-event`、jest-dom matcher
或测试运行器启动，因此不能作为完整框架测试性能的结论。

每例 fixture 解析、查询、交互、结果读取和 `body.replaceChildren()` 清理都计时。
只有 `windowLifecycle` 把 Window 创建和 `happyDOM.close()` 算进窗口；
其他场景每轮共享一个 Window，创建与最终关闭在计时外。
预生成 fixture 字符串、最终断言、SHA-256、显式 GC 和事件循环排空不计时。
异步场景使用 Promise + MutationObserver，2 秒定时器仅作失败 watchdog，
正常路径没有固定等待或外网请求。

## RSS 和 pipeline total

JSON `rss.baseline` 是首个正式轮次前的 RSS。
`rss.perPhase.<phase>.peak` 在 GC 前采样，`after` 在 GC 和事件循环排空后采样；
它们只保留最后一个正式轮次，`peak` 是时点读数，不是 OS 高水位。
Core 对比表展示 `after - baseline`，testing 的 RSS 仅保留在 JSON 中。

本次 core 最后阶段的 after-baseline 为 mad-dom **+242.3 MiB**、
happy-dom **+3,475.1 MiB**。这是多轮 worker 累积驻留量，包含 native
分配、wrapper/cache、JIT 和 GC 状态，不是每份文档的对象大小，也不是泄漏检测。

Core `total` 为每轮完整 pipeline 的墙钟时间，包含准备、验证及相位间 GC/等待。
本次中位数是 374.80 / 3,252.41 ms，但 happy-dom 的 total MAD 超过中位数 20%，
因此主表采用 `operations`。另外 happy-dom 的 `queryHot` 与
`traverseWarm` 也超过不稳定阈值；微秒级热查询和窄差值不宜当作稳定胜负。

## Integration-test benchmark

`run.mjs` 对两个私有包运行测试：

- `mad-dom-integration-test/` 通过 `file:../..` 导入本地 mad-dom。
- `happy-dom-integration-test/` 导入锁定的 happy-dom `20.11.11`。

两份测试之间仅替换引擎 import/require，断言一致。共同的上游适配包括 Bun
runner，以及 `Browser.test.js` 使用 `timer.maxIntervalTime`。
异常观察器会捕获进程级 `uncaughtException` / `unhandledRejection`，
因此通过独立脚本运行，避开与测试 runner 的冲突。

先完成根目录依赖安装和原生构建，再安装两个私有包的依赖：

```sh
bun install --frozen-lockfile --cwd benchmark/mad-dom-integration-test
bun install --frozen-lockfile --cwd benchmark/happy-dom-integration-test
bun run bench:integration
bun run bench:integration --iterations 5 --json
```

默认每引擎运行 3 次，报告两个中位墙钟时间：

| 字段 | 工作量与解释 |
| --- | --- |
| `local` | CommonJS、使用本地 Express 的 Fetch、WindowGlobals，加独立异常观察器；不依赖外网，但包含进程启动、模块加载和本地 HTTP 成本 |
| `full` | 全部测试加异常观察器；Browser、部分 XMLHttpRequest 和 WebSocket 用例依赖外网，受服务可达性和实时页面内容影响 |

当前 runner 即使测试失败也会输出时间和速度比较，未校验所有子进程 exit status；
JSON 的 summary 只保留最后一轮 full 主测试结果，不包含逐轮 local 通过情况。
**报告生成成功不代表测试通过**，使用时间比较前应单独确认所选用例的正确性。
DOM 性能结论优先使用有 workload 校验的 `bench:dom`。

`bun run test:integration` 是 CI 对 mad-dom 包的功能检查，执行其 `test:ci`：
只排除 `Browser.test.js`，并单独运行异常观察器。
**它仍包含 XMLHttpRequest 和 WebSocket 的外网用例，并非纯 local 分组。**
完整 Browser 用例也可能暴露导航或脚本行为差异，不能把失败一概归因于网络。

## 与兼容性门禁的关系

| 验证线 | 关注点 |
| --- | --- |
| `bench:dom` | 当前 DOM 工作量的有效性和耗时对比 |
| `test:integration` | mad-dom 侧集成用例的通过情况 |
| `bench:check` | 内部性能/内存指标相对基线的大幅退化 |
| `compat:hdunit:validate` | vendored happy-dom 单测文件的 triage 与不可退化检查 |

集成测试来自上游 `integration-test/`，hdunit 来自上游 `test/`，
两者都锁定 happy-dom 20.11.11，覆盖范围不同。
性能比值不能代替兼容性结论；完整范围见
[兼容报告](../docs/compat-report.md) 和 [hdunit 覆盖说明](../tests/happy-dom/COVERAGE.md)。
