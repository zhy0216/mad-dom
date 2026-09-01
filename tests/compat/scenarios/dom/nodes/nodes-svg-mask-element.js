// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-mask-element/SVGMaskElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGMaskElement constructor identity, the
// `maskUnits` / `maskContentUnits` `SVGAnimatedEnumeration` reflections
// (default `userSpaceOnUse`) and the shared `width` / `height` / `x` / `y`
// `SVGAnimatedLength` reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeInstanceof,
  observeLength,
  observeUnitEnumeration,
} from "./_svg-helpers.js";

export const id = "nodes-svg-mask-element";
export const description = "real differential: SVGMaskElement identity + maskUnits/maskContentUnits + geometry";
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
    const element = document.createElementNS(SVG_NS, "mask");
    observeInstanceof(api, window, element, "SVGMaskElement", "SVGElement");

    observeUnitEnumeration(api, window, element, "maskUnits", "maskUnits", "userSpaceOnUse");
    observeUnitEnumeration(api, window, element, "maskContentUnits", "maskContentUnits", "userSpaceOnUse");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
