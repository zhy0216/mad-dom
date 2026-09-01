// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSStyleRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSStyleRule(...)` + the internal selector-text slot slot write is
// replaced by parsing `div { color: red; border: 1px solid black }`. `type` /
// `selectorText` / `cssText` / `style` / `styleMap` are all public getters.
// The rule type constant (1) is inlined from
// tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-style-rule";
export const description = "real differential: CSSStyleRule type/styleMap/selectorText/cssText/style";
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
    sheet.insertRule("div { color: red; border: 1px solid black }");
    const cssRule = sheet.cssRules[0];

    api.record.value("type", cssRule.type);
    api.record.value("type-style-rule", cssRule.type === 1);
    api.record.value("selector-text", cssRule.selectorText);
    api.record.value("css-text", cssRule.cssText);
    api.record.value("style-css-text", cssRule.style.cssText);

    api.record.identity("style-map-identity", cssRule.styleMap, cssRule.styleMap);
    cssRule.styleMap.set("color", "red");
    cssRule.styleMap.set("border", "1px solid black");
    cssRule.styleMap.set("border-top", "2px solid red");
    api.record.value("style-map-css-text", cssRule.cssText);

    const emptySheet = new window.CSSStyleSheet();
    emptySheet.insertRule("div { }");
    const emptyRule = emptySheet.cssRules[0];
    api.record.value("empty-selector-text", emptyRule.selectorText);
    api.record.value("empty-css-text", emptyRule.cssText);

    const styleSheet = new window.CSSStyleSheet();
    styleSheet.insertRule("div { }");
    const styleRule = styleSheet.cssRules[0];
    styleRule.style.setProperty("color", "red");
    styleRule.style.setProperty("border", "1px solid black");
    api.record.value("style-css-text-after-set", styleRule.style.cssText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
