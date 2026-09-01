// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-style-element/SVGStyleElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the SVGStyleElement constructor identity, the
// `Object.prototype.toString` tag, the `media` / `type` / `title` / `disabled`
// attribute reflections and the live `sheet` `CSSStyleSheet` generated from the
// element text content (parsed on access, re-parsed on append / remove /
// insert / text-node data edits, and feeding `getComputedStyle` for matching
// rules). The internal `CSSStyleSheetElementStyle` construction is replaced by
// the public `element.sheet`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { SVG_NS, observeInstanceof } from "./_svg-helpers.js";

export const id = "nodes-svg-style-element";
export const description = "real differential: SVGStyleElement identity + media/type/title/disabled + live sheet";
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
    const element = document.createElementNS(SVG_NS, "style");
    observeInstanceof(api, window, element, "SVGStyleElement", "SVGElement");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    api.record.value("media-default", element.media);
    element.setAttribute("media", "test");
    api.record.value("media-read", element.media);
    element.media = "test";
    api.record.value("media-write", element.getAttribute("media"));

    api.record.value("type-default", element.type);
    element.setAttribute("type", "test");
    api.record.value("type-read", element.type);
    element.type = "test";
    api.record.value("type-write", element.getAttribute("type"));

    api.record.value("title-default", element.title);
    element.setAttribute("title", "test");
    api.record.value("title-read", element.title);
    element.title = "test";
    api.record.value("title-write", element.getAttribute("title"));

    api.record.value("disabled-default", element.disabled);
    element.disabled = true;
    api.record.value("disabled-set", element.disabled);
    api.record.value("disabled-attr", element.getAttribute("disabled"));

    api.record.value("sheet-detached", element.sheet);

    const textNode = document.createTextNode(
      "body { background-color: red }\ndiv { background-color: green }",
    );
    element.appendChild(textNode);
    document.head.appendChild(element);

    api.record.value("sheet-length", element.sheet.cssRules.length);
    api.record.value("sheet-rule0", element.sheet.cssRules[0].cssText);
    api.record.value("sheet-rule1", element.sheet.cssRules[1].cssText);

    element.sheet.insertRule("html { background-color: blue }", 0);
    api.record.value("sheet-insert-length", element.sheet.cssRules.length);
    api.record.value("sheet-insert-rule0", element.sheet.cssRules[0].cssText);
    api.record.value("sheet-insert-rule1", element.sheet.cssRules[1].cssText);
    api.record.value("sheet-insert-rule2", element.sheet.cssRules[2].cssText);

    const textNode2 = document.createTextNode("html { background-color: blue }");
    element.insertBefore(textNode2, textNode);
    api.record.value("sheet-insert-before-length", element.sheet.cssRules.length);
    api.record.value("sheet-insert-before-rule0", element.sheet.cssRules[0].cssText);
    api.record.value("sheet-insert-before-rule1", element.sheet.cssRules[1].cssText);
    api.record.value("sheet-insert-before-rule2", element.sheet.cssRules[2].cssText);

    element.removeChild(textNode2);
    api.record.value("sheet-remove-length", element.sheet.cssRules.length);

    const documentElementComputedStyle = window.getComputedStyle(document.documentElement);
    api.record.value("computed-before", documentElementComputedStyle.backgroundColor);
    textNode.data = "html { background-color: blue }";
    api.record.value("sheet-edit-length", element.sheet.cssRules.length);
    api.record.value("sheet-edit-rule0", element.sheet.cssRules[0].cssText);
    api.record.value("computed-after", documentElementComputedStyle.backgroundColor);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
