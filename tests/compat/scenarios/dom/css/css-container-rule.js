// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSContainerRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSContainerRule(...)` + the internal condition-text slot slot write is
// replaced by parsing `@container (min-width: 900px) { }` and using the
// public `type` / `conditionText` / `cssText` getters and `insertRule()`.
// The rule type constant (0) is inlined from
// tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-container-rule";
export const description = "real differential: CSSContainerRule type/conditionText/cssText and insertRule";
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
    sheet.insertRule("@container (min-width: 900px) { }");
    const cssRule = sheet.cssRules[0];
    api.record.value("type", cssRule.type);
    api.record.value("type-container-rule", cssRule.type === 0);
    api.record.value("condition-text", cssRule.conditionText);
    api.record.value("css-text-empty", cssRule.cssText);

    cssRule.insertRule("body { color: red; }");
    cssRule.insertRule(".test { color: blue; }");
    api.record.value("css-text-after-insert", cssRule.cssText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
