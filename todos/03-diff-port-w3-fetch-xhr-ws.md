# 03 差分移植波次 W3：fetch / xml-http-request / web-socket

- 状态：待办
- 优先级：P1
- 里程碑：W3
- 条目 ID：`D03`
- 依赖：D02
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W3）

## 目标

把 fetch（8）、xml-http-request（1）、web-socket（1）共 10 个 `unmapped-internal-import` skip 文件按共用移植协议（todos/README.md）1:1 移植为差分场景。计划预告 `web-socket` 可能整文件 B 档（宿主依赖 → 三问第 3 问「可差分」不满足）；`fetch/SyncFetch`、`fetch/ResourceFetch`、`FetchCORSUtility`、`ResponseCache*` 均直接构造网络相关内部对象，逐文件三问大概率判 B 档——**B 档是预期结果，如实落笔，不强行移植**。A 档场景必须只走公开 API（Request/Response/Headers/fetch 及 XMLHttpRequest 公开面），不触发真实网络。

## 波次文件清单（10）

| 文件 | 导入的内部模块 |
| --- | --- |
| `fetch/Fetch.test.ts` | fetch 内部 |
| `fetch/FetchCORSUtility.test.ts` | FetchCORSUtility.js |
| `fetch/Request.test.ts` | fetch 内部 |
| `fetch/ResourceFetch.test.ts` | ResourceFetch.js |
| `fetch/Response.test.ts` | fetch 内部 |
| `fetch/SyncFetch.test.ts` | SyncFetch.js |
| `fetch/cache/response/ResponseCache.test.ts` | ResponseCache.js |
| `fetch/cache/response/ResponseCacheFileSystem.test.ts` | 内部缓存实现 |
| `xml-http-request/XMLHttpRequest.test.ts` | xhr 内部 |
| `web-socket/WebSocket.test.ts` | WebSocket 内部 |

## 条目

- [ ] **D03 — W3 三子系统差分移植**
  - 实现：
    - 逐文件核实运行时导入；enum/type-only 排除（triage 不动，commit body 列明）；其余三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`——网络/文件系统/宿主依赖归「不可差分」。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/<subsystem>/<name>.js`，id `fetch-request`、`xml-http-request`、`web-socket` 等）、逐场景对拍至双端一致、登记四件套。A 档场景固定输入、无网络、无文件系统、无真实时间（如 Response 构造与属性读、Request 构造与公开属性、XMLHttpRequest 公开状态机）。
    - 三问判定以可观测性为第一门槛：内部缓存状态、CORS 决策、同步 fetch 的网络路径没有公开等价面，直接 B 档，不写「近似」场景。
  - 验收：
    - 本波清单内除 enum-only 排除项外，每文件 triage reason 为 `ported-to-diff` 或 `internal-only-no-public-surface`；
    - 每个 A 档场景双端一致，ledger diff 条目与场景一一对应，up 条目与 upstream-map 条目完备；
    - `npm run compat:ledger`、`npm run compat:hdunit:validate`、`npm run validate` 全绿；hdunit coverage 计数不变；
    - commit body 逐文件列明 A/B/enum-only 判定，B 档写明不满足哪一问。
  - 阻塞/回退：同 D01；双端不一致不许合入，修 facade/core 或缩小断言面。

## 预期改动

- `tests/compat/scenarios/dom/{fetch,xml-http-request,web-socket}/**`（新增场景文件）
- `compat/ledger.json`、`compat/upstream-map.json`
- `tests/happy-dom/triage/{fetch,xml-http-request,web-socket}.json`
- 修 facade/core（如对拍暴露差异）：`js/facade/**`、`crates/mad-dom-core/**` 及配套测试（`tests/bun/**`）

## 专属校验

- 逐场景对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/<path>`（双端一致，exit 0）
- `npm run compat:ledger`
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`（计数口径核对）
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 只动本波 3 个子系统；不碰其他子系统 triage 分片与场景目录。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- A 档场景不得触发真实网络/文件系统/真实时间；无公开等价面的内部网络路径一律 B 档。
- 不 push、不创建 PR。
