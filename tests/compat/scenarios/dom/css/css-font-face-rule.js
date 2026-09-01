// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSFontFaceRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSFontFaceRule(...)` + the internal css-text slot slot write is
// replaced by parsing `@font-face { font-family: "Trickster"; }` and reading
// the public `type` / `style` / `cssText` getters. The rule type constant (5)
// is inlined from tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-font-face-rule";
export const description = "real differential: CSSFontFaceRule type/style/cssText";
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

  try {
    const sheet = new window.CSSStyleSheet();
    sheet.insertRule('@font-face { font-family: "Trickster"; }');
    const cssRule = sheet.cssRules[0];
    api.record.value("type", cssRule.type);
    api.record.value("type-font-face-rule", cssRule.type === 5);
    api.record.identity("style-identity", cssRule.style, cssRule.style);
    api.record.value("style-css-text", cssRule.style.cssText);
    api.record.value("style-font-family", cssRule.style.fontFamily);
    api.record.value("css-text", cssRule.cssText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
