// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-image-element/SVGFEImageElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGFEImageElement constructor identity, the
// shared filter-primitive geometry (`height` / `width` / `x` / `y`, `result`),
// the `crossOrigin` attribute reflection, the `href` `SVGAnimatedString`
// reflection and the `preserveAspectRatio` `SVGAnimatedPreserveAspectRatio`
// reflection. The upstream internal `SVGPreserveAspectRatio*Enum` constants are
// read through the public `window.SVGPreserveAspectRatio` statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof, observeLength, observeString, observePreserveAspectRatio } from "./_svg-helpers.js";

export const id = "nodes-svg-fe-image-element";
export const description = "real differential: SVGFEImageElement identity + geometry/crossOrigin/href/preserveAspectRatio";
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
    const element = document.createElementNS(SVG_NS, "feImage");
    observeInstanceof(api, window, element, "SVGFEImageElement", "SVGElement");

    // crossOrigin: plain attribute reflection (no enum normalisation).
    api.record.value("crossOrigin-default", element.crossOrigin);
    element.setAttribute("crossorigin", "use-credentials");
    api.record.value("crossOrigin-read", element.crossOrigin);
    element.crossOrigin = "anonymous";
    api.record.value("crossOrigin-write", element.crossOrigin);
    api.record.value("crossOrigin-write-attr", element.getAttribute("crossorigin"));
    element.crossOrigin = "use-credentials";
    api.record.value("crossOrigin-write-2", element.crossOrigin);
    api.record.value("crossOrigin-write-attr-2", element.getAttribute("crossorigin"));

    observeLength(api, window, element, "height", "height");
    observeLength(api, window, element, "width", "width");
    observeLength(api, window, element, "x", "x");
    observeLength(api, window, element, "y", "y");

    // href: an SVGAnimatedString with an empty-string default.
    api.record.value("href-type", element.href instanceof window.SVGAnimatedString);
    api.record.value("href-default", element.href.baseVal);
    api.record.value("href-default-anim", element.href.animVal);
    element.setAttribute("href", "https://example.com/image.jpg");
    api.record.value("href-base", element.href.baseVal);
    api.record.value("href-anim", element.href.animVal);
    element.href.baseVal = "https://example.com/image2.jpg";
    api.record.value("href-writeback", element.getAttribute("href"));
    element.href.animVal = "https://example.com/image3.jpg";
    api.record.value("href-anim-write-noop", element.getAttribute("href"));

    observePreserveAspectRatio(api, window, element);

    observeString(api, window, element, "result", "result");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
