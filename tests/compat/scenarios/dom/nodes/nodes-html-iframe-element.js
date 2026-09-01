// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-iframe-element/HTMLIFrameElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLIFrameElement surface — the
// attribute reflections (allow/height/width/name/referrerPolicy/srcdoc), the
// URL-resolved src getter with the raw-attribute setter, the sandbox
// DOMTokenList and the tabIndex "0" default. The page-loading tests
// (srcdoc/src navigation, contentWindow/contentDocument, x-frame-options,
// script execution) are dropped — they depend on Fetch / browser-frame
// navigation (host/network dependent).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-iframe-element";
export const description = "real differential: public HTMLIFrameElement attribute reflections, src resolution, sandbox DOMTokenList, tabIndex";
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
    const element = document.createElement("iframe");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    for (const property of ["allow", "height", "width", "name", "srcdoc"]) {
      element.setAttribute(property, "value");
      api.record.value(`get-${property}`, element[property]);
      element[property] = "value";
      api.record.value(`set-${property}`, element.getAttribute(property));
    }

    // src getter resolves against the window location; setter writes raw.
    element.setAttribute("src", "test");
    api.record.value("src-relative", element.src);
    element.setAttribute("src", "https://example.com/page");
    api.record.value("src-absolute", element.src);
    element.removeAttribute("src");
    api.record.value("src-empty", element.src);
    element.src = "test";
    api.record.value("src-set-attr", element.getAttribute("src"));

    // sandbox DOMTokenList over the "sandbox" attribute.
    api.record.value("sandbox-default-value", element.sandbox.value);
    api.record.value("sandbox-default-length", element.sandbox.length);
    element.sandbox.add("allow-forms", "allow-scripts");
    api.record.value("sandbox-add", element.sandbox.toString());
    element.setAttribute("sandbox", "allow-forms allow-scripts");
    api.record.value("sandbox-attr-value", element.sandbox.toString());
    api.record.value("sandbox-length", element.sandbox.length);
    api.record.value("sandbox-0", element.sandbox[0]);
    api.record.value("sandbox-1", element.sandbox[1]);
    element.sandbox = "allow-forms allow-scripts";
    api.record.value("sandbox-set-attr", element.getAttribute("sandbox"));

    // srcdoc round-trip.
    element.srcdoc = "<div></div>";
    api.record.value("srcdoc-set", element.getAttribute("srcdoc"));
    api.record.value("srcdoc-get", element.srcdoc);

    // tabIndex.
    const fresh = document.createElement("iframe");
    api.record.value("tabindex-default", fresh.tabIndex);
    fresh.setAttribute("tabindex", "5");
    api.record.value("tabindex-attr", fresh.tabIndex);
    fresh.setAttribute("tabindex", "invalid");
    api.record.value("tabindex-nan", fresh.tabIndex);
    fresh.tabIndex = 5;
    api.record.value("tabindex-set-5", fresh.getAttribute("tabindex"));
    fresh.tabIndex = -1;
    api.record.value("tabindex-set-neg", fresh.getAttribute("tabindex"));
    fresh.tabIndex = "invalid";
    api.record.value("tabindex-set-invalid", fresh.getAttribute("tabindex"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
