// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-geometry-element/SVGGeometryElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGGeometryElement constructor identity (on
// a `circle`), the `pathLength` `SVGAnimatedNumber` reflection and the
// unimplemented geometry probes happy-dom stubs (`isPointInFill` /
// `isPointInStroke` → false, `getTotalLength` → 0, `getPointAtLength` → an
// origin SVGPoint). The upstream illegal-constructor `SVGPoint` construction
// is replaced by the public `createSVGPoint()` mint on a scratch `<svg>` element.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeNumber, svgPublicMint } from "./_svg-helpers.js";

export const id = "nodes-svg-geometry-element";
export const description = "real differential: SVGGeometryElement identity + pathLength + geometry stubs";
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
    observeInstanceof(api, window, element, "SVGGeometryElement", "SVGGraphicsElement");

    observeNumber(api, window, element, "pathLength", "pathLength");

    const point = svgPublicMint(window, "createSVGPoint");
    api.record.value("isPointInFill", element.isPointInFill(point));
    api.record.value("isPointInStroke", element.isPointInStroke(point));
    api.record.value("getTotalLength", element.getTotalLength());

    const lengthPoint = element.getPointAtLength(10);
    api.record.value("getPointAtLength-type", lengthPoint instanceof window.SVGPoint);
    api.record.value("getPointAtLength-x", lengthPoint.x);
    api.record.value("getPointAtLength-y", lengthPoint.y);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
