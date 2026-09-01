// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSScopeRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSScopeRule(...)` + the internal start / end slots slot writes are
// replaced by parsing `@scope` declarations and reading the public `type` /
// `start` / `end` / `cssText` getters and `insertRule()`. The rule type
// constant (0) is inlined from
// tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-scope-rule";
export const description = "real differential: CSSScopeRule type/start/end/cssText";
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
    sheet.insertRule("@scope { }");
    const cssRule = sheet.cssRules[0];
    api.record.value("type", cssRule.type);
    api.record.value("type-container-rule", cssRule.type === 0);
    api.record.value("start-empty", cssRule.start);
    api.record.value("end-empty", cssRule.end);
    api.record.value("css-text-empty", cssRule.cssText);

    const fromToSheet = new window.CSSStyleSheet();
    fromToSheet.insertRule("@scope (.from .element) to (.to .element) { div { color: red; } }");
    const fromToRule = fromToSheet.cssRules[0];
    api.record.value("start-from-to", fromToRule.start);
    api.record.value("end-from-to", fromToRule.end);
    api.record.value("css-text-from-to", fromToRule.cssText);

    fromToRule.insertRule("span { color: blue; }");
    api.record.value("css-text-after-insert", fromToRule.cssText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
