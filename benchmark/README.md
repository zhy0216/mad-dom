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
bun run bench:integration        # run both suites, print the comparison
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

`bun run test:integration` runs the mad-dom copy as the CI gate. It uses the
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
  `DOC_STATES` 所持的私有 token registry（旧 binding 回退到 `pinned`；
  `js/facade/window.js`，文档可达期间不失效），导航 memo 命中（树不变时遍历零
  FFI）。cold 相位
  （`queryCold`、`traverseCold`）跑在每轮
  全新解析、从未计数的文档上——wrapper 现铸、memo 未命中，测的是铸造路径。
  **pinned 驻留是设计特性，不是测量噪声**：warm 数字快是诚实的稳态成本，cold
  数字才是铸造成本；读 warm 收益时请连同 RSS 增量一起读（驻留以内存为代价）。
- **id 索引口径**：每轮共享文档第一次 document plain-`#id` 查询把 Core 查询模式从
  `Off` 原子切换为 `IdOnly`，只构建并维护 document light tree 的 `by_id`；因此
  `getById` 计时同时包含一次构建和其后的 99 次索引读取。class/tag/all-elements 的
  完整 T32 索引仍保持关闭，`queryHot`/`queryCold` 的一般选择器也不触发它。
- 每个计量轮之间强制 `Bun.gc(true)` + 排空事件循环（在计量窗口之外，两引擎同样
  付出）。Bun 会把 Node-API finalizer 推迟到后续事件循环轮；排空可以让两引擎的
  残留堆压力在固定相位边界收敛。facade wrapper 按设计在文档存活期间驻留；raw 弱缓存
  则用 mint stamp 安全处理"已回收、尚未 finalize"的重铸窗口。
- `build` 系相位用 JS 计数器记录同步工作量，并在计量窗口外用单次 walk + id
  抽查验证真实树，避免把不属于创建相位的 collection 物化成本算入结果。

### traverse 阶段剖析

（历史：2026-09-04 之前）traverse 曾是 mad-dom 唯一显著落后的阶段（早期测量：
~20.5 ms vs happy-dom ~2.8 ms）。当时分层测量显示瓶颈不在遍历写法、也不在
Rust 树链查询，而是**每个节点的 wrapper 铸造**：旧 bench 在每轮计量前强制
gc+排空，弱缓存里的 wrapper 全部失效，上万节点每轮重新铸造——每次铸造付
`napi_new_instance` + create_reference（~0.5 µs）+ facade 侧一次
`wrapperKind()` 分类 FFI（~0.3 µs）+ facade wrapper 对象与 WeakMap 登记；
缓存命中时每条边也有 ~0.2 µs 的 N-API 往返下限。朴素 getter 遍历对任何逐节点
过 FFI 的 native DOM 都是结构性劣势。

后续四层改动同时消除了 warm 和 cold 路径上的这个劣势（2026-09-05 的完整
pipeline ABBA 复核：`traverseWarm` 0.546 vs 1.416 ms，`traverseCold`
3.203 vs 3.434 ms）：

1. **分类随 mint 产出**：`wrap_node` 铸造时把 `madDomType` / `madDomName` /
   `madDomNamespace` 直接盖在 wrapper 对象上（`handle.rs` `stamp_wrapper_kind`），
   facade 的 wrapper 工厂改为纯属性读取，省掉逐节点的 `wrapperKind()` FFI。
2. **导航读原路返回裸值**：`firstChild` / `nextSibling` 等改为返回裸
   Node-API 值（`wrap_node_value` / `raw_value_if_live`），缓存命中只付一次
   `napi_get_reference_value`，去掉 upgrade/unref 的引用计数往返；亲和检查的
   线程 id 改为 thread-local 缓存（`affinity.rs`）。
3. **epoch 守卫的导航 memo + wrapper 驻留**：facade 把五个导航读的最近答案记在
   module-private WeakMap 记录中（`node.js` `navRead`），用文档的结构 epoch
   校验——binding 在任何改变了树关系的调用后递增 canonical epoch，并发布到
   JS-owned 4 字节 buffer
   （Core `structure_generation` 在全部关系写入点计数，`with_document` 前后比较，
   见 `extensions/epoch_api.rs`）；facade 用一次 `Int32Array` 读取即可判定树未变、
   直接返回缓存；为了让 memo 跨 gc 存活，`ctx.wrap` 在文档 native handle 可达
   期间把 wrapper 钉在该文档的 facade 状态里（`window.js` `DOC_STATES`，弱键于
   文档——释放文档仍会释放一切，T47 生命周期测试锁定）。树不变时整轮遍历零 FFI。
4. **文档令牌 + 有界 subtree snapshot**：facade 节点可以先只持有文档作用域的
   `u32` token，直到非 token API 才物化 `NodeHandle`；cold walk 首次进入一个树时，
   native 用 `Uint32Array` 返回最多 65,535 个 preorder token/分类/深度对，以及下一
   节点深度 header。facade 重建这个有界前缀的 wrapper 与已证明关系，边界后继续
   使用有界子树/sibling 读取，因此 2× 负载不再陡增到 50+ ms，单次 snapshot 仍有界。
   token registry 只包含绑定/Core 生成的整数和 arena id，使用局部 `FxHashMap`；
   快照在一次 registry lock 内单次探测、批量补齐 token，facade hydration 同步预建
   memo。这个非随机哈希器不得用于用户提供的字符串或一般 facade 状态。
   snapshot 新分配的 token 由 native fresh bit 证明，facade 可跳过不可能命中的
   wrapper 查找；同一轮 hydration 复用 descriptor→prototype 结果，并先完整构造
   null-prototype 私有记录、再一次写入 WeakMap，继续压低首次访问成本。

正确性边界：memo 只在 epoch 未变时命中，而所有结构突变（append/insert/remove/
replace、innerHTML/textContent、parser、custom-element 升级替换）都经过关系写入
chokepoint 递增 `structure_generation`，facade 无需枚举突变入口。`tests/bun/
navigation-memo.test.js` 锁定失效语义、跨 gc 身份与 epoch/印章的 native 形状。

现行测量：`traverseWarm` 测驻留 + memo 命中态，`traverseCold` 测 token wrapper 的
首次批量铸造；两者仍分别展示稳态与首次访问成本。query 同理拆为 `queryHot` /
`queryCold`。

创建热路径也使用同一文档令牌：常见 HTML tag 的 token 池从单次创建自适应升到
8/32/128/256 批，`setAttribute` 与同文档 `appendChild` 直接消费 token。这样既不为
一次性 tag 隐藏预分配 256 个节点，也把持续创建的固定 FFI 成本摊薄。新建 token
同时构成“此前不可能已有 wrapper”的证明；facade 复用文档私有 state 中的 handle
与 coercion 后读取的 epoch，跳过重复 WeakMap/Map 查找。当前 binding 的批量入口只
返回连续 token 区间的起点，facade 用标量游标按旧数组 `pop()` 顺序消费，避免把
原生 `Vec<u32>` 封送成 JavaScript 数组；旧 binding 依次回退到 token 数组批量入口
和单节点入口。所有可选性能方法都只接受原生直接 prototype 上的 own data method，
原生分类/token 印章也只接受 handle 自身的 data property；解析后的方法按文档缓存并
安全预绑定，继承属性不能伪造旧 binding 的能力，也不会给热循环重复增加 descriptor
查询。1× ABBA 合并中位数中 `buildCreate` / `buildAttr` / `buildAppend` /
`buildText` 分别为 5.880/19.567/10.355/7.109 ms，happy-dom 为
7.132/26.200/12.515/8.530 ms。

最终的小规模复核又把 Text 创建路径收窄为三步：Node-API 转换出的 owned `String`
直接移入 Core；fresh `NodeId` 登记跳过必然 miss 的反向表探测；facade 用创建专用
Text wrapper 工厂直接初始化同一份私有记录和 token 身份表。四个配对、每块 31 轮的
同引擎 A/B 中，`buildText` 合并中位数从 0.60775 降至 0.57408 ms（快 5.54%）；
四对 pipeline total 变化为 −0.35%、−0.54%、+0.48%、+1.65%，中心不足 1%。

`getByTag` / class collection 的 length 缓存在 Core 维护的结构/属性 generation 上，
树或 class 写入后立即 miss；新鲜 collection 身份不变，但重复的未变计数不再跨
FFI。相同测量中 `getByTag` 为 0.216 vs 2.482 ms。第一次简单 document id 查询只
自适应建立 Core `by_id` 索引，因此 `getById` 为 0.791 vs 41.147 ms，而一般 selector
仍不会承担完整 T32 索引的内存和写维护成本。`id`/`class` 反射值使用独立属性
generation，并在冷 miss 时用一个原生调用同时填充两项，避免 `id`、`className`、
`getAttribute("class")` 连续读取反复跨边界；Core `textContent` 同时使用无分配关系
遍历及空/单文本子节点快路径，`readHeavy` 为 4.117 vs 4.559 ms。

高样本 1× 审计的 16 个独立相位全部快于锁定的 happy-dom 基线；其中 `parse`、
`queryHot`、`serialize`、`buildBulk` 与 mutation churn 是数倍到十倍级领先。数字是
单机 macOS arm64 / Bun 1.4.0 样本。正式命令 15 轮的第一次 1× 测量中，15 个相位
领先，`readHeavy` 为 4.41 vs 4.39 ms，仅差 0.46% 且处于噪声内；为避免固定引擎
顺序和挑选结果，随后补跑完整 pipeline ABBA（mad、happy、happy、mad），每个
worker 15 个测量轮，合并为每引擎 30 个样本。ABBA 合并中位数 16/16 相位领先；
两个 mad-dom batch 的 `readHeavy` 中位数为 4.005/4.142 ms，两个 happy-dom batch
为 4.386/4.582 ms，方向一致。按 batch 分层的 200,000 次 bootstrap 给出 happy-dom
− mad-dom 差值 95% CI +0.126..+0.777 ms、ratio 1.030×..1.189×，点估计 mad-dom
少 9.69%。全部 16 相位各做 50,000 次同法 bootstrap 后，差值 CI 下界都大于零，
最窄的是 `traverseCold` 的 +0.119 ms。

最终固定代码另保留了 0.1× / 1× / 2× 三档审计。0.1× 用四个交替 worker、每个
31 个测量轮，合并为每引擎 62 个样本：14 个相位的分层 bootstrap 差值 CI 明确大于
零，`buildText` 与 `readHeavy` 统计持平。合并中位数分别为 `traverseCold`
0.3377 vs 0.3528 ms、`buildText` 0.5742 vs 0.6689 ms、`readHeavy` 0.4050 vs
0.3996 ms；后三者的 happy-dom − mad-dom 95% CI 依次为 +0.0003..+0.0263、
−0.0332..+0.1914、−0.0487..+0.0260 ms。也就是说，小规模只剩微秒级、不足以判定
回归的边界噪声。最终正式命令的固定引擎顺序 15 轮在这三项给出 0.43 vs 0.36、0.74 vs
0.49、0.59 vs 0.39 ms，方向与高样本 ABBA 部分相反且三个区间都重叠；原始点值保留
在此，但结论采用交替顺序的 62 样本审计。

最终 `--runs 15 --sizes 0.1,1,2` 正式命令中，1×/2× 除 `readHeavy` 外的 15 个
相位都领先；`readHeavy` 为 4.89 vs 4.18 ms 和 10.21 vs 10.17 ms，区间重叠，后者
只差 0.04 ms（0.4%），应与上面的高样本 1× 证据合读。2× 的 `buildCreate` 为
12.42 vs 20.39 ms，`buildText` 为 14.82 vs 18.50 ms，`traverseCold` 为
6.27 vs 7.09 ms。更早一次 2× 正式测量的 `readHeavy` 为 9.81 vs 10.30 ms，方向
相反，进一步说明该窄差值不能作为稳定输赢。happy-dom 的跨相位总耗时样本波动超过
稳定性阈值，因此这里只把逐相位中位数作为证据；仍应在目标机器重跑基准确认。

同一次最终正式命令在 total 行记录的 pipeline-end、排空后 worker RSS 增量如下；
它包含整个多轮 worker 的驻留/JIT/GC 状态，不是单文档对象大小：

| 规模 | mad-dom RSS Δ | happy-dom RSS Δ |
| --- | ---: | ---: |
| 0.1× | +13.4 MB | +591.1 MB |
| 1× | +236.7 MB | +5,752.8 MB |
| 2× | +333.2 MB | +10,730.1 MB |

因此 warm traversal 的 memo/token 驻留收益没有脱离内存代价单独报告；完整 JSON 还
保留每相位的 peak/after 采样，可用 `--json` 在目标机器复核。

## 与 hdunit 的关系

本目录的 integration benchmark 与 hdunit（`tests/happy-dom/`，[ADR-0006](../adr/0006-happy-dom-unit-suite-hdunit.md)）
是**互补的两条验证线**，不互相替代：

| 维度 | integration benchmark（本目录） | hdunit（tests/happy-dom/） |
| --- | --- | --- |
| 套件来源 | happy-dom 的 `integration-test/` 子套件（少量、端到端：Fetch、XMLHttpRequest、WebSocket、Browser、窗口脚本求值） | happy-dom 的 `test/` 全量单测（298 个 `*.test.ts`，约 9.9 万行） |
| 运行方式 | 同一套测试跑两遍（mad-dom vs happy-dom），比对 wall-clock | 只跑 mad-dom 侧，逐文件 triage 终态 |
| 关注点 | **性能**（local 组：确定性 DOM 负载的中位耗时对比） | **正确性门禁**（每个 vendored 文件声明 enabled/skip/expected-fail 且不可退化） |
| 测试代码改动 | 拷来改 import（`happy-dom` → `mad-dom`）+ 少量运行适配 | 机械重写（vitest → bun:test + shim 路径），禁止手改断言 |
| 门禁 | CI `integration` job（`bun run test:integration`）+ `bench` job（`bun run bench:check` 对基线） | `compat:hdunit:validate`（validate job + `bun run validate` 链） |

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
