// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGNumber.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGNumber(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `svg.createSVGNumber()` mint
// (standalone value) and through a `<feColorMatrix>` `values` `baseVal` list
// item (attribute-backed). The read-only error uses a read-only animVal list
// item.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-number";
export const description = "real differential: SVGNumber value read/write via createSVGNumber mint + values list item + errors";
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
    const svg = document.createElementNS(SVG_NS, "svg");
    const number = svg.createSVGNumber();
    api.record.value("type", number instanceof window.SVGNumber);
    api.record.value("value-default", number.value);
    number.value = 10;
    api.record.value("value-set", number.value);
    api.record.value("value-set-readback", number.value);

    const element = document.createElementNS(SVG_NS, "feColorMatrix");
    element.setAttribute("values", "10");
    const item = element.values.baseVal.getItem(0);
    api.record.value("value-from-attribute", item.value);
    item.value = 10;
    api.record.value("value-attr-readback", item.value);
    item.value = "10.5";
    api.record.value("value-parse-float", item.value);
    api.record.value("value-attr-writeback", element.getAttribute("values"));

    try {
      item.value = "abc";
      api.record.value("value-nonnumber", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      element.values.animVal.getItem(0).value = 10;
      api.record.value("readonly-set", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
