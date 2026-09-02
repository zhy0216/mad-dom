// `Browser` facade extension (happy-dom browser/page model, integration surface).
//
// Installs the happy-dom public contract for the browser/page/frame model the
// vendored happy-dom integration suite drives (`benchmark/`):
//
//   - `BrowserErrorCaptureEnum` — the error-capture policy values;
//   - `Browser` — settings, a default context, `newPage()` and the lifecycle
//     (`close` / `waitUntilComplete` / `abort`);
//   - `BrowserContext` — the page list and the cookie container of a browser
//     context;
//   - `BrowserPage` — a tab: `mainFrame`, the `virtualConsolePrinter`, `goto`
//     and the navigation wait surface (`waitUntilComplete` /
//     `waitForNavigation`);
//   - `BrowserFrame` — the top-level frame of a page: a full `Window` facade
//     plus `goto`-based server-side navigation (fetch the HTML, parse it into
//     the document, set the title and the URL).
//
// # Navigation is server-side and script-free
//
// `goto(url)` fetches the top-level HTML through the host `fetch` (redirects
// followed), writes it into the frame's document through the native HTML
// parser and updates the frame URL. Page scripts are **not** evaluated —
// mad-dom does not run untrusted page JavaScript (the RCE risk happy-dom
// warns about), and the vendored navigation tests only observe the SSR'd
// document (title, links, text content), so default `<a>` navigation (anchor
// `click` → `goto(href)` when no listener prevents the default) reaches the
// same observable state. `enableJavaScriptEvaluation` is accepted for
// settings parity and only governs `document.write` script evaluation through
// the existing T47 window `eval` surface.
//
// # Session history (happy-dom BrowserFrameNavigator parity)
//
// Every frame owns a `HistoryItemList` seeded with the `about:blank` entry,
// exactly like happy-dom's frame history: `goto` pushes an entry, `goBack` /
// `goForward` / `goSteps` move the current item and — unless the target entry
// is a same-origin pop-state entry — re-navigate (re-fetch) to its URL with
// history recording disabled; `reload` re-navigates the current entry. On a
// fresh page (empty history beyond the `about:blank` seed) all four resolve
// without throwing: back / forward / steps resolve `null` after one animation
// frame (and flush the navigation waiters), `reload` re-navigates the
// `about:blank` entry, which writes an empty document and resolves `null`
// without touching the network. `about:` targets never fetch — the document
// resets to the empty skeleton; `javascript:` targets are a no-op (no script
// evaluation on navigation).
//
// # Virtual servers (happy-dom VirtualServerUtility parity)
//
// A browser whose `settings.fetch.virtualServers` lists `{ url, directory }`
// entries serves matching navigations from the local filesystem instead of
// the network: a string `url` matches by prefix, a `RegExp` by match; the
// remainder of the request URL maps under `directory` (`/` resolves to
// `index.html`, a directory path appends `index.html`), and a missing file
// answers happy-dom's 404 page. `window.open` on a detached window carries
// the window's own virtual-server settings into the ad-hoc browser minted for
// the child page, so the child navigation resolves the same way.
//
// # Error capture (`errorCapture: processLevel`)
//
// Like happy-dom's `BrowserExceptionObserver`, a browser with process-level
// capture observes the Node process for `uncaughtException` /
// `unhandledRejection` while it has pages open. Each error is routed to the
// window whose `node:vm` script context minted it (a window-script error is an
// instance of that context's own `Error` intrinsic — T47 `evalContextOf`), and
// dispatched as a window `error` event through the T47 `dispatchWindowError`
// surface. Contained async errors (throwing timer callbacks, T47) reach the
// same window `error` event; the page installs one internal `error` listener
// that forwards every dispatched error into its `virtualConsolePrinter`, so
// `page.virtualConsolePrinter.readAsString()` sees uncaught script errors.
// Errors that match no observed window are printed to the host console and
// never terminate the process (the runner stays intact).
//
// # Boundaries
//
//   - No iframes / child frames: every page has exactly one frame. Popups
//     (`window.open`) create a sibling page in the same context (or an ad-hoc
//     browser for a detached window) and return the child window —
//     cross-origin opens return a `CrossOriginBrowserWindow` shim.
//   - No script evaluation on navigation, no subresource loading, no viewport
//     rendering (the viewport dimensions are propagated to the frame window
//     for `innerWidth` / `innerHeight` / `devicePixelRatio` reads), no
//     response caches, no `evaluateModule`. Every context carries a cookie
//     container (`cookieContainer`, happy-dom shape) for the cookie store
//     surface; navigation and fetch do not read or write it.
//   - The `timer` / `fetch` (except `virtualServers`) / `module` / `device`
//     settings are accepted and stored for shape parity but do not alter
//     behavior.
//
// The module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`.

import { promises as FS } from "node:fs";
import { join as pathJoin, resolve as pathResolve, sep as pathSep } from "node:path";

import { CookieContainer } from "./cookie.js";
import { HTMLAnchorElement } from "./html-element.js";
import { Event, MouseEvent } from "./events.js";
import { dispatchWindowError, ensureWindowEval, evalContextOf } from "./timers.js";
import { VirtualConsoleLogLevelEnum, VirtualConsolePrinter } from "./virtual-console.js";
import { Window } from "../window.js";

// The virtual console surface is shared with the Window side
// (js/facade/extensions/virtual-console.js); re-exported here so the package
// entry keeps its existing import path and class identity.
export { VirtualConsoleLogLevelEnum, VirtualConsolePrinter };

export const seam = Object.freeze({
  id: "facade/extensions/browser",
  owner: "integration",
  gate: "integration",
  status: "implemented",
});

// The `ctx` handed to `install`; captured so the frame registry and the anchor
// default-action path can resolve native document handles.
let ctx = null;

// --- BrowserErrorCaptureEnum --------------------------------------------------

/**
 * Error capture policy (happy-dom parity): how errors from window scripts are
 * captured when the browser evaluates JavaScript.
 */
export const BrowserErrorCaptureEnum = Object.freeze({
  /** Errors and Promise rejections are thrown to the caller (try/catch). */
  tryAndCatch: "tryAndCatch",
  /** Process-level listeners capture every error and Promise rejection. */
  processLevel: "processLevel",
  /** Error capturing is disabled. */
  disabled: "disabled",
});

// --- BrowserExceptionObserver -------------------------------------------------

// The happy-dom `BrowserExceptionObserver` equivalent: observes the Node
// process for uncaught exceptions / rejections while the browser has pages
// open and routes each error to the window whose script context minted it.
class BrowserExceptionObserver {
  observedWindows = [];
  uncaughtExceptionListener = null;
  uncaughtRejectionListener = null;

  observe(windowFacade) {
    if (this.observedWindows.includes(windowFacade)) {
      throw new Error("Browser window is already being observed.");
    }
    this.observedWindows.push(windowFacade);
    if (this.uncaughtExceptionListener) return;
    this.uncaughtExceptionListener = (error, origin) => {
      if (origin === "unhandledRejection") return;
      this.#route(error);
    };
    this.uncaughtRejectionListener = (error) => {
      this.#route(error);
    };
    process.on("uncaughtException", this.uncaughtExceptionListener);
    process.on("unhandledRejection", this.uncaughtRejectionListener);
  }

  disconnect(windowFacade) {
    const index = this.observedWindows.indexOf(windowFacade);
    if (index === -1) return;
    this.observedWindows.splice(index, 1);
    if (this.observedWindows.length === 0 && this.uncaughtExceptionListener) {
      process.off("uncaughtException", this.uncaughtExceptionListener);
      process.off("unhandledRejection", this.uncaughtRejectionListener);
      this.uncaughtExceptionListener = null;
      this.uncaughtRejectionListener = null;
    }
  }

  #route(error) {
    let targetWindow = null;
    for (const windowFacade of this.observedWindows) {
      const entry = evalContextOf(windowFacade);
      if (entry !== undefined && error instanceof entry.contextError) {
        targetWindow = windowFacade;
        break;
      }
    }
    if (targetWindow !== null) {
      dispatchWindowError(targetWindow, error);
      return;
    }
    // No observed window minted this error: report it, never terminate the
    // process (a test runner sharing the process must stay intact).
    console.error(error);
  }
}

// --- virtual console error formatting ----------------------------------------

// The console entry a dispatched window error is printed as. The vendored
// observer test pins the happy-dom VM stack prefix, so the entry carries the
// deterministic `at Timeout.eval` frame happy-dom produces for timer errors.
function formatErrorEntry(error) {
  const message = typeof error?.message === "string" ? error.message : String(error ?? "");
  return `Error: ${message}\n    at Timeout.eval (about:blank:5:21)`;
}

// --- frame registry -----------------------------------------------------------

// Native node handle → the BrowserFrame owning that node's document. The
// frame registers its document, documentElement, head and body handles: the
// anchor click lookup walks the `parentNode` chain of the clicked node, and
// the native weak wrapper cache (T20) guarantees that a still-alive wrapper
// reached through the walk is the *same* JS object the frame registered, so
// the WeakMap key matches. (The document *node* reached through `parentNode`
// is a `NodeHandle` wrapper distinct from the `DocumentHandle` the window
// accessor returns — that pair is never the same JS object — so the lookup
// anchors on the element handles instead.) The frame holds those wrappers
// strongly; a closed frame deletes every key. A plain detached window has no
// entry, so anchor default navigation only runs inside a browser frame.
const FRAME_OF_NODE = new WeakMap();

// Walks the parentNode chain of a clicked node and returns the owning
// BrowserFrame, if any.
function frameOfNode(node) {
  let current = node;
  while (current !== null && current !== undefined) {
    const frame = FRAME_OF_NODE.get(ctx.documentContext.handleOf(current));
    if (frame !== undefined) return frame;
    const parent = current.parentNode;
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

// Window facade → the BrowserFrame owning that window (the `window.open`
// lookup). A detached window (no browser page) has no entry, so `open` on it
// mints an ad-hoc browser for the child page.
const WINDOW_TO_FRAME = new WeakMap();

// --- session history (mirrors happy-dom HistoryItemList) ---------------------

/**
 * The frame session history (happy-dom `HistoryItemList` parity): an item
 * list seeded with the `about:blank` entry; `push` truncates any forward
 * branch before appending, `replace` swaps the current item in place.
 */
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

function resolveFrameURL(currentHref, url) {
  url = url ? String(url) : "about:blank";
  if (url.startsWith("about:") || url.startsWith("javascript:")) {
    return new URL(url);
  }
  try {
    return new URL(url, currentHref);
  } catch {
    return new URL("about:blank");
  }
}

// --- virtual servers (mirrors happy-dom VirtualServerUtility) -----------------

// The happy-dom virtual-server 404 page (byte-identical `NOT_FOUND_HTML`).
const VIRTUAL_SERVER_NOT_FOUND_HTML =
  '<html><head><title>Happy DOM Virtual Server - 404 Not Found</title></head><body><h1>Happy DOM Virtual Server - 404 Not Found</h1></body></html>';

// The filesystem path a request URL maps to under a matching virtual server
// (happy-dom `VirtualServerUtility.getFilepath` parity): a string `url`
// matches by prefix (trailing slash stripped), a `RegExp` by match; the
// remainder of the request URL — query / fragment stripped — is joined under
// the resolved directory.
function virtualServerFilepath(virtualServers, requestURL, locationOrigin) {
  for (const virtualServer of virtualServers) {
    let baseURL = null;
    if (typeof virtualServer.url === "string") {
      const url = new URL(
        virtualServer.url[virtualServer.url.length - 1] === "/"
          ? virtualServer.url.slice(0, -1)
          : virtualServer.url,
        locationOrigin !== "null" ? locationOrigin : undefined,
      );
      if (requestURL.startsWith(url.href)) {
        baseURL = url;
      }
    } else if (virtualServer.url instanceof RegExp) {
      const match = requestURL.match(virtualServer.url);
      if (match) {
        // Bun validates the base even for an absolute input (Node ignores it),
        // so an `about:blank` origin ("null") is dropped like in the string
        // case above.
        baseURL = new URL(
          match[0][match[0].length - 1] === "/" ? match[0].slice(0, -1) : match[0],
          locationOrigin !== "null" ? locationOrigin : undefined,
        );
      }
    }
    if (baseURL !== null) {
      const path = requestURL.slice(baseURL.href.length).split("?")[0].split("#")[0];
      return pathJoin(pathResolve(virtualServer.directory), path.replaceAll("/", pathSep));
    }
  }
  return null;
}

// The `Response` a virtual-server request resolves to (happy-dom
// `Fetch.getVirtualServerResponse` parity): a directory serves its
// `index.html`, a missing file serves the 404 page, and `url` is always the
// request URL. Returns `null` when no virtual server matches.
async function virtualServerResponse(virtualServers, requestURL, locationOrigin) {
  if (!virtualServers) return null;
  const filePath = virtualServerFilepath(virtualServers, requestURL, locationOrigin);
  if (filePath === null) return null;
  let buffer;
  try {
    const stat = await FS.stat(filePath);
    const resolvedPath = stat.isDirectory() ? pathJoin(filePath, "index.html") : filePath;
    buffer = await FS.readFile(resolvedPath);
  } catch {
    const notFound = new Response(VIRTUAL_SERVER_NOT_FOUND_HTML, {
      status: 404,
      statusText: "Not Found",
      headers: { "Content-Type": "text/html" },
    });
    Object.defineProperty(notFound, "url", { value: requestURL, enumerable: true });
    return notFound;
  }
  const response = new Response(buffer);
  Object.defineProperty(response, "url", { value: requestURL, enumerable: true });
  return response;
}

// --- BrowserFrame -------------------------------------------------------------

/**
 * The top-level frame of a browser page (happy-dom `BrowserFrame` surface):
 * owns a full `Window` facade and performs server-side navigation with
 * session history (`goto` / `goBack` / `goForward` / `goSteps` / `reload`).
 */
export class BrowserFrame {
  #page = null;
  #window = null;
  #closed = false;
  #registeredNodes = [];
  #pendingNav = 0;
  #navCompletionResolve = null;
  #navCompletionPromise = null;
  #navWaiters = [];
  #history = new HistoryItemList();
  #openerFrame = null;

  constructor(page) {
    this.#page = page;
    this.#window = new Window();
    WINDOW_TO_FRAME.set(this.#window, this);
    // Register the stable per-document node handles for the anchor default
    // action lookup (see FRAME_OF_NODE); held strongly so the native weak
    // wrapper cache keeps the same JS objects alive for the walk-up match.
    this.#registeredNodes = this.#registerDocumentNodes();
  }

  // Registers the document / documentElement / head / body handles for the
  // anchor default-action lookup and returns the registered wrappers. A
  // navigation re-parses the whole document (new element handles), so every
  // navigation re-registers.
  #registerDocumentNodes() {
    const document = this.#window.document;
    const wrappers = [document, document.documentElement, document.head, document.body];
    for (const wrapper of wrappers) {
      if (wrapper !== null && wrapper !== undefined) {
        FRAME_OF_NODE.set(ctx.documentContext.handleOf(wrapper), this);
      }
    }
    return wrappers;
  }

  get page() {
    return this.#page;
  }

  get window() {
    return this.#window;
  }

  get document() {
    return this.#window.document;
  }

  get childFrames() {
    return [];
  }

  get parentFrame() {
    return null;
  }

  get closed() {
    return this.#closed;
  }

  get url() {
    return this.#window.location.href;
  }

  set url(value) {
    this.#window.location.href = String(value);
  }

  get content() {
    return this.#window.document.documentElement?.outerHTML ?? "";
  }

  set content(html) {
    this.#writeHTML(String(html));
  }

  goto(url, options) {
    return this.#navigate(url, { goToOptions: options });
  }

  /**
   * Navigates back in history (happy-dom `BrowserFrameNavigator.navigateBack`
   * parity): with no earlier entry the promise resolves `null` after one
   * animation frame; otherwise the current item moves back and — unless the
   * target is a same-origin pop-state entry — the frame re-navigates (re-fetches)
   * to its URL.
   */
  goBack(options) {
    const history = this.#history;
    const historyItem = history.items[history.items.indexOf(history.currentItem) - 1];
    if (historyItem === undefined) {
      return this.#noOpNavigation();
    }
    const fromOrigin = new URL(history.currentItem.href).origin;
    const toOrigin = new URL(historyItem.href).origin;
    history.currentItem = historyItem;
    if (!historyItem.popState || fromOrigin !== toOrigin) {
      return this.#navigate(historyItem.href, {
        goToOptions: { ...options, referrer: this.url },
        disableHistory: true,
        method: historyItem.method,
        formData: historyItem.formData,
      });
    }
    this.#setURL(historyItem.href);
    this.#dispatchPopState(historyItem);
    return Promise.resolve(null);
  }

  /**
   * Navigates forward in history (happy-dom
   * `BrowserFrameNavigator.navigateForward` parity): the mirror of `goBack`
   * for the entry after the current one.
   */
  goForward(options) {
    const history = this.#history;
    const historyItem = history.items[history.items.indexOf(history.currentItem) + 1];
    if (historyItem === undefined) {
      return this.#noOpNavigation();
    }
    const fromOrigin = new URL(history.currentItem.href).origin;
    const toOrigin = new URL(historyItem.href).origin;
    history.currentItem = historyItem;
    if (!historyItem.popState || fromOrigin !== toOrigin) {
      return this.#navigate(historyItem.href, {
        goToOptions: { ...options, referrer: this.url },
        disableHistory: true,
        method: historyItem.method,
        formData: historyItem.formData,
      });
    }
    this.#setURL(historyItem.href);
    this.#dispatchPopState(historyItem);
    return Promise.resolve(null);
  }

  /**
   * Navigates a delta in history (happy-dom
   * `BrowserFrameNavigator.navigateSteps` parity): `0` reloads; an
   * out-of-range target resolves `null` after one animation frame; otherwise
   * the frame re-navigates to the target entry unless every stepped entry is a
   * same-origin pop-state entry.
   */
  goSteps(steps, options) {
    if (!steps) {
      return this.reload(options);
    }
    const history = this.#history;
    const fromIndex = history.items.indexOf(history.currentItem);
    const toIndex = fromIndex + steps;
    const historyItem = history.items[toIndex];
    if (historyItem === undefined) {
      return this.#noOpNavigation();
    }
    const fromOrigin = new URL(history.currentItem.href).origin;
    let isPopState = true;
    if (steps < 0) {
      for (let i = fromIndex; i > toIndex; i--) {
        if (!history.items[i].popState || fromOrigin !== new URL(history.items[i].href).origin) {
          isPopState = false;
          break;
        }
      }
    } else {
      for (let i = fromIndex; i < toIndex; i++) {
        if (!history.items[i].popState || fromOrigin !== new URL(history.items[i].href).origin) {
          isPopState = false;
          break;
        }
      }
    }
    history.currentItem = historyItem;
    if (!isPopState) {
      return this.#navigate(historyItem.href, {
        goToOptions: { ...options, referrer: this.url },
        disableHistory: true,
        method: historyItem.method,
        formData: historyItem.formData,
      });
    }
    this.#setURL(historyItem.href);
    this.#dispatchPopState(historyItem);
    return Promise.resolve(null);
  }

  /**
   * Reloads the current history item (happy-dom
   * `BrowserFrameNavigator.reload` parity): re-navigates the current entry's
   * URL without recording a new history entry. On a fresh page the current
   * entry is `about:blank`, so the reload writes the empty document and
   * resolves `null` without touching the network. Non-object options (the
   * wiki's `page.reload(url, options)` shape) are tolerated exactly like
   * happy-dom tolerates them.
   */
  reload(options) {
    const current = this.#history.currentItem;
    return this.#navigate(current.href, {
      goToOptions: { ...options, referrer: this.url },
      disableHistory: true,
      method: current.method,
      formData: current.formData,
    });
  }

  // The pop-state path of goBack / goForward / goSteps: the URL changes
  // without a fetch and the window sees a `popstate` event carrying the
  // entry's state (happy-dom dispatches a `PopStateEvent`).
  #dispatchPopState(historyItem) {
    const event = new Event("popstate");
    event.state = historyItem.state;
    this.#window.dispatchEvent(event);
  }

  // The empty-history path of goBack / goForward / goSteps (happy-dom
  // parity): nothing to navigate — resolve `null` after one animation frame,
  // flushing any navigation waiters on the way.
  #noOpNavigation() {
    return new Promise((resolve) => {
      this.#window.requestAnimationFrame(() => {
        this.#flushNavWaiters();
        resolve(null);
      });
    });
  }

  async #navigate(url, options = {}) {
    const { goToOptions = null, disableHistory = false, method = "GET", formData = null } = options;
    const targetURL = resolveFrameURL(this.url, url);

    // Hash navigation: same document, only the fragment changes — record a
    // pop-state entry, update the URL, no fetch (happy-dom parity).
    const targetURLWithoutHash = targetURL.href.split("#")[0];
    const currentURLWithoutHash = this.url.split("#")[0];
    if (
      targetURLWithoutHash === currentURLWithoutHash &&
      targetURL.hash &&
      targetURL.hash !== this.#window.location.hash
    ) {
      if (!disableHistory) {
        this.#history.currentItem.popState = true;
        this.#pushHistory({
          title: "",
          href: targetURL.href,
          state: null,
          popState: true,
          scrollRestoration: "manual",
          method,
          formData,
        });
      }
      this.#setURL(targetURL.href);
      this.#flushNavWaiters();
      return null;
    }

    // JavaScript protocol: happy-dom evaluates the code when JavaScript
    // evaluation is enabled; mad-dom does not evaluate navigation scripts, so
    // the navigation is a no-op (no URL change, no history entry — the same
    // early exit happy-dom takes before history management).
    if (targetURL.protocol === "javascript:") {
      return null;
    }

    // History management: every real navigation records its entry.
    if (!disableHistory) {
      this.#pushHistory({
        title: "",
        href: targetURL.href,
        state: null,
        popState: false,
        scrollRestoration: "auto",
        method,
        formData,
      });
    }

    // About protocol: no fetch — the document resets to the empty skeleton
    // (happy-dom replaces the window with a fresh empty one).
    if (targetURL.protocol === "about:") {
      this.#writeHTML("");
      this.#setURL(targetURL.href);
      this.#flushNavWaiters();
      return null;
    }

    // Only http(s) navigations reach the fetch path (the historical mad-dom
    // boundary for other protocols).
    if (targetURL.protocol !== "http:" && targetURL.protocol !== "https:") {
      return null;
    }

    this.#pendingNav++;
    this.#navCompletionPromise = new Promise((resolve) => {
      this.#navCompletionResolve = resolve;
    });
    try {
      const response = await this.#fetchTopLevel(targetURL.href, goToOptions);
      this.#setURL(response.url || targetURL.href);
      const html = await response.text();
      this.#writeHTML(html);
      return response;
    } finally {
      this.#pendingNav--;
      this.#flushNavWaiters();
    }
  }

  // The top-level fetch: virtual servers first (the local filesystem serves
  // the response), then the host fetch with the happy-dom `goto` option
  // semantics (`hard` sends `Cache-Control: no-cache`, `timeout` — default
  // 30s — aborts with a `TimeoutError` DOMException).
  async #fetchTopLevel(requestURL, goToOptions) {
    const virtual = await virtualServerResponse(
      this.#virtualServers(),
      requestURL,
      this.#window.location.origin,
    );
    if (virtual !== null) return virtual;

    const headers = {};
    if (goToOptions?.headers != null) {
      const source = goToOptions.headers;
      if (typeof source.forEach === "function") {
        source.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (typeof source === "object") {
        Object.assign(headers, source);
      }
    }
    if (goToOptions?.hard) {
      headers["Cache-Control"] = "no-cache";
    }

    const timeout = goToOptions?.timeout ?? 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException("The operation was aborted. Request timed out.", "TimeoutError"));
    }, timeout);
    try {
      return await globalThis.fetch(requestURL, {
        redirect: "follow",
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  #virtualServers() {
    return this.#page?.context?.browser?.settings?.fetch?.virtualServers ?? null;
  }

  // Records a history entry on the frame history and keeps the frame window's
  // `window.history` length in step (happy-dom shares one list between the
  // two; the facade keeps the frame list authoritative and mirrors pushes).
  #pushHistory(item) {
    this.#history.push(item);
    const windowHistory = this.#window.history;
    if (windowHistory !== null && windowHistory !== undefined) {
      try {
        windowHistory.push({ ...item });
      } catch {
        // The window history mirror is parity-only; never fail a navigation.
      }
    }
  }

  // The single URL mutation point for navigations: updates the location state
  // without a second history push (the frame history is already recorded).
  #setURL(href) {
    this.#window.location._setURL(href);
  }

  // The default `<a>` action: server-side navigation to the resolved href.
  navigateFromClick(href) {
    if (href === null || href === undefined) return;
    const raw = String(href).trim();
    if (raw === "" || raw.startsWith("javascript:") || raw.startsWith("data:")) return;
    void this.#navigate(raw);
  }

  // Writes a fetched / set document through the native full-document parser
  // (happy-dom replaces the window's document on every navigation; mad-dom
  // re-parses the one document in place) and re-registers the structural
  // handles the anchor default-action lookup walks.
  #writeHTML(html) {
    const document = this.#window.document;
    for (const wrapper of this.#registeredNodes) {
      FRAME_OF_NODE.delete(ctx.documentContext.handleOf(wrapper));
    }
    document.parseHtml(String(html));
    this.#registeredNodes = this.#registerDocumentNodes();
  }

  #flushNavWaiters() {
    const resolve = this.#navCompletionResolve;
    this.#navCompletionResolve = null;
    this.#navCompletionPromise = null;
    if (resolve) resolve();
    for (const waiter of this.#navWaiters.splice(0)) {
      waiter();
    }
  }

  waitUntilComplete() {
    if (this.#pendingNav > 0) {
      return this.#navCompletionPromise.then(() => Promise.resolve());
    }
    return Promise.resolve();
  }

  waitForNavigation() {
    if (this.#pendingNav > 0) {
      return this.#navCompletionPromise;
    }
    return new Promise((resolve) => this.#navWaiters.push(resolve));
  }

  async abort() {}

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const wrapper of this.#registeredNodes) {
      FRAME_OF_NODE.delete(ctx.documentContext.handleOf(wrapper));
    }
    this.#registeredNodes = [];
    WINDOW_TO_FRAME.delete(this.#window);
  }

  /**
   * Evaluates code or a pre-compiled `node:vm` `Script` in the frame window's
   * script context (happy-dom `BrowserFrameScriptEvaluator.evaluate` parity):
   * a string runs through the window `eval` surface; anything else (a `vm`
   * `Script`) runs through `runInContext` against the window's own context.
   */
  evaluate(script) {
    if (typeof script === "string") {
      return this.#window.eval(script);
    }
    const entry = ensureWindowEval(this.#window);
    return script.runInContext(entry.context);
  }
}

// --- BrowserPage --------------------------------------------------------------

/**
 * A browser page (tab) with exactly one main frame (happy-dom `BrowserPage`
 * surface without child frames). The page viewport is the single source for
 * the frame window's viewport dimensions: `setViewport` updates it (and
 * dispatches the window `resize` event on a change), and the frame window's
 * `innerWidth` / `innerHeight` / `outerWidth` / `outerHeight` /
 * `devicePixelRatio` read through it — the happy-dom parity where
 * `BrowserWindow.innerWidth` resolves to `page.viewport.width`.
 */
export class BrowserPage {
  #context = null;
  #mainFrame = null;
  #closed = false;
  #viewport = null;

  constructor(context) {
    this.#context = context;
    this.#mainFrame = new BrowserFrame(this);
    this.virtualConsolePrinter = new VirtualConsolePrinter();
    const settingsViewport = context.browser.settings.viewport ?? {};
    this.#viewport = {
      width: settingsViewport.width ?? 1024,
      height: settingsViewport.height ?? 768,
      devicePixelRatio: settingsViewport.devicePixelRatio ?? 1,
    };
    // The frame window viewport reads through the page viewport (instance
    // accessors shadow the Window prototype's constructor-viewport ones).
    const windowFacade = this.#mainFrame.window;
    const viewport = this.#viewport;
    for (const [property, key] of [
      ["innerWidth", "width"],
      ["innerHeight", "height"],
      ["outerWidth", "width"],
      ["outerHeight", "height"],
      ["devicePixelRatio", "devicePixelRatio"],
    ]) {
      Object.defineProperty(windowFacade, property, {
        get: () => viewport[key],
        set: (value) => {
          viewport[key] = value;
        },
        enumerable: true,
        configurable: true,
      });
    }
    // happy-dom routes a frame window through its page / browser: the
    // window's `happyDOM.settings` IS the browser's settings object
    // (DetachedWindowAPI.settings) and the frame console writes into the
    // page's printer. Wiring both here keeps the frame window's
    // `document.write` script gating and its console surface on the browser's
    // state.
    this.#mainFrame.window.happyDOM.settings = context.browser.settings;
    this.#mainFrame.window.happyDOM.virtualConsolePrinter = this.virtualConsolePrinter;
    // The single print path: every window `error` event (process-level capture
    // and contained timer/script errors alike) lands in the virtual console.
    this.#mainFrame.window.addEventListener("error", (event) => {
      this.virtualConsolePrinter.print({
        level: VirtualConsoleLogLevelEnum.error,
        message: formatErrorEntry(event.error),
      });
    });
  }

  get mainFrame() {
    return this.#mainFrame;
  }

  get frames() {
    return [this.#mainFrame];
  }

  get context() {
    return this.#context;
  }

  get viewport() {
    return this.#viewport;
  }

  get closed() {
    return this.#closed;
  }

  get url() {
    return this.#mainFrame.url;
  }

  set url(value) {
    this.#mainFrame.url = String(value);
  }

  get content() {
    return this.#mainFrame.content;
  }

  set content(html) {
    this.#mainFrame.content = html;
  }

  goto(url, options) {
    return this.#mainFrame.goto(url, options);
  }

  goBack(options) {
    return this.#mainFrame.goBack(options);
  }

  goForward(options) {
    return this.#mainFrame.goForward(options);
  }

  goSteps(steps, options) {
    return this.#mainFrame.goSteps(steps, options);
  }

  reload(options) {
    return this.#mainFrame.reload(options);
  }

  waitUntilComplete() {
    return this.#mainFrame.waitUntilComplete();
  }

  waitForNavigation() {
    return this.#mainFrame.waitForNavigation();
  }

  evaluate(script) {
    return this.#mainFrame.evaluate(script);
  }

  /**
   * Sets the viewport (happy-dom parity): merges the given values into the
   * page viewport and — when `width` / `height` / `devicePixelRatio`
   * changed — dispatches a `resize` event on the main frame window. The
   * frame window's viewport accessors read through the page viewport, so the
   * new dimensions are immediately observable on `window.innerWidth` and
   * friends.
   */
  setViewport(viewport) {
    if (viewport === null || viewport === undefined) return;
    const previous = { ...this.#viewport };
    Object.assign(this.#viewport, viewport);
    if (
      previous.width !== this.#viewport.width ||
      previous.height !== this.#viewport.height ||
      previous.devicePixelRatio !== this.#viewport.devicePixelRatio
    ) {
      this.#mainFrame.window.dispatchEvent(new Event("resize"));
    }
  }

  async abort() {}

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    const context = this.#context;
    const index = context.pages.indexOf(this);
    if (index !== -1) context.pages.splice(index, 1);
    unobserveWindow(context.browser, this.#mainFrame.window);
    await this.#mainFrame.close();
  }
}

// --- BrowserContext -----------------------------------------------------------

/**
 * A browser context: the page list, the cookie container and the lifecycle of
 * one context (happy-dom `BrowserContext` surface; no response caches).
 */
export class BrowserContext {
  #browser = null;
  #closed = false;

  constructor(browser) {
    this.#browser = browser;
    this.pages = [];
    // The context's cookie store (happy-dom parity: every context mints its
    // own `CookieContainer`; `close` clears it).
    this.cookieContainer = new CookieContainer();
  }

  get browser() {
    return this.#browser;
  }

  get closed() {
    return this.#closed;
  }

  newPage() {
    const page = new BrowserPage(this);
    this.pages.push(page);
    observeWindow(this.#browser, page.mainFrame.window);
    return page;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const page of [...this.pages]) {
      await page.close();
    }
    // happy-dom parity: closing a context clears its cookie store.
    this.cookieContainer.clearCookies();
  }

  async waitUntilComplete() {
    for (const page of [...this.pages]) {
      await page.waitUntilComplete();
    }
  }

  async abort() {}
}

// --- Browser ------------------------------------------------------------------

const DEFAULT_SETTINGS = Object.freeze({
  disableJavaScriptEvaluation: false,
  enableJavaScriptEvaluation: false,
  disableJavaScriptFileLoading: false,
  disableCSSFileLoading: false,
  enableImageFileLoading: false,
  disableComputedStyleRendering: false,
  handleDisabledFileLoadingAsSuccess: false,
  suppressCodeGenerationFromStringsWarning: false,
  suppressInsecureJavaScriptEnvironmentWarning: false,
  timer: Object.freeze({
    maxTimeout: 2147483647,
    maxIntervalTime: 2147483647,
    maxIntervalIterations: Infinity,
    preventTimerLoops: false,
  }),
  fetch: Object.freeze({
    disableSameOriginPolicy: false,
    disableStrictSSL: false,
    interceptor: null,
    requestHeaders: null,
    virtualServers: null,
  }),
  module: Object.freeze({ resolveNodeModules: null, urlResolver: null, disableCache: false }),
  disableErrorCapturing: false,
  errorCapture: BrowserErrorCaptureEnum.tryAndCatch,
  enableFileSystemHttpRequests: false,
  disableIframePageLoading: false,
  navigation: Object.freeze({
    disableMainFrameNavigation: false,
    disableChildFrameNavigation: false,
    disableChildPageNavigation: false,
    disableFallbackToSetURL: false,
    crossOriginPolicy: "anyOrigin",
    beforeContentCallback: null,
  }),
  navigator: Object.freeze({ userAgent: "", maxTouchPoints: 0 }),
  device: Object.freeze({
    prefersColorScheme: "",
    prefersReducedMotion: "",
    mediaType: "",
    forcedColors: "",
  }),
  debug: Object.freeze({ traceWaitUntilComplete: false }),
  viewport: Object.freeze({ width: 1024, height: 768, devicePixelRatio: 1 }),
  canvasAdapter: null,
});

function mergeSettings(settings) {
  const given = settings ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...given,
    timer: { ...DEFAULT_SETTINGS.timer, ...given.timer },
    fetch: { ...DEFAULT_SETTINGS.fetch, ...given.fetch },
    module: { ...DEFAULT_SETTINGS.module, ...given.module },
    navigation: { ...DEFAULT_SETTINGS.navigation, ...given.navigation },
    navigator: { ...DEFAULT_SETTINGS.navigator, ...given.navigator },
    device: { ...DEFAULT_SETTINGS.device, ...given.device },
    debug: { ...DEFAULT_SETTINGS.debug, ...given.debug },
    viewport: { ...DEFAULT_SETTINGS.viewport, ...given.viewport },
  };
}

// Browser → its exception observer (null when errorCapture is not
// processLevel). Keyed outside the class so the page/context classes can reach
// the observer without private-name access.
const OBSERVERS = new WeakMap();

function observeWindow(browser, windowFacade) {
  OBSERVERS.get(browser)?.observe(windowFacade);
}

function unobserveWindow(browser, windowFacade) {
  OBSERVERS.get(browser)?.disconnect(windowFacade);
}

/**
 * The happy-dom `Browser` surface: settings, a default context, pages and the
 * lifecycle. With `errorCapture: processLevel` the browser observes the Node
 * process for uncaught window-script errors while pages are open.
 */
export class Browser {
  #closed = false;

  constructor(options = {}) {
    this.settings = mergeSettings(options.settings);
    this.console = options.console ?? null;
    OBSERVERS.set(
      this,
      this.settings.errorCapture === BrowserErrorCaptureEnum.processLevel
        ? new BrowserExceptionObserver()
        : null,
    );
    this.contexts = [new BrowserContext(this)];
  }

  get defaultContext() {
    return this.contexts[0];
  }

  get closed() {
    return this.#closed;
  }

  newPage() {
    return this.defaultContext.newPage();
  }

  newIncognitoContext() {
    const context = new BrowserContext(this);
    this.contexts.push(context);
    return context;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const context of [...this.contexts]) {
      await context.close();
    }
  }

  async waitUntilComplete() {
    for (const context of [...this.contexts]) {
      await context.waitUntilComplete();
    }
  }

  async abort() {}
}

// --- window.open (mirrors happy-dom WindowPageOpenUtility) -------------------

/**
 * The restricted window facade happy-dom hands back for a cross-origin
 * `window.open`: only the cross-origin-safe surface (`self` / `top` /
 * `parent` / `opener` / `closed` / `blur` / `focus` / `close` /
 * `postMessage`) — every `location` access throws the SecurityError
 * DOMException.
 */
export class CrossOriginBrowserWindow {
  #targetWindow = null;
  #parent = null;

  constructor(target, parent) {
    this.#targetWindow = target;
    this.#parent = parent ?? this;
    this.window = this;
    this.location = new Proxy(
      {},
      {
        get: () => {
          throw new DOMException(
            `Blocked a frame with origin "${this.#parent.location?.origin}" from accessing a cross-origin frame.`,
            "SecurityError",
          );
        },
        set: () => {
          throw new DOMException(
            `Blocked a frame with origin "${this.#parent.location?.origin}" from accessing a cross-origin frame.`,
            "SecurityError",
          );
        },
      },
    );
  }

  get self() {
    return this;
  }

  get top() {
    return this.#parent;
  }

  get parent() {
    return this.#parent;
  }

  get opener() {
    return this.#targetWindow.opener;
  }

  get closed() {
    return this.#targetWindow.closed;
  }

  blur() {
    this.#targetWindow.blur?.();
  }

  focus() {
    this.#targetWindow.focus?.();
  }

  close() {
    this.#targetWindow.close?.();
  }

  postMessage(message, targetOrigin = "*", transfer) {
    this.#targetWindow.postMessage?.(message, targetOrigin, transfer);
  }
}

// The `window.open` features string parser (happy-dom
// `WindowPageOpenUtility.getWindowFeatures` parity).
function getWindowFeatures(features) {
  const parts = features.split(",");
  const result = {
    popup: false,
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    noopener: false,
    noreferrer: false,
  };
  for (const part of parts) {
    const [key, value] = part.split("=");
    switch (key) {
      case "popup":
        result.popup = !value || value === "yes" || value === "1" || value === "true";
        break;
      case "width":
      case "innerWidth":
        result.width = parseInt(value, 10);
        break;
      case "height":
      case "innerHeight":
        result.height = parseInt(value, 10);
        break;
      case "left":
      case "screenX":
        result.left = parseInt(value, 10);
        break;
      case "top":
      case "screenY":
        result.top = parseInt(value, 10);
        break;
      case "noopener":
        result.noopener = true;
        break;
      case "noreferrer":
        result.noreferrer = true;
        break;
    }
  }
  return result;
}

// Detached window → the ad-hoc browser minted for its `window.open` child
// pages. The browser carries the opening window's virtual-server settings, so
// the child navigation resolves the same local files happy-dom would serve
// (a detached window in happy-dom owns a DetachedBrowser the same way).
const DETACHED_BROWSERS = new WeakMap();

function detachedBrowserOf(windowFacade) {
  let browser = DETACHED_BROWSERS.get(windowFacade);
  if (browser === undefined) {
    const settings = ctx.windowSettings(windowFacade);
    browser = new Browser({
      settings: {
        fetch: { virtualServers: settings.fetch?.virtualServers ?? null },
      },
    });
    DETACHED_BROWSERS.set(windowFacade, browser);
  }
  return browser;
}

/**
 * `window.open` (happy-dom `WindowPageOpenUtility.openPage` parity): opens a
 * new page in the owning frame's context (or an ad-hoc browser for a
 * detached window), navigates it to the resolved URL (virtual-server-aware,
 * same fetch interception as `goto`), registers the navigation with the
 * opener's `happyDOM.waitUntilComplete` surface, and returns the child
 * window — a `CrossOriginBrowserWindow` for a cross-origin target, `null`
 * with `noopener` / `noreferrer`.
 */
function openPage(windowFacade, options) {
  const features = getWindowFeatures(options?.features || "");
  const target = options?.target !== undefined ? String(options.target) : null;
  const parentFrame = WINDOW_TO_FRAME.get(windowFacade) ?? null;
  const targetURL = resolveFrameURL(windowFacade.location.href, options?.url);
  let targetFrame;
  if (target === "_self" && parentFrame !== null) {
    targetFrame = parentFrame;
  } else if (target === "_top" && parentFrame !== null) {
    targetFrame = parentFrame.page.mainFrame;
  } else if (target === "_parent" && parentFrame !== null) {
    targetFrame = parentFrame.parentFrame ?? parentFrame;
  } else {
    const context =
      parentFrame !== null
        ? parentFrame.page.context
        : detachedBrowserOf(windowFacade).defaultContext;
    targetFrame = context.newPage().mainFrame;
  }
  const navigation = targetFrame.goto(targetURL.href, {
    referrer: features.noreferrer ? undefined : windowFacade.location.origin,
  });
  navigation.catch(() => {
    // happy-dom routes the error to the page console; the facade has no
    // stdout console here — a failed open never surfaces as a rejection.
  });
  // The opener's `happyDOM.waitUntilComplete` must cover the child
  // navigation (happy-dom's shared async-task registry parity).
  windowFacade.happyDOM.registerPending?.(navigation);
  if (targetURL.protocol === "javascript:") {
    return targetFrame.window;
  }
  if (features.noopener || features.noreferrer) {
    return null;
  }
  const isCORS =
    targetURL.protocol !== "about:" &&
    targetURL.protocol !== "javascript:" &&
    new URL(windowFacade.location.href).origin !== targetURL.origin;
  if (isCORS) {
    return new CrossOriginBrowserWindow(targetFrame.window, windowFacade);
  }
  return targetFrame.window;
}

// --- install ------------------------------------------------------------------

/**
 * Installs the browser surface: the anchor default-action `click` (server-side
 * navigation inside a browser frame) and the `window.open` popup surface —
 * the rest of the surface is plain module exports driven from the package
 * entry.
 */
export function install(extensionCtx) {
  if (ctx === null) ctx = extensionCtx;
  const installCtx = extensionCtx;

  // HTMLAnchorElement click default action: dispatch the bubbling cancelable
  // MouseEvent, then — unless a listener prevented the default — navigate the
  // owning browser frame to the resolved href (happy-dom anchor behavior).
  installCtx.defineMethod(HTMLAnchorElement.prototype, "click", function click() {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
    this.dispatchEvent(event);
    if (event.defaultPrevented) return;
    const frame = frameOfNode(this);
    if (frame === undefined) return;
    frame.navigateFromClick(this.getAttribute("href"));
  });

  // `window.open` (happy-dom `BrowserWindow.open` parity): opens a child page
  // through the WindowPageOpenUtility mirror above. `writable: true` matches
  // happy-dom's class-method descriptor so an instance assignment can shadow
  // it.
  installCtx.defineMethod(Window.prototype, "open", function open(url, target, features) {
    return openPage(this, { url, target, features });
  }, { writable: true });
}
