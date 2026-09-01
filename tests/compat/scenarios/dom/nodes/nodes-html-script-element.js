// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-script-element/HTMLScriptElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLScriptElement surface — the
// type/charset/lang/crossOrigin/integrity attribute reflections, the async/
// defer/noModule booleans, the blocking DOMTokenList, the fetchPriority /
// referrerPolicy enum reflections, the URL-resolved src getter with the raw
// setter and the textContent-backed text accessor. The external-script and
// module loading/execution tests (Fetch/ResourceFetch network dependency) and
// the in-place script-evaluation tests (the evaluation engine is not
// surfaced) are dropped.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-script-element";
export const description = "real differential: public HTMLScriptElement attribute/enum reflections, blocking DOMTokenList, src, text";
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
    const element = document.createElement("script");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // string attribute reflections.
    for (const property of ["type", "charset", "lang", "integrity"]) {
      element.setAttribute(property, "test");
      api.record.value(`get-${property}`, element[property]);
      element[property] = "value";
      api.record.value(`set-${property}`, element.getAttribute(property));
    }
    element.setAttribute("crossorigin", "test");
    api.record.value("get-crossOrigin", element.crossOrigin);
    element.crossOrigin = "value";
    api.record.value("set-crossOrigin", element.getAttribute("crossorigin"));

    // boolean reflections.
    for (const property of ["async", "defer", "noModule"]) {
      const el = document.createElement("script");
      api.record.value(`bool-${property}-default`, el[property]);
      el.setAttribute(property, "");
      api.record.value(`bool-${property}-attr`, el[property]);
      el[property] = true;
      api.record.value(`bool-${property}-set`, el.getAttribute(property));
      el[property] = false;
      api.record.value(`bool-${property}-clear`, el.getAttribute(property));
    }

    // blocking DOMTokenList.
    element.setAttribute("blocking", "value1 value2");
    api.record.value("blocking-value", element.blocking.value);
    api.record.value("blocking-length", element.blocking.length);
    api.record.value("blocking-0", element.blocking[0]);
    api.record.value("blocking-1", element.blocking[1]);
    element.blocking = "value1 value2";
    api.record.value("blocking-set", element.getAttribute("blocking"));

    // fetchPriority enum reflection.
    api.record.value("fetchPriority-default", element.fetchPriority);
    element.setAttribute("fetchpriority", "high");
    api.record.value("fetchPriority-high", element.fetchPriority);
    element.setAttribute("fetchpriority", "low");
    api.record.value("fetchPriority-low", element.fetchPriority);
    element.setAttribute("fetchpriority", "normal");
    api.record.value("fetchPriority-normal", element.fetchPriority);
    element.setAttribute("fetchpriority", "invalid");
    api.record.value("fetchPriority-invalid", element.fetchPriority);
    element.fetchPriority = "high";
    api.record.value("fetchPriority-set", element.getAttribute("fetchpriority"));

    // referrerPolicy enum reflection.
    api.record.value("referrerPolicy-default", element.referrerPolicy);
    element.setAttribute("referrerpolicy", "no-referrer");
    api.record.value("referrerPolicy-no-referrer", element.referrerPolicy);
    element.setAttribute("referrerpolicy", "unsafe-url");
    api.record.value("referrerPolicy-unsafe-url", element.referrerPolicy);
    element.setAttribute("referrerpolicy", "invalid");
    api.record.value("referrerPolicy-invalid", element.referrerPolicy);
    element.referrerPolicy = "origin";
    api.record.value("referrerPolicy-set", element.getAttribute("referrerpolicy"));

    // src getter resolves against the window location; setter writes raw.
    element.setAttribute("src", "test");
    api.record.value("src-relative", element.src);
    element.setAttribute("src", "https://example.com/script.js");
    api.record.value("src-absolute", element.src);
    element.removeAttribute("src");
    api.record.value("src-empty", element.src);
    element.src = "test";
    api.record.value("src-set-attr", element.getAttribute("src"));

    // text getter / setter.
    const textEl = document.createElement("script");
    textEl.appendChild(document.createTextNode("test"));
    api.record.value("text-get", textEl.text);
    textEl.text = "test2";
    api.record.value("text-set", textEl.text);
    api.record.value("text-set-content", textEl.textContent);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
