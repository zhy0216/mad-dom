// `Window` facade base module (T22B).
//
// The facade is a thin, state-free wrapper over the native binding
// (crates/mad-dom-bun, T19/T22A): it does argument shaping, wraps opaque
// native handles into facade objects and forwards lifecycle calls. It keeps
// **no second DOM state** — the Rust arena is the only authoritative tree and
// every wrapper below it stays exactly as long as its native handle.
//
// # The unique conversion entry (`ctx.wrap`)
//
// Every facade wrapper is produced by `ctx.wrap`, the single native handle →
// facade wrapper conversion point required by js/facade/CONTRACT.md. It
// mirrors the native per-document weak wrapper cache (T20): one facade object
// per live native handle, so `window.document === window.document` holds and
// cross-window documents never share identity. Facade wrappers are cached
// weakly (WeakMap keyed by the native handle), so the facade never pins a
// document either.
//
// # Handle-type registration
//
// `WindowHandle` → `Window` and `DocumentHandle` → `Document` are registered
// here at module init. Capability extensions register their own wrapper types
// (e.g. `NodeHandle` → `Node`, T23B) during their `install(ctx)` through
// `ctx.registerHandleType`, so a later subtask adds a wrapper type purely in
// its own extension file.
//
// # The `ctx` given to extensions
//
// js/facade/window.js builds the context and hands it to the facade registry
// (extensions/index.js) exactly once at facade initialization:
//
//   - `ctx.wrap(nativeHandle)` — the unique conversion entry above;
//   - `ctx.defineMethod(target, name, fn, descriptor)` /
//     `ctx.defineAccessor(target, name, get, set, descriptor)` — the only
//     sanctioned property-definition helpers for extension installers;
//   - `ctx.documentContext` — frozen, read-only access to the document
//     ownership reference a wrapper carries (`handleOf(wrapper)`); the native
//     handle is opaque, a Core `NodeId` never crosses this seam;
//   - `ctx.registerHandleType(name, makeWrapper)` — wrapper-type registry.
//
// The `seam` metadata below is flipped to `"implemented"` by the T22 gate;
// tests/bun/seam.test.js pins that shape.

import { loadNative } from "../native-loader.js";

import { Document } from "./document.js";
import { DOC_STATE_SLOT } from "./extensions/classes.js";
import { installExtensions } from "./extensions/index.js";

export const seam = Object.freeze({
  id: "facade/window",
  owner: "T22B",
  gate: "T22",
  status: "implemented",
});

// --- Native binding (T19 / T49) --------------------------------------------
//
// Shares the unified resolution chain and load-time ABI probe with the entry
// (js/native-loader.js): explicit `MAD_DOM_NATIVE_PATH` → npm platform package
// → repository-local dev artifact. Loading is lazy but fail-fast on first use
// with a stable `MAD_DOM_UNSUPPORTED_PLATFORM` / `MAD_DOM_ABI_MISMATCH` /
// `MAD_DOM_NATIVE_NOT_FOUND` error (ADR-0005 §6, §8, §9).

// --- The unique conversion entry -----------------------------------------

// Native handle behind each facade wrapper (reverse of the wrap cache below).
// Used by `ctx.documentContext.handleOf` so extensions can read the document
// ownership reference a wrapper carries without touching private fields.
const WRAPPER_TO_HANDLE = new WeakMap();

// Facade wrapper cache: native handle → facade wrapper. Weak on the native
// handle, so a facade wrapper never keeps its document alive; identity simply
// mirrors the native per-document weak cache (T20).
const WRAP_CACHE = new WeakMap();

// Native handle type → facade wrapper factory, keyed by the native class name
// (`WindowHandle`, `DocumentHandle`, …). Extensions add entries through
// `ctx.registerHandleType`.
const HANDLE_TYPES = new Map();

// --- Per-document facade state + wrapper pinning -------------------------
//
// Each facade-wrapped document owns a state object:
//
//   epoch — an `Int32Array` over the native document's structural epoch slot
//           (`DocumentHandle.epochView()`): the binding bumps the slot on
//           every call that changed the tree relations, so the navigation
//           getters (extensions/node.js) can validate their memoized reads
//           with a plain typed-array load — no FFI. `null` when the native
//           binding does not carry the epoch surface; the memo then stays
//           off and every read crosses into native as before.
//
//   pinned — a strong `Map` of native handle → facade wrapper, keyed into
//           this WeakMap by the document's native handle. The weak key keeps
//           the native binding's weak wrapper cache authoritative (a released
//           document still releases everything — the T47 lifecycle test), but
//           *while the document's native handle is reachable* every wrapper
//           minted under it stays alive. That stability is what lets the
//           navigation memo survive garbage collection: a tree walk over an
//           unchanged document re-reads memoized wrappers instead of
//           re-minting every node, which is the difference between native-
//           speed traversal and per-node FFI churn. Memory is bounded by the
//           document's own node count — the same order happy-dom's plain JS
//           nodes occupy.
const DOC_STATES = new WeakMap();

function docStateOf(docHandle) {
  let state = DOC_STATES.get(docHandle);
  if (state === undefined) {
    state = { epoch: null, pinned: new Map() };
    try {
      state.epoch = new Int32Array(docHandle.epochView());
    } catch {
      // Older native bindings without the epoch surface: the navigation memo
      // stays disabled, every read crosses into native as before.
    }
    DOC_STATES.set(docHandle, state);
  }
  return state;
}

// Pins a node wrapper in its document's state (see `DOC_STATES`). `docState`
// is passed by callers that already know the wrapper's document (navigation
// getters, the custom-element mint path); resolving it from the handle costs
// an `ownerDocument()` crossing and only happens on a cold mint.
function pinWrapper(nativeHandle, wrapper, docState) {
  const state = docState ?? docStateOf(nativeHandle.ownerDocument());
  wrapper[DOC_STATE_SLOT] = state;
  state.pinned.set(nativeHandle, wrapper);
}

function registerHandleType(constructorName, makeWrapper) {
  if (typeof constructorName !== "string" || constructorName.length === 0) {
    throw new TypeError("registerHandleType requires a non-empty constructor name");
  }
  if (typeof makeWrapper !== "function") {
    throw new TypeError("registerHandleType requires a wrapper factory function");
  }
  if (HANDLE_TYPES.has(constructorName)) {
    throw new Error(`mad-dom facade: handle type "${constructorName}" is already registered`);
  }
  HANDLE_TYPES.set(constructorName, makeWrapper);
}

// `docState` (optional, node wrappers only): the already-resolved per-
// document state of the wrapper's owning document; navigation getters pass
// their own so a mint never pays an extra `ownerDocument()` crossing.
function wrap(nativeHandle, docState) {
  if (nativeHandle === null || nativeHandle === undefined) return nativeHandle;
  const cached = WRAP_CACHE.get(nativeHandle);
  if (cached) return cached;
  const typeName = nativeHandle.constructor?.name;
  const makeWrapper = HANDLE_TYPES.get(typeName);
  if (typeof makeWrapper !== "function") {
    throw new TypeError(
      `mad-dom facade: no wrapper registered for native handle type "${
        typeName ?? "(unknown)"
      }"`,
    );
  }
  const wrapper = makeWrapper(nativeHandle);
  WRAP_CACHE.set(nativeHandle, wrapper);
  WRAPPER_TO_HANDLE.set(wrapper, nativeHandle);
  if (typeName === "NodeHandle") {
    pinWrapper(nativeHandle, wrapper, docState);
  } else if (typeName === "DocumentHandle") {
    wrapper[DOC_STATE_SLOT] = docStateOf(nativeHandle);
  }
  return wrapper;
}

// Registers a wrapper that was constructed outside `wrap` (the T48A
// `new DefinedClass()` mint path) in the same two caches, so a later `wrap`
// of the same native handle hands back that exact object. `docHandle` (the
// mint slot's native document handle) resolves the pin target without an
// extra crossing.
function registerWrap(nativeHandle, wrapper, docHandle) {
  if (nativeHandle === null || nativeHandle === undefined) return;
  WRAP_CACHE.set(nativeHandle, wrapper);
  WRAPPER_TO_HANDLE.set(wrapper, nativeHandle);
  if (docHandle !== undefined) {
    pinWrapper(nativeHandle, wrapper, docStateOf(docHandle));
  }
}

// --- Descriptor helpers ---------------------------------------------------

function defineMethod(target, name, fn, descriptor = {}) {
  Object.defineProperty(target, name, {
    value: fn,
    writable: descriptor.writable ?? false,
    enumerable: descriptor.enumerable ?? false,
    configurable: descriptor.configurable ?? false,
  });
}

function defineAccessor(target, name, get, set, descriptor = {}) {
  Object.defineProperty(target, name, {
    get,
    set,
    enumerable: descriptor.enumerable ?? false,
    configurable: descriptor.configurable ?? false,
  });
}

// --- The extension context ------------------------------------------------

const documentContext = Object.freeze({
  // Read-only access to the document ownership reference a wrapper carries.
  // The returned native handle is opaque — a Core `NodeId` never crosses this
  // seam as a primitive value (CONTRACT.md / native-window-document contract).
  handleOf(wrapper) {
    return WRAPPER_TO_HANDLE.get(wrapper) ?? null;
  },
});

const ctx = Object.freeze({
  wrap,
  defineMethod,
  defineAccessor,
  documentContext,
  registerHandleType,
  registerWrap,
  // Per-document facade state resolver (see `DOC_STATES`): mint-heavy facade
  // paths pass the result into `wrap` so a fresh wrapper is pinned without an
  // extra `ownerDocument()` crossing.
  docStateOf,
  windowFacadeOfDocument,
  windowSettings,
  windowOptions,
  setWindowViewport,
});

// --- `Window` facade -------------------------------------------------------

function isWindowHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.document === "function" &&
    typeof handle.destroy === "function"
  );
}

// Native handle behind each Window facade (the document's ownership lives in
// the native window handle itself).
const WIN_HANDLES = new WeakMap();

// Per-window viewport state (happy-dom Window constructor parity: `width` /
// `height` options (and the deprecated `innerWidth` / `innerHeight` aliases)
// take precedence over the `settings.viewport` browser setting, which itself
// falls back to the happy-dom default 1024×768 at devicePixelRatio 1). Keyed
// by the Window facade so the `innerWidth` / `outerWidth` / `devicePixelRatio`
// accessors and the media-query evaluation all read one consistent value.
const WINDOW_VIEWPORTS = new WeakMap();

// Per-window happy-dom settings kept by the Window facade for the surfaces
// that need them at runtime (`matchMedia` device settings and computed-style
// rendering toggle). Only the fields consumed by the facade are kept; the rest
// of the happy-dom settings surface is handled by the `Browser` settings when a
// window is created through a browser frame.
const WINDOW_SETTINGS = new WeakMap();

// The raw happy-dom constructor options object per window (`new Window(options)`
// hands a plain object literal; the native-handle path keeps an empty object).
// Extension surfaces resolve their constructor-time inputs lazily through
// `ctx.windowOptions` — the `console` option (window-platform.js) and the
// `settings` merged into `window.happyDOM.settings` live here, so the facade
// classes never re-read the options object themselves.
const WINDOW_OPTIONS = new WeakMap();

function computeWindowSettings(options) {
  const given = options?.settings ?? {};
  return {
    device: {
      prefersColorScheme: given.device?.prefersColorScheme ?? "light",
      prefersReducedMotion: given.device?.prefersReducedMotion ?? "no-preference",
      mediaType: given.device?.mediaType ?? "screen",
      forcedColors: given.device?.forcedColors ?? "none",
    },
    disableComputedStyleRendering: given.disableComputedStyleRendering ?? false,
    // The fetch settings a detached window carries for the browser surface: a
    // `window.open` child navigation resolves its virtual servers against the
    // opening window's settings (happy-dom WindowPageOpenUtility parity).
    fetch: {
      virtualServers: given.fetch?.virtualServers ?? null,
    },
  };
}

// Per-window settings accessor exposed through the facade `ctx` for the
// extension installers (the happy-dom device defaults: prefers-color-scheme
// light, prefers-reduced-motion no-preference, media type screen, forced-colors
// none). Not part of the module export surface — the public `window.js` shape
// is pinned by the T22B export test.
function windowSettings(windowFacade) {
  return WINDOW_SETTINGS.get(windowFacade) ?? computeWindowSettings({});
}

// Per-window constructor options accessor exposed through the facade `ctx` for
// the extension installers (the `console` / `settings` options). Returns the
// exact options object the window was constructed with, or an empty object for
// the native-handle construction path.
function windowOptions(windowFacade) {
  return WINDOW_OPTIONS.get(windowFacade) ?? {};
}

function computeViewport(options) {
  const viewportSetting = options?.settings?.viewport ?? {};
  return {
    width: options?.width ?? options?.innerWidth ?? viewportSetting.width ?? 1024,
    height: options?.height ?? options?.innerHeight ?? viewportSetting.height ?? 768,
    devicePixelRatio: viewportSetting.devicePixelRatio ?? 1,
  };
}

// Document facade → owning Window facade, held as a WeakRef value. A document
// has no native back-pointer to its window, so the `document` accessor keeps
// this reverse mapping for the document-side surface (document.write, script
// evaluation) to reach `eval` / the window error dispatch. The value is a
// WeakRef so the map never forms the strong cycle
// window → native handle → document → window (which Bun's GC would fail to
// reclaim in the lifecycle test); a collected window simply derefs to
// undefined.
const DOC_TO_WINDOW = new WeakMap();

// Reverse lookup for the document-side surface (document.write, script
// evaluation). The value is a WeakRef so the map never forms the strong cycle
// window → native handle → document → window (which Bun's GC would fail to
// reclaim in the lifecycle test); a collected window simply derefs to
// undefined.
function windowFacadeOfDocument(documentFacade) {
  return DOC_TO_WINDOW.get(documentFacade)?.deref();
}

/**
 * Facade wrapper for a native `WindowHandle`.
 *
 * T48 makes `Window` user-constructible like happy-dom: `new Window()` (or
 * `new Window(options)`) mints a fresh native window through the same lazy
 * loader `createWindow()` uses, so the happy-dom constructor shape works from
 * user code. Passing a genuine native window handle (the internal `wrap`
 * path) uses that handle directly. Anything else — `null`, a plain value, or a
 * wrong native handle such as a `DocumentHandle` — throws a `TypeError`, so
 * no facade surface can fabricate a window from a non-window.
 */
export class Window {
  constructor(nativeHandle) {
    let options = null;
    if (nativeHandle === undefined) {
      options = {};
      nativeHandle = loadNative().createWindow();
    } else if (
      nativeHandle !== null &&
      typeof nativeHandle === "object" &&
      nativeHandle.constructor === Object
    ) {
      // A plain object literal is a happy-dom-style options object (native
      // handles carry a real constructor class, so a wrong native handle —
      // e.g. a DocumentHandle — never matches here and keeps throwing below).
      options = nativeHandle;
      nativeHandle = loadNative().createWindow();
    }
    if (!isWindowHandle(nativeHandle)) {
      throw new TypeError(
        "Window can only be constructed from a genuine native Window handle (as returned by createWindow)",
      );
    }
    WIN_HANDLES.set(this, nativeHandle);
    WINDOW_OPTIONS.set(this, options ?? {});
    WINDOW_VIEWPORTS.set(this, computeViewport(options));
    WINDOW_SETTINGS.set(this, computeWindowSettings(options));
    // happy-dom constructor options: honor `url` by simulating the initial
    // navigation (the T45 simulated location), so `new Window({ url })`
    // matches `new Window()` plus a synchronous navigation to that URL.
    if (options !== null && typeof options.url === "string") {
      this.location.href = options.url;
    }
  }
}

// `document` is a live accessor: each read forwards to the native handle and
// the result goes through the unique conversion entry, so repeated reads hand
// back one and the same Document facade (native identity + facade cache).
defineAccessor(Window.prototype, "document", function getDocument() {
  const documentFacade = wrap(WIN_HANDLES.get(this).document());
  DOC_TO_WINDOW.set(documentFacade, new WeakRef(this));
  return documentFacade;
}, undefined);

// Window viewport surface (happy-dom parity): the four viewport dimensions and
// the device scale factor read the per-window viewport state set from the
// constructor options (T22B viewport). `outerWidth` / `outerHeight` mirror the
// happy-dom window surface where the outer size equals the viewport size.
function windowViewport(windowFacade) {
  const viewport = WINDOW_VIEWPORTS.get(windowFacade);
  return viewport ?? { width: 1024, height: 768, devicePixelRatio: 1 };
}

// Updates the per-window viewport state in place (happy-dom
// `BrowserPage.setViewport` parity: `Object.assign(this.viewport, viewport)`).
// The viewport dimensions, the device pixel ratio and every media-query
// evaluation read through `windowViewport`, so a single in-place mutation keeps
// the whole window surface consistent. Exposed through the facade `ctx` for
// the `window.happyDOM` detached-window API (window-platform.js); the public
// `window.js` export shape is pinned by the T22B export test.
function setWindowViewport(windowFacade, viewport) {
  let current = WINDOW_VIEWPORTS.get(windowFacade);
  if (current === undefined) {
    current = { width: 1024, height: 768, devicePixelRatio: 1 };
    WINDOW_VIEWPORTS.set(windowFacade, current);
  }
  Object.assign(current, viewport);
}

defineAccessor(Window.prototype, "innerWidth", function innerWidth() {
  return windowViewport(this).width;
}, undefined);

defineAccessor(Window.prototype, "innerHeight", function innerHeight() {
  return windowViewport(this).height;
}, undefined);

defineAccessor(Window.prototype, "outerWidth", function outerWidth() {
  return windowViewport(this).width;
}, undefined);

defineAccessor(Window.prototype, "outerHeight", function outerHeight() {
  return windowViewport(this).height;
}, undefined);

defineAccessor(Window.prototype, "devicePixelRatio", function devicePixelRatio() {
  return windowViewport(this).devicePixelRatio;
}, undefined);

defineMethod(Window.prototype, "destroy", function destroy() {
  WIN_HANDLES.get(this).destroy();
});

// --- Facade entry ----------------------------------------------------------

/**
 * Compatibility alias for `new Window()`.
 *
 * The native binding mints the window + document pair and hands back an opaque
 * `WindowHandle`; the historical MAD DOM entry routed it through `ctx.wrap`,
 * the single native handle → facade wrapper conversion entry. Since T48
 * `new Window()` / `new Window(options)` construct the same way through the
 * constructor's mint path, and since T48E the **package entry** (js/entry.js,
 * index.d.ts) no longer exports `createWindow` — happy-dom does not expose it
 * either, so the entry shapes match. This function is kept here as an internal
 * compatibility alias only, for the facade layer and its tests.
 */
export function createWindow() {
  return wrap(loadNative().createWindow());
}

// --- Facade initialization -------------------------------------------------

registerHandleType("WindowHandle", (handle) => new Window(handle));
registerHandleType("DocumentHandle", (handle) => new Document(handle));

// Wire every capability extension exactly once at facade initialization. The
// registry imports the extension files itself, so a later subtask only needs
// to add an `install` export to its own file — never to this module.
installExtensions(ctx);
