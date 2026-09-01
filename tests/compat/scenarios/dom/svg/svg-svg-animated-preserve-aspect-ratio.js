// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedPreserveAspectRatio.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedPreserveAspectRatio(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public `<svg>`
// `preserveAspectRatio` reflection (an SVGAnimatedPreserveAspectRatio backed
// by the `preserveAspectRatio` attribute, whose `baseVal`/`animVal` are
// SVGPreserveAspectRatio instances). The no-op `animVal`/`baseVal` setters are
// observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-preserve-aspect-ratio";
export const description = "real differential: SVGAnimatedPreserveAspectRatio svg preserveAspectRatio baseVal/animVal align/meetOrSlice + no-op setters";
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
    const animated = element.preserveAspectRatio;
    api.record.value("type", animated instanceof window.SVGAnimatedPreserveAspectRatio);
    api.record.value("identity", animated === animated);
    element.setAttribute("preserveAspectRatio", "xMinYMin slice");
    api.record.value("anim-type", animated.animVal instanceof window.SVGPreserveAspectRatio);
    api.record.value("anim-align", animated.animVal.align);
    api.record.value("anim-meetOrSlice", animated.animVal.meetOrSlice);
    const anim = animated.animVal;
    animated.animVal = anim;
    api.record.value("set-anim-noop", animated.animVal === anim);
    api.record.value("set-anim-attr", element.getAttribute("preserveAspectRatio"));

    api.record.value("base-type", animated.baseVal instanceof window.SVGPreserveAspectRatio);
    api.record.value("base-align", animated.baseVal.align);
    api.record.value("base-meetOrSlice", animated.baseVal.meetOrSlice);
    const base = animated.baseVal;
    animated.baseVal = base;
    api.record.value("set-base-noop", animated.baseVal === base);
    api.record.value("set-base-attr", element.getAttribute("preserveAspectRatio"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
