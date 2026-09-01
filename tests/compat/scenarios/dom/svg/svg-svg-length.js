// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGLength.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGLength(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<circle>` `cx` `baseVal` (a
// real SVGLength backed by the `cx` attribute) plus the `window.SVGLength`
// static enum constants (inline SVG_LENGTHTYPE_* literals). The standalone
// `new SVGLength()` default/`newValueSpecifiedUnits` cases use the public
// `svg.createSVGLength()` mint. The `SVGLengthTypeEnum` import is replaced by
// the public statics.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-length";
export const description = "real differential: SVGLength unitType/value/valueAsString/valueInSpecifiedUnits + newValueSpecifiedUnits/convertToSpecifiedUnits + statics";
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
    api.record.value("static-unknown", window.SVGLength.SVG_LENGTHTYPE_UNKNOWN);
    api.record.value("static-number", window.SVGLength.SVG_LENGTHTYPE_NUMBER);
    api.record.value("static-percentage", window.SVGLength.SVG_LENGTHTYPE_PERCENTAGE);
    api.record.value("static-ems", window.SVGLength.SVG_LENGTHTYPE_EMS);
    api.record.value("static-exs", window.SVGLength.SVG_LENGTHTYPE_EXS);
    api.record.value("static-px", window.SVGLength.SVG_LENGTHTYPE_PX);
    api.record.value("static-cm", window.SVGLength.SVG_LENGTHTYPE_CM);
    api.record.value("static-mm", window.SVGLength.SVG_LENGTHTYPE_MM);
    api.record.value("static-in", window.SVGLength.SVG_LENGTHTYPE_IN);
    api.record.value("static-pt", window.SVGLength.SVG_LENGTHTYPE_PT);
    api.record.value("static-pc", window.SVGLength.SVG_LENGTHTYPE_PC);

    const element = document.createElementNS(SVG_NS, "circle");
    const length = element.cx.baseVal;
    api.record.value("type", length instanceof window.SVGLength);
    api.record.value("unitType-default", length.unitType);
    api.record.value("value-default", length.value);
    api.record.value("valueAsString-default", length.valueAsString);
    api.record.value("valueInSpecifiedUnits-default", length.valueInSpecifiedUnits);

    for (const attributeValue of ["10px", "10cm", "10mm", "10in", "10pt", "10pc", "10"]) {
      element.setAttribute("cx", attributeValue);
      api.record.value(`unitType-${attributeValue}`, length.unitType);
      api.record.value(`value-${attributeValue}`, length.value);
      api.record.value(`valueAsString-${attributeValue}`, length.valueAsString);
      api.record.value(`valueInSpecifiedUnits-${attributeValue}`, length.valueInSpecifiedUnits);
    }
    for (const relative of ["10em", "10ex", "10%"]) {
      element.setAttribute("cx", relative);
      try {
        api.record.value(`value-${relative}`, length.value);
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
      try {
        api.record.value(`unitType-${relative}`, length.unitType);
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
    }

    element.setAttribute("cx", "10px");
    length.value = 20;
    api.record.value("set-value-px", element.getAttribute("cx"));
    element.setAttribute("cx", "10cm");
    length.value = 20;
    api.record.value("set-value-cm", element.getAttribute("cx"));
    element.setAttribute("cx", "10mm");
    length.value = 20;
    api.record.value("set-value-mm", element.getAttribute("cx"));
    element.setAttribute("cx", "10in");
    length.value = 20;
    api.record.value("set-value-in", element.getAttribute("cx"));
    element.setAttribute("cx", "10pt");
    length.value = 20;
    api.record.value("set-value-pt", element.getAttribute("cx"));
    element.setAttribute("cx", "10pc");
    length.value = 20;
    api.record.value("set-value-pc", element.getAttribute("cx"));
    element.setAttribute("cx", "10");
    length.value = 20;
    api.record.value("set-value-number", element.getAttribute("cx"));
    element.setAttribute("cx", "10em");
    try {
      length.value = 20;
      api.record.value("set-value-relative", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    const svg = document.createElementNS(SVG_NS, "svg");
    const minted = svg.createSVGLength();
    minted.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 10);
    api.record.value("newValue-px", minted.value);
    api.record.value("newValue-px-attr", minted.valueAsString);
    minted.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 10);
    api.record.value("newValue-cm", minted.valueInSpecifiedUnits);
    minted.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_MM, 10);
    api.record.value("newValue-mm", minted.valueInSpecifiedUnits);
    minted.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_IN, 10);
    api.record.value("newValue-in", minted.valueInSpecifiedUnits);
    minted.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PT, 10);
    api.record.value("newValue-pt", minted.valueInSpecifiedUnits);
    minted.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PC, 10);
    api.record.value("newValue-pc", minted.valueInSpecifiedUnits);
    minted.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_NUMBER, 10);
    api.record.value("newValue-number", minted.valueInSpecifiedUnits);

    element.setAttribute("cx", "10cm");
    length.convertToSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX);
    api.record.value("convert-px", element.getAttribute("cx"));
    element.setAttribute("cx", "10px");
    length.convertToSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM);
    api.record.value("convert-cm", element.getAttribute("cx"));
    element.setAttribute("cx", "10px");
    length.convertToSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_MM);
    api.record.value("convert-mm", element.getAttribute("cx"));
    element.setAttribute("cx", "10px");
    length.convertToSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_IN);
    api.record.value("convert-in", element.getAttribute("cx"));
    element.setAttribute("cx", "10px");
    length.convertToSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PT);
    api.record.value("convert-pt", element.getAttribute("cx"));
    element.setAttribute("cx", "10px");
    length.convertToSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PC);
    api.record.value("convert-pc", element.getAttribute("cx"));

    const readOnly = element.cx.animVal;
    try {
      readOnly.value = 10;
      api.record.value("readonly-set", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 10);
      api.record.value("readonly-newValue", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.convertToSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX);
      api.record.value("readonly-convert", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
