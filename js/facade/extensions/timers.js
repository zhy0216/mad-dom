import { createContext, runInContext } from "node:vm";

import { Window } from "../window.js";

// `Window` timer / task-scheduling / script-evaluation facade extension (T47).
//
// Installs the happy-dom public contract for the window async surface —
// `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval`,
// `requestAnimationFrame` / `cancelAnimationFrame`, `queueMicrotask`, `eval`
// and the window `error` event propagation — calibrated against the locked
// happy-dom 20.11.11 observable behavior.
//
// # Timers are scheduled by Bun, never by a second event loop
//
// Per the T47 boundary ("不创建独立浏览器事件循环"), every timer is delegated
// verbatim to the host primitives (`globalThis.setTimeout` /
// `setInterval` / `setImmediate`), so timer ordering, cancellation and the
// microtask/macrotask boundary are exactly Bun's. happy-dom's `setImmediate` /
// `clearImmediate` are **not** public window members (the baseline reads them
// as `undefined`); only its `requestAnimationFrame` is backed by Node's
// `setImmediate`, and this module mirrors that — `requestAnimationFrame` is
// implemented on `setImmediate` and `cancelAnimationFrame` on `clearImmediate`.
//
// # Callback wrapping (baseline error propagation)
//
// happy-dom wraps every scheduled callback so a throwing callback never
// becomes an uncaught host error: it is caught and re-dispatched as an `error`
// event on the window (and `setInterval` additionally clears itself — baseline
// parity). This module does the same through the small facade-level window
// `EventTarget` below (`addEventListener` / `removeEventListener` /
// `dispatchEvent`), plus the baseline `ErrorEvent` class. The wrapped callback
// also contains a returned rejected Promise, exactly like the baseline.
//
// # Script evaluation with document/window global binding
//
// `window.eval(code)` runs `code` through `node:vm` with the **owning window
// facade as its global object** — `document`, `window`, `HTMLElement`,
// `setTimeout`, `URL` and every other window member resolve as globals, `var`
// declarations and undeclared writes land on the window (never on the process
// globals), an undeclared read throws `ReferenceError`, and script errors
// propagate synchronously to the caller — the happy-dom VM-context observable
// behavior. `node:vm` is plain script evaluation, not a second event loop
// (T47 boundary).
//
// # Per-window lifecycle: no orphaned timers / native resources
//
// Per-window async state is keyed by the native document handle (a WeakMap, the
// T37/T41/T45 per-document-state pattern), so it is collected with the window
// and never pins it. Timer callbacks hold only a `WeakRef` to the window facade
// (a released window is never kept alive by a pending timer), and a
// `FinalizationRegistry` clears every still-pending timer of a collected
// window, so releasing a Window leaves neither a pending callback firing into
// the void nor a native document alive. A timer that fires after its window
// was released simply cleans itself up without invoking the user callback.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes beyond the
// import and array entry.

export const seam = Object.freeze({
  id: "facade/extensions/timers",
  owner: "T47",
  gate: "T47",
  status: "implemented",
});

// The `ctx` handed to `install`; captured so the timer callbacks and the
// per-window state accessors can resolve the native document handle.
let ctx = null;

// --- per-window async state --------------------------------------------------

// Native DocumentHandle → per-window async state. Weak: a collected / destroyed
// window stops holding its timers, listeners and eval binding, and two windows
// never share an entry (each native document is minted once per window). The
// native handle is opaque; only the facade uses it as a key.
const WINDOW_ASYNC = new WeakMap();

// Native DocumentHandle → the window's `eval` entry: the evaluator, the
// `node:vm` context it runs in, and that context's own `Error` intrinsic
// (errors thrown by window scripts are instances of the *context* `Error`,
// never the host `Error` — the Browser error observer identifies the owning
// window through exactly that check). Kept separate from the async state so a
// pending timer closure never drags the eval global-scope binding (which
// references the window facade) with it.
const WINDOW_EVAL = new WeakMap();

/**
 * The per-window `node:vm` context `Error` intrinsic (T47 export, used by the
 * Browser facade's process-level error observer). Returns `undefined` for a
 * window that never evaluated a script.
 */
export function evalContextOf(windowFacade) {
  const docHandle = ctx.documentContext.handleOf(windowFacade.document);
  return WINDOW_EVAL.get(docHandle);
}

function ensureAsyncState(windowFacade) {
  const docHandle = ctx.documentContext.handleOf(windowFacade.document);
  let state = WINDOW_ASYNC.get(docHandle);
  if (state === undefined) {
    state = {
      timeouts: new Set(),
      intervals: new Set(),
      rafs: new Set(),
      listeners: new Map(),
      finalized: false,
    };
    WINDOW_ASYNC.set(docHandle, state);
    if (!state.finalized) {
      state.finalized = true;
      // When the window facade is collected, clear every still-pending timer
      // so no callback fires into the void. The held value is the async state
      // — a container of timer ids and listeners that never references the
      // native document — so the registration cannot keep the window or its
      // document alive; the unregister token is the native document handle.
      windowCleanup.register(windowFacade, state, docHandle);
    }
  }
  return state;
}

// Clears every pending timer of a collected window.
const windowCleanup = new FinalizationRegistry((state) => {
  for (const id of state.timeouts) globalThis.clearTimeout(id);
  for (const id of state.intervals) globalThis.clearInterval(id);
  for (const id of state.rafs) globalThis.clearImmediate(id);
  state.timeouts.clear();
  state.intervals.clear();
  state.rafs.clear();
});

// --- error propagation -------------------------------------------------------

/**
 * WHATWG `ErrorEvent` facade (T47): the `error` event happy-dom dispatches on
 * the window when an async callback throws. A small standalone class carrying
 * the baseline init payload (`message`, `error`, `filename`, `lineno`); the
 * dispatch stamps `target` / `currentTarget` with the window.
 */
export class ErrorEvent {
  constructor(type, eventInit = null) {
    const init = eventInit == null ? {} : eventInit;
    this.type = String(type);
    this.message = init.message ?? "";
    this.error = init.error ?? null;
    this.filename = init.filename ?? "";
    this.lineno = init.lineno ?? 0;
    this.target = null;
    this.currentTarget = null;
    this.bubbles = false;
    this.cancelable = false;
    this.composed = false;
    this.defaultPrevented = false;
    this.eventPhase = 0;
  }
}

/**
 * Dispatches an `error` event on `windowFacade` for `error` (happy-dom
 * `[PropertySymbol.dispatchError]` parity). With no `error` listener the
 * dispatch is a silent no-op, so a throwing async callback is contained and
 * never becomes an uncaught host error — exactly like the baseline.
 */
export function dispatchWindowError(windowFacade, error) {
  const docHandle = ctx.documentContext.handleOf(windowFacade.document);
  const state = WINDOW_ASYNC.get(docHandle);
  if (state === undefined) return;
  const entries = state.listeners.get("error");
  if (entries === undefined || entries.length === 0) return;
  const event = new ErrorEvent("error", {
    message: typeof error?.message === "string" ? error.message : String(error),
    error,
  });
  event.target = windowFacade;
  event.currentTarget = windowFacade;
  for (const entry of [...entries]) {
    if (entry.once) {
      const index = entries.indexOf(entry);
      if (index !== -1) entries.splice(index, 1);
    }
    entry.listener.call(windowFacade, event);
  }
}

// Invokes a user callback inside the try/catch + promise-rejection containment
// the baseline applies to every scheduled callback.
function invokeWrapped(windowFacade, callback, args) {
  let result;
  try {
    result = callback(...args);
  } catch (error) {
    dispatchWindowError(windowFacade, error);
    return;
  }
  if (result instanceof Promise) {
    result.catch((error) => dispatchWindowError(windowFacade, error));
  }
}

// --- timers ------------------------------------------------------------------

function scheduleTimeout(windowFacade, callback, delay, args) {
  const state = ensureAsyncState(windowFacade);
  const windowRef = new WeakRef(windowFacade);
  const id = globalThis.setTimeout(() => {
    state.timeouts.delete(id);
    const current = windowRef.deref();
    if (current === undefined) return;
    invokeWrapped(current, callback, args);
  }, delay);
  state.timeouts.add(id);
  return id;
}

function scheduleInterval(windowFacade, callback, delay, args) {
  const state = ensureAsyncState(windowFacade);
  const windowRef = new WeakRef(windowFacade);
  let id;
  id = globalThis.setInterval(() => {
    const current = windowRef.deref();
    if (current === undefined) {
      globalThis.clearInterval(id);
      state.intervals.delete(id);
      return;
    }
    let result;
    try {
      result = callback(...args);
    } catch (error) {
      globalThis.clearInterval(id);
      state.intervals.delete(id);
      dispatchWindowError(current, error);
      return;
    }
    if (result instanceof Promise) {
      result.catch((error) => {
        globalThis.clearInterval(id);
        state.intervals.delete(id);
        dispatchWindowError(current, error);
      });
    }
  }, delay);
  state.intervals.add(id);
  return id;
}

function scheduleAnimationFrame(windowFacade, callback) {
  const state = ensureAsyncState(windowFacade);
  const windowRef = new WeakRef(windowFacade);
  let id;
  id = globalThis.setImmediate(() => {
    state.rafs.delete(id);
    const current = windowRef.deref();
    if (current === undefined) return;
    invokeWrapped(current, callback, [globalThis.performance.now()]);
  });
  state.rafs.add(id);
  return id;
}

// --- eval --------------------------------------------------------------------

/**
 * The `window.eval` evaluator (T47).
 *
 * Runs `code` with the **owning window facade as its global object** through
 * `node:vm` — the same mechanism happy-dom uses for its VM contexts, so the
 * deterministic surface matches the baseline exactly: `document`, `window`,
 * `HTMLElement`, `setTimeout`, `URL` and every other window member resolve as
 * globals, `var` declarations and undeclared writes land on the window (never
 * on the process globals), an undeclared read throws `ReferenceError`, and
 * errors propagate synchronously to the caller. `node:vm` creates no separate
 * event loop — it is plain script evaluation, within the T47 boundary.
 */
// The window self-reference names happy-dom resolves to the window global
// object itself (so `this === window` / `this === globalThis` hold in scripts).
const WINDOW_SELF_NAMES = ["window", "self", "globalThis", "top", "parent"];

// Collects every member of the window surface: own + inherited enumerable
// string properties of the facade (Window.prototype chain + the instance).
function windowSurfaceDescriptors(windowFacade) {
  const descriptors = new Map();
  let target = windowFacade;
  const seen = new Set();
  while (target !== null && target !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(target)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (descriptor !== undefined) descriptors.set(name, descriptor);
    }
    target = Object.getPrototypeOf(target);
  }
  return descriptors;
}

// A window surface member as a context-global descriptor that always evaluates
// against the real window facade (`this`-insensitive): functions are bound, so
// a bare global call (`addEventListener(…)`) still runs with the facade as
// `this`; accessors are re-wrapped to invoke the original getter/setter with
// the facade, so identity-keyed lookups (WIN_HANDLES / DOC_TO_WINDOW) resolve.
function contextGlobalDescriptor(windowFacade, name, descriptor) {
  if ("value" in descriptor) {
    const value =
      typeof descriptor.value === "function" ? descriptor.value.bind(windowFacade) : descriptor.value;
    return { value, writable: true, enumerable: true, configurable: true };
  }
  return {
    get: descriptor.get === undefined ? undefined : () => descriptor.get.call(windowFacade),
    set: descriptor.set === undefined ? undefined : (value) => descriptor.set.call(windowFacade, value),
    enumerable: true,
    configurable: true,
  };
}

function createWindowEval(windowFacade) {
  // Build an explicit global object for the script context instead of handing
  // the facade directly to `vm.createContext`: Bun's VM gives *undefined* as
  // `this` for a bare global call (`addEventListener(…)`), while `this`
  // itself *is* the contextified sandbox object. Binding the window surface
  // to the facade keeps every method `this`-insensitive; the self-references
  // point at the sandbox so `this === window` / `this === globalThis` hold.
  const globalObject = {};
  const context = createContext(globalObject);
  for (const name of WINDOW_SELF_NAMES) {
    Object.defineProperty(globalObject, name, {
      value: globalObject,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  for (const [name, descriptor] of windowSurfaceDescriptors(windowFacade)) {
    if (WINDOW_SELF_NAMES.includes(name)) continue;
    Object.defineProperty(globalObject, name, contextGlobalDescriptor(windowFacade, name, descriptor));
  }
  return {
    evaluate: (code) => runInContext(String(code), context),
    context,
  };
}

// --- install -----------------------------------------------------------------

/**
 * Installs the T47 window async surface.
 *
 * `ctx.defineMethod` / `ctx.defineAccessor` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(extensionCtx) {
  // Capture the facade-provided `ctx` once, on the real facade install. The
  // structural test re-drives `installExtensions` with a plain mock ctx
  // (facade-window-document.test.js); property definitions during that pass go
  // to the mock (recorded), but the module-level `ctx` the runtime paths rely
  // on stays the real facade context, so a later real window keeps resolving
  // its native document handle.
  if (ctx === null) ctx = extensionCtx;
  const installCtx = extensionCtx;

  // Timers (baseline public surface; happy-dom exposes no `setImmediate` /
  // `clearImmediate` on the window — only `requestAnimationFrame` is
  // immediate-backed).
  installCtx.defineMethod(Window.prototype, "setTimeout", function setTimeout(callback, delay = 0, ...args) {
    return scheduleTimeout(this, callback, delay, args);
  });

  installCtx.defineMethod(Window.prototype, "clearTimeout", function clearTimeout(id) {
    const docHandle = ctx.documentContext.handleOf(this.document);
    const state = WINDOW_ASYNC.get(docHandle);
    state?.timeouts.delete(id);
    globalThis.clearTimeout(id);
  });

  installCtx.defineMethod(Window.prototype, "setInterval", function setInterval(callback, delay = 0, ...args) {
    return scheduleInterval(this, callback, delay, args);
  });

  installCtx.defineMethod(Window.prototype, "clearInterval", function clearInterval(id) {
    const docHandle = ctx.documentContext.handleOf(this.document);
    const state = WINDOW_ASYNC.get(docHandle);
    state?.intervals.delete(id);
    globalThis.clearInterval(id);
  });

  installCtx.defineMethod(Window.prototype, "requestAnimationFrame", function requestAnimationFrame(callback) {
    return scheduleAnimationFrame(this, callback);
  });

  installCtx.defineMethod(Window.prototype, "cancelAnimationFrame", function cancelAnimationFrame(id) {
    const docHandle = ctx.documentContext.handleOf(this.document);
    const state = WINDOW_ASYNC.get(docHandle);
    state?.rafs.delete(id);
    globalThis.clearImmediate(id);
  });

  installCtx.defineMethod(Window.prototype, "queueMicrotask", function queueMicrotask(callback) {
    const windowRef = new WeakRef(this);
    globalThis.queueMicrotask(() => {
      const current = windowRef.deref();
      if (current === undefined) return;
      invokeWrapped(current, callback, []);
    });
  });

  // Script evaluation with the owning window's surface as globals.
  const evalMethod = { ["eval"](code) {
    const docHandle = ctx.documentContext.handleOf(this.document);
    let entry = WINDOW_EVAL.get(docHandle);
    if (entry === undefined) {
      const built = createWindowEval(this);
      entry = { evaluate: built.evaluate, context: built.context, contextError: runInContext("Error", built.context) };
      WINDOW_EVAL.set(docHandle, entry);
    }
    return entry.evaluate(code);
  } }.eval;
  installCtx.defineMethod(Window.prototype, "eval", evalMethod);

  // The window-level EventTarget (facade, per-window) and the `ErrorEvent`
  // constructor — the happy-dom `error`-event propagation surface for async
  // callback failures.
  installCtx.defineMethod(Window.prototype, "addEventListener", function addEventListener(type, listener, options) {
    if (listener == null) return;
    if (typeof listener !== "function" && typeof listener.handleEvent !== "function") {
      throw new TypeError(
        "Failed to execute 'addEventListener' on 'EventTarget': parameter 2 is not of type 'EventListener'.",
      );
    }
    const state = ensureAsyncState(this);
    const eventType = String(type);
    let entries = state.listeners.get(eventType);
    if (entries === undefined) {
      entries = [];
      state.listeners.set(eventType, entries);
    }
    if (!entries.some((entry) => entry.listener === listener)) {
      entries.push({ listener, once: Boolean(options?.once) });
    }
  });

  installCtx.defineMethod(Window.prototype, "removeEventListener", function removeEventListener(type, listener) {
    if (listener == null) return;
    const docHandle = ctx.documentContext.handleOf(this.document);
    const state = WINDOW_ASYNC.get(docHandle);
    if (state === undefined) return;
    const entries = state.listeners.get(String(type));
    if (entries === undefined) return;
    const index = entries.findIndex((entry) => entry.listener === listener);
    if (index !== -1) entries.splice(index, 1);
  });

  installCtx.defineMethod(Window.prototype, "dispatchEvent", function dispatchEvent(event) {
    if (event == null || typeof event.type !== "string") {
      throw new TypeError(
        "Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.",
      );
    }
    const docHandle = ctx.documentContext.handleOf(this.document);
    const state = WINDOW_ASYNC.get(docHandle);
    if (state === undefined) return true;
    const entries = state.listeners.get(event.type);
    if (entries === undefined || entries.length === 0) return true;
    event.target = this;
    event.currentTarget = this;
    for (const entry of [...entries]) {
      if (entry.once) {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
      }
      entry.listener.call(this, event);
    }
    return true;
  });

  installCtx.defineAccessor(Window.prototype, "ErrorEvent", function getErrorEvent() {
    return ErrorEvent;
  }, undefined);

  // Window self-references (happy-dom parity: `window.window === window`,
  // and the same for `self` / `globalThis` / `top` / `parent`). They also give
  // `eval` the baseline `globalThis === window` / `this === window` identity.
  for (const selfName of ["window", "self", "globalThis", "top", "parent"]) {
    installCtx.defineAccessor(Window.prototype, selfName, function getSelf() {
      return this;
    }, undefined);
  }
}
