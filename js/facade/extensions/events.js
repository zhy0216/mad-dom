// `EventTarget` / `Event` facade extension (T37).
//
// Installs the WHATWG event surface on `Node.prototype` and
// `Document.prototype` — `addEventListener` / `removeEventListener` /
// `dispatchEvent` — plus a minimal `Event` class (the base needed to
// construct and dispatch events; concrete subclasses, constants and
// `composedPath`/`timeStamp`/`initEvent` land with T38) and the `window.Event`
// constructor accessor. Every behavior delegates verbatim to the native T37
// contract (crates/mad-dom-bun/src/extensions/events_api.rs) and through it to
// the Core propagation engine (`mad_dom_core::dom::events`). Like the rest of
// the facade, this module keeps **no second DOM state**: Core owns the listener
// registrations and the dispatch plan, this module only shapes arguments,
// wraps the user listener into the stable wrapper the native identity
// comparisons rely on, and routes `preventDefault` / `stopPropagation` /
// `stopImmediatePropagation` to the native event state.
//
// # Listener wrapper (`WRAPPED`)
//
// The native binding compares *callback identity* for deduplication and
// removal, so the facade registers a stable wrapper per user listener and the
// native strict-equality always sees the same function. The wrapper also does
// the two things only JS can do:
//
//   - **`this` binding** — the native invokes the wrapper with `this` = the
//     native current-target handle; the wrapper converts it (and the native
//     event handle argument) through the unique `ctx.wrap` entry so listeners
//     observe facade objects;
//   - **exception containment** — a throwing listener must not break the
//     dispatch (happy-dom parity: dispatch continues and the error never
//     reaches the `dispatchEvent` caller), so the wrapper swallows it.
//
// # Options
//
// `capture`, `once` and `passive` are forwarded verbatim to Core. `signal`
// follows the baseline: the listener is registered and, when the signal is not
// already aborted and exposes `addEventListener`, an `abort` handler removes it
// (matching happy-dom, which registers regardless of the `aborted` flag and
// only hooks a live signal).
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)` and registering its `EventHandle` wrapper type;
// nothing in the registry changes beyond the import and array entry.

import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Document } from "../document.js";
import { Node } from "./node.js";
import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/events",
  owner: "T37",
  gate: "T37",
  status: "implemented",
});

// Native EventHandle behind each Event facade. Weak so a facade never pins an
// event; the native handle keeps its state alive.
const EVENT_HANDLES = new WeakMap();

// Reverse map: native EventHandle → the facade Event that owns it. The user
// constructs `new Event(type, init)` directly (it mints a native handle), so
// the facade wrapper never went through the `ctx.wrap` cache; this map lets the
// listener wrapper resolve the native event argument back to *the very object
// the caller dispatched*, preserving identity across the dispatch.
const EVENT_OWNERS = new WeakMap();

// The stable wrapper function registered with the native binding per user
// listener (WeakMap so a collected user listener stops being reachable).
const WRAPPED = new WeakMap();

// --- Native loader (mirrors js/facade/window.js; the Event constructor mints
// native event handles through the module-level `createEvent` factory) --------

let native = null;
let nativeLoadError = null;

function resolveNativePath() {
  const explicit = process.env.MAD_DOM_NATIVE_PATH;
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
  return fileURLToPath(new URL("../../../build/mad-dom.node", import.meta.url));
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

// --- handle guards -----------------------------------------------------------

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function isDocumentHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.destroy === "function" &&
    typeof handle.appendChild === "function"
  );
}

function isEventHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.preventDefault === "function" &&
    typeof handle.stopPropagation === "function" &&
    typeof handle.eventType === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

function facadeDocumentHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isDocumentHandle(handle)) {
    throw new TypeError(`Document.${role} requires a genuine Document facade wrapper`);
  }
  return handle;
}

/**
 * Minimal `Event` facade (T37).
 *
 * Construction mints a native event handle with the WebIDL init values; the
 * facade registry's `EventHandle` wrapper factory wraps an existing native
 * handle instead. Every property and method delegates to the native event
 * state, so the object handed to a listener is the same object the caller
 * dispatched (identity through the `ctx.wrap` cache).
 */
export class Event {
  constructor(type, eventInit = null) {
    let handle;
    if (isEventHandle(type)) {
      handle = type;
    } else {
      const init = eventInit == null ? {} : eventInit;
      handle = loadNative().createEvent(
        String(type),
        Boolean(init.bubbles),
        Boolean(init.cancelable),
        Boolean(init.composed),
      );
    }
    EVENT_HANDLES.set(this, handle);
    EVENT_OWNERS.set(handle, this);
  }
}

/**
 * Resolves a native event handle to the facade `Event` the caller dispatched
 * (falling back to the `ctx.wrap` cache for handles minted outside this
 * module), preserving identity across the dispatch.
 */
function wrapEvent(ctx, nativeEvent) {
  const owner = EVENT_OWNERS.get(nativeEvent);
  return owner === undefined ? ctx.wrap(nativeEvent) : owner;
}

/**
 * Returns the stable wrapper for `listener`, or `null` for a nullish listener.
 *
 * The wrapper converts the native handles the binding passes (`this` = the
 * current target, argument 0 = the event) through `ctx.wrap` and contains any
 * listener exception so dispatch continues (happy-dom parity).
 */
function wrapListener(ctx, listener) {
  if (listener == null) return null;
  const cached = WRAPPED.get(listener);
  if (cached !== undefined) return cached;
  let wrapped;
  if (typeof listener === "function") {
    wrapped = function wrappedListener(nativeEvent) {
      try {
        return listener.call(ctx.wrap(this), wrapEvent(ctx, nativeEvent));
      } catch {
        // A throwing listener must not break the dispatch.
      }
    };
  } else if (typeof listener.handleEvent === "function") {
    const handleEvent = listener.handleEvent;
    const self = listener;
    wrapped = function wrappedListener(nativeEvent) {
      try {
        return handleEvent.call(self, wrapEvent(ctx, nativeEvent));
      } catch {
        // A throwing listener must not break the dispatch.
      }
    };
  } else {
    throw new TypeError(
      "Failed to execute 'addEventListener' on 'EventTarget': " +
        "parameter 2 is not of type 'EventListener'.",
    );
  }
  WRAPPED.set(listener, wrapped);
  return wrapped;
}

/**
 * Installs the T37 event surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  ctx.registerHandleType("EventHandle", (handle) => new Event(handle));

  // Node surface (all nodes are event targets).
  ctx.defineMethod(Node.prototype, "addEventListener", function addEventListener(type, listener, options) {
    const handle = facadeNodeHandle(ctx, this, "addEventListener");
    const opts = typeof options === "boolean" ? { capture: options } : options ?? {};
    const wrapped = wrapListener(ctx, listener);
    if (wrapped === null) return;
    const eventType = String(type);
    const capture = Boolean(opts.capture);
    if (opts.signal && !opts.signal.aborted && typeof opts.signal.addEventListener === "function") {
      opts.signal.addEventListener("abort", () => {
        handle.removeEventListener(eventType, wrapped, capture);
      });
    }
    handle.addEventListener(eventType, wrapped, capture, Boolean(opts.once), Boolean(opts.passive));
  });

  ctx.defineMethod(Node.prototype, "removeEventListener", function removeEventListener(type, listener, options) {
    const handle = facadeNodeHandle(ctx, this, "removeEventListener");
    const wrapped = WRAPPED.get(listener);
    if (wrapped === undefined) return;
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    handle.removeEventListener(String(type), wrapped, capture);
  });

  ctx.defineMethod(Node.prototype, "dispatchEvent", function dispatchEvent(event) {
    const handle = facadeNodeHandle(ctx, this, "dispatchEvent");
    if (!(event instanceof Event)) {
      throw new TypeError(
        "Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.",
      );
    }
    return handle.dispatchEvent(EVENT_HANDLES.get(event));
  });

  // Document surface (forwards to the document-root node).
  ctx.defineMethod(Document.prototype, "addEventListener", function addEventListener(type, listener, options) {
    const handle = facadeDocumentHandle(ctx, this, "addEventListener");
    const opts = typeof options === "boolean" ? { capture: options } : options ?? {};
    const wrapped = wrapListener(ctx, listener);
    if (wrapped === null) return;
    const eventType = String(type);
    const capture = Boolean(opts.capture);
    if (opts.signal && !opts.signal.aborted && typeof opts.signal.addEventListener === "function") {
      opts.signal.addEventListener("abort", () => {
        handle.removeEventListener(eventType, wrapped, capture);
      });
    }
    handle.addEventListener(eventType, wrapped, capture, Boolean(opts.once), Boolean(opts.passive));
  });

  ctx.defineMethod(Document.prototype, "removeEventListener", function removeEventListener(type, listener, options) {
    const handle = facadeDocumentHandle(ctx, this, "removeEventListener");
    const wrapped = WRAPPED.get(listener);
    if (wrapped === undefined) return;
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    handle.removeEventListener(String(type), wrapped, capture);
  });

  ctx.defineMethod(Document.prototype, "dispatchEvent", function dispatchEvent(event) {
    const handle = facadeDocumentHandle(ctx, this, "dispatchEvent");
    if (!(event instanceof Event)) {
      throw new TypeError(
        "Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.",
      );
    }
    return handle.dispatchEvent(EVENT_HANDLES.get(event));
  });

  // `window.Event` — the WHATWG constructor accessor on every window.
  ctx.defineAccessor(Window.prototype, "Event", function getEvent() {
    return Event;
  }, undefined);

  // Event surface.
  ctx.defineAccessor(Event.prototype, "type", function type() {
    return EVENT_HANDLES.get(this).eventType();
  }, undefined);

  ctx.defineAccessor(Event.prototype, "bubbles", function bubbles() {
    return EVENT_HANDLES.get(this).bubbles();
  }, undefined);

  ctx.defineAccessor(Event.prototype, "cancelable", function cancelable() {
    return EVENT_HANDLES.get(this).cancelable();
  }, undefined);

  ctx.defineAccessor(Event.prototype, "composed", function composed() {
    return EVENT_HANDLES.get(this).composed();
  }, undefined);

  ctx.defineAccessor(Event.prototype, "defaultPrevented", function defaultPrevented() {
    return EVENT_HANDLES.get(this).defaultPrevented();
  }, undefined);

  ctx.defineAccessor(Event.prototype, "eventPhase", function eventPhase() {
    return EVENT_HANDLES.get(this).eventPhase();
  }, undefined);

  ctx.defineAccessor(Event.prototype, "target", function target() {
    return ctx.wrap(EVENT_HANDLES.get(this).target());
  }, undefined);

  ctx.defineAccessor(Event.prototype, "currentTarget", function currentTarget() {
    return ctx.wrap(EVENT_HANDLES.get(this).currentTarget());
  }, undefined);

  ctx.defineMethod(Event.prototype, "preventDefault", function preventDefault() {
    EVENT_HANDLES.get(this).preventDefault();
  });

  ctx.defineMethod(Event.prototype, "stopPropagation", function stopPropagation() {
    EVENT_HANDLES.get(this).stopPropagation();
  });

  ctx.defineMethod(Event.prototype, "stopImmediatePropagation", function stopImmediatePropagation() {
    EVENT_HANDLES.get(this).stopImmediatePropagation();
  });
}
