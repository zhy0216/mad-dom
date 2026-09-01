// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-marker-element/SVGMarkerElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGMarkerElement constructor identity, the
// public static orientation / units constants, the `markerUnits`
// `SVGAnimatedEnumeration`, the `markerWidth` / `markerHeight` / `refX` /
// `refY` `SVGAnimatedLength` reflections, the `orientType`
// `SVGAnimatedEnumeration` (with the "any angle" sentinel), the `orientAngle`
// `SVGAnimatedAngle`, the `viewBox` `SVGAnimatedRect`, the
// `preserveAspectRatio` `SVGAnimatedPreserveAspectRatio` and `setOrientToAuto()`.
// The upstream `SVGAngle.SVG_ANGLETYPE_*` constants are read through the
// public `window.SVGAngle` statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import {
  SVG_NS,
  observeEnumeration,
  observeInstanceof,
  observeLength,
  observePreserveAspectRatio,
  observeRect,
} from "./_svg-helpers.js";

export const id = "nodes-svg-marker-element";
export const description = "real differential: SVGMarkerElement identity + statics + markerUnits/orientType/orientAngle/refX/viewBox/preserveAspectRatio";
export const targets = "real";

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
    const element = document.createElementNS(SVG_NS, "marker");
    observeInstanceof(api, window, element, "SVGMarkerElement", "SVGElement");

    api.record.value("static-orient-unknown", window.SVGMarkerElement.SVG_MARKER_ORIENT_UNKNOWN);
    api.record.value("static-orient-auto", window.SVGMarkerElement.SVG_MARKER_ORIENT_AUTO);
    api.record.value("static-orient-angle", window.SVGMarkerElement.SVG_MARKER_ORIENT_ANGLE);
    api.record.value("static-units-unknown", window.SVGMarkerElement.SVG_MARKERUNITS_UNKNOWN);
    api.record.value("static-units-userspaceonuse", window.SVGMarkerElement.SVG_MARKERUNITS_USERSPACEONUSE);
    api.record.value("static-units-strokewidth", window.SVGMarkerElement.SVG_MARKERUNITS_STROKEWIDTH);

    const markerUnitsValues = ["userSpaceOnUse", "strokeWidth"];
    observeEnumeration(
      api,
      window,
      element,
      "markerUnits",
      "markerUnits",
      markerUnitsValues,
      "strokeWidth",
      (value) => window.SVGMarkerElement[`SVG_MARKERUNITS_${value.toUpperCase().replace(/-/g, "_")}`],
    );

    observeLength(api, window, element, "markerWidth", "markerWidth");
    observeLength(api, window, element, "markerHeight", "markerHeight");
    observeLength(api, window, element, "refX", "refX");
    observeLength(api, window, element, "refY", "refY");

    // orientType — on a fresh element so the default reads before any orient
    // attribute mutation (mirrors the upstream per-`it` beforeEach).
    const orientTypeElement = document.createElementNS(SVG_NS, "marker");
    api.record.value("orientType-type", orientTypeElement.orientType instanceof window.SVGAnimatedEnumeration);
    api.record.value("orientType-default-base", orientTypeElement.orientType.baseVal);
    api.record.value("orientType-default-anim", orientTypeElement.orientType.animVal);
    orientTypeElement.setAttribute("orient", "auto");
    api.record.value("orientType-auto-base", orientTypeElement.orientType.baseVal);
    orientTypeElement.removeAttribute("orient");
    orientTypeElement.orientType.baseVal = window.SVGMarkerElement.SVG_MARKER_ORIENT_AUTO;
    api.record.value("orientType-auto-writeback", orientTypeElement.getAttribute("orient"));
    orientTypeElement.removeAttribute("orient");
    orientTypeElement.orientType.animVal = window.SVGMarkerElement.SVG_MARKER_ORIENT_AUTO;
    api.record.value("orientType-auto-anim-noop", orientTypeElement.getAttribute("orient"));
    orientTypeElement.setAttribute("orient", "90deg");
    api.record.value("orientType-angle-base", orientTypeElement.orientType.baseVal);
    api.record.value("orientType-angle-anim", orientTypeElement.orientType.animVal);
    orientTypeElement.removeAttribute("orient");
    orientTypeElement.orientType.baseVal = window.SVGMarkerElement.SVG_MARKER_ORIENT_ANGLE;
    api.record.value("orientType-angle-writeback", orientTypeElement.getAttribute("orient"));
    orientTypeElement.removeAttribute("orient");
    orientTypeElement.orientType.animVal = window.SVGMarkerElement.SVG_MARKER_ORIENT_ANGLE;
    api.record.value("orientType-angle-anim-noop", orientTypeElement.getAttribute("orient"));
    for (const orient of ["90deg", "1.5708rad", "100grad", "0.25turn"]) {
      orientTypeElement.setAttribute("orient", orient);
      api.record.value(`orientType-${orient}-base`, orientTypeElement.orientType.baseVal);
    }

    // orientAngle — on a fresh element (the happy-dom SVGAngle keeps a cached
    // canonical value, so the default must be read before any orient mutation).
    const orientAngleElement = document.createElementNS(SVG_NS, "marker");
    api.record.value("orientAngle-type", orientAngleElement.orientAngle instanceof window.SVGAnimatedAngle);
    api.record.value("orientAngle-default-value", orientAngleElement.orientAngle.baseVal.value);
    api.record.value("orientAngle-default-unitType", orientAngleElement.orientAngle.baseVal.unitType);
    api.record.value("orientAngle-default-anim-value", orientAngleElement.orientAngle.animVal.value);
    orientAngleElement.setAttribute("orient", "90deg");
    api.record.value("orientAngle-value", orientAngleElement.orientAngle.baseVal.value);
    api.record.value("orientAngle-unitType", orientAngleElement.orientAngle.baseVal.unitType);
    api.record.value("orientAngle-valueAsString", orientAngleElement.orientAngle.baseVal.valueAsString);
    api.record.value("orientAngle-anim-value", orientAngleElement.orientAngle.animVal.value);
    api.record.value("orientAngle-anim-unitType", orientAngleElement.orientAngle.animVal.unitType);
    orientAngleElement.orientAngle.baseVal.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_RAD, 1.5708);
    api.record.value("orientAngle-writeback", orientAngleElement.getAttribute("orient"));
    try {
      orientAngleElement.orientAngle.animVal.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_GRAD, 100);
      api.record.value("orientAngle-anim-write", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    observeRect(api, window, element, "viewBox", "viewBox");
    observePreserveAspectRatio(api, window, element);

    element.setOrientToAuto();
    api.record.value("setOrientToAuto-1", element.getAttribute("orient"));
    element.setAttribute("orient", "90deg");
    element.setOrientToAuto();
    api.record.value("setOrientToAuto-2", element.getAttribute("orient"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
