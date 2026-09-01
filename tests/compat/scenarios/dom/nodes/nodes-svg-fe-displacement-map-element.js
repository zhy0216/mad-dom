// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-displacement-map-element/SVGFEDisplacementMapElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEDisplacementMapElement constructor
// identity, the shared filter-primitive geometry (`height` / `width` / `x` /
// `y`, `in1` / `in2` / `result`), the `scale` `SVGAnimatedNumber` reflection
// and the `xChannelSelector` / `yChannelSelector` `SVGAnimatedEnumeration`
// reflections. The `SVG_CHANNEL_*` statics are read through
// `window.SVGFEDisplacementMapElement`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observeNumber, observeEnumeration } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-displacement-map-element";
export const description = "real differential: SVGFEDisplacementMapElement identity + geometry/scale/channel selectors";
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
    const element = document.createElementNS(SVG_NS, "feDisplacementMap");
    observeInstanceof(api, window, element, "SVGFEDisplacementMapElement", "SVGElement");

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");
    observeString(api, window, element, "in1", "in");
    observeString(api, window, element, "in2", "in2");
    observeString(api, window, element, "result", "result");
    observeNumber(api, window, element, "scale", "scale");

    const channelConstant = (keyword) => window.SVGFEDisplacementMapElement[`SVG_CHANNEL_${keyword.toUpperCase()}`];
    observeEnumeration(api, window, element, "xChannelSelector", "xChannelSelector", ["r", "g", "b", "a"], "r", channelConstant);
    observeEnumeration(api, window, element, "yChannelSelector", "yChannelSelector", ["r", "g", "b", "a"], "r", channelConstant);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
