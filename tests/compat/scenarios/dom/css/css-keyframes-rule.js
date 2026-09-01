// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSKeyframesRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSKeyframesRule(...)` + the internal name slot slot write is replaced
// by parsing `@keyframes test { 0% { ... } }`. `type` / `cssRules` / `name` /
// `length` / `appendRule` / `deleteRule` / `findRule` are public getters and
// methods. Rule type constants (7, 8) are inlined from
// tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-keyframes-rule";
export const description = "real differential: CSSKeyframesRule type/cssRules/name/length + appendRule/deleteRule/findRule + errors";
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

  function recordThrow(fn, phase) {
    try {
      fn();
      api.record.error(new Error("no-throw"), phase);
    } catch (error) {
      api.record.error(error, phase);
    }
  }

  try {
    const sheet = new window.CSSStyleSheet();
    sheet.insertRule("@keyframes test { 0% { transform: rotate(360deg); } }");
    const cssRule = sheet.cssRules[0];

    api.record.value("type", cssRule.type);
    api.record.value("type-keyframes-rule", cssRule.type === 7);
    api.record.value("name", cssRule.name);
    api.record.value("css-rules-length", cssRule.cssRules.length);
    api.record.value("rule-0-type", cssRule.cssRules[0].type);
    api.record.value("rule-0-keyframe-rule", cssRule.cssRules[0].type === 8);
    api.record.value("rule-0-css-text", cssRule.cssRules[0].cssText);
    api.record.value("length", cssRule.length);

    cssRule.appendRule("100% { transform: rotate(0deg); }");
    api.record.value("css-rules-length-after-append", cssRule.cssRules.length);
    api.record.value("rule-1-css-text-after-append", cssRule.cssRules[1].cssText);

    recordThrow(() => cssRule.appendRule(), "sync-throw");
    recordThrow(() => cssRule.appendRule("100 { transform: rotate(0deg); }"), "sync-throw");
    recordThrow(() => cssRule.appendRule("test { transform: rotate(0deg); }"), "sync-throw");

    cssRule.deleteRule("0%");
    api.record.value("css-rules-length-after-delete", cssRule.cssRules.length);
    api.record.value("rule-0-css-text-after-delete", cssRule.cssRules[0].cssText);

    recordThrow(() => cssRule.deleteRule(), "sync-throw");

    const findSheet = new window.CSSStyleSheet();
    findSheet.insertRule("@keyframes spin { 0% { transform: rotate(360deg); } 100% { transform: rotate(0deg); } }");
    const findRule = findSheet.cssRules[0].findRule("0%");
    api.record.value("find-rule-css-text", findRule.cssText);
    api.record.value("find-rule-key-text", findRule.keyText);
    api.record.value("find-missing", findSheet.cssRules[0].findRule("50%"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
