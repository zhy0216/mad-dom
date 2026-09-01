// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGRect.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGRect(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<svg>` `viewBox` `baseVal`
// (a real SVGRect backed by the `viewBox` attribute). The read-only animVal
// error path is observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-rect";
export const description = "real differential: SVGRect x/y/width/height read/write via svg viewBox baseVal + read-only error";
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
    const rect = element.viewBox.baseVal;
    api.record.value("type", rect instanceof window.SVGRect);
    api.record.value("x-default", rect.x);
    api.record.value("y-default", rect.y);
    api.record.value("width-default", rect.width);
    api.record.value("height-default", rect.height);
    element.setAttribute("viewBox", "1.1 2.2 10.1 20.2");
    api.record.value("x-attribute", rect.x);
    api.record.value("y-attribute", rect.y);
    api.record.value("width-attribute", rect.width);
    api.record.value("height-attribute", rect.height);

    element.setAttribute("viewBox", "1.1 2.2 10.1 20.2");
    rect.x = 100;
    api.record.value("set-x-attr", element.getAttribute("viewBox"));
    element.setAttribute("viewBox", "1.1 2.2 10.1 20.2");
    rect.y = 100;
    api.record.value("set-y-attr", element.getAttribute("viewBox"));
    element.setAttribute("viewBox", "1.1 2.2 10.1 20.2");
    rect.width = 100;
    api.record.value("set-width-attr", element.getAttribute("viewBox"));
    element.setAttribute("viewBox", "1.1 2.2 10.1 20.2");
    rect.height = 100;
    api.record.value("set-height-attr", element.getAttribute("viewBox"));

    try {
      element.viewBox.animVal.x = 40;
      api.record.value("readonly-x", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
