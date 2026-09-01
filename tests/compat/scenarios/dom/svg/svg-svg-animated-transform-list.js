// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedTransformList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedTransformList(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public `<g>`
// `transform` reflection (an SVGAnimatedTransformList backed by the
// `transform` attribute, whose `baseVal`/`animVal` are SVGTransformList
// instances). The per-item `matrix` values are read through the public
// `transform.baseVal[i].matrix` surface; the no-op `animVal`/`baseVal`
// setters are observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-transform-list";
export const description = "real differential: SVGAnimatedTransformList g transform baseVal/animVal matrix reads + no-op setters";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";
const ATTRIBUTE = "rotate(-10 50 100) translate(-36 45.5) skewX(40) scale(1 0.5)";

function recordMatrix(api, prefix, list) {
  for (let i = 0; i < 4; i += 1) {
    api.record.value(`${prefix}-${i}-a`, list[i].matrix.a);
    api.record.value(`${prefix}-${i}-b`, list[i].matrix.b);
    api.record.value(`${prefix}-${i}-c`, list[i].matrix.c);
    api.record.value(`${prefix}-${i}-d`, list[i].matrix.d);
    api.record.value(`${prefix}-${i}-e`, list[i].matrix.e);
    api.record.value(`${prefix}-${i}-f`, list[i].matrix.f);
  }
}

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
    const element = document.createElementNS(SVG_NS, "g");
    const animated = element.transform;
    api.record.value("type", animated instanceof window.SVGAnimatedTransformList);
    api.record.value("identity", animated === animated);
    element.setAttribute("transform", ATTRIBUTE);
    api.record.value("anim-type", animated.animVal instanceof window.SVGTransformList);
    api.record.value("anim-numberOfItems", animated.animVal.numberOfItems);
    recordMatrix(api, "anim", animated.animVal);
    const anim = animated.animVal;
    animated.animVal = anim;
    api.record.value("set-anim-noop", animated.animVal === anim);
    api.record.value("set-anim-attr", element.getAttribute("transform"));

    api.record.value("base-type", animated.baseVal instanceof window.SVGTransformList);
    api.record.value("base-numberOfItems", animated.baseVal.numberOfItems);
    recordMatrix(api, "base", animated.baseVal);
    const base = animated.baseVal;
    animated.baseVal = base;
    api.record.value("set-base-noop", animated.baseVal === base);
    api.record.value("set-base-attr", element.getAttribute("transform"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
