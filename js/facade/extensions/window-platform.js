// `Window` platform facade extension (T45).
//
// Installs the happy-dom public contract for the platform objects — URL,
// Location, History, Navigator, `localStorage` / `sessionStorage` and the
// `document.cookie` jar — onto the `Window` / `Document` facade classes,
// calibrated against the locked happy-dom 20.11.11 observable behavior.
//
// # Why this lives in the facade
//
// None of these objects describe *tree* state: they are per-window platform /
// navigation state (the current URL, the session history, the fixed mock
// navigator values, the two storage areas and the cookie jar). The facade keeps
// **no second DOM state** (CONTRACT.md), and these objects are not DOM state —
// so they legitimately live here, exactly one copy per window, reachable from
// both the `Window` facade and the `Document` facade through the same key.
//
// # The unique key: the native DocumentHandle
//
// Both `window.location` and `document.URL` / `document.cookie` need the *same*
// per-window state. The native `WindowHandle` strongly owns one
// `DocumentHandle` (T22A, `WindowHandle.document()` returns one and the same
// object), so the native document handle is the stable per-window key:
//
//   - `Window.prototype.location` resolves the window's document handle through
//     `this.document` + `ctx.documentContext.handleOf`, then reads `state` from
//     the `PLATFORM` WeakMap;
//   - `Document.prototype.URL` / `documentURI` / `cookie` resolve the document
//     handle through `ctx.documentContext.handleOf(this)` directly.
//
// Both paths hit the same WeakMap entry, so every `Window` and its `Document`
// share one location / history / navigator / storage / cookie state, and two
// windows never share any of it (state isolation is per document = per window).
// A raw native document created through `createDocument()` (no window) has no
// platform entry: `document.URL` reads `"about:blank"` and `document.cookie`
// reads `""`, matching a window-less document.
//
// # Reuse of Bun / Web standard objects
//
// `window.URL` and `window.DOMException` are the global Bun constructors
// (which parse and throw exactly like the WHATWG / Node originals happy-dom
// subclasses). URL parsing, `about:blank` semantics (`pathname === "blank"`,
// `origin === "null"`, relative resolution failures) and the `DOMException`
// name/message/toString shape come from those, never from a second
// implementation. The `Location` / `History` / `Navigator` / `Storage` classes
// below are thin calibrated wrappers over that standard surface.
//
// # Navigation is simulated
//
// Per the T45 boundary, no real page navigation, security sandbox or disk
// storage is implemented. `Location.href` / the property setters / `assign` /
// `replace` perform a *synchronous simulated navigation*: the current URL is
// re-resolved against the same rules happy-dom uses (`BrowserFrameURL`), a
// history entry is pushed exactly like happy-dom's history management, and the
// URL state is updated — no fetch, no window replacement, no browser process
// behavior. `reload()` and `history.back/forward/go` are no-ops (the session
// history has no page content to restore). The differential scenarios therefore
// probe only the deterministic synchronous surface (reads, `hash` setter,
// `pushState` / `replaceState`, cookie and storage), never async full
// navigation.
//
// # Events
//
// happy-dom fires no `storage` events for a detached window (verified against
// the baseline: `addEventListener("storage", ...)` observes none), so this
// module dispatches none. The async `hashchange` happy-dom schedules after a
// hash change is likewise not dispatched: our `Window` is not an EventTarget
// (T37 wired Node/Document only) and the T45 differential surface is
// synchronous.

import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Document } from "../document.js";
import { Window } from "../window.js";
import { Event } from "./events.js";
import { Clipboard, Permissions, URL as FacadeURL } from "./lightweight.js";
import { disconnectWindowObservers } from "./mutation-observer.js";
import { windowTasks } from "../window-tasks.js";
import { createBrowserSettings, defaultUserAgent } from "../browser-settings.js";
import { VirtualConsole, VirtualConsolePrinter } from "./virtual-console.js";

export const seam = Object.freeze({
  id: "facade/extensions/window-platform",
  owner: "T45",
  gate: "T45",
  status: "implemented",
});

// --- per-window platform state ----------------------------------------------

// Native DocumentHandle → PlatformState. Weak: a collected / destroyed document
// stops holding its location / history / storage / cookie state, and two
// windows never share an entry (each native document is minted once per
// window). The native handle itself is opaque; only the facade uses it as a
// key, never as a value crossing a seam.
const PLATFORM = new WeakMap();

// The key inside a `Storage` proxy's raw target (symbol so it never collides
// with a stored data key). Mirrors happy-dom's `PropertySymbol.data` storage.
const STORAGE_DATA = Symbol("mad-dom-storage-data");

// Internal slots of `Location` / `History` (symbols so the platform state never
// shows up as an own enumerable string key — happy-dom keeps these in private
// fields, and `Object.keys(location)` / `Object.keys(history)` are empty).
const STATE = Symbol("mad-dom-platform-state");
const LIST = Symbol("mad-dom-history-list");

// Detached and Browser windows share the same resource owner.
function createHappyDOMApi(ctx, windowFacade, settingsAccess) {
  const api = {
    waitUntilComplete() {
      return windowTasks(windowFacade).waitUntilComplete();
    },
    whenAsyncComplete() {
      return this.waitUntilComplete();
    },
    abort() {
      return windowTasks(windowFacade).abort();
    },
    cancelAsync() {
      return this.abort();
    },
    close() {
      return closeWindow(windowFacade);
    },
    setURL(url) {
      windowFacade.location.href = String(url);
    },
    setViewport(viewport) {
      if (viewport === null || viewport === undefined) return;
      const previousWidth = windowFacade.innerWidth;
      const previousHeight = windowFacade.innerHeight;
      const previousRatio = windowFacade.devicePixelRatio;
      ctx.setWindowViewport(windowFacade, viewport);
      if (
        previousWidth !== windowFacade.innerWidth ||
        previousHeight !== windowFacade.innerHeight ||
        previousRatio !== windowFacade.devicePixelRatio
      ) {
        windowFacade.dispatchEvent(new Event("resize"));
      }
    },
    // Deprecated happy-dom aliases of `setViewport`.
    setWindowSize(sizeOptions) {
      this.setViewport({ width: sizeOptions?.width, height: sizeOptions?.height });
    },
    setInnerWidth(width) {
      this.setViewport({ width });
    },
    setInnerHeight(height) {
      this.setViewport({ height });
    },
    registerPending(promise) {
      return windowTasks(windowFacade).track(promise);
    },
  };
  Object.defineProperty(api, "registerPending", {
    enumerable: false,
    configurable: true,
  });
  // The per-window virtual console printer, created lazily on first read. The
  // setter lets a browser page make its frame window's printer BE the page's
  // printer (happy-dom routes every frame console entry through the page
  // printer), so the window console resolves it lazily on every print.
  let virtualConsolePrinter = null;
  Object.defineProperty(api, "virtualConsolePrinter", {
    get() {
      virtualConsolePrinter ??= new VirtualConsolePrinter();
      return virtualConsolePrinter;
    },
    set(printer) {
      virtualConsolePrinter = printer;
    },
    enumerable: true,
    configurable: true,
  });
  // The happy-dom browser settings of the owning window (DetachedWindowAPI
  // exposes the frame's browser settings; a detached window owns its own).
  Object.defineProperty(api, "settings", {
    get() {
      return settingsAccess.get();
    },
    set(settings) {
      settingsAccess.set(settings);
    },
    enumerable: true,
    configurable: true,
  });
  return api;
}

// A closed Window retains an empty, readable DOM until its last wrapper is
// collected. Native destroy() remains the explicit arena-invalidation API.
export function closeWindow(window) {
  const owner = windowTasks(window);
  if (owner.closed) return owner.waitUntilComplete();
  const pending = owner.abort(true);
  disconnectWindowObservers(window);
  window.document.parseHtml("");
  return pending;
}

export function setWindowCookieContainer(window, container) {
  COOKIE_CONTAINERS.set(cookieContext.documentContext.handleOf(window.document), container);
}
const COOKIE_CONTAINERS = new WeakMap();
let cookieContext;

// --- Location / History shared state ----------------------------------------

function createPlatformState() {
  const state = {
    url: new URL("about:blank"),
    cookies: [],
    location: null,
    history: null,
    navigator: null,
    localStorage: null,
    sessionStorage: null,
    // The happy-dom browser settings of the owning window, created lazily from
    // the Window constructor options on first read (the same object
    // `window.happyDOM.settings` exposes and the `Navigator` reads).
    settings: null,
  };
  state.history = new History(state);
  state.location = new Location(state);
  return state;
}

// The per-window happy-dom browser settings (lazily merged from the Window
// constructor options through the facade `ctx`). One object per platform state:
// `window.happyDOM.settings` exposes it, a browser page may replace it with the
// browser's own settings, and `navigator.userAgent` / `maxTouchPoints` read it.
function ensureWindowSettings(ctx, state, windowFacade) {
  state.settings ??= createBrowserSettings(ctx.windowOptions(windowFacade)?.settings);
  return state.settings;
}

function platformOfDocument(nativeDocumentHandle) {
  if (nativeDocumentHandle === null || nativeDocumentHandle === undefined) return null;
  let state = PLATFORM.get(nativeDocumentHandle);
  if (state === undefined) {
    state = createPlatformState();
    PLATFORM.set(nativeDocumentHandle, state);
  }
  return state;
}

// The document handle owned by a facade `Window` (the stable per-window key).
// Resolved through the document facade so directly-constructed windows (the
// guarded `new Window(nativeHandle)` path, which skips the `ctx.wrap` cache)
// reach the same state as wrap-minted ones.
function nativeDocumentOfWindow(ctx, windowFacade) {
  const document = windowFacade.document;
  if (document === null || document === undefined) return null;
  return ctx.documentContext.handleOf(document);
}

// --- history stack (mirrors happy-dom HistoryItemList) ------------------------

class HistoryItemList {
  constructor() {
    this.currentItem = {
      title: "",
      href: "about:blank",
      state: null,
      popState: false,
      scrollRestoration: "auto",
      method: "GET",
      formData: null,
    };
    this.items = [this.currentItem];
  }

  push(historyItem) {
    const index = this.items.indexOf(this.currentItem);
    // If the current item is not the last one, remove all items after it.
    if (index !== this.items.length - 1) {
      this.items.length = index + 1;
    }
    this.items.push(historyItem);
    this.currentItem = historyItem;
  }

  replace(historyItem) {
    const index = this.items.indexOf(this.currentItem);
    if (index !== this.items.length - 1) {
      this.items.length = index + 1;
    }
    if (index === -1) {
      throw new Error("Current history item not found");
    }
    this.currentItem = historyItem;
    this.items[index] = historyItem;
  }
}

// --- relative URL resolution (mirrors happy-dom BrowserFrameURL) -------------

function resolveRelativeURL(state, url) {
  url = url ? String(url) : "about:blank";
  if (url.startsWith("about:") || url.startsWith("javascript:")) {
    return new URL(url);
  }
  try {
    return new URL(url, state.url.href);
  } catch {
    return new URL("about:blank");
  }
}

// --- Location ----------------------------------------------------------------

/**
 * `window.location` facade (T45).
 *
 * Reads derive from the per-window `URL` instance (global WHATWG `URL`). The
 * `hash` setter and `pushState`/`replaceState` funnels go through the single
 * `_setURL` mutation so `location.href` and `document.URL` always agree. Full
 * navigations (`href` setter, the property setters, `assign`, `replace`) are
 * simulated synchronously: URL re-resolution, history push, state update — no
 * real page load.
 */
export class Location {
  constructor(state) {
    this[STATE] = state;
  }

  get hash() {
    return this[STATE].url.hash;
  }

  set hash(hash) {
    const history = this[STATE].history;
    const url = new URL(this[STATE].url.href);
    const oldHash = this[STATE].url.hash;
    url.hash = hash;
    if (url.hash !== oldHash) {
      history.currentItem.popState = true;
      history.push({
        title: "",
        href: url.href,
        state: history.currentItem.state,
        popState: true,
        scrollRestoration: "manual",
        method: history.currentItem.method,
        formData: history.currentItem.formData || null,
      });
      this._setURL(url.href);
    }
  }

  get host() {
    return this[STATE].url.host;
  }

  set host(host) {
    const url = new URL(this[STATE].url.href);
    url.host = host;
    this.href = url.href;
  }

  get hostname() {
    return this[STATE].url.hostname;
  }

  set hostname(hostname) {
    const url = new URL(this[STATE].url.href);
    url.hostname = hostname;
    this.href = url.href;
  }

  get href() {
    return this[STATE].url.href;
  }

  set href(url) {
    this._navigate(url);
  }

  get origin() {
    return this[STATE].url.origin;
  }

  get pathname() {
    return this[STATE].url.pathname;
  }

  set pathname(pathname) {
    const url = new URL(this[STATE].url.href);
    url.pathname = pathname;
    this.href = url.href;
  }

  get port() {
    return this[STATE].url.port;
  }

  set port(port) {
    const url = new URL(this[STATE].url.href);
    url.port = port;
    this.href = url.href;
  }

  get protocol() {
    return this[STATE].url.protocol;
  }

  set protocol(protocol) {
    const url = new URL(this[STATE].url.href);
    url.protocol = protocol;
    this.href = url.href;
  }

  get search() {
    return this[STATE].url.search;
  }

  set search(search) {
    const url = new URL(this[STATE].url.href);
    url.search = search;
    this.href = url.href;
  }

  replace(url) {
    this.href = String(url);
  }

  assign(url) {
    this.href = String(url);
  }

  reload() {
    // Simulated: no real page reload happens (T45 boundary).
  }

  toString() {
    return this[STATE].url.toString();
  }

  /** The single URL mutation point (mirrors happy-dom's `setURL` symbol). */
  _setURL(url) {
    this[STATE].url.href = url;
  }

  /**
   * Simulated navigation: re-resolves `href`, manages the history stack like
   * happy-dom's hash / full navigation, then updates the URL state. No fetch,
   * no window replacement, no browser process behavior (T45 boundary).
   */
  _navigate(href) {
    const targetURL = resolveRelativeURL(this[STATE], href);
    const history = this[STATE].history;
    const targetURLWithoutHash = targetURL.href.split("#")[0];
    const currentURLWithoutHash = this[STATE].url.href.split("#")[0];
    // Hash navigation: same document, only the fragment changes.
    if (
      targetURLWithoutHash === currentURLWithoutHash &&
      targetURL.hash &&
      targetURL.hash !== this[STATE].url.hash
    ) {
      history.currentItem.popState = true;
      history.push({
        title: "",
        href: targetURL.href,
        state: null,
        popState: true,
        scrollRestoration: "manual",
        method: history.currentItem.method,
        formData: history.currentItem.formData || null,
      });
      this._setURL(targetURL.href);
      return;
    }
    history.push({
      title: "",
      href: targetURL.href,
      state: null,
      popState: false,
      scrollRestoration: "auto",
      method: "GET",
      formData: null,
    });
    this._setURL(targetURL.href);
  }
}

Object.defineProperty(Location.prototype, Symbol.toStringTag, {
  value: "Location",
  writable: false,
  enumerable: false,
  configurable: true,
});

// --- History ----------------------------------------------------------------

/**
 * `window.history` facade (T45).
 *
 * The session history stack (items + current index) is per window, shared with
 * the `Location` through the platform state. `pushState` / `replaceState` are
 * synchronous URL-state mutations; `back` / `forward` / `go` are simulated
 * no-ops (T45 boundary: no page content to restore).
 */
export class History {
  constructor(state) {
    this[STATE] = state;
    this[LIST] = new HistoryItemList();
  }

  get length() {
    return this[LIST].items.length;
  }

  get state() {
    return this[LIST].currentItem.state || null;
  }

  get scrollRestoration() {
    return this[LIST].currentItem.scrollRestoration || "auto";
  }

  set scrollRestoration(scrollRestoration) {
    if (scrollRestoration === "auto" || scrollRestoration === "manual") {
      this[LIST].currentItem.scrollRestoration = scrollRestoration;
    }
  }

  get currentItem() {
    return this[LIST].currentItem;
  }

  push(item) {
    this[LIST].push(item);
  }

  replace(item) {
    this[LIST].replace(item);
  }

  back() {
    // Simulated: no page navigation (T45 boundary).
  }

  forward() {
    // Simulated: no page navigation (T45 boundary).
  }

  go() {
    // Simulated: no page navigation (T45 boundary).
  }

  pushState(state, _unused, url) {
    if (arguments.length < 2) {
      throw new TypeError(
        `Failed to execute 'pushState' on 'History': 2 arguments required, but only ${arguments.length} present.`,
      );
    }
    const location = this[STATE].location;
    const newURL = url ? resolveRelativeURL(this[STATE], url) : this[STATE].url;
    if (url && newURL.origin !== location.origin) {
      throw new DOMException(
        `Failed to execute 'pushState' on 'History': A history state object with URL '${String(
          url,
        )}' cannot be created in a document with origin '${location.origin}' and URL '${location.href}'.`,
        "SecurityError",
      );
    }
    this[LIST].currentItem.popState = true;
    this[LIST].push({
      title: "",
      href: newURL.href,
      state,
      popState: true,
      scrollRestoration: this[LIST].currentItem.scrollRestoration,
      method: this[LIST].currentItem.method || "GET",
      formData: this[LIST].currentItem.formData || null,
    });
    location._setURL(this[LIST].currentItem.href);
  }

  replaceState(state, _unused, url) {
    // The happy-dom error message also says "pushState" here (baseline quirk).
    if (arguments.length < 2) {
      throw new TypeError(
        `Failed to execute 'pushState' on 'History': 2 arguments required, but only ${arguments.length} present.`,
      );
    }
    const location = this[STATE].location;
    const newURL = url ? resolveRelativeURL(this[STATE], url) : this[STATE].url;
    if (url && newURL.origin !== location.origin) {
      throw new DOMException(
        `Failed to execute 'pushState' on 'History': A history state object with URL '${String(
          url,
        )}' cannot be created in a document with origin '${location.origin}' and URL '${location.href}'.`,
        "SecurityError",
      );
    }
    const current = this[LIST].currentItem;
    this[LIST].replace({
      title: "",
      href: newURL.href,
      state,
      popState: current.popState,
      scrollRestoration: current.scrollRestoration,
      method: current.method,
      formData: current.formData,
    });
    if (url) {
      location._setURL(this[LIST].currentItem.href);
    }
  }
}

// --- Navigator ----------------------------------------------------------------



class MimeTypeArray {
  constructor(mimeTypes) {
    for (let i = 0, max = mimeTypes.length; i < max; i++) {
      this[i] = mimeTypes[i];
      this[mimeTypes[i].type] = mimeTypes[i];
    }
    this.length = mimeTypes.length;
  }

  item(index) {
    return this[index] || null;
  }

  namedItem(name) {
    return this[name] || null;
  }

  toString() {
    return "[object MimeTypeArray]";
  }
}

class PluginArray {
  constructor(plugins) {
    for (let i = 0, max = plugins.length; i < max; i++) {
      this[i] = plugins[i];
      this[plugins[i].name] = plugins[i];
    }
    this.length = plugins.length;
  }

  item(index) {
    return this[index] || null;
  }

  namedItem(name) {
    return this[name] || null;
  }

  refresh() {
    // Do nothing
  }

  toString() {
    return "[object PluginArray]";
  }
}

/**
 * `window.navigator` facade (T45).
 *
 * The fixed mock values happy-dom exposes (calibrated 1:1 against the locked
 * baseline). `userAgent` / `maxTouchPoints` read the owning window's happy-dom
 * browser settings (`settings.navigator.userAgent` /
 * `settings.navigator.maxTouchPoints` — happy-dom resolves them through the
 * frame's browser settings, so writing `window.happyDOM.settings.navigator
 * .userAgent` changes what `navigator.userAgent` reads); writing the unrelated
 * `settings.navigation.userAgent` has no effect on them (baseline behavior).
 * `mimeTypes` / `plugins` are empty list stubs; `sendBeacon` returns `true`
 * without issuing a real fetch (T45 boundary); `permissions` and `clipboard`
 * are the lightweight Permissions / Clipboard stubs.
 */
export class Navigator {
  #permissions = null;
  #clipboard = null;

  constructor(state) {
    this[STATE] = state;
  }

  get cookieEnabled() {
    return true;
  }

  get credentials() {
    return null;
  }

  get geolocation() {
    return null;
  }

  get language() {
    return "en-US";
  }

  get languages() {
    return ["en-US", "en"];
  }

  get locks() {
    return null;
  }

  get maxTouchPoints() {
    return this[STATE]?.settings?.navigator?.maxTouchPoints || 0;
  }

  get hardwareConcurrency() {
    return 8;
  }

  get appCodeName() {
    return "Mozilla";
  }

  get appName() {
    return "Netscape";
  }

  get appVersion() {
    const userAgent = this.userAgent;
    const index = userAgent.indexOf("/");
    return index > -1 ? userAgent.substring(index + 1) : "";
  }

  get platform() {
    const userAgent = this.userAgent;
    const indexStart = userAgent.indexOf("(");
    const indexEnd = userAgent.indexOf(")");
    return indexStart > -1 && indexEnd > -1 ? userAgent.substring(indexStart + 1, indexEnd) : "";
  }

  get product() {
    return "Gecko";
  }

  get productSub() {
    return "20100101";
  }

  get vendor() {
    return "";
  }

  get vendorSub() {
    return "";
  }

  get userAgent() {
    return this[STATE]?.settings?.navigator?.userAgent || defaultUserAgent();
  }

  get onLine() {
    return true;
  }

  get permissions() {
    this.#permissions ??= new Permissions();
    return this.#permissions;
  }

  get clipboard() {
    this.#clipboard ??= new Clipboard(this);
    return this.#clipboard;
  }

  get webdriver() {
    return true;
  }

  get doNotTrack() {
    return "unspecified";
  }

  get mimeTypes() {
    return new MimeTypeArray([]);
  }

  get plugins() {
    return new PluginArray([]);
  }

  sendBeacon() {
    return true;
  }

  toString() {
    return "[object Navigator]";
  }
}

// --- Storage -----------------------------------------------------------------

/**
 * `localStorage` / `sessionStorage` facade (T45).
 *
 * A Proxy-backed area replicating happy-dom's Storage observable behavior: a
 * plain object store keyed by `String(name)`, values coerced with `String()`,
 * `Object.keys` ordering (integer-like keys first, then insertion order),
 * own-key descriptors `{ value, writable: true, enumerable: true,
 * configurable: true }`, `deleteProperty` only for stored keys, and the
 * prototype `length` / `key` / `setItem` / `getItem` / `removeItem` / `clear`
 * surface. Each window owns its own `localStorage` and `sessionStorage`
 * instances (isolation verified against the baseline), and happy-dom's
 * detached window fires no `storage` events, so none are dispatched here.
 */
export class Storage {
  [STORAGE_DATA] = {};

  constructor() {
    const dataSlot = STORAGE_DATA;
    return new Proxy(this, {
      get: (target, property) => {
        if (property in target || typeof property === "symbol") {
          return target[property];
        }
        if (property in target[dataSlot]) {
          return target[dataSlot][property];
        }
      },
      set: (target, property, newValue) => {
        if (property in target || typeof property === "symbol") {
          return true;
        }
        target[dataSlot][String(property)] = String(newValue);
        return true;
      },
      deleteProperty: (target, property) => {
        if (property in target[dataSlot]) {
          delete target[dataSlot][String(property)];
          return true;
        }
        return false;
      },
      ownKeys: (target) => Object.keys(target[dataSlot]),
      has: (target, property) => {
        if (property in target || property in target[dataSlot]) {
          return true;
        }
        return false;
      },
      defineProperty: (target, property, descriptor) => {
        if (property in target) {
          Object.defineProperty(target, property, descriptor);
          return true;
        }
        if (descriptor.value !== undefined) {
          target[dataSlot][String(property)] = String(descriptor.value);
          return true;
        }
        return false;
      },
      getOwnPropertyDescriptor: (target, property) => {
        if (property in target) {
          return undefined;
        }
        const value = target[dataSlot][String(property)];
        if (value !== undefined) {
          return { value, writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      },
    });
  }

  get length() {
    return Object.keys(this[STORAGE_DATA]).length;
  }

  key(index) {
    const name = Object.keys(this[STORAGE_DATA])[index];
    return name !== undefined ? name : null;
  }

  setItem(name, item) {
    this[STORAGE_DATA][name] = String(item);
  }

  getItem(name) {
    const value = this[STORAGE_DATA][name];
    return value !== undefined ? value : null;
  }

  removeItem(name) {
    delete this[STORAGE_DATA][name];
  }

  clear() {
    const data = this[STORAGE_DATA];
    for (const key of Object.keys(data)) {
      delete data[key];
    }
  }
}

// --- cookie jar (mirrors happy-dom CookieContainer + utilities) --------------

const DEFAULT_COOKIE = {
  key: null,
  originURL: null,
  value: null,
  domain: "",
  path: "",
  expires: null,
  httpOnly: false,
  secure: false,
  sameSite: "lax",
};

function cookieHasExpired(cookie) {
  return cookie.expires !== null && cookie.expires.getTime() < Date.now();
}

function cookieMatchesURL(cookie, url) {
  const isLocalhost = url.hostname === "localhost" || url.hostname?.endsWith(".localhost");
  return (
    (!cookie.secure || url.protocol === "https:" || isLocalhost) &&
    (!cookie.domain || url.hostname?.endsWith(cookie.domain)) &&
    (!cookie.path || url.pathname?.startsWith(cookie.path)) &&
    ((cookie.sameSite === "none" && cookie.secure) ||
      cookie.originURL?.hostname === url.hostname)
  );
}

function stringToCookie(originURL, cookieString) {
  const parts = cookieString.split(";");
  const part = parts.shift();
  if (!part) {
    return null;
  }
  const index = part.indexOf("=");
  const key = index !== -1 ? part.slice(0, index).trim() : part.trim();
  const value = index !== -1 ? part.slice(index + 1).trim() : null;
  const cookie = { ...DEFAULT_COOKIE, key, value, originURL };
  // Invalid if key is empty.
  if (!cookie.key) {
    return null;
  }
  for (const attribute of parts) {
    const index = attribute.indexOf("=");
    const attributeKey =
      index !== -1 ? attribute.slice(0, index).trim().toLowerCase() : attribute.trim().toLowerCase();
    const attributeValue = index !== -1 ? attribute.slice(index + 1).trim() : "";
    switch (attributeKey) {
      case "expires":
        cookie.expires = new Date(attributeValue);
        break;
      case "max-age":
        cookie.expires = new Date(parseInt(attributeValue, 10) * 1000 + Date.now());
        break;
      case "domain":
        cookie.domain = attributeValue;
        break;
      case "path":
        cookie.path = attributeValue[0] === "/" ? attributeValue : `/${attributeValue}`;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "samesite":
        switch (attributeValue.toLowerCase()) {
          case "strict":
            cookie.sameSite = "strict";
            break;
          case "lax":
            cookie.sameSite = "lax";
            break;
          case "none":
            cookie.sameSite = "none";
            break;
        }
        break;
    }
  }
  const lowerKey = cookie.key.toLowerCase();
  // Invalid if the __secure- prefix is used and the cookie is not secure.
  if (lowerKey.startsWith("__secure-") && !cookie.secure) {
    return null;
  }
  // Invalid if the __host- prefix is used without secure / root path / no domain.
  if (
    lowerKey.startsWith("__host-") &&
    (!cookie.secure || cookie.path !== "/" || cookie.domain)
  ) {
    return null;
  }
  return cookie;
}

function cookiesToString(cookies) {
  const parts = [];
  for (const cookie of cookies) {
    if (cookie.value !== null) {
      parts.push(`${cookie.key}=${cookie.value}`);
    } else {
      parts.push(cookie.key);
    }
  }
  return parts.join("; ");
}

function addCookies(cookies, incoming) {
  for (const cookie of incoming) {
    const newCookie = { ...DEFAULT_COOKIE, ...cookie };
    if (newCookie.key && newCookie.originURL) {
      const hasExpired = cookieHasExpired(newCookie);
      // Remove any existing cookie with the same key, hostname, path and value
      // type first (the value-type check matches happy-dom, so a null-valued
      // cookie never replaces a string-valued one and vice versa).
      for (let i = 0, max = cookies.length; i < max; i++) {
        const existing = cookies[i];
        if (
          existing.key === newCookie.key &&
          existing.originURL.hostname === newCookie.originURL.hostname &&
          existing.path === newCookie.path &&
          typeof existing.value === typeof newCookie.value
        ) {
          cookies.splice(i, 1);
          break;
        }
      }
      if (!hasExpired) {
        cookies.push(newCookie);
      }
    }
  }
}

function getCookies(cookies, url, clientSide) {
  const result = [];
  for (const cookie of cookies) {
    if (
      !cookieHasExpired(cookie) &&
      (!clientSide || !cookie.httpOnly) &&
      (!url || cookieMatchesURL(cookie, url))
    ) {
      result.push(cookie);
    }
  }
  return result;
}

// --- install ----------------------------------------------------------------

/**
 * Cookie-jar bridge for the fetch surface (T46).
 *
 * `window.fetch` must send the owning window's cookies on same-origin /
 * credentials-include requests and fold `Set-Cookie` response headers back
 * into the same per-window jar. The jar lives in this module's per-document
 * platform state (T45); this small bridge hands the fetch facade read / parse
 * / add access to it without exposing the rest of the platform state.
 */
export function fetchCookieJar(nativeDocumentHandle) {
  const state = platformOfDocument(nativeDocumentHandle);
  if (state === null) return null;
  return {
    readCookies(url, clientSide) {
      return cookiesToString(COOKIE_CONTAINERS.get(nativeDocumentHandle)?.getCookies(url, clientSide) ?? getCookies(state.cookies, url, clientSide));
    },
    parseCookie(url, cookieString) {
      return stringToCookie(url, cookieString);
    },
    addCookies(incoming) {
      const container = COOKIE_CONTAINERS.get(nativeDocumentHandle);
      if (container) container.addCookies(incoming);
      else addCookies(state.cookies, incoming);
    },
  };
}

/**
 * Installs the T45 platform surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths (fixed, non-enumerable, non-configurable descriptors, matching the rest
 * of the facade surface).
 */
export function install(ctx) {
  cookieContext ??= ctx;
  // Window surface.
  ctx.defineAccessor(Window.prototype, "location", function getLocation() {
    return platformOfDocument(nativeDocumentOfWindow(ctx, this))?.location ?? null;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "history", function getHistory() {
    return platformOfDocument(nativeDocumentOfWindow(ctx, this))?.history ?? null;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "navigator", function getNavigator() {
    const state = platformOfDocument(nativeDocumentOfWindow(ctx, this));
    if (state === null) return null;
    ensureWindowSettings(ctx, state, this);
    state.navigator ??= new Navigator(state);
    return state.navigator;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "localStorage", function getLocalStorage() {
    const state = platformOfDocument(nativeDocumentOfWindow(ctx, this));
    if (state === null) return null;
    state.localStorage ??= new Storage();
    return state.localStorage;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "sessionStorage", function getSessionStorage() {
    const state = platformOfDocument(nativeDocumentOfWindow(ctx, this));
    if (state === null) return null;
    state.sessionStorage ??= new Storage();
    return state.sessionStorage;
  }, undefined);

  // Reuse the Bun / Web standard constructors (calibrated: happy-dom subclasses
  // the same Node WHATWG URL / DOMException, so observable behavior matches).
  // `window.URL` is the facade URL (a subclass of the host constructor) so the
  // happy-dom `blob:nodedata:` object-URL prefix works; `DOMException` stays the
  // host constructor.
  ctx.defineAccessor(Window.prototype, "URL", function getURL() {
    return FacadeURL;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "DOMException", function getDOMException() {
    return globalThis.DOMException;
  }, undefined);

  // Lazily mint the detached control API; task state lives in window-tasks.
  const HAPPY_DOM_PER_WINDOW = new WeakMap();
  ctx.defineAccessor(Window.prototype, "happyDOM", function getHappyDOM() {
    const windowFacade = this;
    let api = HAPPY_DOM_PER_WINDOW.get(windowFacade);
    if (api === undefined) {
      const state = platformOfDocument(nativeDocumentOfWindow(ctx, windowFacade));
      // The settings object shared with the `Navigator`: the platform state's
      // slot when the window has one, a local slot otherwise (a window facade
      // without a reachable native document never reaches the Navigator).
      let fallbackSettings = null;
      const settingsAccess = {
        get() {
          if (state !== null) return ensureWindowSettings(ctx, state, windowFacade);
          fallbackSettings ??= createBrowserSettings(ctx.windowOptions(windowFacade)?.settings);
          return fallbackSettings;
        },
        set(settings) {
          if (state !== null) state.settings = settings;
          else fallbackSettings = settings;
        },
      };
      api = createHappyDOMApi(ctx, windowFacade, settingsAccess);
      HAPPY_DOM_PER_WINDOW.set(windowFacade, api);
    }
    return api;
  }, undefined);

  // `window.console` (happy-dom parity): the constructor `console` option used
  // directly when given (`browser.console ?? new VirtualConsole(printer)`),
  // otherwise a per-window virtual console writing into the printer its
  // `window.happyDOM.virtualConsolePrinter` currently holds — resolved lazily
  // on every print, never cached, so a browser page that repoints the frame
  // window's printer receives every subsequent entry.
  const WINDOW_CONSOLES = new WeakMap();
  ctx.defineAccessor(Window.prototype, "console", function getConsole() {
    const windowFacade = this;
    const given = ctx.windowOptions(windowFacade)?.console;
    if (given !== undefined && given !== null) return given;
    let consoleFacade = WINDOW_CONSOLES.get(windowFacade);
    if (consoleFacade === undefined) {
      consoleFacade = new VirtualConsole(() => windowFacade.happyDOM.virtualConsolePrinter);
      WINDOW_CONSOLES.set(windowFacade, consoleFacade);
    }
    return consoleFacade;
  }, undefined);

  // happy-dom's `window.close()` (BrowserWindow.close) only destroys a window
  // that a script opened (`window.open`) and that is its page's main frame; for
  // a detached `new Window()` the `openerWindow` check fails and the call is a
  // plain no-op. Every mad-dom window is detached, so the parity method does
  // nothing and the window stays fully usable afterwards.
  ctx.defineMethod(Window.prototype, "close", function close() {});

  // Document surface.
  ctx.defineAccessor(Document.prototype, "defaultView", function defaultView() {
    return ctx.windowFacadeOfDocument(this) ?? null;
  }, undefined);

  ctx.defineAccessor(Document.prototype, "URL", function getURL() {
    return platformOfDocument(ctx.documentContext.handleOf(this))?.url.href ?? "about:blank";
  }, undefined);

  ctx.defineAccessor(Document.prototype, "documentURI", function getDocumentURI() {
    return platformOfDocument(ctx.documentContext.handleOf(this))?.url.href ?? "about:blank";
  }, undefined);

  ctx.defineAccessor(Document.prototype, "cookie", function getCookie() {
    const state = platformOfDocument(ctx.documentContext.handleOf(this));
    if (state === null) return "";
    return fetchCookieJar(ctx.documentContext.handleOf(this)).readCookies(state.location, true);
  }, function setCookie(value) {
    const state = platformOfDocument(ctx.documentContext.handleOf(this));
    if (state === null) return;
    const cookie = stringToCookie(state.location, value);
    if (cookie) {
      fetchCookieJar(ctx.documentContext.handleOf(this)).addCookies([cookie]);
    }
  });
}
