// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-radial-gradient-element/SVGRadialGradientElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGRadialGradientElement constructor identity
// (with SVGGradientElement) and the `cx` / `cy` / `r` / `fx` / `fy`
// `SVGAnimatedLength` reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength } from "./_svg-helpers.js";

export const id = "nodes-svg-radial-gradient-element";
export const description = "real differential: SVGRadialGradientElement identity + cx/cy/r/fx/fy SVGAnimatedLength";
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
    const element = document.createElementNS(SVG_NS, "radialGradient");
    observeInstanceof(api, window, element, "SVGRadialGradientElement", "SVGGradientElement");
    observeLength(api, window, element, "cx", "cx");
    observeLength(api, window, element, "cy", "cy");
    observeLength(api, window, element, "r", "r");
    observeLength(api, window, element, "fx", "fx");
    observeLength(api, window, element, "fy", "fy");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
