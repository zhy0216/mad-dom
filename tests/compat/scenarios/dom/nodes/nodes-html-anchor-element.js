// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-anchor-element/HTMLAnchorElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLAnchorElement surface — the
// attribute reflections (download/hreflang/ping/target/referrerPolicy/rel/
// type), the relList DOMTokenList, the hyperlink URL parts (href/origin/
// protocol/username/password/host/hostname/port/pathname/search/hash and the
// part setters writing the mutated URL back to the "href" attribute),
// toString and tabIndex. The navigation-on-click tests are dropped (browser
// navigation depends on Fetch/browser-frame mocks — host/network dependent),
// as are the window.open feature-string observations.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-anchor-element";
export const description = "real differential: public HTMLAnchorElement attribute reflections, relList, hyperlink URL parts and tabIndex";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window({ url: "https://www.somesite.com/test.html" });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const element = document.createElement("a");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    for (const property of ["download", "hreflang", "ping", "target", "referrerPolicy", "rel", "type"]) {
      element.setAttribute(property, "test");
      api.record.value(`get-${property}`, element[property]);
      element[property] = "value";
      api.record.value(`set-${property}`, element.getAttribute(property));
    }

    // relList DOMTokenList over the "rel" attribute.
    element.setAttribute("rel", "value1 value2");
    api.record.value("relList-value", element.relList.value);
    api.record.value("relList-length", element.relList.length);
    api.record.value("relList-0", element.relList[0]);
    api.record.value("relList-1", element.relList[1]);
    element.relList.add("value3");
    api.record.value("relList-add", element.getAttribute("rel"));
    element.relList = "a b";
    api.record.value("relList-set", element.getAttribute("rel"));

    // href getter resolves against the window location (absolute / relative).
    element.setAttribute("href", "http://www.example.com");
    api.record.value("href-http", element.href);
    element.setAttribute("href", "tel:+123456789");
    api.record.value("href-tel", element.href);
    element.setAttribute("href", "//example.com");
    api.record.value("href-scheme-relative", element.href);
    element.setAttribute("href", "test");
    api.record.value("href-relative", element.href);
    element.removeAttribute("href");
    api.record.value("href-empty", element.href);

    // href setter writes the raw attribute.
    element.href = "test";
    api.record.value("href-set-attr", element.getAttribute("href"));
    element.href = "https://example.com";
    api.record.value("href-set-abs-attr", element.getAttribute("href"));

    // toString mirrors href.
    element.setAttribute("href", "http://www.example.com");
    api.record.value("toString-http", element.toString());
    element.setAttribute("href", "test");
    api.record.value("toString-relative", element.toString());
    element.removeAttribute("href");
    api.record.value("toString-empty", element.toString());

    // origin.
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    api.record.value("origin-standard", element.origin);
    element.setAttribute("href", "http://www.example.com:8080/path?q1=a#xyz");
    api.record.value("origin-port", element.origin);
    element.setAttribute("href", "/path?q1=a#xyz");
    api.record.value("origin-relative", element.origin);

    // protocol getter / setter.
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    api.record.value("protocol-get", element.protocol);
    element.protocol = "http";
    api.record.value("protocol-after-set", element.protocol);
    api.record.value("protocol-href-after-set", element.href);

    // username getter / setter.
    element.setAttribute("href", "https://user:pw@www.example.com:443/path?q1=a#xyz");
    api.record.value("username-get", element.username);
    element.username = "user2";
    api.record.value("username-after-set", element.username);
    api.record.value("username-href-after-set", element.href);

    // password getter / setter.
    api.record.value("password-get", element.password);
    element.password = "pw2";
    api.record.value("password-after-set", element.password);
    api.record.value("password-href-after-set", element.href);

    // host getter / setter.
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    api.record.value("host-get", element.host);
    element.host = "abc.example2.com";
    api.record.value("host-after-set", element.host);
    api.record.value("host-href-after-set", element.href);

    // hostname getter / setter.
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    api.record.value("hostname-get", element.hostname);
    element.hostname = "abc.example2.com";
    api.record.value("hostname-after-set", element.hostname);
    api.record.value("hostname-href-after-set", element.href);

    // port getter / setter.
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    api.record.value("port-default", element.port);
    element.setAttribute("href", "https://www.example.com:444/path?q1=a#xyz");
    api.record.value("port-non-default", element.port);
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    element.port = "8080";
    api.record.value("port-after-set", element.port);
    api.record.value("port-href-after-set", element.href);

    // pathname getter / setter.
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    api.record.value("pathname-get", element.pathname);
    element.pathname = "/path2";
    api.record.value("pathname-after-set", element.pathname);
    api.record.value("pathname-href-after-set", element.href);

    // search getter / setter.
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    api.record.value("search-get", element.search);
    element.search = "?q1=b";
    api.record.value("search-after-set", element.search);
    api.record.value("search-href-after-set", element.href);

    // hash getter / setter.
    element.setAttribute("href", "https://www.example.com:443/path?q1=a#xyz");
    api.record.value("hash-get", element.hash);
    element.hash = "#fgh";
    api.record.value("hash-after-set", element.hash);
    api.record.value("hash-href-after-set", element.href);

    // tabIndex.
    const fresh = document.createElement("a");
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
