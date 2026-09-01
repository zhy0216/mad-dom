// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-gaussian-blur-element/SVGFEGaussianBlurElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEGaussianBlurElement constructor identity,
// the shared filter-primitive geometry (`height` / `width` / `x` / `y`, `in1` /
// `result`), the `edgeMode` `SVGAnimatedEnumeration` reflection, the
// `stdDeviationX` / `stdDeviationY` (default 2) `SVGAnimatedNumber` reflections
// and the `setStdDeviation()` write. The `SVG_EDGEMODE_*` statics are read
// through `window.SVGFEGaussianBlurElement`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeNumber, observeEnumeration } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-gaussian-blur-element";
export const description = "real differential: SVGFEGaussianBlurElement identity + geometry/edgeMode/stdDeviation/setStdDeviation";
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
    const element = document.createElementNS(SVG_NS, "feGaussianBlur");
    observeInstanceof(api, window, element, "SVGFEGaussianBlurElement", "SVGElement");

    const edgeModeConstant = (keyword) => window.SVGFEGaussianBlurElement[`SVG_EDGEMODE_${keyword.toUpperCase()}`];
    observeEnumeration(api, window, element, "edgeMode", "edgeMode", ["duplicate", "wrap", "none"], "duplicate", edgeModeConstant);

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeString(api, window, element, "result", "result");
    observeNumber(api, window, element, "stdDeviationX", "stdDeviationX", 2);
    observeNumber(api, window, element, "stdDeviationY", "stdDeviationY", 2);

    element.setStdDeviation(10, 20);
    api.record.value("setStdDeviation-x", element.stdDeviationX.baseVal);
    api.record.value("setStdDeviation-y", element.stdDeviationY.baseVal);
    api.record.value("setStdDeviation-attr-x", element.getAttribute("stdDeviationX"));
    api.record.value("setStdDeviation-attr-y", element.getAttribute("stdDeviationY"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
