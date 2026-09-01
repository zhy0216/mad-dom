// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSMediaRule.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSMediaRule(...)` is replaced by parsing `@media { }` / `@media
// screen, print { ... }` through a CSSStyleSheet. `type` / `media` /
// `conditionText` / `cssText` and `media`'s `appendMedium` / `mediaText` are
// all public getters/methods. The rule type constant (4) is inlined from
// tests/happy-dom/vendor-src-enums/css/CSSRuleTypeEnum.ts.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-media-rule";
export const description = "real differential: CSSMediaRule type/media/conditionText/cssText";
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
    sheet.insertRule("@media { }");
    const cssRule = sheet.cssRules[0];

    api.record.value("type", cssRule.type);
    api.record.value("type-media-rule", cssRule.type === 4);
    api.record.identity("media-identity", cssRule.media, cssRule.media);
    api.record.value("css-text-empty", cssRule.cssText);

    cssRule.media.appendMedium("screen");
    cssRule.media.appendMedium("print");
    api.record.value("media-text-after-append", cssRule.media.mediaText);
    api.record.value("condition-text-after-append", cssRule.conditionText);
    api.record.value("media-length-after-append", cssRule.media.length);
    api.record.value("media-0-after-append", cssRule.media[0]);
    api.record.value("media-1-after-append", cssRule.media[1]);

    cssRule.media.mediaText = "test";
    api.record.value("media-text-after-set", cssRule.media.mediaText);
    api.record.value("condition-text-after-set", cssRule.conditionText);
    api.record.value("media-length-after-set", cssRule.media.length);
    api.record.value("media-0-after-set", cssRule.media[0]);

    cssRule.media.appendMedium("screen");
    cssRule.media.appendMedium("print");
    cssRule.insertRule("body { color: red; }");
    cssRule.insertRule(".test { color: blue; }");
    api.record.value("css-text-after-insert", cssRule.cssText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
