// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-pattern-element/SVGPatternElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGPatternElement constructor identity, the
// `href` `SVGAnimatedString`, the `patternUnits` / `patternContentUnits`
// `SVGAnimatedEnumeration`, the `patternTransform` `SVGAnimatedTransformList`
// and the shared geometry `SVGAnimatedLength` reflections. The upstream
// `SVGTransformTypeEnum` constants are recorded as the numeric `type` values
// and the write-back transform is minted through the public
// `createSVGTransform()`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeInstanceof,
  observeLength,
  observeString,
  observeTransformList,
  observeUnitEnumeration,
} from "./_svg-helpers.js";

export const id = "nodes-svg-pattern-element";
export const description = "real differential: SVGPatternElement identity + href/patternUnits/patternContentUnits/patternTransform/geometry";
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
    const element = document.createElementNS(SVG_NS, "pattern");
    observeInstanceof(api, window, element, "SVGPatternElement", "SVGElement");

    observeString(api, window, element, "href", "href");
    observeUnitEnumeration(api, window, element, "patternUnits", "patternUnits", "objectBoundingBox");
    observeUnitEnumeration(api, window, element, "patternContentUnits", "patternContentUnits", "userSpaceOnUse");
    observeTransformList(api, window, element, "patternTransform", "patternTransform");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
