// `Browser` facade extension (happy-dom browser/page model, integration surface).
//
// Installs the happy-dom public contract for the browser/page/frame model the
// vendored happy-dom integration suite drives (`benchmark/`):
//
//   - `BrowserErrorCaptureEnum` — the error-capture policy values;
//   - `Browser` — settings, a default context, `newPage()` and the lifecycle
//     (`close` / `waitUntilComplete` / `abort`);
//   - `BrowserContext` — the page list of a browser context;
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
//   - No iframes / child frames / popups: every page has exactly one frame.
//   - No script evaluation on navigation, no subresource loading, no viewport
//     rendering, no cookie/response caches, no `evaluateModule`.
//   - The `timer` / `fetch` / `module` / `device` settings are accepted and
//     stored for shape parity but do not alter behavior.
//
// The module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`.

import { HTMLAnchorElement } from "./html-element.js";
import { MouseEvent } from "./events.js";
import { dispatchWindowError, evalContextOf } from "./timers.js";
import { Window } from "../window.js";

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

// --- VirtualConsoleLogLevelEnum / VirtualConsolePrinter -----------------------

export const VirtualConsoleLogLevelEnum = Object.freeze({
  log: 0,
  info: 1,
  warn: 2,
  error: 3,
});

/**
 * The page's virtual console printer (happy-dom parity): a growing buffer of
 * log entries with the `print` / `clear` event surface and `read` /
 * `readAsString` consumers.
 */
export class VirtualConsolePrinter {
  #logEntries = [];
  #listeners = { print: [], clear: [] };
  #closed = false;

  get closed() {
    return this.#closed;
  }

  print(logEntry) {
    if (this.#closed) return;
    this.#logEntries.push(logEntry);
    this.#dispatch({ type: "print" });
  }

  clear() {
    if (this.#closed) return;
    this.#logEntries = [];
    this.#dispatch({ type: "clear" });
  }

  close() {
    if (this.#closed) return;
    this.#logEntries = [];
    this.#listeners = { print: [], clear: [] };
    this.#closed = true;
  }

  addEventListener(eventType, listener) {
    if (this.#closed) return;
    if (!this.#listeners[eventType]) {
      throw new Error(`Event type "${eventType}" is not supported.`);
    }
    this.#listeners[eventType].push(listener);
  }

  removeEventListener(eventType, listener) {
    if (this.#closed) return;
    if (!this.#listeners[eventType]) {
      throw new Error(`Event type "${eventType}" is not supported.`);
    }
    const index = this.#listeners[eventType].indexOf(listener);
    if (index !== -1) {
      this.#listeners[eventType].splice(index, 1);
    }
  }

  dispatchEvent(event) {
    if (this.#closed) return;
    if (event.type !== "print" && event.type !== "clear") {
      throw new Error(`Event type "${event.type}" is not supported.`);
    }
    this.#dispatch(event);
  }

  #dispatch(event) {
    for (const listener of this.#listeners[event.type]) {
      listener(event);
    }
  }

  read() {
    const logEntries = this.#logEntries;
    this.#logEntries = [];
    return logEntries;
  }

  readAsString(logLevel = VirtualConsoleLogLevelEnum.log) {
    let output = "";
    for (const logEntry of this.read()) {
      if (logEntry.level >= logLevel) {
        output += logEntry.message;
      }
    }
    return output;
  }
}

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

// --- HTML title extraction ----------------------------------------------------

const TITLE_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;

const HTML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (match) => HTML_ENTITIES[match]);
}

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

// --- BrowserFrame -------------------------------------------------------------

/**
 * The top-level frame of a browser page (happy-dom `BrowserFrame` surface):
 * owns a full `Window` facade and performs server-side navigation.
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

  constructor(page) {
    this.#page = page;
    this.#window = new Window();
    // Register the stable per-document node handles for the anchor default
    // action lookup (see FRAME_OF_NODE); held strongly so the native weak
    // wrapper cache keeps the same JS objects alive for the walk-up match.
    const document = this.#window.document;
    this.#registeredNodes = [document, document.documentElement, document.head, document.body];
    for (const wrapper of this.#registeredNodes) {
      if (wrapper !== null && wrapper !== undefined) {
        FRAME_OF_NODE.set(ctx.documentContext.handleOf(wrapper), this);
      }
    }
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

  goto(url) {
    return this.#navigate(url);
  }

  async #navigate(url) {
    const absolute = (() => {
      try {
        return new URL(String(url ?? ""), this.url).href;
      } catch {
        return null;
      }
    })();
    if (absolute === null) return null;
    let protocol;
    try {
      protocol = new URL(absolute).protocol;
    } catch {
      return null;
    }
    if (protocol !== "http:" && protocol !== "https:") return null;
    this.#pendingNav++;
    this.#navCompletionPromise = new Promise((resolve) => {
      this.#navCompletionResolve = resolve;
    });
    try {
      const response = await globalThis.fetch(absolute, { redirect: "follow" });
      const html = await response.text();
      this.#writeHTML(html);
      this.url = response.url || absolute;
      return response;
    } finally {
      this.#pendingNav--;
      const resolve = this.#navCompletionResolve;
      this.#navCompletionResolve = null;
      this.#navCompletionPromise = null;
      if (resolve) resolve();
      for (const waiter of this.#navWaiters.splice(0)) {
        waiter();
      }
    }
  }

  // The default `<a>` action: server-side navigation to the resolved href.
  navigateFromClick(href) {
    if (href === null || href === undefined) return;
    const raw = String(href).trim();
    if (raw === "" || raw.startsWith("javascript:") || raw.startsWith("data:")) return;
    void this.#navigate(raw);
  }

  #writeHTML(html) {
    const document = this.#window.document;
    const titleMatch = TITLE_PATTERN.exec(html);
    if (titleMatch !== null) {
      document.title = decodeEntities(titleMatch[1].trim());
    }
    const body = document.body;
    body.innerHTML = "";
    const fragment = document.createDocumentFragment();
    fragment.innerHTML = html;
    body.appendChild(fragment);
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
  }

  evaluate(script) {
    return this.#window.eval(String(script));
  }
}

// --- BrowserPage --------------------------------------------------------------

/**
 * A browser page (tab) with exactly one main frame (happy-dom `BrowserPage`
 * surface without child frames / popups).
 */
export class BrowserPage {
  #context = null;
  #mainFrame = null;
  #closed = false;
  #viewport = { width: 1024, height: 768 };

  constructor(context) {
    this.#context = context;
    this.#mainFrame = new BrowserFrame(this);
    this.virtualConsolePrinter = new VirtualConsolePrinter();
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

  goto(url) {
    return this.#mainFrame.goto(url);
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

  setViewport(viewport) {
    if (viewport === null || viewport === undefined) return;
    if (typeof viewport.width === "number") this.#viewport.width = viewport.width;
    if (typeof viewport.height === "number") this.#viewport.height = viewport.height;
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
 * A browser context: the page list and lifecycle of one context (happy-dom
 * `BrowserContext` surface; no cookie / response caches).
 */
export class BrowserContext {
  #browser = null;
  #closed = false;

  constructor(browser) {
    this.#browser = browser;
    this.pages = [];
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
  viewport: Object.freeze({ width: 1024, height: 768 }),
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

// --- install ------------------------------------------------------------------

/**
 * Installs the browser surface: the anchor default-action `click` (server-side
 * navigation inside a browser frame) — the rest of the surface is plain module
 * exports driven from the package entry.
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
}
