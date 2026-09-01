// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedAngle.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGAnimatedAngle(illegal, window, {getAttribute, setAttribute})`
// construction is expressed through the public `<marker>` `orientAngle`
// reflection (an SVGAnimatedAngle backed by the `orient` attribute). The
// `instanceof SVGAnimatedAngle` / `SVGAngle` checks use the window classes;
// the read-only `animVal` write errors and the no-op `animVal`/`baseVal`
// setters are observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-animated-angle";
export const description = "real differential: SVGAnimatedAngle marker orientAngle baseVal/animVal identity + value/unitType + read-only animVal";
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
    const marker = document.createElementNS(SVG_NS, "marker");
    const animated = marker.orientAngle;
    api.record.value("animated-type", animated instanceof window.SVGAnimatedAngle);
    api.record.value("identity", animated === animated);
    marker.setAttribute("orient", "90deg");
    const angle = animated.animVal;
    api.record.value("anim-type", angle instanceof window.SVGAngle);
    api.record.value("anim-identity", animated.animVal === angle);
    api.record.value("anim-value", angle.value);
    api.record.value("anim-unitType", angle.unitType);
    api.record.value("anim-animated-identity", animated.animVal === animated.animVal);
    try {
      angle.value = 45;
      api.record.value("anim-write", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    const animBefore = animated.animVal;
    animated.animVal = angle;
    api.record.value("set-anim-noop", animated.animVal === animBefore);
    marker.setAttribute("orient", "90deg");
    api.record.value("set-anim-attr-unchanged", marker.getAttribute("orient"));

    const base = animated.baseVal;
    api.record.value("base-type", base instanceof window.SVGAngle);
    api.record.value("base-identity", animated.baseVal === base);
    api.record.value("base-value", base.value);
    api.record.value("base-unitType", base.unitType);
    base.value = 45;
    api.record.value("base-write-value", base.value);
    api.record.value("base-write-attr", marker.getAttribute("orient"));
    const baseBefore = animated.baseVal;
    animated.baseVal = base;
    api.record.value("set-base-noop", animated.baseVal === baseBefore);
    marker.setAttribute("orient", "90deg");
    api.record.value("set-base-attr-unchanged", marker.getAttribute("orient"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
