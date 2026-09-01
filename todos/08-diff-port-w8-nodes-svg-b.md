# 08 差分移植波次 W8：nodes svg 元素内部类（SVGFilter*–SVGView*）

- 状态：待办
- 优先级：P1
- 里程碑：W8
- 条目 ID：`D08`
- 依赖：D07
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W5–W8）

## 目标

nodes 104 个 `unmapped-internal-import` 文件按上游目录拆 4 波（W5–W8）。本波覆盖 **nodes svg 元素内部类** 字母序后半段（SVGFilterElement – SVGViewElement，33 个文件），按共用移植协议（todos/README.md）1:1 移植为差分场景。与 W7 同构：等价公开面 `document.createElementNS('http://www.w3.org/2000/svg', <tag>)` + 公开属性反射，同族判定面合并。id 如 `nodes-svg-filter-element`。

## 波次文件清单（33）

`nodes/svg-filter-element/SVGFilterElement.test.ts`、`nodes/svg-foreign-object-element/SVGForeignObjectElement.test.ts`、`nodes/svg-g-element/SVGGElement.test.ts`、`nodes/svg-geometry-element/SVGGeometryElement.test.ts`、`nodes/svg-gradient-element/SVGGradientElement.test.ts`、`nodes/svg-graphics-element/SVGGraphicsElement.test.ts`、`nodes/svg-image-element/SVGImageElement.test.ts`、`nodes/svg-line-element/SVGLineElement.test.ts`、`nodes/svg-linear-gradient-element/SVGLinearGradientElement.test.ts`、`nodes/svg-m-path-element/SVGMPathElement.test.ts`、`nodes/svg-marker-element/SVGMarkerElement.test.ts`、`nodes/svg-mask-element/SVGMaskElement.test.ts`、`nodes/svg-metadata-element/SVGMetadataElement.test.ts`、`nodes/svg-path-element/SVGPathElement.test.ts`、`nodes/svg-pattern-element/SVGPatternElement.test.ts`、`nodes/svg-polygon-element/SVGPolygonElement.test.ts`、`nodes/svg-polyline-element/SVGPolylineElement.test.ts`、`nodes/svg-radial-gradient-element/SVGRadialGradientElement.test.ts`、`nodes/svg-rect-element/SVGRectElement.test.ts`、`nodes/svg-svg-element/SVGSVGElement.test.ts`、`nodes/svg-script-element/SVGScriptElement.test.ts`、`nodes/svg-set-element/SVGSetElement.test.ts`、`nodes/svg-stop-element/SVGStopElement.test.ts`、`nodes/svg-style-element/SVGStyleElement.test.ts`、`nodes/svg-switch-element/SVGSwitchElement.test.ts`、`nodes/svg-symbol-element/SVGSymbolElement.test.ts`、`nodes/svg-t-span-element/SVGTSpanElement.test.ts`、`nodes/svg-text-content-element/SVGTextContentElement.test.ts`、`nodes/svg-text-element/SVGTextElement.test.ts`、`nodes/svg-text-positioning-element/SVGTextPositioningElement.test.ts`、`nodes/svg-title-element/SVGTitleElement.test.ts`、`nodes/svg-use-element/SVGUseElement.test.ts`、`nodes/svg-view-element/SVGViewElement.test.ts`

## 条目

- [ ] **D08 — W8 nodes svg 元素（后半）差分移植**
  - 实现：
    - 逐文件核实运行时导入；enum/type-only 排除（triage 不动，commit body 列明）；其余三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`。
    - 与 W7 同族判定模板保持一致（同族 svg 元素类的公开面等价写法、舍弃面说明不应在两个波次间漂移）。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/nodes/<name>.js`）、逐场景对拍至双端一致、登记四件套。
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

- 只动 `tests/happy-dom/triage/nodes.json` 中本波清单内的条目，不碰 W5/W6/W7 的 nodes 条目。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- 纯内部槽位断言无公开等价面的直接 B 档，不写近似场景。
- 不 push、不创建 PR。
