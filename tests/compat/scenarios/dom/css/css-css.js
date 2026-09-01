// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/CSS.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: `window.CSS` replaces the internal `CSS`
// class; the unit list is inlined from
// tests/happy-dom/vendor-src-enums/css/CSSUnits.ts (the vendored literal, not
// guessed). The upstream `new CSS()` constructor call is not public surface —
// the `CSS` namespace is exposed as `window.CSS` only, and all observed unit
// factories / supports / escape behaviors are reachable on it.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-css";
export const description = "real differential: window.CSS unit factories, supports(), escape()";
export const targets = "real";

// Inlined from tests/happy-dom/vendor-src-enums/css/CSSUnits.ts.
const CSS_UNITS = [
  "Hz", "Q", "ch", "cm", "deg", "dpcm", "dpi", "dppx", "em", "ex", "fr", "grad",
  "in", "kHz", "mm", "ms", "number", "pc", "percent", "pt", "px", "rad", "rem",
  "s", "turn", "vh", "vmax", "vmin", "vw",
];

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  const css = window.CSS;
  api.record.value("css-typeof", typeof css);

  for (const unit of CSS_UNITS) {
    const factory = css[unit];
    if (typeof factory === "function") {
      const cssUnitValue = factory(100);
      api.record.value(`unit-${unit}-factory-typeof`, typeof factory);
      api.record.value(`unit-${unit}-unit`, cssUnitValue.unit);
      api.record.value(`unit-${unit}-value`, cssUnitValue.value);
    } else {
      api.record.value(`unit-${unit}-factory-typeof`, typeof factory);
    }
  }

  api.record.value("supports-condition", css.supports("condition"));
  api.record.value("supports-property-value", css.supports("property", "value"));

  for (const [label, input] of [
    ["escape-dot", ".foo#bar"],
    ["escape-parens", "()[]{}"],
    ["escape-custom-prop", "--a"],
    ["escape-leading-zero", "0"],
    ["escape-nul", "\0"],
  ]) {
    api.record.value(label, css.escape(input));
  }
}
