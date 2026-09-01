// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSConditionRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSSupportsRule(...)` + the internal condition-text slot slot write is
// replaced by parsing `@supports <condition>` through a CSSStyleSheet and
// reading the public `conditionText` getter.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-condition-rule";
export const description = "real differential: CSSConditionRule.conditionText via @supports";
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
    sheet.insertRule("@supports screen and (min-width: 900px) { p { color: red } }");
    api.record.value("condition-text", sheet.cssRules[0].conditionText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
