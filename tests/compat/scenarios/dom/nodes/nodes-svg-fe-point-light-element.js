// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-point-light-element/SVGFEPointLightElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEPointLightElement constructor identity
// and the `x` / `y` / `z` (default 0) `SVGAnimatedNumber` reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeNumber } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-point-light-element";
export const description = "real differential: SVGFEPointLightElement identity + x/y/z";
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
    const element = document.createElementNS(SVG_NS, "fePointLight");
    observeInstanceof(api, window, element, "SVGFEPointLightElement", "SVGElement");
    observeNumber(api, window, element, "x", "x");
    observeNumber(api, window, element, "y", "y");
    observeNumber(api, window, element, "z", "z");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
