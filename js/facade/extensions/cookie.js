// Cookie container facade module (happy-dom cookie surface parity).
//
// Provides the happy-dom cookie model the `BrowserContext` carries
// (`cookieContainer`) plus the `CookieSameSiteEnum` the package entry exports:
//
//   - `CookieSameSiteEnum` — the `SameSite` attribute values
//     (`strict` / `lax` / `none` → `"Strict"` / `"Lax"` / `"None"`);
//   - `DEFAULT_COOKIE` — the default cookie shape happy-dom merges under every
//     added cookie (`DefaultCookie` parity: required `key` / `originURL`,
//     optional `value` / `domain` / `path` / `expires` / `httpOnly` /
//     `secure` / `sameSite` defaulting to `Lax`);
//   - `CookieContainer` — `addCookies(cookies)` (replace-by-identity, expired
//     cookies deleted, returns the `{ changed, deleted }` rollup),
//     `getCookies(url, clientSide)` (expiry / `httpOnly` / URL filtering) and
//     `clearCookies()`.
//
// The filtering semantics mirror happy-dom's `CookieExpireUtility` /
// `CookieURLUtility` verbatim — including their observable quirks: a cookie's
// `originURL` is stored exactly as given (a string origin keeps reading
// `undefined` for `hostname`), and `getCookies(url, …)` reads `url.hostname` /
// `url.protocol` / `url.pathname` off the argument as given, so a plain string
// URL matches through the `undefined === undefined` same-host comparison.
//
// This module is not a facade `install(ctx)` extension — it defines plain
// classes consumed by the browser extension (js/facade/extensions/browser.js)
// and the package entry, the same shape as virtual-console.js.

/**
 * Cookie `SameSite` attribute values (happy-dom `CookieSameSiteEnum` parity).
 */
export const CookieSameSiteEnum = Object.freeze({
  strict: "Strict",
  lax: "Lax",
  none: "None",
});

/**
 * The default cookie shape (happy-dom `DefaultCookie` parity): every cookie
 * added to a container is merged over these defaults.
 */
export const DEFAULT_COOKIE = Object.freeze({
  // Required
  key: null,
  originURL: null,
  // Optional
  value: null,
  domain: "",
  path: "",
  expires: null,
  httpOnly: false,
  secure: false,
  sameSite: CookieSameSiteEnum.lax,
});

/**
 * Returns `true` when `cookie` has expired (happy-dom `CookieExpireUtility`
 * parity: an `expires` date in the past).
 */
function hasExpired(cookie) {
  return cookie.expires && cookie.expires.getTime() < Date.now();
}

/**
 * Returns `true` when `cookie` matches `url` (happy-dom `CookieURLUtility`
 * parity): the secure flag requires `https:` (localhost exempt), the cookie's
 * `domain` / `path` prefix-match the URL, and a cookie crosses origins only
 * with `SameSite=None` plus `secure` — otherwise its `originURL` hostname must
 * equal the URL hostname (both read as given, so string origins compare
 * `undefined === undefined`).
 */
function cookieMatchesURL(cookie, url) {
  const isLocalhost = url.hostname === "localhost" || url.hostname?.endsWith(".localhost");
  return (
    (!cookie.secure || url.protocol === "https:" || isLocalhost) &&
    (!cookie.domain || url.hostname?.endsWith(cookie.domain)) &&
    (!cookie.path || url.pathname?.startsWith(cookie.path)) &&
    // @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#samesitesamesite-value
    ((cookie.sameSite === CookieSameSiteEnum.none && cookie.secure) ||
      cookie.originURL?.hostname === url.hostname)
  );
}

/**
 * Cookie container (happy-dom `CookieContainer` parity): the cookie store a
 * `BrowserContext` carries for its pages.
 */
export class CookieContainer {
  #cookies = [];

  /**
   * Adds or replaces cookies.
   *
   * @param {Array<object>} cookies Cookies.
   * @returns {{ changed: Array<object>, deleted: Array<object> }} Changed cookies.
   */
  addCookies(cookies) {
    const changedCookies = {
      changed: [],
      deleted: [],
    };
    const allCookies = this.#cookies;
    for (const cookie of cookies) {
      const newCookie = Object.assign({}, DEFAULT_COOKIE, cookie);
      if (newCookie && newCookie.key && newCookie.originURL) {
        const hasExpiredCookie = hasExpired(newCookie);
        // Checks if the cookie already exists and removes it.
        for (let i = 0, max = allCookies.length; i < max; i++) {
          const existingCookie = allCookies[i];
          if (
            existingCookie.key === newCookie.key &&
            existingCookie.originURL.hostname === newCookie.originURL.hostname &&
            existingCookie.path === newCookie.path &&
            typeof existingCookie.value === typeof newCookie.value
          ) {
            if (hasExpiredCookie) {
              changedCookies.deleted.push(existingCookie);
            }
            allCookies.splice(i, 1);
            break;
          }
        }
        if (!hasExpiredCookie) {
          allCookies.push(newCookie);
          changedCookies.changed.push(newCookie);
        }
      }
    }
    return changedCookies;
  }

  /**
   * Returns cookies.
   *
   * @param {string|URL|null} [url] URL.
   * @param {boolean} [clientSide] `true` if `httpOnly` cookies should be filtered out.
   * @returns {Array<object>} Cookies.
   */
  getCookies(url = null, clientSide = false) {
    const cookies = [];
    for (const cookie of this.#cookies) {
      if (
        !hasExpired(cookie) &&
        (!clientSide || !cookie.httpOnly) &&
        (!url || cookieMatchesURL(cookie, url))
      ) {
        cookies.push(cookie);
      }
    }
    return cookies;
  }

  /**
   * Clears all cookies.
   */
  clearCookies() {
    this.#cookies = [];
  }
}
