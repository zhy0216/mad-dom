# 06 差分移植波次 W6：nodes html 元素内部类

- 状态：待复核
- 优先级：P1
- 里程碑：W6
- 条目 ID：`D06`
- 依赖：D05
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W5–W8）

## 目标

nodes 104 个 `unmapped-internal-import` 文件按上游目录拆 4 波（W5–W8）。本波覆盖 **nodes html 元素**（22 个文件，多数为单个 HTML*Element 内部类测试，上游直接 `new HTMLInputElement(...)` 构造内部对象、断言内部属性）。等价公开面优先选：`document.createElement()` 构造 + 公开属性/方法反射（tagName、attribute 反射、公开 value 语义）。按共用移植协议（todos/README.md）1:1 移植为差分场景，id 如 `nodes-html-input-element`。

## 波次文件清单（22）

`nodes/html-anchor-element/HTMLAnchorElement.test.ts`、`nodes/html-area-element/HTMLAreaElement.test.ts`、`nodes/html-button-element/HTMLButtonElement.test.ts`、`nodes/html-canvas-element/HTMLCanvasElement.test.ts`、`nodes/html-element/HTMLElement.test.ts`、`nodes/html-form-element/HTMLFormElement.test.ts`、`nodes/html-iframe-element/HTMLIFrameElement.test.ts`、`nodes/html-input-element/HTMLInputElement.test.ts`、`nodes/html-input-element/HTMLInputElementDateUtility.test.ts`、`nodes/html-input-element/HTMLInputElementValueSanitizer.test.ts`、`nodes/html-link-element/HTMLLinkElement.test.ts`、`nodes/html-media-element/HTMLMediaElement.test.ts`、`nodes/html-object-element/HTMLObjectElement.test.ts`、`nodes/html-output-element/HTMLOutputElement.test.ts`、`nodes/html-script-element/HTMLScriptElement.test.ts`、`nodes/html-select-element/HTMLSelectElement.test.ts`、`nodes/html-table-cell-element/HTMLTableCellElement.test.ts`、`nodes/html-text-area-element/HTMLTextAreaElement.test.ts`、`nodes/html-track-element/HTMLTrackElement.test.ts`、`nodes/html-image-element/Image.test.ts`、`nodes/html-media-element/TextTrack.test.ts`、`nodes/html-media-element/TimeRanges.test.ts`

## 条目

- [x] **D06 — W6 nodes html 元素差分移植**
  - 实现：
    - 逐文件核实运行时导入；enum/type-only 排除（triage 不动，commit body 列明）；其余三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`。
    - `HTMLInputElementDateUtility`、`HTMLInputElementValueSanitizer`、`TextTrack`、`TimeRanges` 等是纯内部工具/内部类，公开面通常无法等价构造 → 大概率 B 档，如实判定；`HTMLCanvasElement` 若依赖真实渲染上下文归「不可差分」。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/nodes/<name>.js`）、逐场景对拍至双端一致、登记四件套。构造面用 `document.createElement`，观测面用公开属性/方法；上游直接断言内部槽位的部分舍去并注明。
  - 验收：
    - 本波清单内除 enum-only 排除项外，每文件 triage reason 为 `ported-to-diff` 或 `internal-only-no-public-surface`；
    - 每个 A 档场景双端一致，ledger diff 条目与场景一一对应，up 条目与 upstream-map 条目完备；
    - `npm run compat:ledger`、`npm run compat:hdunit:validate`、`npm run validate` 全绿；hdunit coverage 计数不变；
    - commit body 逐文件列明 A/B/enum-only 判定，B 档写明不满足哪一问。
  - 阻塞/回退：同 D01；双端不一致不许合入，修 facade/core 或缩小断言面。

## 预期改动

- `tests/compat/scenarios/dom/nodes/**`（新增场景文件）
- `compat/ledger.json`、`compat/upstream-map.json`
- `tests/happy-dom/triage/nodes.json`（本波清单条目）
- 修 facade/core（如对拍暴露差异）：`js/facade/**`、`crates/mad-dom-core/**` 及配套测试（`tests/bun/**`）

## 专属校验

- 逐场景对拍：`bun tests/compat/runner/run.js tests/compat/scenarios/dom/nodes/<path>`（双端一致，exit 0）
- `npm run compat:ledger`
- `npm run compat:hdunit:validate`、`npm run compat:hdunit:report`（计数口径核对）
- 每个新增 facade/core 修复的针对性测试
- `npm run validate`（仓库级）

## 边界

- 只动 `tests/happy-dom/triage/nodes.json` 中本波清单内的条目，不碰 W5/W7/W8 的 nodes 条目。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- 纯内部工具/内部槽位断言无公开等价面的直接 B 档，不写近似场景。
- 不 push、不创建 PR。
