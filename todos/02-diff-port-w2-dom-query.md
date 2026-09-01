# 02 差分移植波次 W2：dom / query-selector / range / selection / utilities

- 状态：待复核
- 优先级：P1
- 里程碑：W2
- 条目 ID：`D02`
- 依赖：D01
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W2）

## 目标

把 dom（5）、query-selector（1）、range（1）、selection（1）、utilities（1）共 9 个 `unmapped-internal-import` skip 文件按共用移植协议（todos/README.md）1:1 移植为差分场景。dom 子系统的场景目录是 `scenarios/dom/dom/`，id 形如 `dom-dom-token-list`（subsystem `dom` + basename `DOMTokenList`），与既有扁平场景（`dom-attributes` 等）无冲突——写第一个场景时先确认 runner 无重复 id 报错。

## 波次文件清单（9）

| 文件 | 导入的内部模块 |
| --- | --- |
| `dom/DOMPointReadOnly.test.ts` | dom 内部 |
| `dom/DOMRectList.test.ts` | dom 内部 |
| `dom/DOMTokenList.test.ts` | dom 内部 |
| `dom/dom-matrix/DOMMatrix.test.ts` | dom-matrix 内部 |
| `dom/dom-matrix/DOMMatrixReadOnly.test.ts` | dom-matrix 内部 |
| `query-selector/QuerySelector.test.ts` | query-selector 内部 |
| `range/Range.test.ts` | range 内部 |
| `selection/Selection.test.ts` | selection 内部 |
| `utilities/StringUtility.test.ts` | utilities 内部 |

## 条目

- [ ] **D02 — W2 五子系统差分移植**
  - 实现：
    - 逐文件核实运行时导入（读 `tests/happy-dom/rewritten/<file>`）：enum/type-only 按排除处理（triage 不动，commit body 列明）；其余按三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/<subsystem>/<name>.js`）、逐场景对拍至双端一致、登记四件套（ledger diff / upstream-map / ledger up / triage reason `ported-to-diff (hc-diff-<id>)`）。id 规则：`<subsystem>-<basename>`（kebab），如 `query-selector`、`range`、`selection`、`string-utility`。
    - 注意 `selection/Selection.test.ts` 与 `range/Range.test.ts`：上游大量断言依赖内部状态，若公开面读不出（如内部选择锚点对象）该断言面舍去或整文件降 B 档，按三问逐项落笔。
  - 验收：
    - 本波清单内除 enum-only 排除项外，每文件 triage reason 为 `ported-to-diff` 或 `internal-only-no-public-surface`；
    - 每个 A 档场景双端一致，ledger diff 条目与场景一一对应，up 条目与 upstream-map 条目完备；
    - `npm run compat:ledger`、`npm run compat:hdunit:validate`、`npm run validate` 全绿；hdunit coverage 计数不变；
    - commit body 逐文件列明 A/B/enum-only 判定。
  - 阻塞/回退：同 D01；双端不一致不许合入，修 facade/core 或缩小断言面。

## 预期改动

- `tests/compat/scenarios/dom/{dom,query-selector,range,selection,utilities}/**`（新增场景文件）
- `compat/ledger.json`、`compat/upstream-map.json`
- `tests/happy-dom/triage/{dom,query-selector,range,selection,utilities}.json`
- 修 facade/core（如对拍暴露差异）：`js/facade/**`、`crates/mad-dom-core/**` 及配套测试（`tests/bun/**`）

## 专属校验

- 逐场景对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/<path>`（双端一致，exit 0）
- `npm run compat:ledger`
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`（计数口径核对）
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 只动本波 5 个子系统；不碰其他子系统 triage 分片与场景目录。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- enum-only 文件不移植、不改 triage；facade-gap 文件不在本计划。
- 不 push、不创建 PR。
