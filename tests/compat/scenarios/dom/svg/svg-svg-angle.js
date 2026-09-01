// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAngle.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream `new window.SVGAngle(illegal, win,
// {getAttribute, setAttribute})` internal constructions are expressed through
// the public `<marker>` `orientAngle` (SVGAnimatedAngle) `.baseVal` — a real
// SVGAngle backed by the `orient` attribute — plus the `window.SVGAngle`
// static enum constants (inline SVG_ANGLETYPE_* literals). The upstream
// `SVGAngleTypeEnum` import is replaced by the public statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-angle";
export const description = "real differential: SVGAngle unitType/value/valueAsString/valueInSpecifiedUnits + newValueSpecifiedUnits/convertToSpecifiedUnits via marker orientAngle";
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
    api.record.value("static-unknown", window.SVGAngle.SVG_ANGLETYPE_UNKNOWN);
    api.record.value("static-unspecified", window.SVGAngle.SVG_ANGLETYPE_UNSPECIFIED);
    api.record.value("static-deg", window.SVGAngle.SVG_ANGLETYPE_DEG);
    api.record.value("static-rad", window.SVGAngle.SVG_ANGLETYPE_RAD);
    api.record.value("static-grad", window.SVGAngle.SVG_ANGLETYPE_GRAD);

    const marker = document.createElementNS(SVG_NS, "marker");
    const angle = marker.orientAngle.baseVal;
    api.record.value("type", angle instanceof window.SVGAngle);
    api.record.value("unitType-default", angle.unitType);
    api.record.value("value-default", angle.value);
    api.record.value("valueAsString-default", angle.valueAsString);
    api.record.value("valueInSpecifiedUnits-default", angle.valueInSpecifiedUnits);

    for (const attributeValue of ["90deg", "90rad", "100grad", "0.5turn", "90"]) {
      marker.setAttribute("orient", attributeValue);
      api.record.value(`unitType-${attributeValue}`, angle.unitType);
      api.record.value(`value-${attributeValue}`, angle.value);
      api.record.value(`valueAsString-${attributeValue}`, angle.valueAsString);
      api.record.value(`valueInSpecifiedUnits-${attributeValue}`, angle.valueInSpecifiedUnits);
    }

    marker.setAttribute("orient", `${Math.PI}rad`);
    api.record.value("value-pi-rad", angle.value);
    api.record.value("valueInSpecifiedUnits-pi-rad", angle.valueInSpecifiedUnits);

    marker.setAttribute("orient", "90deg");
    angle.value = 180;
    api.record.value("set-value-deg-writeback", marker.getAttribute("orient"));
    marker.setAttribute("orient", `${Math.PI}rad`);
    angle.value = 90;
    api.record.value("set-value-rad-writeback", marker.getAttribute("orient"));
    marker.setAttribute("orient", "100grad");
    angle.value = 45;
    api.record.value("set-value-grad-writeback", marker.getAttribute("orient"));
    marker.setAttribute("orient", "0.5turn");
    angle.value = 90;
    api.record.value("set-value-turn-writeback", marker.getAttribute("orient"));
    marker.setAttribute("orient", "90");
    angle.value = 90;
    api.record.value("set-value-unspecified-writeback", marker.getAttribute("orient"));

    const marker2 = document.createElementNS(SVG_NS, "marker");
    const angle2 = marker2.orientAngle.baseVal;
    angle2.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_DEG, 90);
    api.record.value("newValue-deg", marker2.getAttribute("orient"));
    angle2.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_RAD, Math.PI);
    api.record.value("newValue-rad", marker2.getAttribute("orient"));
    angle2.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_GRAD, 100);
    api.record.value("newValue-grad", marker2.getAttribute("orient"));
    angle2.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_UNKNOWN, 0.5);
    api.record.value("newValue-turn", marker2.getAttribute("orient"));
    api.record.value("newValue-turn-readback", angle2.value);

    const marker3 = document.createElementNS(SVG_NS, "marker");
    const angle3 = marker3.orientAngle.baseVal;
    marker3.setAttribute("orient", "100grad");
    angle3.convertToSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_DEG);
    api.record.value("convert-deg", marker3.getAttribute("orient"));
    marker3.setAttribute("orient", "90deg");
    angle3.convertToSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_RAD);
    api.record.value("convert-rad", marker3.getAttribute("orient"));
    marker3.setAttribute("orient", "90deg");
    angle3.convertToSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_GRAD);
    api.record.value("convert-grad", marker3.getAttribute("orient"));
    marker3.setAttribute("orient", "90deg");
    angle3.convertToSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_UNKNOWN);
    api.record.value("convert-turn", marker3.getAttribute("orient"));

    try {
      angle.value = 45;
      api.record.value("readonly-set", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      angle.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_DEG, 90);
      api.record.value("readonly-newValue", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      angle.convertToSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_DEG);
      api.record.value("readonly-convert", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
