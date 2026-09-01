// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-image-element/SVGImageElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGImageElement constructor identity, the
// `crossOrigin` attribute reflection, the `href` `SVGAnimatedString`, the
// `decoding` attribute normalization, the `preserveAspectRatio`
// `SVGAnimatedPreserveAspectRatio`, the shared geometry `SVGAnimatedLength`
// reflections and the `decode()` promise. The upstream
// `SVGPreserveAspectRatio*Enum` constants are read through the public
// `window.SVGPreserveAspectRatio` statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeInstanceof,
  observeLength,
  observePreserveAspectRatio,
  observeString,
} from "./_svg-helpers.js";

export const id = "nodes-svg-image-element";
export const description = "real differential: SVGImageElement identity + crossOrigin/href/decoding/preserveAspectRatio/geometry/decode";
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
    const element = document.createElementNS(SVG_NS, "image");
    observeInstanceof(api, window, element, "SVGImageElement", "SVGGraphicsElement");

    api.record.value("crossOrigin-default", element.crossOrigin);
    element.setAttribute("crossorigin", "use-credentials");
    api.record.value("crossOrigin-read", element.crossOrigin);
    element.crossOrigin = "anonymous";
    api.record.value("crossOrigin-write", element.crossOrigin);
    api.record.value("crossOrigin-write-attr", element.getAttribute("crossorigin"));
    element.crossOrigin = "use-credentials";
    api.record.value("crossOrigin-write-2", element.crossOrigin);
    api.record.value("crossOrigin-write-attr-2", element.getAttribute("crossorigin"));

    observeString(api, window, element, "href", "href");

    api.record.value("decoding-default", element.decoding);
    for (const value of ["sync", "async", "auto", "invalid"]) {
      element.setAttribute("decoding", value);
      api.record.value(`decoding-${value}`, element.decoding);
    }
    element.decoding = "anyValue";
    api.record.value("decoding-assign", element.getAttribute("decoding"));

    observePreserveAspectRatio(api, window, element);

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");

    api.record.value("decode-resolved", await element.decode());
  } catch (error) {
    api.record.error(error, "facade");
  }
}
