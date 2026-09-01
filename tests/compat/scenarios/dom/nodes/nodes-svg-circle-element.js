// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-circle-element/SVGCircleElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGCircleElement constructor identity and the
// `cx` / `cy` / `r` `SVGAnimatedLength` attribute reflections (unitType /
// valueAsString / valueInSpecifiedUnits, `newValueSpecifiedUnits` write-back and
// the read-only `animVal`). The upstream `SVGLength.SVG_LENGTHTYPE_*` internal
// constants are read through the public `window.SVGLength` statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength } from "./_svg-helpers.js";

export const id = "nodes-svg-circle-element";
export const description = "real differential: SVGCircleElement identity + cx/cy/r SVGAnimatedLength reflection";
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
    const element = document.createElementNS(SVG_NS, "circle");
    observeInstanceof(api, window, element, "SVGCircleElement", "SVGGeometryElement");
    observeLength(api, window, element, "cx", "cx");
    observeLength(api, window, element, "cy", "cy");
    observeLength(api, window, element, "r", "r");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
