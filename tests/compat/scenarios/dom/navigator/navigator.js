// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/navigator/Navigator.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the internal `Navigator` class import is
// replaced by the public `window.navigator` surface. The upstream
// `expect(window.navigator[property]).toEqual(PROPERTIES[property])` loop is
// restated by recording each navigator property through `api.record`.
//
// Dropped assertion surfaces (documented, not observable-equivalent on both
// sides):
//   - the `window.navigator instanceof Navigator` check reads the internal
//     `Navigator` class (the class itself is not part of the public window
//     surface on both sides);
//   - the `permissions` object value is recorded as its public shape
//     (constructor name + own keys) instead of an internal class identity;
//   - `sendBeacon()` drives the internal `Fetch` class and reads the internal
//     request stream — the network/stream surface is host-dependent and is
//     not diffed.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "navigator-navigator";
export const description =
  "real differential: window.navigator surface — the fixed browser-data properties (appCodeName, appName, appVersion, cookieEnabled, credentials, doNotTrack, geolocation, hardwareConcurrency, language, languages, locks, maxTouchPoints, mimeTypes, onLine, permissions shape, platform, plugins, product, productSub, userAgent, vendor, vendorSub, webdriver)";
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
    const navigator = window.navigator;
    const properties = [
      "appCodeName",
      "appName",
      "appVersion",
      "cookieEnabled",
      "credentials",
      "doNotTrack",
      "geolocation",
      "hardwareConcurrency",
      "language",
      "languages",
      "locks",
      "maxTouchPoints",
      "mimeTypes",
      "onLine",
      "permissions",
      "platform",
      "plugins",
      "product",
      "productSub",
      "userAgent",
      "vendor",
      "vendorSub",
      "webdriver",
    ];
    for (const property of properties) {
      api.record.value(`navigator.${property}`, navigator[property]);
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
