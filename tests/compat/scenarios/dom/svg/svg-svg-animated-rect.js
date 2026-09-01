// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedRect.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedRect(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<svg>` `viewBox` reflection
// (an SVGAnimatedRect backed by the `viewBox` attribute, whose
// `baseVal`/`animVal` are SVGRect instances). The no-op `animVal`/`baseVal`
// setters are observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-rect";
export const description = "real differential: SVGAnimatedRect svg viewBox baseVal/animVal SVGRect x/y/width/height + no-op setters";
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
    const element = document.createElementNS(SVG_NS, "svg");
    const animated = element.viewBox;
    api.record.value("type", animated instanceof window.SVGAnimatedRect);
    api.record.value("identity", animated === animated);
    element.setAttribute("viewBox", "10 20 100 200");
    api.record.value("anim-type", animated.animVal instanceof window.SVGRect);
    api.record.value("anim-x", animated.animVal.x);
    api.record.value("anim-y", animated.animVal.y);
    api.record.value("anim-width", animated.animVal.width);
    api.record.value("anim-height", animated.animVal.height);
    const anim = animated.animVal;
    animated.animVal = anim;
    api.record.value("set-anim-noop", animated.animVal === anim);
    api.record.value("set-anim-attr", element.getAttribute("viewBox"));

    api.record.value("base-type", animated.baseVal instanceof window.SVGRect);
    api.record.value("base-x", animated.baseVal.x);
    api.record.value("base-y", animated.baseVal.y);
    api.record.value("base-width", animated.baseVal.width);
    api.record.value("base-height", animated.baseVal.height);
    const base = animated.baseVal;
    animated.baseVal = base;
    api.record.value("set-base-noop", animated.baseVal === base);
    api.record.value("set-base-attr", element.getAttribute("viewBox"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
