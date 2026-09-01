// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-blend-element/SVGFEBlendElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEBlendElement constructor identity, the
// filter-primitive geometry (`height` / `width` / `x` / `y` as
// `SVGAnimatedLength`, `in1` / `in2` as `SVGAnimatedString`), and the `mode`
// `SVGAnimatedEnumeration` reflection across every blend keyword. The upstream
// `SVG_FEBLEND_MODE_*` static constants are read through the public
// `window.SVGFEBlendElement` statics. (happy-dom's `SVGFEBlendElement` exposes
// no `result` member, so the shared filter-primitive `result` reflection is not
// part of this scenario's surface.)
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeEnumeration } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-blend-element";
export const description = "real differential: SVGFEBlendElement identity + geometry/in1/in2 + mode enumeration";
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
    const element = document.createElementNS(SVG_NS, "feBlend");
    observeInstanceof(api, window, element, "SVGFEBlendElement", "SVGElement");

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeString(api, window, element, "in2", "in2");

    const modeConstant = (keyword) =>
      window.SVGFEBlendElement[`SVG_FEBLEND_MODE_${keyword.toUpperCase().replace(/-/g, "_")}`];
    observeEnumeration(
      api,
      window,
      element,
      "mode",
      "mode",
      ["normal", "multiply", "screen", "darken", "lighten", "overlay", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"],
      "normal",
      modeConstant,
    );
  } catch (error) {
    api.record.error(error, "facade");
  }
}
