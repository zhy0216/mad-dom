// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-component-transfer-function-element/SVGComponentTransferFunctionElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGComponentTransferFunctionElement
// constructor identity and the `type` / `tableValues` / `slope` / `intercept` /
// `amplitude` / `exponent` / `offset` reflections (`SVGAnimatedEnumeration`,
// `SVGAnimatedNumberList`, `SVGAnimatedNumber`). The upstream
// `new window.SVGNumber(…)` appendItem
// assertion is dropped: `SVGNumber` has no public constructor, so it is not
// reproducible via the public surface (plan §4). The `SVG_FECOMPONENTTRANSFER_*`
// constants are read through the public `window.SVGComponentTransferFunctionElement`
// statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeEnumeration, observeNumber, observeNumberList } from "./_svg-helpers.js";

export const id = "nodes-svg-component-transfer-function-element";
export const description = "real differential: SVGComponentTransferFunctionElement identity + type/tableValues/slope/intercept/amplitude/exponent/offset";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const element = document.createElementNS(SVG_NS, "feFuncA");
    observeInstanceof(api, window, element, "SVGComponentTransferFunctionElement", "SVGElement");

    const typeConstant = (keyword) =>
      window.SVGComponentTransferFunctionElement[`SVG_FECOMPONENTTRANSFER_TYPE_${keyword.toUpperCase()}`];
    observeEnumeration(api, window, element, "type", "type", ["identity", "table", "discrete", "linear", "gamma"], "identity", typeConstant);

    observeNumberList(api, window, element, "tableValues", "tableValues");

    observeNumber(api, window, element, "slope", "slope", 1);
    observeNumber(api, window, element, "intercept", "intercept", 0);
    observeNumber(api, window, element, "amplitude", "amplitude", 1);
    observeNumber(api, window, element, "exponent", "exponent", 1);
    observeNumber(api, window, element, "offset", "offset", 0);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
