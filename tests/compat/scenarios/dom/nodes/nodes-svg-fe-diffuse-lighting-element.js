// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-diffuse-lighting-element/SVGFEDiffuseLightingElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEDiffuseLightingElement constructor
// identity, the shared filter-primitive geometry (`height` / `width` / `x` /
// `y`, `in1` / `result`) and the `diffuseConstant` / `kernelUnitLengthX` /
// `kernelUnitLengthY` / `surfaceScale` `SVGAnimatedNumber` reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeNumber } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-diffuse-lighting-element";
export const description = "real differential: SVGFEDiffuseLightingElement identity + geometry/diffuseConstant/kernelUnitLength/surfaceScale";
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
    const element = document.createElementNS(SVG_NS, "feDiffuseLighting");
    observeInstanceof(api, window, element, "SVGFEDiffuseLightingElement", "SVGElement");

    observeNumber(api, window, element, "diffuseConstant", "diffuseConstant");
    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeNumber(api, window, element, "kernelUnitLengthX", "kernelUnitLengthX");
    observeNumber(api, window, element, "kernelUnitLengthY", "kernelUnitLengthY");
    observeString(api, window, element, "result", "result");
    observeNumber(api, window, element, "surfaceScale", "surfaceScale");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
