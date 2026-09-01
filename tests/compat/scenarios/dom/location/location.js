// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/location/Location.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the upstream constructs the internal
// `new Location(browserFrame, url)` class directly; the starting state is
// rebuilt through the public `new Window({ url })` constructor (which drives
// the same simulated initial navigation on both sides) and every assertion
// reads through the public `window.location` members. Only the deterministic
// synchronous surface is ported: the read getters (`hash` / `host` /
// `hostname` / `href` / `origin` / `pathname` / `port` / `protocol` /
// `search` / `toString`) on a fixed-URL window and the synchronous `hash`
// setter (URL update + the `document.URL` linkage).
//
// Narrowed assertion surfaces (documented):
//   - the `set hash()` `hashchange` event assertions are dropped — happy-dom
//     dispatches `hashchange` asynchronously on a window that is an
//     EventTarget, while the mad-dom `Window` is not an EventTarget (T45
//     boundary), so the event is not differentially portable;
//   - the `href` / `host` / `hostname` / `pathname` / `port` / `protocol` /
//     `search` setters and `assign()` / `replace()` / `reload()` are dropped —
//     in happy-dom they drive `browserFrame.goto()` (a real asynchronous
//     navigation through the internal `Fetch`), which the upstream only
//     asserts by mocking `browserFrame.goto`; there is no public, synchronous,
//     mock-free way to observe the navigation flow, so these are not portable;
//   - the promise-rejection assertions (`virtualConsolePrinter` output after a
//     rejected `goto`) are dropped with the navigation surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "location-location";
export const description =
  "real differential: window.location public reads on a fixed-URL window (hash/host/hostname/href/origin/pathname/port/protocol/search) and the synchronous hash setter with document.URL linkage";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  // The upstream `HREF` used by the `get href()` assertions.
  const HREF = "https://google.com/some-path/?key=value&key2=value2#hash";
  const BASE = "https://localhost:8080/some-path/?key=value&key2=value2#hash";

  let window;
  try {
    window = new entry.Window({ url: BASE });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const location = window.location;
  const document = window.document;

  try {
    // 1. Read getters on a fixed-URL window (upstream `get hash()` / `get
    // host()` / … / `get search()` on `new Location(browserFrame, url)`).
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

    // 2. `get href()` with the upstream HREF value (asserts the exact URL).
    {
      const hrefWindow = new entry.Window({ url: HREF });
      api.record.value("loc-href-exact", hrefWindow.location.href);
    }

    // 3. The synchronous `hash` setter (upstream `set hash()`): each set
    // updates the hash and the href, and `document.URL` stays linked.
    {
      const hashWindow = new entry.Window({
        url: "https://localhost:8080/some-path/?key=value&key2=value2",
      });
      const hashLocation = hashWindow.location;
      hashLocation.hash = "#new-hash";
      api.record.value("hash-1-hash", hashLocation.hash);
      api.record.value("hash-1-href", hashLocation.href);
      api.record.value("hash-1-doc-url", hashWindow.document.URL);
      api.record.value("hash-1-doc-url-linked", hashWindow.document.URL === hashLocation.href);
      hashLocation.hash = "#new-hash2";
      api.record.value("hash-2-hash", hashLocation.hash);
      api.record.value("hash-2-href", hashLocation.href);
      // The non-hash components are untouched by a hash change.
      api.record.value("hash-2-host", hashLocation.host);
      api.record.value("hash-2-search", hashLocation.search);
    }

    // 4. Descriptor shape of the public location members (getter on the
    // prototype, not an own data property).
    api.record.descriptor("loc-href-desc", Object.getPrototypeOf(location), "href");
    api.record.descriptor("loc-hash-desc", Object.getPrototypeOf(location), "hash");
    api.record.identity("loc-identity", window.location, window.location);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
