// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-line-element/SVGLineElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGLineElement constructor identity (with
// SVGGeometryElement) and the `x1` / `y1` / `x2` / `y2` `SVGAnimatedLength`
// reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength } from "./_svg-helpers.js";

export const id = "nodes-svg-line-element";
export const description = "real differential: SVGLineElement identity + x1/y1/x2/y2 SVGAnimatedLength";
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
    const element = document.createElementNS(SVG_NS, "line");
    observeInstanceof(api, window, element, "SVGLineElement", "SVGGeometryElement");
    observeLength(api, window, element, "x1", "x1");
    observeLength(api, window, element, "y1", "y1");
    observeLength(api, window, element, "x2", "x2");
    observeLength(api, window, element, "y2", "y2");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
