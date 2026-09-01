// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-func-a-element/SVGFEFuncAElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the constructor identity of a
// `createElementNS('http://www.w3.org/2000/svg', 'feFuncA')` element against
// the `window.SVGFEFuncAElement` / `window.SVGComponentTransferFunctionElement`
// classes (the public equivalent of the upstream internal-class `instanceof`
// assertions).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-func-a-element";
export const description = "real differential: SVGFEFuncAElement createElementNS constructor identity";
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
    const element = document.createElementNS(SVG_NS, "feFuncA");
    observeInstanceof(api, window, element, "SVGFEFuncAElement", "SVGComponentTransferFunctionElement");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
