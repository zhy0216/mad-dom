// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-text-positioning-element/SVGTextPositioningElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGTextPositioningElement surface observed
// through a `text` element: the `x` / `y` / `dx` / `dy`
// `SVGAnimatedLengthList` reflections (with per-segment
// `newValueSpecifiedUnits` write-back) and the `rotate` `SVGAnimatedNumberList`
// reflection. The upstream `SVGLength.SVG_LENGTHTYPE_*` constants are read
// through the public `window.SVGLength` statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeLengthList,
  observeRotateList,
} from "./_svg-helpers.js";

export const id = "nodes-svg-text-positioning-element";
export const description = "real differential: SVGTextPositioningElement x/y/dx/dy length lists + rotate number list";
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
    const element = document.createElementNS(SVG_NS, "text");
    observeLengthList(api, window, element, "x", "x");
    observeLengthList(api, window, element, "y", "y");
    observeLengthList(api, window, element, "dx", "dx");
    observeLengthList(api, window, element, "dy", "dy");
    observeRotateList(api, window, element);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
