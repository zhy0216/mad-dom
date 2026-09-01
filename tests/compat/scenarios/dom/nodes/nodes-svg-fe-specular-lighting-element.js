// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-specular-lighting-element/SVGFESpecularLightingElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFESpecularLightingElement constructor
// identity, the shared filter-primitive geometry (`height` / `width` / `x` /
// `y`, `in1` / `result`) and the `kernelUnitLengthX` / `kernelUnitLengthY` /
// `specularConstant` (1) / `specularExponent` (1) / `surfaceScale` (1)
// `SVGAnimatedNumber` reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeNumber } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-specular-lighting-element";
export const description = "real differential: SVGFESpecularLightingElement identity + full number surface";
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
    const element = document.createElementNS(SVG_NS, "feSpecularLighting");
    observeInstanceof(api, window, element, "SVGFESpecularLightingElement", "SVGElement");

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeNumber(api, window, element, "kernelUnitLengthX", "kernelUnitLengthX");
    observeNumber(api, window, element, "kernelUnitLengthY", "kernelUnitLengthY");
    observeString(api, window, element, "result", "result");
    observeNumber(api, window, element, "specularConstant", "specularConstant", 1);
    observeNumber(api, window, element, "specularExponent", "specularExponent", 1);
    observeNumber(api, window, element, "surfaceScale", "surfaceScale", 1);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
