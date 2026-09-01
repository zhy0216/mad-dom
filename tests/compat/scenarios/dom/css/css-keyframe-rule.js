// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSKeyframeRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSKeyframeRule(...)` + the internal key-text / css-text slots slot
// writes are replaced by parsing `@keyframes` and reading the public
// `type` / `keyText` / `style` / `cssText` getters on the first keyframe.
// The rule type constant (8) is inlined from
// tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-keyframe-rule";
export const description = "real differential: CSSKeyframeRule type/keyText/style/cssText";
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
    sheet.insertRule("@keyframes spin { 0% { top: 200px; } }");
    const cssRule = sheet.cssRules[0].cssRules[0];
    api.record.value("type", cssRule.type);
    api.record.value("type-keyframe-rule", cssRule.type === 8);
    api.record.value("key-text", cssRule.keyText);
    api.record.identity("style-identity", cssRule.style, cssRule.style);
    api.record.value("style-css-text", cssRule.style.cssText);
    api.record.value("style-top", cssRule.style.top);
    api.record.value("css-text", cssRule.cssText);

    const fromSheet = new window.CSSStyleSheet();
    fromSheet.insertRule("@keyframes spin { from { top: 100px; } }");
    api.record.value("from-key-text", fromSheet.cssRules[0].cssRules[0].keyText);
    api.record.value("from-css-text", fromSheet.cssRules[0].cssRules[0].cssText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
