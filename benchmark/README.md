# Integration-test benchmark (mad-dom vs happy-dom)

This directory vendors the happy-dom integration-test suite in two copies and
runs both under the bun test runner to compare wall-clock:

- `mad-dom-integration-test/` — imports `mad-dom` (devDependency `file:../..`)
- `happy-dom-integration-test/` — imports `happy-dom` 20.11.11 (same version the
  compat differential suite pins)

Both packages keep the upstream test files verbatim except:

1. `import ... from 'happy-dom'` → `from 'mad-dom'` in the mad-dom copy.
2. The `test` script uses `bun test` instead of `node --test` (upstream ran
   `ls | node --disallow-code-generation-from-strings --test`).
3. `Browser.test.js` sets `timer.maxIntervalTime` instead of the stale
   `timer.maxInterval` (no published happy-dom version, nor happy-dom `master`,
   defines `maxInterval`; the upstream test was already broken against it).

The `browser-exception-observer` test cannot run inside a test runner — it
captures process-level `uncaughtException`/`unhandledRejection`, which collide
with the runner — so the `test` script runs it as a standalone script, exactly
like the upstream design.

## Running

```sh
npm run bench:integration        # run both suites, print the comparison
bun benchmark/run.mjs --json     # machine-readable JSON
bun benchmark/run.mjs --iterations 5
```

The report shows two timings (median over 3 runs by default):

- **full** — every test file. The Browser / XMLHttpRequest / WebSocket cases
  hit real external endpoints (github.com, npmjs.com, echo.websocket.org), so
  their latency dominates the total and is noisy; on happy-dom those cases
  usually fail fast in this environment, which makes the full-suite number
  misleading as a performance signal.
- **local** — only the deterministic, dependency-free cases (CommonJS, Fetch
  over a local express server, WindowGlobals, exception observer). This is the
  stable DOM-workload signal and the number to compare.

`npm run test:integration` runs the mad-dom copy as the CI gate. It uses the
`test:ci` script, which excludes `Browser.test.js` (see below) and runs the
deterministic cases plus the exception observer; the full suite including the
live-network cases stays available via the package `test` script or
`bun test test`.

## DOM-intensive benchmark (dom-bench)

`benchmark/run.mjs`（上文）测的是小型集成套件的 wall-clock，其中进程启动、模块
加载、网络等固定成本占大头。`benchmark/dom-bench/` 则直接压 DOM 引擎本身：

```sh
bun benchmark/dom-bench/run.mjs                         # 对比表（默认 5 轮，size 1×）
bun benchmark/dom-bench/run.mjs --json                  # JSON（含 schema、samples、checks、rss）
bun benchmark/dom-bench/run.mjs --runs 7                # 每引擎计量轮数（默认 5）
bun benchmark/dom-bench/run.mjs --sizes 0.1,1,10        # 规模曲线（1 = 基准负载）
```

`--runs` 必须为 ≥ 1 的整数，`--sizes` 为逗号分隔的正数（可小数）；非法参数打印
用法并 `exit 2`（run.mjs 与 worker.mjs 两侧都校验）。

worker（`dom-bench/worker.mjs`）对两个引擎跑同一份确定性负载：以**轮主循环**
跑完整条 pipeline（2 轮 warmup 丢弃，测量轮保留全部原始 samples），共 16 个
相位，各自独立计量（与 `--json` 输出的 phase 键一一对应）：

| 阶段 | 负载与计时窗口 |
| --- | --- |
| `parse` | `document.write` 一份生成的 ~10.3k 元素 / ~320 KB 页面（每次全新 window，只计 write） |
| `buildMixed` | 20k 元素 `createElement` + `setAttribute` + `appendChild` 建树（另 +4k 文本节点，只计建树循环） |
| `queryHot` | 选择器批量（类 / 复合后代）在轮内共享文档上重跑（驻留态） |
| `queryCold` | 同一批量在每轮全新解析文档上首查（现铸 wrapper、选择器缓存未命中） |
| `getById` | 100 个不同 id 的 `querySelector` 单点命中（步长覆盖全量 id 区间） |
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
| `total` | 每轮整条 pipeline 实测总耗时的中位数（不是各相位中位数之和） |

`--sizes` 按倍率缩放 sections（parse/query/traverse 负载）与 build/read/mutation
节点数（多 size 时附 mad-dom 中位数规模曲线表）。每相位结束采样 RSS
（`process.memoryUsage().rss`），打印相对基线的增量（`mad rss Δ` 列）。

方法学要点：

- 两引擎跑在各自独立的 `bun` 子进程（`process.execPath` 拉起；spawn 失败、信号
  终止、非法 JSON、schema/engine 不一致都报错退出）。有效性校验（worker 输出
  `checks`）逐项相等才视为有效对比：逐选择器命中数、build 树实际节点计数 +
  id 抽查、序列化内容哈希、遍历计数、read/mutation 指纹；且两引擎
  `host.os/arch` 必须一致。worker JSON 的 `schema` 为 `mad-dom-dom-bench/3`，
  对比层为 `mad-dom-dom-bench-comparison/1`。
- 统计口径：每相位保留全部轮次原始 `samples`；打印行为
  `median [min-p90] MAD`（MAD = median(|x−median|)）；`total` 为每轮 pipeline
  总耗时数组的中位数；任一相位 MAD > 20% median 即打印 `UNSTABLE` 警告。
- **cold/warm 定义**：warm 相位（`queryHot`、`traverseWarm`）跑在轮内共享文档上——
  该文档刚被 `elementCount` 全树读取并反复访问，wrapper 已被钉在
  `DOC_STATES.pinned`（`js/facade/window.js`，文档可达期间不失效），导航 memo
  命中（树不变时遍历零 FFI）。cold 相位（`queryCold`、`traverseCold`）跑在每轮
  全新解析、从未计数的文档上——wrapper 现铸、memo 未命中，测的是铸造路径。
  **pinned 驻留是设计特性，不是测量噪声**：warm 数字快是诚实的稳态成本，cold
  数字才是铸造成本；读 warm 收益时请连同 RSS 增量一起读（驻留以内存为代价）。
- 每个计量轮之间强制 `Bun.gc(true)` + 排空事件循环（在计量窗口之外，两引擎同样
  付出）。这是必需的：Bun 把 Node-API finalizer 推迟到下一事件循环轮，若不排空，
  mad-dom 的弱 wrapper 缓存在同步 churn 下会累积"已回收未 finalize"的陈旧条目，
  后续节点读取会返回 `undefined` 或在数组转换时报 `InvalidArg`
  （见 `crates/mad-dom-bun/src/handle.rs` 的 "transient gap" 注释）。
- 出于同一原因，`build` 系相位用 JS 计数器 / 单次 walk 校验而不是
  `root.childNodes.length` 收尾：对数千子节点的 `childNodes` 快照读取在该缺口
  窗口内会直接崩溃。该缺口是一个独立的正确性问题，不改变本基准的计量公平性。
  全部校验读（build 树计数、query 命中断言）都在计量窗口之外、树刚建成时读一次。

### traverse 阶段剖析

（历史：2026-09-04 之前）traverse 曾是 mad-dom 唯一显著落后的阶段（早期测量：
~20.5 ms vs happy-dom ~2.8 ms）。当时分层测量显示瓶颈不在遍历写法、也不在
Rust 树链查询，而是**每个节点的 wrapper 铸造**：旧 bench 在每轮计量前强制
gc+排空，弱缓存里的 wrapper 全部失效，上万节点每轮重新铸造——每次铸造付
`napi_new_instance` + create_reference（~0.5 µs）+ facade 侧一次
`wrapperKind()` 分类 FFI（~0.3 µs）+ facade wrapper 对象与 WeakMap 登记；
缓存命中时每条边也有 ~0.2 µs 的 N-API 往返下限。朴素 getter 遍历对任何逐节点
过 FFI 的 native DOM 都是结构性劣势。

三层改动消除了 warm 路径上的这个劣势（`traverseWarm` 现约 0.5 ms，约 8× 快于
happy-dom）：

1. **分类随 mint 产出**：`wrap_node` 铸造时把 `madDomType` / `madDomName` /
   `madDomNamespace` 直接盖在 wrapper 对象上（`handle.rs` `stamp_wrapper_kind`），
   facade 的 wrapper 工厂改为纯属性读取，省掉逐节点的 `wrapperKind()` FFI。
2. **导航读原路返回裸值**：`firstChild` / `nextSibling` 等改为返回裸
   Node-API 值（`wrap_node_value` / `raw_value_if_live`），缓存命中只付一次
   `napi_get_reference_value`，去掉 upgrade/unref 的引用计数往返；亲和检查的
   线程 id 改为 thread-local 缓存（`affinity.rs`）。
3. **epoch 守卫的导航 memo + wrapper 驻留**：facade 把五个导航读的最近答案记在
   wrapper 自身（`node.js` `navRead`），用文档的结构 epoch 校验——binding 在任何
   改变了树关系的调用后递增该文档的 4 字节 epoch 槽（Core `structure_generation`
   在全部关系写入点计数，`with_document` 前后比较并递增，见
   `extensions/epoch_api.rs`），facade 用一次 `Int32Array` 读取即可判定树未变、
   直接返回缓存；为了让 memo 跨 gc 存活，`ctx.wrap` 在文档 native handle 可达
   期间把 wrapper 钉在该文档的 facade 状态里（`window.js` `DOC_STATES`，弱键于
   文档——释放文档仍会释放一切，T47 生命周期测试锁定）。树不变时整轮遍历零 FFI。

正确性边界：memo 只在 epoch 未变时命中，而所有结构突变（append/insert/remove/
replace、innerHTML/textContent、parser、custom-element 升级替换）都经过关系写入
chokepoint 递增 `structure_generation`，facade 无需枚举突变入口。`tests/bun/
navigation-memo.test.js` 锁定失效语义、跨 gc 身份与 epoch/印章的 native 形状。

现行测量：`traverseWarm` 测驻留 + memo 命中态（稳态遍历成本），`traverseCold`
测铸造路径（mad-dom 上显著更慢，约数十毫秒量级——两条数字的分离本身就是
cold/warm 拆分生效的证据）。query 同理拆为 `queryHot` / `queryCold`。

结论：build 族（旧五相位口径下约占总耗时八成；现 `buildMixed` 仍是单相位最重的
成本中心，且 create/attr/append/text 全线落后于 happy-dom）与 cold 路径铸造
成本是引擎下一个热点；`getByTag` 的 live-collection 双原生查询
（`live-collections.js` 先急切作用域校验一次、`.length` 再查一次）为已知计量
事实——以上作为引擎侧后续优化输入（roadmap，不在本 plan 实施）。

注：`buildBulk`（单次 innerHTML 解析）mad-dom 约 3× 快于 happy-dom；
`queryHot` / `serialize` / `parse` 保持数倍领先。

## 与 hdunit 的关系

本目录的 integration benchmark 与 hdunit（`tests/happy-dom/`，[ADR-0006](../adr/0006-happy-dom-unit-suite-hdunit.md)）
是**互补的两条验证线**，不互相替代：

| 维度 | integration benchmark（本目录） | hdunit（tests/happy-dom/） |
| --- | --- | --- |
| 套件来源 | happy-dom 的 `integration-test/` 子套件（少量、端到端：Fetch、XMLHttpRequest、WebSocket、Browser、窗口脚本求值） | happy-dom 的 `test/` 全量单测（298 个 `*.test.ts`，约 9.9 万行） |
| 运行方式 | 同一套测试跑两遍（mad-dom vs happy-dom），比对 wall-clock | 只跑 mad-dom 侧，逐文件 triage 终态 |
| 关注点 | **性能**（local 组：确定性 DOM 负载的中位耗时对比） | **正确性门禁**（每个 vendored 文件声明 enabled/skip/expected-fail 且不可退化） |
| 测试代码改动 | 拷来改 import（`happy-dom` → `mad-dom`）+ 少量运行适配 | 机械重写（vitest → bun:test + shim 路径），禁止手改断言 |
| 门禁 | CI `integration` job（`npm run test:integration`）+ `bench` job（`npm run bench:check` 对基线） | `compat:hdunit:validate`（validate job + `npm run validate` 链） |

简单说：integration benchmark 回答「mad-dom 在这个工作负载上快不快」，hdunit 回答
「mad-dom 跑不跑得对上游单测」。两者的基底版本一致（都锁定 happy-dom v20.11.11 @
`64e2c774…`），但覆盖范围与判定语义不同。hdunit 的覆盖总结与 known-gap 见
[tests/happy-dom/COVERAGE.md](../tests/happy-dom/COVERAGE.md)。

## Current gaps on mad-dom

The mad-dom copy now runs the full suite: `Browser` / `BrowserErrorCaptureEnum`
and the page/frame model are implemented (`js/facade/extensions/browser.js`,
exported from the package entry). Navigation is server-side and script-free:
`goto()` fetches the top-level HTML, parses it into the document and sets the
title and frame URL; page JavaScript is not evaluated. The
`browser-exception-observer` test passes fully (process-level error capture
routes uncaught window-script errors to the window `error` event and the
`virtualConsolePrinter`).

`Browser.test.js` hits real github.com / npmjs.com content: the assertions
depend on the live SSR markup (and the network path to those hosts), so it
passes only when the endpoints are reachable and their markup matches — treat
its failures as environment noise, exactly like the happy-dom copy. For this
reason it is excluded from the CI gate (`test:ci`); it remains part of the
`test` script and of the benchmark's full-suite run (`benchmark/run.mjs`).
