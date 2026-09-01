// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-text-content-element/SVGTextContentElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGTextContentElement surface observed
// through a `textPath` element (`instanceof window.SVGTextPathElement`, which
// happy-dom exposes while `window.SVGTextContentElement` stays undefined; the
// upstream `instanceof SVGTextContentElement` internal assertion is covered by
// the concrete per-tag identity), the `LENGTHADJUST_*` statics, the
// `textLength` `SVGAnimatedLength`, the `lengthAdjust`
// `SVGAnimatedEnumeration` and the layout-free character stubs. The upstream
// illegal-constructor `SVGPoint` argument is replaced by the public
// `createSVGPoint()` mint.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeEnumeration,
  observeInstanceof,
  observeLength,
  svgPublicMint,
} from "./_svg-helpers.js";

export const id = "nodes-svg-text-content-element";
export const description = "real differential: SVGTextContentElement surface (textPath) + textLength/lengthAdjust + character stubs";
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
    const element = document.createElementNS(SVG_NS, "textPath");
    observeInstanceof(api, window, element, "SVGTextPathElement", "SVGGraphicsElement");
    api.record.value("constructor-name", element.constructor.name);

    api.record.value("static-unknown", window.SVGTextPathElement.LENGTHADJUST_UNKNOWN);
    api.record.value("static-spacing", window.SVGTextPathElement.LENGTHADJUST_SPACING);
    api.record.value("static-spacingandglyphs", window.SVGTextPathElement.LENGTHADJUST_SPACINGANDGLYPHS);

    observeLength(api, window, element, "textLength", "textLength");

    observeEnumeration(
      api,
      window,
      element,
      "lengthAdjust",
      "lengthAdjust",
      ["spacing", "spacingAndGlyphs"],
      "spacing",
      (value) => window.SVGTextPathElement[`LENGTHADJUST_${value.toUpperCase()}`],
    );

    api.record.value("getNumberOfChars", element.getNumberOfChars());
    api.record.value("getComputedTextLength", element.getComputedTextLength());
    api.record.value("getSubStringLength", element.getSubStringLength(0, 0));
    const startPoint = element.getStartPositionOfChar(0);
    api.record.value("getStartPositionOfChar-type", startPoint instanceof window.SVGPoint);
    api.record.value("getEndPositionOfChar-type", element.getEndPositionOfChar(0) instanceof window.SVGPoint);
    api.record.value("getExtentOfChar-type", element.getExtentOfChar(0) instanceof window.SVGRect);
    api.record.value("getRotationOfChar", element.getRotationOfChar(0));
    api.record.value("getCharNumAtPosition", element.getCharNumAtPosition(svgPublicMint(window, "createSVGPoint")));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
