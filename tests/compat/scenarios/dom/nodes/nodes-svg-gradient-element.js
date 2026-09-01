// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-gradient-element/SVGGradientElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGGradientElement constructor identity (on
// a `linearGradient`), the `href` `SVGAnimatedString`, the `gradientUnits`
// `SVGAnimatedEnumeration` (default `objectBoundingBox`), the
// `gradientTransform` `SVGAnimatedTransformList` and the `spreadMethod`
// `SVGAnimatedEnumeration` across all keywords. The upstream internal
// `SVGTransformTypeEnum` constants are recorded as the numeric `type`
// values; the write-back path mints the transform through the public
// `createSVGTransform()`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeEnumeration,
  observeInstanceof,
  observeString,
  observeTransformList,
  observeUnitEnumeration,
} from "./_svg-helpers.js";

export const id = "nodes-svg-gradient-element";
export const description = "real differential: SVGGradientElement identity + href/gradientUnits/gradientTransform/spreadMethod";
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
    const element = document.createElementNS(SVG_NS, "linearGradient");
    observeInstanceof(api, window, element, "SVGGradientElement", "SVGGraphicsElement");

    observeString(api, window, element, "href", "href");
    observeUnitEnumeration(api, window, element, "gradientUnits", "gradientUnits", "objectBoundingBox");
    observeTransformList(api, window, element, "gradientTransform", "gradientTransform");

    const spreadMethodValues = ["pad", "reflect", "repeat"];
    observeEnumeration(
      api,
      window,
      element,
      "spreadMethod",
      "spreadMethod",
      spreadMethodValues,
      "pad",
      (value) => window.SVGGradientElement[`SVG_SPREADMETHOD_${value.toUpperCase()}`],
    );
  } catch (error) {
    api.record.error(error, "facade");
  }
}
