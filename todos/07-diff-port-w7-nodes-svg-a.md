# 07 差分移植波次 W7：nodes svg 元素内部类（SVGAnimate*–SVGFETurbulence*）

- 状态：待办
- 优先级：P1
- 里程碑：W7
- 条目 ID：`D07`
- 依赖：D06
- 来源：[plans/0002-hdunit-internal-to-differential-port.md](../../plans/0002-hdunit-internal-to-differential-port.md)（§6 W5–W8）

## 目标

nodes 104 个 `unmapped-internal-import` 文件按上游目录拆 4 波（W5–W8）。本波覆盖 **nodes svg 元素内部类** 字母序前半段（SVGAnimateElement – SVGFETurbulenceElement，36 个文件），按共用移植协议（todos/README.md）1:1 移植为差分场景。这类上游测试多为「内部构造 + tagName/属性反射断言」，等价公开面：`document.createElementNS('http://www.w3.org/2000/svg', <tag>)` + 公开属性反射，判定面高度合并（计划 §6 W9 注同样适用）。id 如 `nodes-svg-animate-element`。

## 波次文件清单（36）

`nodes/svg-animate-element/SVGAnimateElement.test.ts`、`nodes/svg-animate-motion-element/SVGAnimateMotionElement.test.ts`、`nodes/svg-animate-transform-element/SVGAnimateTransformElement.test.ts`、`nodes/svg-animation-element/SVGAnimationElement.test.ts`、`nodes/svg-circle-element/SVGCircleElement.test.ts`、`nodes/svg-clip-path-element/SVGClipPathElement.test.ts`、`nodes/svg-component-transfer-function-element/SVGComponentTransferFunctionElement.test.ts`、`nodes/svg-defs-element/SVGDefsElement.test.ts`、`nodes/svg-desc-element/SVGDescElement.test.ts`、`nodes/svg-element/SVGElement.test.ts`、`nodes/svg-ellipse-element/SVGEllipseElement.test.ts`、`nodes/svg-fe-blend-element/SVGFEBlendElement.test.ts`、`nodes/svg-fe-color-matrix-element/SVGFEColorMatrixElement.test.ts`、`nodes/svg-fe-component-transfer-element/SVGFEComponentTransferElement.test.ts`、`nodes/svg-fe-composite-element/SVGFECompositeElement.test.ts`、`nodes/svg-fe-convolve-matrix-element/SVGFEConvolveMatrixElement.test.ts`、`nodes/svg-fe-diffuse-lighting-element/SVGFEDiffuseLightingElement.test.ts`、`nodes/svg-fe-displacement-map-element/SVGFEDisplacementMapElement.test.ts`、`nodes/svg-fe-distant-light-element/SVGFEDistantLightElement.test.ts`、`nodes/svg-fe-drop-shadow-element/SVGFEDropShadowElement.test.ts`、`nodes/svg-fe-flood-element/SVGFEFloodElement.test.ts`、`nodes/svg-fe-func-a-element/SVGFEFuncAElement.test.ts`、`nodes/svg-fe-func-b-element/SVGFEFuncBElement.test.ts`、`nodes/svg-fe-func-g-element/SVGFEFuncGElement.test.ts`、`nodes/svg-fe-func-r-element/SVGFEFuncRElement.test.ts`、`nodes/svg-fe-gaussian-blur-element/SVGFEGaussianBlurElement.test.ts`、`nodes/svg-fe-image-element/SVGFEImageElement.test.ts`、`nodes/svg-fe-merge-element/SVGFEMergeElement.test.ts`、`nodes/svg-fe-merge-node-element/SVGFEMergeNodeElement.test.ts`、`nodes/svg-fe-morphology-element/SVGFEMorphologyElement.test.ts`、`nodes/svg-fe-offset-element/SVGFEOffsetElement.test.ts`、`nodes/svg-fe-point-light-element/SVGFEPointLightElement.test.ts`、`nodes/svg-fe-specular-lighting-element/SVGFESpecularLightingElement.test.ts`、`nodes/svg-fe-spot-light-element/SVGFESpotLightElement.test.ts`、`nodes/svg-fe-tile-element/SVGFETileElement.test.ts`、`nodes/svg-fe-turbulence-element/SVGFETurbulenceElement.test.ts`

## 条目

- [ ] **D07 — W7 nodes svg 元素（前半）差分移植**
  - 实现：
    - 逐文件核实运行时导入；enum/type-only 排除（triage 不动，commit body 列明）；其余三问 A/B 判定，B 档 reason `internal-only-no-public-surface (哪一问: 简述)`。
    - 同类元素（如 SVGFE* 滤镜族）判定面合并：先看 1–2 个代表文件确定公开面等价写法与舍弃面，同族文件套用同一判定模板；每个文件的 A/B 结论仍逐项落笔。
    - A 档按 README 共用协议写场景（`tests/compat/scenarios/dom/nodes/<name>.js`）、逐场景对拍至双端一致、登记四件套。构造面用 `createElementNS`，观测面用公开属性（tagName、namespaceURI、反射属性）；上游断言内部实现细节、公开面无法区分的舍去并注明。
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

- 只动 `tests/happy-dom/triage/nodes.json` 中本波清单内的条目，不碰 W5/W6/W8 的 nodes 条目。
- 不手改 `tests/happy-dom/rewritten/**` 与 `tests/happy-dom/vendor/**`（triage json 的 reason 字段除外）。
- 纯内部槽位断言无公开等价面的直接 B 档，不写近似场景。
- 不 push、不创建 PR。
