// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-convolve-matrix-element/SVGFEConvolveMatrixElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEConvolveMatrixElement constructor
// identity, the shared filter-primitive geometry (`height` / `width` / `x` /
// `y`, `in1` / `result`), and the `bias` / `divisor` / `kernelUnitLengthX` /
// `kernelUnitLengthY` (`SVGAnimatedNumber`), `edgeMode`
// (`SVGAnimatedEnumeration`), `kernelMatrix` (`SVGAnimatedNumberList`),
// `orderX` / `orderY` / `targetX` / `targetY` (`SVGAnimatedInteger`) and
// `preserveAlpha` (`SVGAnimatedBoolean`) reflections. The upstream
// `new window.SVGNumber(…)` appendItem
// assertion is dropped (`SVGNumber` has no public constructor). The
// `SVG_EDGEMODE_*` statics are read through `window.SVGFEConvolveMatrixElement`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeNumber, observeInteger, observeBoolean, observeEnumeration, observeNumberList } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-convolve-matrix-element";
export const description = "real differential: SVGFEConvolveMatrixElement identity + full reflection surface";
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
    const element = document.createElementNS(SVG_NS, "feConvolveMatrix");
    observeInstanceof(api, window, element, "SVGFEConvolveMatrixElement", "SVGElement");

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeString(api, window, element, "result", "result");

    observeNumber(api, window, element, "bias", "bias");
    observeNumber(api, window, element, "divisor", "divisor");
    const edgeModeConstant = (keyword) => window.SVGFEConvolveMatrixElement[`SVG_EDGEMODE_${keyword.toUpperCase()}`];
    observeEnumeration(api, window, element, "edgeMode", "edgeMode", ["duplicate", "wrap", "none"], "duplicate", edgeModeConstant);
    observeNumberList(api, window, element, "kernelMatrix", "kernelMatrix");
    observeNumber(api, window, element, "kernelUnitLengthX", "kernelUnitLengthX");
    observeNumber(api, window, element, "kernelUnitLengthY", "kernelUnitLengthY");
    observeInteger(api, window, element, "orderX", "orderX");
    observeInteger(api, window, element, "orderY", "orderY");
    observeBoolean(api, window, element, "preserveAlpha", "preserveAlpha");
    observeInteger(api, window, element, "targetX", "targetX");
    observeInteger(api, window, element, "targetY", "targetY");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
