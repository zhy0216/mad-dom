// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedEnumeration.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedEnumeration(illegal, window, {values, defaultValue,
// …})` configurations are expressed through the public `<feBlend>` `mode`
// reflection (an SVGAnimatedEnumeration with the real blend-mode value list).
// The upstream "values list contains null (any value)" configuration is an
// internal construction detail without an element reflection; it is dropped.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-enumeration";
export const description = "real differential: SVGAnimatedEnumeration feBlend mode default/attribute reads + baseVal write + range errors";
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
    const element = document.createElementNS(SVG_NS, "feBlend");
    const animated = element.mode;
    api.record.value("type", animated instanceof window.SVGAnimatedEnumeration);
    api.record.value("identity", animated === animated);
    api.record.value("anim-default", animated.animVal);
    api.record.value("base-default", animated.baseVal);

    for (const value of ["normal", "multiply", "screen"]) {
      element.setAttribute("mode", value);
      api.record.value(`anim-${value}`, animated.animVal);
      api.record.value(`base-${value}`, animated.baseVal);
    }
    element.setAttribute("mode", "not-a-mode");
    api.record.value("anim-unknown", animated.animVal);
    api.record.value("base-unknown", animated.baseVal);

    element.setAttribute("mode", "normal");
    animated.animVal = window.SVGFEBlendElement.SVG_FEBLEND_MODE_SCREEN;
    api.record.value("set-anim-noop", element.getAttribute("mode"));

    element.removeAttribute("mode");
    animated.baseVal = window.SVGFEBlendElement.SVG_FEBLEND_MODE_SCREEN;
    api.record.value("set-base-writeback", element.getAttribute("mode"));
    api.record.value("set-base-readback", animated.baseVal);
    element.removeAttribute("mode");
    animated.baseVal = window.SVGFEBlendElement.SVG_FEBLEND_MODE_MULTIPLY;
    api.record.value("set-base-writeback2", element.getAttribute("mode"));

    try {
      animated.baseVal = 0;
      api.record.value("base-zero", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      animated.baseVal = -1;
      api.record.value("base-negative", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      animated.baseVal = window.SVGFEBlendElement.SVG_FEBLEND_MODE_LUMINOSITY + 1;
      api.record.value("base-too-large", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
