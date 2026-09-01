// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-filter-element/SVGFilterElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFilterElement constructor identity, the
// `href` `SVGAnimatedString`, the `filterUnits` / `primitiveUnits`
// `SVGAnimatedEnumeration` (default `userSpaceOnUse`) and the shared
// `height` / `width` / `x` / `y` `SVGAnimatedLength` reflections. The
// upstream `SVGLength.SVG_LENGTHTYPE_*` constants are read through the public
// `window.SVGLength` statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeInstanceof,
  observeLength,
  observeString,
  observeUnitEnumeration,
} from "./_svg-helpers.js";

export const id = "nodes-svg-filter-element";
export const description = "real differential: SVGFilterElement identity + href/filterUnits/primitiveUnits/geometry";
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
    const element = document.createElementNS(SVG_NS, "filter");
    observeInstanceof(api, window, element, "SVGFilterElement", "SVGElement");

    observeString(api, window, element, "href", "href");
    observeUnitEnumeration(api, window, element, "filterUnits", "filterUnits", "userSpaceOnUse");
    observeUnitEnumeration(api, window, element, "primitiveUnits", "primitiveUnits", "userSpaceOnUse");
    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
