// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/CSSRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the upstream `new CSSStyleRule(...)` +
// internal symbol-keyed slot writes are replaced by rules obtained from
// `CSSStyleSheet.insertRule()` (public construction of a top-level and a
// nested `@media` rule). Static type constants are read off the public
// `CSSRule` export and inlined from
// tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts. The illegal-
// constructor construction path has no public surface and is dropped.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-rule";
export const description = "real differential: CSSRule static type constants, parentRule/parentStyleSheet of parsed rules";
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

  const staticCases = [
    ["CONTAINER_RULE", 0],
    ["STYLE_RULE", 1],
    ["IMPORT_RULE", 3],
    ["MEDIA_RULE", 4],
    ["FONT_FACE_RULE", 5],
    ["PAGE_RULE", 6],
    ["KEYFRAMES_RULE", 7],
    ["KEYFRAME_RULE", 8],
    ["NAMESPACE_RULE", 10],
    ["COUNTER_STYLE_RULE", 11],
    ["SUPPORTS_RULE", 12],
    ["DOCUMENT_RULE", 13],
    ["FONT_FEATURE_VALUES_RULE", 14],
    ["REGION_STYLE_RULE", 16],
  ];

  try {
    const cssRule = entry.CSSRule;
    api.record.value("css-rule-typeof", typeof cssRule);
    for (const [name, value] of staticCases) {
      api.record.value(`static-${name}`, cssRule[name]);
    }

    const sheet = new window.CSSStyleSheet();
    sheet.insertRule("div { color: red }");
    const styleRule = sheet.cssRules[0];
    api.record.value("style-rule-parentRule", styleRule.parentRule);
    api.record.identity("style-rule-parentStyleSheet", styleRule.parentStyleSheet, sheet);
    api.record.identity("style-rule-parentSheet-null", styleRule.parentStyleSheet, null);

    sheet.insertRule("@media screen { span { color: blue } }");
    const mediaRule = sheet.cssRules[1];
    const child = mediaRule.cssRules[0];
    api.record.identity("nested-parentRule", child.parentRule, mediaRule);
    api.record.identity("nested-parentStyleSheet", child.parentStyleSheet, sheet);
    api.record.value("nested-parentRule-null", child.parentRule === null);
    api.record.value("style-parentRule-null", styleRule.parentRule === null);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
