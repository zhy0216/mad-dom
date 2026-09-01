// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-merge-node-element/SVGFEMergeNodeElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEMergeNodeElement constructor identity
// and the `in1` `SVGAnimatedString` reflection (the "in" attribute).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeString } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-merge-node-element";
export const description = "real differential: SVGFEMergeNodeElement identity + in1";
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
    const element = document.createElementNS(SVG_NS, "feMergeNode");
    observeInstanceof(api, window, element, "SVGFEMergeNodeElement", "SVGElement");
    observeString(api, window, element, "in1", "in");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
