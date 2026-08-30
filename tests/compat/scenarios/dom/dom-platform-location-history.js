// Real differential scenario (T45): the window platform objects.
//
// Scope is exactly the deterministic synchronous T45 slice: `window.location`
// reads, the `hash` setter, `history.pushState` / `replaceState` (including the
// arg-count TypeError and the cross-origin SecurityError), the session-history
// length / state / scrollRestoration, the `document.URL` / `documentURI`
// linkage, the fixed `navigator` values, and the `window.URL` / `window.DOMException`
// constructors reused from the host.
//
// Deliberately absent (T45 boundary / non-deterministic in happy-dom): full
// navigation — the `href` setter, the property setters, `assign`, `replace`,
// `reload`, `history.back/forward/go` — which in happy-dom replaces the window
// and fetches asynchronously while MAD DOM simulates it synchronously; those
// are covered by the Bun integration tests instead. Events (`hashchange`) are
// also out of scope: our `Window` is not an EventTarget and happy-dom's
// dispatch is async.
export const id = "dom-platform-location-history";
export const description =
  "real differential: window.location reads + hash setter, history.pushState/replaceState (errors, length, state, scrollRestoration), document.URL/documentURI linkage, navigator values, window.URL/window.DOMException constructors";
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
  const location = window.location;
  const history = window.history;

  try {
    // 1. Location reads on the default (about:blank) window.
    api.record.value("loc-href", location.href);
    api.record.value("loc-hash", location.hash);
    api.record.value("loc-host", location.host);
    api.record.value("loc-hostname", location.hostname);
    api.record.value("loc-origin", location.origin);
    api.record.value("loc-pathname", location.pathname);
    api.record.value("loc-port", location.port);
    api.record.value("loc-protocol", location.protocol);
    api.record.value("loc-search", location.search);
    api.record.value("loc-tostring", location.toString());
    api.record.value("loc-string", String(location));
    api.record.value("loc-tag", Object.prototype.toString.call(location));
    api.record.value("loc-own-keys", Object.keys(location));
    api.record.value("loc-proto-name", Object.getPrototypeOf(location).constructor.name);

    // 2. Document URL linkage and history baseline.
    api.record.value("doc-url", document.URL);
    api.record.value("doc-document-uri", document.documentURI);
    api.record.value("doc-url-eq-loc", document.URL === location.href);
    api.record.value("hist-length", history.length);
    api.record.value("hist-state", history.state);
    api.record.value("hist-scroll-restoration", history.scrollRestoration);

    // 3. The hash setter pushes a history entry, updates the URL and keeps
    // document.URL linked; an unchanged hash is a no-op.
    {
      const lengthBefore = history.length;
      location.hash = "#part1";
      api.record.value("hash-set-href", location.href);
      api.record.value("hash-set-length-delta", history.length - lengthBefore);
      api.record.value("hash-set-doc-url", document.URL);
      api.record.value("hash-set-state", history.state);
      location.hash = "#part1";
      api.record.value("hash-set-same-delta", history.length - lengthBefore);
      location.hash = "#part2";
      api.record.value("hash-set-second-delta", history.length - lengthBefore);
      api.record.value("hash-set-second-href", location.href);
    }

    // 4. pushState: relative URLs from about:blank stay about:blank (the
    // relative resolution fails against the about: base), the state and length
    // update, and an absolute URL is a cross-origin SecurityError.
    {
      const lengthBefore = history.length;
      history.pushState({ a: 1 }, "", "/rel");
      api.record.value("push-relative-href", location.href);
      api.record.value("push-relative-length-delta", history.length - lengthBefore);
      api.record.value("push-relative-state", history.state);
      api.record.value("push-relative-doc-url", document.URL);
      history.pushState({ b: 2 }, "", "?q=1");
      api.record.value("push-query-state", history.state);
    }
    {
      const lengthBefore = history.length;
      try {
        history.pushState({}, "", "https://evil.example.com/x");
        api.record.value("push-cross-origin", "no-throw");
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
      api.record.value("push-cross-origin-length-delta", history.length - lengthBefore);
    }
    {
      try {
        history.pushState();
        api.record.value("push-no-args", "no-throw");
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
    }
    {
      try {
        history.pushState(null);
        api.record.value("push-one-arg", "no-throw");
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
    }

    // 5. replaceState replaces the current entry without changing the length.
    {
      const lengthBefore = history.length;
      history.replaceState({ c: 3 }, "", "/rep");
      api.record.value("replace-href", location.href);
      api.record.value("replace-length-delta", history.length - lengthBefore);
      api.record.value("replace-state", history.state);
      api.record.value("replace-doc-url", document.URL);
    }

    // 6. scrollRestoration setter accepts only auto / manual.
    history.scrollRestoration = "manual";
    api.record.value("scroll-manual", history.scrollRestoration);
    history.scrollRestoration = "bogus";
    api.record.value("scroll-invalid", history.scrollRestoration);
    history.scrollRestoration = "auto";
    api.record.value("scroll-auto", history.scrollRestoration);

    // 7. Navigator fixed mock values.
    const navigator = window.navigator;
    api.record.value("nav-user-agent", navigator.userAgent);
    api.record.value("nav-platform", navigator.platform);
    api.record.value("nav-app-code-name", navigator.appCodeName);
    api.record.value("nav-app-name", navigator.appName);
    api.record.value("nav-app-version", navigator.appVersion);
    api.record.value("nav-language", navigator.language);
    api.record.value("nav-languages", navigator.languages);
    api.record.value("nav-product", navigator.product);
    api.record.value("nav-vendor", navigator.vendor);
    api.record.value("nav-on-line", navigator.onLine);
    api.record.value("nav-cookie-enabled", navigator.cookieEnabled);
    api.record.value("nav-hardware-concurrency", navigator.hardwareConcurrency);
    api.record.value("nav-max-touch-points", navigator.maxTouchPoints);
    api.record.value("nav-webdriver", navigator.webdriver);
    api.record.value("nav-do-not-track", navigator.doNotTrack);
    api.record.value("nav-tostring", navigator.toString());
    api.record.value("nav-tag", Object.prototype.toString.call(navigator));
    api.record.value("nav-proto-name", Object.getPrototypeOf(navigator).constructor.name);
    api.record.value("nav-mime-types-string", String(navigator.mimeTypes));
    api.record.value("nav-plugins-string", String(navigator.plugins));

    // 8. The URL / DOMException constructors on the window.
    api.record.value("url-type", typeof window.URL);
    api.record.value("url-new", new window.URL("https://x.test/y?z=1").href);
    try {
      new window.URL("not a url");
      api.record.value("url-invalid", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    api.record.value("dom-exception-name", new window.DOMException("boom", "SecurityError").name);
    api.record.value("dom-exception-message", new window.DOMException("boom", "SecurityError").message);

    // 9. Descriptor shapes of the returned platform objects.
    api.record.descriptor("loc-href-desc", Object.getPrototypeOf(location), "href");
    api.record.descriptor("loc-own-keys", location, "constructor");
    api.record.descriptor("hist-length-desc", Object.getPrototypeOf(history), "length");
    api.record.descriptor("storage-length-desc", Object.getPrototypeOf(window.localStorage), "length");
    api.record.descriptor("storage-setitem-desc", Object.getPrototypeOf(window.localStorage), "setItem");

    // 10. Object identity: repeat reads return one and the same object.
    api.record.identity("loc-identity", window.location, window.location);
    api.record.identity("hist-identity", window.history, window.history);
    api.record.identity("nav-identity", window.navigator, window.navigator);
    api.record.identity("ls-identity", window.localStorage, window.localStorage);
    api.record.identity("ss-identity", window.sessionStorage, window.sessionStorage);
    api.record.identity("ls-ss-distinct", window.localStorage, window.sessionStorage);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
