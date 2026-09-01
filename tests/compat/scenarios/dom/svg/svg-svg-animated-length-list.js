// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedLengthList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedLengthList(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public `<text>` `x`
// reflection (an SVGAnimatedLengthList backed by the `x` attribute, whose
// `baseVal`/`animVal` are SVGLengthList instances). The no-op
// `animVal`/`baseVal` setters are observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-length-list";
export const description = "real differential: SVGAnimatedLengthList text x baseVal/animVal SVGLengthList reads + no-op setters";
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
    const element = document.createElementNS(SVG_NS, "text");
    const animated = element.x;
    api.record.value("type", animated instanceof window.SVGAnimatedLengthList);
    api.record.value("identity", animated === animated);
    element.setAttribute("x", "10px 20cm 30in 40mm");
    api.record.value("anim-type", animated.animVal instanceof window.SVGLengthList);
    api.record.value("anim-length", animated.animVal.length);
    api.record.value("anim-0-valueAsString", animated.animVal[0].valueAsString);
    api.record.value("anim-0-valueInSpecifiedUnits", animated.animVal[0].valueInSpecifiedUnits);
    api.record.value("anim-1-valueAsString", animated.animVal[1].valueAsString);
    api.record.value("anim-1-valueInSpecifiedUnits", animated.animVal[1].valueInSpecifiedUnits);
    api.record.value("anim-2-valueAsString", animated.animVal[2].valueAsString);
    api.record.value("anim-2-valueInSpecifiedUnits", animated.animVal[2].valueInSpecifiedUnits);
    api.record.value("anim-3-valueAsString", animated.animVal[3].valueAsString);
    api.record.value("anim-3-valueInSpecifiedUnits", animated.animVal[3].valueInSpecifiedUnits);
    const anim = animated.animVal;
    animated.animVal = anim;
    api.record.value("set-anim-noop", animated.animVal === anim);
    api.record.value("set-anim-attr", element.getAttribute("x"));

    api.record.value("base-type", animated.baseVal instanceof window.SVGLengthList);
    api.record.value("base-length", animated.baseVal.length);
    api.record.value("base-0-valueAsString", animated.baseVal[0].valueAsString);
    api.record.value("base-0-valueInSpecifiedUnits", animated.baseVal[0].valueInSpecifiedUnits);
    api.record.value("base-1-valueAsString", animated.baseVal[1].valueAsString);
    api.record.value("base-1-valueInSpecifiedUnits", animated.baseVal[1].valueInSpecifiedUnits);
    api.record.value("base-2-valueAsString", animated.baseVal[2].valueAsString);
    api.record.value("base-2-valueInSpecifiedUnits", animated.baseVal[2].valueInSpecifiedUnits);
    api.record.value("base-3-valueAsString", animated.baseVal[3].valueAsString);
    api.record.value("base-3-valueInSpecifiedUnits", animated.baseVal[3].valueInSpecifiedUnits);
    const base = animated.baseVal;
    animated.baseVal = base;
    api.record.value("set-base-noop", animated.baseVal === base);
    api.record.value("set-base-attr", element.getAttribute("x"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
