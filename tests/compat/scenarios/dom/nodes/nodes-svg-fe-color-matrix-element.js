// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-color-matrix-element/SVGFEColorMatrixElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEColorMatrixElement constructor identity,
// the shared filter-primitive geometry (`height` / `width` / `x` / `y`, `in1` /
// `in2` / `result`), the `type` `SVGAnimatedEnumeration` reflection and the
// `values` `SVGAnimatedNumberList` reflection. The upstream
// `new window.SVGNumber(…)` appendItem
// assertion is dropped (`SVGNumber` has no public constructor). The
// `SVG_FEBLEND_TYPE_*` statics are read through `window.SVGFEColorMatrixElement`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeEnumeration, observeNumberList } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-color-matrix-element";
export const description = "real differential: SVGFEColorMatrixElement identity + geometry/type/values";
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
    const element = document.createElementNS(SVG_NS, "feColorMatrix");
    observeInstanceof(api, window, element, "SVGFEColorMatrixElement", "SVGElement");

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeString(api, window, element, "in2", "in2");
    observeString(api, window, element, "result", "result");

    const typeConstant = (keyword) =>
      window.SVGFEColorMatrixElement[`SVG_FEBLEND_TYPE_${keyword.toUpperCase()}`];
    observeEnumeration(api, window, element, "type", "type", ["matrix", "saturate", "huerotate", "luminancetoalpha"], "matrix", typeConstant);

    observeNumberList(api, window, element, "values", "values");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
