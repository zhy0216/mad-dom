// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSGroupingRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSScopeRule(...)` is replaced by parsing `@scope { }` through a
// CSSStyleSheet. `cssRules` / `insertRule` / `deleteRule` / `cssText` are all
// public getters/methods. The WebIDL argument-count and parse/range error
// messages are recorded verbatim. The `toBeInstanceOf(CSSStyleRule)` assertion
// maps to the public `rule.cssRules[i].cssText` shape.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-grouping-rule";
export const description = "real differential: CSSGroupingRule cssRules/insertRule/deleteRule/cssText + WebIDL errors";
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
    sheet.insertRule("@scope { }");
    const cssRule = sheet.cssRules[0];

    cssRule.insertRule("body { color: red; }");
    api.record.value("css-rules-length-1", cssRule.cssRules.length);
    api.record.value("rule-0-css-text", cssRule.cssRules[0].cssText);

    cssRule.insertRule(".test { color: blue; }");
    api.record.value("css-rules-length-2", cssRule.cssRules.length);
    api.record.value("rule-0-css-text-2", cssRule.cssRules[0].cssText);
    api.record.value("rule-1-css-text-2", cssRule.cssRules[1].cssText);

    cssRule.insertRule(".test2 { color: green; }", 1);
    api.record.value("css-rules-length-3", cssRule.cssRules.length);
    api.record.value("rule-0-css-text-3", cssRule.cssRules[0].cssText);
    api.record.value("rule-1-css-text-3", cssRule.cssRules[1].cssText);
    api.record.value("rule-2-css-text-3", cssRule.cssRules[2].cssText);

    recordThrow(() => cssRule.insertRule(), "sync-throw");
    recordThrow(() => cssRule.insertRule("{ color: red; }"), "sync-throw");
    recordThrow(() => cssRule.insertRule("body { color: red; } .test { color: blue; }"), "sync-throw");
    recordThrow(() => cssRule.insertRule("body { color: red; }", "invalid"), "sync-throw");
    recordThrow(() => cssRule.insertRule("body { color: red; }", 1), "sync-throw");

    cssRule.deleteRule(0);
    api.record.value("css-rules-length-after-delete", cssRule.cssRules.length);
    api.record.value("rule-0-css-text-after-delete", cssRule.cssRules[0].cssText);

    recordThrow(() => cssRule.deleteRule(), "sync-throw");
    recordThrow(() => cssRule.deleteRule("invalid"), "sync-throw");
    recordThrow(() => cssRule.deleteRule(1), "sync-throw");

    const cssTextSheet = new window.CSSStyleSheet();
    cssTextSheet.insertRule("@scope { }");
    const cssTextRule = cssTextSheet.cssRules[0];
    api.record.value("css-text-empty", cssTextRule.cssText);
    cssTextRule.insertRule("body { color: red; }");
    cssTextRule.insertRule(".test { color: blue; }");
    api.record.value("css-text-after-insert", cssTextRule.cssText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
