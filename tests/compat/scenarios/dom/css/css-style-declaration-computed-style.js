// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/declaration/computed-style/CSSStyleDeclarationComputedStyle.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal
// `new CSSStyleDeclarationElementStyle(element)` + `getComputedStyle()` is
// replaced by `window.getComputedStyle(element)`. The caching assertion maps
// to the public identity of `getComputedStyle` returns (stable object whose
// values refresh after the style attribute changes). `var()` resolution is
// observed through `getPropertyValue()` on the computed declaration.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "css-style-declaration-computed-style";
export const description = "real differential: getComputedStyle identity/cache refresh and CSS var() resolution";
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
  const document = window.document;

  try {
    const element = document.createElement("div");
    document.body.appendChild(element);

    element.setAttribute("style", "border: 2px solid green;border-radius: 2px;font-size: 12px;");
    const computedElementStyle = window.getComputedStyle(element);
    api.record.identity("computed-identity-same", window.getComputedStyle(element), computedElementStyle);
    api.record.value("computed-border-radius", window.getComputedStyle(element).getPropertyValue("border-radius"));
    api.record.value("computed-border-top-width", window.getComputedStyle(element).getPropertyValue("border-top-width"));
    api.record.value("computed-font-size", window.getComputedStyle(element).getPropertyValue("font-size"));

    element.setAttribute("style", "border: 2px solid green;");
    api.record.identity("computed-identity-same-after-change", window.getComputedStyle(element), computedElementStyle);
    api.record.value("computed-border-radius-after", window.getComputedStyle(element).getPropertyValue("border-radius"));
    api.record.value("computed-font-size-after", window.getComputedStyle(element).getPropertyValue("font-size"));

    element.setAttribute("style", "--bg-color: rgb(0 128 0 / 1); background-color: var(--bg-color);");
    api.record.value(
      "computed-var-resolved",
      window.getComputedStyle(element).getPropertyValue("background-color"),
    );

    element.setAttribute(
      "style",
      "--bg-color-alpha: 1; background-color: rgb(0 128 0 / var(--bg-color-alpha, 1));",
    );
    api.record.value(
      "computed-nested-var-resolved",
      window.getComputedStyle(element).getPropertyValue("background-color"),
    );
  } catch (error) {
    api.record.error(error, "facade");
  }
}
