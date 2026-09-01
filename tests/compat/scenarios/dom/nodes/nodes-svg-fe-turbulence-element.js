// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-turbulence-element/SVGFETurbulenceElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFETurbulenceElement constructor identity,
// the shared filter-primitive geometry (`height` / `width` / `x` / `y`, `in1` /
// `result`) and the `baseFrequencyX` / `baseFrequencyY` (default 0) /
// `seed` (default 0) `SVGAnimatedNumber`, `numOctaves` `SVGAnimatedInteger` and
// `stitchTiles` / `type` `SVGAnimatedEnumeration` reflections. The
// `SVG_STITCHTYPE_*` / `SVG_TURBULENCE_TYPE_*` statics are read through
// `window.SVGFETurbulenceElement`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeNumber, observeInteger, observeEnumeration } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-turbulence-element";
export const description = "real differential: SVGFETurbulenceElement identity + full reflection surface";
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
    const element = document.createElementNS(SVG_NS, "feTurbulence");
    observeInstanceof(api, window, element, "SVGFETurbulenceElement", "SVGElement");

    observeNumber(api, window, element, "baseFrequencyX", "baseFrequencyX");
    observeNumber(api, window, element, "baseFrequencyY", "baseFrequencyY");
    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeInteger(api, window, element, "numOctaves", "numOctaves");
    observeString(api, window, element, "result", "result");
    observeNumber(api, window, element, "seed", "seed");

    const stitchConstant = (keyword) => window.SVGFETurbulenceElement[`SVG_STITCHTYPE_${keyword.toUpperCase().replace(/-/g, "_")}`];
    observeEnumeration(api, window, element, "stitchTiles", "stitchTiles", ["stitch", "noStitch"], "stitch", stitchConstant);

    const typeConstant = (keyword) => window.SVGFETurbulenceElement[`SVG_TURBULENCE_TYPE_${keyword.toUpperCase().replace(/-/g, "_")}`];
    observeEnumeration(api, window, element, "type", "type", ["turbulence", "fractalNoise"], "turbulence", typeConstant);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
