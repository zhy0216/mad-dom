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
bun benchmark/dom-bench/run.mjs            # 对比表
bun benchmark/dom-bench/run.mjs --json     # JSON
bun benchmark/dom-bench/run.mjs --runs 7   # 每阶段计量轮数（默认 5）
```

worker（`dom-bench/worker.mjs`）对两个引擎跑同一份确定性负载，共五个阶段，各自
独立计量（warmup 不计，取中位数）：

| 阶段 | 负载 |
| --- | --- |
| `parse` | `document.write` 一份生成的 ~10k 元素 / ~320 KB 页面（每次全新 window） |
| `build` | 20k 节点的 `createElement` + `setAttribute` + `appendChild` 建树 |
| `query` | `querySelectorAll` 类 / 复合选择器 + `querySelector` id + `getElementsByTagName` |
| `serialize` | `body.innerHTML` 全量读取 |
| `traverse` | `firstChild` / `nextSibling` 全树遍历 |

方法学要点：

- 两引擎跑在各自独立的 `bun` 子进程，负载与断言值（元素数、查询命中数、序列化
  字节数、遍历节点数）完全一致后才视为有效对比（worker 输出 `sink` 供核对）。
- 每个计量轮之间强制 `Bun.gc(true)` + 排空事件循环（在计量窗口之外，两引擎同样
  付出）。这是必需的：Bun 把 Node-API finalizer 推迟到下一事件循环轮，若不排空，
  mad-dom 的弱 wrapper 缓存在同步 churn 下会累积"已回收未 finalize"的陈旧条目，
  后续节点读取会返回 `undefined` 或在数组转换时报 `InvalidArg`
  （见 `crates/mad-dom-bun/src/handle.rs` 的 "transient gap" 注释）。
- 出于同一原因，`build` 阶段用 JS 计数器而不是 `root.childNodes.length` 收尾：
  对数千子节点的 `childNodes` 快照读取在该缺口窗口内会直接崩溃。该缺口是一个
  独立的正确性问题，不改变本基准的计量公平性。

### traverse 阶段剖析

traverse 是 mad-dom 唯一显著落后的阶段（~21 ms vs happy-dom ~2.8 ms）。
2026-09-04 用同负载（18,102 节点，~36k 次边读取）做了分层测量：

| 场景 | 耗时 |
| --- | --- |
| facade 全树 `firstChild`/`nextSibling` 遍历（冷，每轮 gc+排空） | ~20.5 ms |
| 同一负载的 `TreeWalker.nextNode` 遍历（冷，正确驱逐后） | ~18–20 ms |
| 仅 native handle 遍历（绕过 facade，冷） | ~15.1 ms |
| facade 遍历，所有 wrapper 被 JS 侧持有（纯缓存命中） | ~8.3 ms |
| 仅 native handle 遍历，wrapper 全部持有（纯缓存命中） | ~6.5 ms |

结论：**瓶颈是每个节点的 wrapper 铸造，不是遍历写法，也不是 Rust 树链查询。**

- 缓存命中时每条边 ≈ 0.2 µs（N-API 往返 + 一次引用探测的下限），36k 条边
  ≈ 6.5–8.3 ms——这已经是 happy-dom 全阶段（2.8 ms，纯 JS 属性读取）的
  ~2.8 倍。朴素 getter 遍历对任何 native-backed DOM 都是结构性劣势。
- 冷路径每个节点额外 ~1 µs：native 侧 `napi_new_instance` + wrap +
  create_reference（~0.5 µs），facade 侧再付一次 `wrapperKind()` FFI
  （含 nodeName/namespace 两个 JS 字符串分配，0.30 µs；对比单读
  `nodeType()` 只要 0.12 µs）+ facade wrapper 对象与两级 WeakMap 登记。
  createElement 密集的 build 阶段为同一原因偏慢（20k 次 mint）。
- **测量坑**：若在 `Bun.gc(true)` 后不排空事件循环就直接测，Bun 推迟执行的
  finalizer 会让缓存里留下"已回收未 finalize"条目、堆也没清扫，此时
  TreeWalker 会虚快到 ~5 ms，容易得出"换 TreeWalker 就能省 4 倍"的错误结论。
  正确驱逐后递归/迭代/TreeWalker 三种写法的成本一致。dom-bench 的
  collectAndDrain 正是为了避开这个 artifact。

未来若要压缩这个阶段，起点是上面的分层数字：可动的杠杆是让节点分类信息
（nodeType/nodeName/namespace）随 mint 一并产出、省掉 facade 侧逐节点的
分类 FFI，上限约 15–25%；再往下就是弱缓存身份语义（T20）与 N-API 往返本身，
属于会改变 benchmark 含义的架构改动。

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
