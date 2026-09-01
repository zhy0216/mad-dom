// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedLength.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedLength(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public `<circle>`
// `cx` reflection (an SVGAnimatedLength backed by the `cx` attribute, whose
// `baseVal`/`animVal` are SVGLength instances). The no-op `animVal`/`baseVal`
// setters are observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-length";
export const description = "real differential: SVGAnimatedLength circle cx baseVal/animVal SVGLength identity + value + no-op setters";
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
    const element = document.createElementNS(SVG_NS, "circle");
    const animated = element.cx;
    api.record.value("type", animated instanceof window.SVGAnimatedLength);
    api.record.value("identity", animated === animated);
    element.setAttribute("cx", "10in");
    api.record.value("anim-type", animated.animVal instanceof window.SVGLength);
    api.record.value("anim-value", animated.animVal.value);
    api.record.value("anim-valueInSpecifiedUnits", animated.animVal.valueInSpecifiedUnits);
    const anim = animated.animVal;
    animated.animVal = anim;
    api.record.value("set-anim-noop", animated.animVal === anim);
    api.record.value("set-anim-attr", element.getAttribute("cx"));

    api.record.value("base-type", animated.baseVal instanceof window.SVGLength);
    api.record.value("base-value", animated.baseVal.value);
    api.record.value("base-valueInSpecifiedUnits", animated.baseVal.valueInSpecifiedUnits);
    const base = animated.baseVal;
    animated.baseVal = base;
    api.record.value("set-base-noop", animated.baseVal === base);
    api.record.value("set-base-attr", element.getAttribute("cx"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
