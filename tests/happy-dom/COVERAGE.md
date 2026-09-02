# hdunit 覆盖总结（差分移植收尾基线）

本文件记录 hdunit 队列（T01–T12）收尾时的**最终通过率总结**，并在差分移植
（[计划 0002](../../plans/0002-hdunit-internal-to-differential-port.md) D01–D10）完成后
更新覆盖口径。所有数字由 `npm run compat:hdunit:report --json`（纯离线聚合，triage
分片为真相源）直接生成，**不美化**；与 `report-baseline.json` 记录的口径一致
（本次 delta 全 0）。

- 记录日期：2026-09-01（T11 基线）；2026-09-02（D11 差分移植收尾口径更新）
- 基线文件：`tests/happy-dom/report-baseline.json`（`compat:hdunit:report:baseline` 写入）
- 口径：文件数 = `rewrite-report.json` 的 `test-source` 文件数；通过率 = `enabled / total`（四舍五入取整）

## 总览

| 指标 | 数值 |
| --- | --- |
| test-source 文件总数 | 298 |
| `enabled`（实跑通过） | 68 |
| `expected-fail`（声明失败面） | 22 |
| `skip`（不运行，带 reason） | 208 |
| **enabled 通过率** | **23%** |
| 终态覆盖完整性 | 298 / 298（全量文件都有终态） |

即：**每 4 个 vendored 测试文件中有约 1 个可在 mad-dom 上实跑通过**；其余文件全部有
显式终态与 reason（无静默缺席）。

## 各子系统终态分布

数据源：`bun tests/happy-dom/report.mjs --json` 的 `bySubsystem`。`total` = 文件数，
`enabled` = 实跑通过数，`expected-fail` / `skip` = 已知缺口，`pass-rate` = enabled 占比。

| subsystem | total | enabled | expected-fail | skip | pass-rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| browser | 9 | 0 | 0 | 9 | 0% |
| canvas | 3 | 1 | 0 | 2 | 33% |
| clipboard | 1 | 1 | 0 | 0 | 100% |
| console | 2 | 2 | 0 | 0 | 100% |
| cookie | 2 | 0 | 0 | 2 | 0% |
| cookie-store | 1 | 0 | 0 | 1 | 0% |
| css | 20 | 3 | 0 | 17 | 15% |
| custom-element | 1 | 0 | 0 | 1 | 0% |
| dom | 8 | 3 | 0 | 5 | 38% |
| dom-implementation | 1 | 0 | 0 | 1 | 0% |
| dom-parser | 1 | 0 | 0 | 1 | 0% |
| event | 9 | 5 | 2 | 2 | 56% |
| fetch | 11 | 3 | 0 | 8 | 27% |
| file | 3 | 3 | 0 | 0 | 100% |
| form-data | 1 | 1 | 0 | 0 | 100% |
| history | 2 | 0 | 0 | 2 | 0% |
| html-parser | 2 | 0 | 0 | 2 | 0% |
| html-serializer | 1 | 0 | 0 | 1 | 0% |
| index | 1 | 0 | 0 | 1 | 0% |
| intersection-observer | 1 | 1 | 0 | 0 | 100% |
| javascript | 1 | 0 | 0 | 1 | 0% |
| location | 1 | 0 | 0 | 1 | 0% |
| match-media | 1 | 0 | 0 | 1 | 0% |
| module | 2 | 0 | 0 | 2 | 0% |
| mutation-observer | 1 | 1 | 0 | 0 | 100% |
| navigator | 1 | 0 | 0 | 1 | 0% |
| nodes | 165 | 42 | 19 | 104 | 25% |
| permissions | 1 | 0 | 0 | 1 | 0% |
| query-selector | 1 | 0 | 0 | 1 | 0% |
| range | 1 | 0 | 0 | 1 | 0% |
| screen | 2 | 0 | 0 | 2 | 0% |
| selection | 1 | 0 | 0 | 1 | 0% |
| storage | 1 | 0 | 0 | 1 | 0% |
| svg | 26 | 0 | 0 | 26 | 0% |
| tree-walker | 2 | 0 | 0 | 2 | 0% |
| url | 1 | 1 | 0 | 0 | 100% |
| utilities | 1 | 0 | 0 | 1 | 0% |
| validity-state | 1 | 1 | 0 | 0 | 100% |
| web-socket | 1 | 0 | 0 | 1 | 0% |
| window | 4 | 0 | 1 | 3 | 0% |
| xml-http-request | 1 | 0 | 0 | 1 | 0% |
| xml-parser | 1 | 0 | 0 | 1 | 0% |
| xml-serializer | 1 | 0 | 0 | 1 | 0% |
| **total** | **298** | **68** | **22** | **208** | **23%** |

体量上 `nodes`（165 文件）与 `svg`（26）、`css`（20）占绝对多数；`nodes` 已启用 42 个，
是后续波次的主要增益区。`svg` / `cookie` / `screen` / `window` 等零启用子系统多为
T02 未映射 `src/…` 路径或独立 facade 面，见下。

## known-gap 主要类别（skip + expected-fail = 230 文件）

按 triage 分片 `reason` 文本确定性归类：

| 类别 | 文件数 | 说明 |
| --- | ---: | --- |
| `ported-to-diff (hc-diff-<id>)` | 147 | 原 `unmapped-internal-import` 文件（A 档三问全满足）已 1:1 移植为差分场景（计划 0002 D01–D10，见 `tests/compat/scenarios/dom/` 与 `compat/ledger.json` 的 `hc-diff-*` 条目）；vendored 文件不可运行，hdunit 仍 `skip`，但理由从「内部耦合不可覆盖」改为「已由差分场景覆盖」——由 runner 对 happy-dom 当 oracle 机械对拍 |
| `internal-only-no-public-surface` | 38 | B 档（三问任一问不满足，计划 0002 §3）：公开面无等价构造/观测，已豁免；哪一问不满足、为何不可构造/不可观测/不可差分的理由逐项落在 triage reason |
| `unmapped-internal-import`（enum-only 排除，T12 机械路线） | 11 | 仅含 enum/type-only 内部导入（`internal-enum` / `internal-config`，含 `svg/SVGUnitTypes` 常量持有类），无内部实现模块运行时构造，**不属于本计划**（计划 0002 §2）；triage 原样保留、继续 `skip`，由 T12 机械路线启用 |
| facade-gap（缺 facade 绑定面） | 18 | 大表面：HTMLSerializer/DOMParser/XMLSerializer、Screen/ScreenDetails、DOMImplementation（HTMLDocument/XMLDocument）、browser 页面/iframe、表单/表格集合等 |
| PropertySymbol internal-slot（内部槽位在 facade 上不可表达） | 8 | T12 shim 已让 `PropertySymbol` 可解析，但 `element[PropertySymbol.buffer]` 这类内部槽位读写与 `new HTMLCollection(illegalConstructor, …)` 回调整体在 facade 上不可表达 |
| HTML 解析器空白节点保真差异 | 2 | `document.write` 输出与上游空白文本节点不一致（解析器保真度，T06/T09 边界） |
| adapter 匹配器缺口（`.instanceOf`） | 2 | bun:test `expect` 缺 vitest 的 `.instanceOf` 别名（表格用例） |
| File binding 缺口（T08 边界） | 2 | 用例构造 `new File(...)`，`shim/src/file/File.js` 仍为 gap shim |
| bun `spyOn` 对 Proxy 的拦截限制 | 1 | `Storage` 用例 12/14 通过，2 个 `vi.spyOn()` 无法拦截 Proxy 包裹实例 |
| 依赖未启用表面 | 1 | `BrowserContext` 依赖 console/cookie/timer 未实现面 |
| **合计** | **230** | = 22 expected-fail + 208 skip |

`expected-fail`（22 个）全部带 reason 声明失败面且不得长期滞留；波次收尾必须收敛为
`enabled` / `skip`。

**skip 计数口径保持原状**：`ported-to-diff` 与 `internal-only-no-public-surface` 文件
在 hdunit report 中仍计入 `skip`（vendored 文件不可运行），`skip` 计数与 D01 基线一致
（208，delta 全 0）；差分移植后的实际覆盖见 `tests/compat/scenarios/dom/`（180 个真实
对拍场景，`npm run compat:ledger` 强制 ledger diff 条目与场景文件一一对应）。

## 差分移植后的状态

- 计划 0002 差分移植（D01–D10）已完成：196 个原 `unmapped-internal-import` 文件全部有
  终态判定（`ported-to-diff` 147 / `internal-only-no-public-surface` 38 / enum-only 排除
  11），分布见上文 known-gap 表，与 `tests/happy-dom/triage/*.json` 逐一机械可核对。
- 基线点：本文件的数字就是 `report-baseline.json`（delta 全 0）。
- 复现本表：`bun tests/happy-dom/report.mjs --json`（数字不得与上表任何一行冲突）。
- 变更纪律：启用/重排 triage 后更新分片 + ledger 计数 + upstream-map，跑
  `npm run compat:hdunit:validate`（exit 0）与 `npm run compat:ledger`，再
  `npm run compat:hdunit:report:baseline` 记录新基线并把新数字同步回本文件。
