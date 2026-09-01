// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedString.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedString(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public `<feImage>`
// `href` reflection (an SVGAnimatedString backed by the `href` attribute).
// The read-only `animVal`, the string-coercing baseVal write and the no-op
// `animVal` setter are observed through that public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-string";
export const description = "real differential: SVGAnimatedString feImage href baseVal/animVal read + string-coercing write";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";

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
    const animated = element.href;
    api.record.value("type", animated instanceof window.SVGAnimatedString);
    api.record.value("anim-default", animated.animVal);
    api.record.value("base-default", animated.baseVal);
    element.setAttribute("href", "test");
    api.record.value("anim-value", animated.animVal);
    api.record.value("base-value", animated.baseVal);

    element.setAttribute("href", "test");
    animated.animVal = "test";
    api.record.value("set-anim-noop", element.getAttribute("href"));

    element.removeAttribute("href");
    animated.baseVal = "test";
    api.record.value("set-base-writeback", element.getAttribute("href"));
    element.removeAttribute("href");
    animated.baseVal = null;
    api.record.value("set-base-null-coerce", element.getAttribute("href"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
