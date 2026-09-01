// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-link-element/HTMLLinkElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLLinkElement surface — the
// attribute reflections (as/crossOrigin/href/hreflang/media/referrerPolicy/
// rel/type), the relList DOMTokenList with its supported-token `supports()`,
// and the URL-resolved href getter with the raw-attribute setter. The external
// stylesheet / module-preload loading and error-event tests are dropped
// (ResourceFetch network + browser-frame mock dependency — host/network
// dependent).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-link-element";
export const description = "real differential: public HTMLLinkElement attribute reflections, relList supports, href resolution";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window({ url: "https://localhost:8080/test/path/" });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const element = document.createElement("link");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    for (const property of ["as", "crossOrigin", "href", "hreflang", "media", "referrerPolicy", "rel", "type"]) {
      element.setAttribute(property, "test");
      api.record.value(`get-${property}`, element[property]);
      element[property] = "value";
      api.record.value(`set-${property}`, element.getAttribute(property));
    }

    // relList over the "rel" attribute with the hardcoded supported tokens.
    element.setAttribute("rel", "value1 value2");
    api.record.value("relList-value", element.relList.value);
    api.record.value("relList-length", element.relList.length);
    api.record.value("relList-0", element.relList[0]);
    api.record.value("relList-1", element.relList[1]);
    api.record.value("relList-supports-stylesheet", element.relList.supports("stylesheet"));
    api.record.value("relList-supports-modulepreload", element.relList.supports("modulepreload"));
    api.record.value("relList-supports-preload", element.relList.supports("preload"));
    api.record.value("relList-supports-unsupported", element.relList.supports("unsupported"));
    element.relList.add("value3");
    api.record.value("relList-add", element.getAttribute("rel"));
    element.relList = "a b";
    api.record.value("relList-set", element.getAttribute("rel"));

    // href getter resolves against the window location.
    element.setAttribute("href", "test");
    api.record.value("href-relative", element.href);
    element.removeAttribute("href");
    api.record.value("href-empty", element.href);
    element.href = "test";
    api.record.value("href-set-attr", element.getAttribute("href"));
    element.href = "https://example.com";
    api.record.value("href-set-abs-attr", element.getAttribute("href"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
