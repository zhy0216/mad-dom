// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedNumber.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedNumber(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public `<stop>`
// `offset` reflection (an SVGAnimatedNumber backed by the `offset`
// attribute). The read-only `animVal` and the non-finite baseVal write error
// are observed through that public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-number";
export const description = "real differential: SVGAnimatedNumber stop offset baseVal/animVal read + write + non-finite error";
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
    const element = document.createElementNS(SVG_NS, "stop");
    const animated = element.offset;
    api.record.value("type", animated instanceof window.SVGAnimatedNumber);
    api.record.value("anim-default", animated.animVal);
    api.record.value("base-default", animated.baseVal);
    element.setAttribute("offset", "100.5");
    api.record.value("anim-number", animated.animVal);
    api.record.value("base-number", animated.baseVal);
    element.setAttribute("offset", "abc");
    api.record.value("anim-nonnumber", animated.animVal);
    api.record.value("base-nonnumber", animated.baseVal);

    element.setAttribute("offset", "100");
    animated.animVal = 100;
    api.record.value("set-anim-noop", element.getAttribute("offset"));

    element.removeAttribute("offset");
    animated.baseVal = 100.5;
    api.record.value("set-base-writeback", element.getAttribute("offset"));
    api.record.value("set-base-readback", animated.baseVal);
    try {
      animated.baseVal = "abc";
      api.record.value("set-base-nonnumber", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
