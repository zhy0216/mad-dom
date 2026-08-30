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

import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Document } from "./document.js";
import { installExtensions } from "./extensions/index.js";

export const seam = Object.freeze({
  id: "facade/window",
  owner: "T22B",
  gate: "T22",
  status: "implemented",
});

// --- Native binding loader (dev form, T19 / ADR-0005 §3) -----------------
//
// Mirrors index.js so the facade does not depend on the root entry's internal
// wiring (which only the T22 gate may touch). Resolution order:
//   1. `MAD_DOM_NATIVE_PATH` — explicit override (absolute, or relative to
//      the current working directory);
//   2. the repository-local dev artifact `build/mad-dom.node` (produced by
//      `npm run dev:build`; git-ignored). Loading is lazy: `createWindow()`
//      fails fast with `MAD_DOM_NATIVE_NOT_FOUND` when no artifact exists.
let native = null;
let nativeLoadError = null;

function resolveNativePath() {
  const explicit = process.env.MAD_DOM_NATIVE_PATH;
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
  return fileURLToPath(new URL("../../build/mad-dom.node", import.meta.url));
}

function loadNative() {
  if (native !== null) return native;
  if (nativeLoadError !== null) throw nativeLoadError;
  const path = resolveNativePath();
  const require = createRequire(import.meta.url);
  try {
    native = require(path);
    return native;
  } catch (error) {
    nativeLoadError = new Error(
      `mad-dom native binding could not be loaded from ${path}. ` +
        "Build it with `npm run dev:build` in a source checkout, or point " +
        "MAD_DOM_NATIVE_PATH at a built artifact. " +
        `Original error: ${error?.message ?? error}`,
      { cause: error },
    );
    nativeLoadError.code = "MAD_DOM_NATIVE_NOT_FOUND";
    throw nativeLoadError;
  }
}

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

function wrap(nativeHandle) {
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
  return wrapper;
}

// Registers a wrapper that was constructed outside `wrap` (the T48A
// `new DefinedClass()` mint path) in the same two caches, so a later `wrap`
// of the same native handle hands back that exact object.
function registerWrap(nativeHandle, wrapper) {
  if (nativeHandle === null || nativeHandle === undefined) return;
  WRAP_CACHE.set(nativeHandle, wrapper);
  WRAPPER_TO_HANDLE.set(wrapper, nativeHandle);
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
  return wrap(WIN_HANDLES.get(this).document());
}, undefined);

defineMethod(Window.prototype, "destroy", function destroy() {
  WIN_HANDLES.get(this).destroy();
});

// --- Facade entry ----------------------------------------------------------

/**
 * Creates a `Window` facade strongly owning a fresh native `Document`.
 *
 * The native binding mints the window + document pair and hands back an opaque
 * `WindowHandle`; `createWindow` routes it through `ctx.wrap`, the single
 * native handle → facade wrapper conversion entry. This is the historical MAD
 * DOM entry; since T48 `new Window()` / `new Window(options)` construct the
 * same way through the constructor's mint path.
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
