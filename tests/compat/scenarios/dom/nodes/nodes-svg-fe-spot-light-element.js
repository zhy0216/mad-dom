// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-spot-light-element/SVGFESpotLightElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFESpotLightElement constructor identity
// and the `x` / `y` / `z` / `pointsAtX` / `pointsAtY` / `pointsAtZ` /
// `limitingConeAngle` (default 0) and `specularExponent` (default 1)
// `SVGAnimatedNumber` reflections.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeNumber } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-spot-light-element";
export const description = "real differential: SVGFESpotLightElement identity + full point/cone number surface";
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
    const element = document.createElementNS(SVG_NS, "feSpotLight");
    observeInstanceof(api, window, element, "SVGFESpotLightElement", "SVGElement");

    observeNumber(api, window, element, "x", "x");
    observeNumber(api, window, element, "y", "y");
    observeNumber(api, window, element, "z", "z");
    observeNumber(api, window, element, "pointsAtX", "pointsAtX");
    observeNumber(api, window, element, "pointsAtY", "pointsAtY");
    observeNumber(api, window, element, "pointsAtZ", "pointsAtZ");
    observeNumber(api, window, element, "specularExponent", "specularExponent", 1);
    observeNumber(api, window, element, "limitingConeAngle", "limitingConeAngle");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
