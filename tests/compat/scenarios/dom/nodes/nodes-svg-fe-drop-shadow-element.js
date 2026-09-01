// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-drop-shadow-element/SVGFEDropShadowElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEDropShadowElement constructor identity,
// the shared filter-primitive geometry (`height` / `width` / `x` / `y`, `in1` /
// `result`) and the `dx` / `dy` / `stdDeviationX` (default 2) / `stdDeviationY`
// (default 2) `SVGAnimatedNumber` reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeNumber } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-drop-shadow-element";
export const description = "real differential: SVGFEDropShadowElement identity + geometry/dx/dy/stdDeviation";
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
    const element = document.createElementNS(SVG_NS, "feDropShadow");
    observeInstanceof(api, window, element, "SVGFEDropShadowElement", "SVGElement");

    observeNumber(api, window, element, "dx", "dx");
    observeNumber(api, window, element, "dy", "dy");
    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeString(api, window, element, "result", "result");
    observeNumber(api, window, element, "stdDeviationX", "stdDeviationX", 2);
    observeNumber(api, window, element, "stdDeviationY", "stdDeviationY", 2);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
