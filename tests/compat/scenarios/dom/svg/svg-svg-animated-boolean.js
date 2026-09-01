// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedBoolean.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedBoolean(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public `<feImage>`
// `preserveAlpha` reflection (an SVGAnimatedBoolean backed by the
// `preserveAlpha` attribute). The read-only `animVal` and the baseVal
// read/write behaviour are observed through that public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-boolean";
export const description = "real differential: SVGAnimatedBoolean feImage preserveAlpha baseVal/animVal read + write";
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
    const animated = element.preserveAlpha;
    api.record.value("type", animated instanceof window.SVGAnimatedBoolean);
    api.record.value("identity", animated === animated);
    api.record.value("anim-default", animated.animVal);
    api.record.value("base-default", animated.baseVal);
    element.setAttribute("preserveAlpha", "true");
    api.record.value("anim-true", animated.animVal);
    api.record.value("base-true", animated.baseVal);
    element.setAttribute("preserveAlpha", "false");
    api.record.value("anim-false", animated.animVal);
    api.record.value("base-false", animated.baseVal);
    element.removeAttribute("preserveAlpha");
    api.record.value("anim-null", animated.animVal);
    api.record.value("base-null", animated.baseVal);

    element.setAttribute("preserveAlpha", "false");
    animated.animVal = false;
    api.record.value("set-anim-noop", element.getAttribute("preserveAlpha"));
    animated.animVal = true;
    api.record.value("set-anim-noop2", element.getAttribute("preserveAlpha"));

    element.removeAttribute("preserveAlpha");
    animated.baseVal = true;
    api.record.value("set-base-true", element.getAttribute("preserveAlpha"));
    element.removeAttribute("preserveAlpha");
    animated.baseVal = false;
    api.record.value("set-base-false", element.getAttribute("preserveAlpha"));
    api.record.value("base-readback", animated.baseVal);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
