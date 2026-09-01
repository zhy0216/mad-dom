// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-component-transfer-element/SVGFEComponentTransferElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEComponentTransferElement constructor
// identity and the shared filter-primitive geometry (`height` / `width` / `x` /
// `y` as `SVGAnimatedLength`, `in1` / `result` as `SVGAnimatedString`).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-component-transfer-element";
export const description = "real differential: SVGFEComponentTransferElement identity + geometry/in1/result";
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
    const element = document.createElementNS(SVG_NS, "feComponentTransfer");
    observeInstanceof(api, window, element, "SVGFEComponentTransferElement", "SVGElement");

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeString(api, window, element, "result", "result");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
