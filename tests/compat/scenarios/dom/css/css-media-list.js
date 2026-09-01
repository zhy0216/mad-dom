// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/MediaList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the upstream `new CSSMediaRule(...)` +
// the internal condition-text slot slot writes are replaced by a parsed
// `@media` rule's live `media` list; `mediaText` writes drive the condition
// text through the public setter. Indexed access, `item()`, `length`,
// `appendMedium` / `deleteMedium` are all read through public members.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-media-list";
export const description = "real differential: MediaList indexed access, mediaText, item, appendMedium/deleteMedium";
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
    sheet.insertRule("@media screen, print { }");
    const mediaRule = sheet.cssRules[0];
    const mediaList = mediaRule.media;

    api.record.identity("media-identity", mediaList, mediaList);
    api.record.value("media-text-initial", mediaRule.conditionText);
    mediaList.mediaText = "";
    api.record.value("media-length-empty", mediaList.length);
    api.record.value("media-0-empty", mediaList[0]);
    api.record.value("media-item-0-empty", mediaList.item(0));

    mediaList.mediaText = "screen, print";
    api.record.value("media-text", mediaList.mediaText);
    api.record.value("media-condition-after", mediaRule.conditionText);
    api.record.value("media-length", mediaList.length);
    api.record.value("media-0", mediaList[0]);
    api.record.value("media-1", mediaList[1]);
    api.record.value("media-2", mediaList[2]);
    api.record.value("media-item-0", mediaList.item(0));
    api.record.value("media-item-1", mediaList.item(1));
    api.record.value("media-item-2", mediaList.item(2));

    mediaList.mediaText = "screen, print , speech";
    api.record.value("media-0-spaced", mediaList[0]);
    api.record.value("media-1-spaced", mediaList[1]);
    api.record.value("media-2-spaced", mediaList[2]);
    api.record.value("media-3-spaced", mediaList[3]);
    api.record.value("media-text-spaced", mediaList.mediaText);

    mediaList.mediaText = "screen";
    api.record.value("media-0-single", mediaList[0]);
    api.record.value("media-1-single", mediaList[1]);

    mediaList.mediaText = "screen, print, speech";
    api.record.value("media-length-3", mediaList.length);

    mediaList.mediaText = "screen,print";
    api.record.value("media-text-normalized", mediaList.mediaText);

    mediaList.mediaText = null;
    api.record.value("media-text-null", mediaList.mediaText);
    api.record.value("media-condition-null", mediaRule.conditionText);

    mediaList.mediaText = undefined;
    api.record.value("media-text-undefined", mediaList.mediaText);
    api.record.value("media-condition-undefined", mediaRule.conditionText);

    mediaList.mediaText = "";
    mediaList.appendMedium("screen");
    api.record.value("append-1", mediaList.mediaText);
    mediaList.appendMedium("print");
    api.record.value("append-2", mediaList.mediaText);
    mediaList.appendMedium("print");
    api.record.value("append-dup", mediaList.mediaText);
    api.record.value("append-condition", mediaRule.conditionText);

    mediaList.mediaText = "screen, print";
    mediaList.deleteMedium("screen");
    api.record.value("delete-1", mediaList.mediaText);
    mediaList.deleteMedium("print");
    api.record.value("delete-2", mediaList.mediaText);
    api.record.value("delete-condition", mediaRule.conditionText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
