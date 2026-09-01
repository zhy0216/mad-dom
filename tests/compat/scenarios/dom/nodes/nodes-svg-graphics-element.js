// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-graphics-element/SVGGraphicsElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGGraphicsElement constructor identity (on
// a `g`), the shared `oncopy` / `oncut` / `onpaste` handler attributes, the
// `requiredExtensions` / `systemLanguage` `SVGStringList` reflections, the
// `transform` `SVGAnimatedTransformList` and the layout-free `getBBox` /
// `getCTM` / `getScreenCTM` stubs. The upstream `SVGTransformTypeEnum`
// constants are recorded as the numeric `type` values and the write-back
// transform is minted via the public `createSVGTransform()`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeEventHandler,
  observeInstanceof,
  observeStringList,
  observeTransformList,
} from "./_svg-helpers.js";

export const id = "nodes-svg-graphics-element";
export const description = "real differential: SVGGraphicsElement identity + events + string lists + transform + geometry stubs";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window({
      settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true },
    });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const element = document.createElementNS(SVG_NS, "g");
    observeInstanceof(api, window, element, "SVGGraphicsElement", "SVGElement");

    for (const event of ["copy", "cut", "paste"]) {
      observeEventHandler(api, window, element, event, "handler-");
    }

    observeStringList(api, window, element, "requiredExtensions", "requiredExtensions");
    observeStringList(api, window, element, "systemLanguage", "systemLanguage");
    observeTransformList(api, window, element, "transform", "transform");

    api.record.value("getBBox-type", element.getBBox() instanceof window.DOMRect);
    api.record.value("getCTM-type", element.getCTM() instanceof window.DOMMatrix);
    api.record.value("getScreenCTM-type", element.getScreenCTM() instanceof window.DOMMatrix);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
