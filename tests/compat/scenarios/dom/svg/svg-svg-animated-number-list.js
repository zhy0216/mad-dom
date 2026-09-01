// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedNumberList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedNumberList(illegal, window, {getAttribute,
// setAttribute})` constructions are expressed through the public
// `<feColorMatrix>` `values` reflection (an SVGAnimatedNumberList backed by
// the `values` attribute, whose `baseVal`/`animVal` are SVGNumberList
// instances). The no-op `animVal`/`baseVal` setters are observed through the
// public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-number-list";
export const description = "real differential: SVGAnimatedNumberList feColorMatrix values baseVal/animVal SVGNumberList reads + no-op setters";
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
    const element = document.createElementNS(SVG_NS, "feColorMatrix");
    const animated = element.values;
    api.record.value("type", animated instanceof window.SVGAnimatedNumberList);
    api.record.value("identity", animated === animated);
    element.setAttribute("values", "100.5 200.5");
    api.record.value("anim-type", animated.animVal instanceof window.SVGNumberList);
    api.record.value("anim-length", animated.animVal.length);
    api.record.value("anim-0-value", animated.animVal[0].value);
    api.record.value("anim-1-value", animated.animVal[1].value);
    const anim = animated.animVal;
    animated.animVal = anim;
    api.record.value("set-anim-noop", animated.animVal === anim);
    api.record.value("set-anim-attr", element.getAttribute("values"));

    api.record.value("base-type", animated.baseVal instanceof window.SVGNumberList);
    api.record.value("base-length", animated.baseVal.length);
    api.record.value("base-0-value", animated.baseVal[0].value);
    api.record.value("base-1-value", animated.baseVal[1].value);
    const base = animated.baseVal;
    animated.baseVal = base;
    api.record.value("set-base-noop", animated.baseVal === base);
    api.record.value("set-base-attr", element.getAttribute("values"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
