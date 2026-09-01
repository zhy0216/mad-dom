// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-rect-element/SVGRectElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGRectElement constructor identity and the
// `x` / `y` / `height` / `width` / `rx` / `ry` `SVGAnimatedLength` reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength } from "./_svg-helpers.js";

export const id = "nodes-svg-rect-element";
export const description = "real differential: SVGRectElement identity + x/y/height/width/rx/ry SVGAnimatedLength";
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
    const element = document.createElementNS(SVG_NS, "rect");
    observeInstanceof(api, window, element, "SVGRectElement", "SVGGeometryElement");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "rx", "rx");
    observeLength(api, window, element, "ry", "ry");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
