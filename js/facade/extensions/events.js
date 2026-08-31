// `EventTarget` / `Event` facade extension (T37, extended by T38).
//
// Installs the WHATWG event surface on `Node.prototype` and
// `Document.prototype` — `addEventListener` / `removeEventListener` /
// `dispatchEvent` — plus the full `Event` base class (constants, the
// `type`/`bubbles`/`cancelable`/`composed`/`defaultPrevented`/`eventPhase`/
// `target`/`currentTarget`/`timeStamp`/`cancelBubble` reads, `composedPath`,
// `initEvent` and the cancel methods), the first batch of concrete event
// classes (`CustomEvent`, `UIEvent`, `MouseEvent`, `KeyboardEvent`,
// `FocusEvent`, `WheelEvent`, `InputEvent`) and the module-level
// `EventPhaseEnum`. Every base-`Event` behavior delegates verbatim to the
// native contract (crates/mad-dom-bun/src/extensions/events_api.rs) and
// through it to the Core propagation engine (`mad_dom_core::dom::events`);
// the concrete classes store their immutable init payload exactly like the
// baseline (own data fields for `UIEvent` and its subclasses, a symbol-like
// slot for `CustomEvent.detail`) — none of that is DOM tree state, so the
// facade still keeps no second authoritative DOM. Like the rest of the
// facade, this module only shapes arguments, wraps the user listener into the
// stable wrapper the native identity comparisons rely on, and routes
// `preventDefault` / `stopPropagation` / `stopImmediatePropagation` /
// `initEvent` / `composedPath` to the native event state.
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
// # Event class payload (T38)
//
// The base `Event` state (type/bubbles/cancelable/composed/defaultPrevented/
// stop flags/dispatching/phase/target/currentTarget/timeStamp) lives in the
// native `EventHandle`. The concrete classes' init payload — `UIEvent.detail`/
// `view` and the `MouseEvent`/`KeyboardEvent`/`FocusEvent`/`WheelEvent`/
// `InputEvent` data fields — is immutable construction metadata, stored as own
// instance fields exactly like the baseline so instance descriptor probes
// match. `CustomEvent.detail` lives behind the prototype getter (a symbol-like
// slot) like the baseline, so its own-property probe matches too. The four
// phase constants are both static class fields and own instance fields
// (baseline instance shape: `Object.keys(event)` == the four constants).
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)` and registering its `EventHandle` wrapper type;
// nothing in the registry changes beyond the import and array entry.

import { Document } from "../document.js";
import { Node } from "./node.js";
import { Window } from "../window.js";
import { loadNative } from "../../native-loader.js";

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

// The `CustomEvent.detail` slot behind the prototype getter (T38). The
// baseline stores it in a symbol-keyed private slot; this WeakMap mirrors that
// layout so `getOwnPropertyDescriptor(event, "detail")` stays absent and the
// own-instance key set matches. Weak so a facade event never pins its payload.
const EVENT_PAYLOADS = new WeakMap();

// --- EventPhaseEnum -----------------------------------------------------------
//
// The `EventPhaseEnum` module export (T38), a TS-style numeric enum object with
// reverse mappings, exactly like the baseline runtime value. It is deliberately
// not frozen (the baseline leaves it extensible) and not a window member
// (happy-dom only exposes it as a module export).

export const EventPhaseEnum = {
  0: "none",
  1: "capturing",
  2: "atTarget",
  3: "bubbling",
  none: 0,
  capturing: 1,
  atTarget: 2,
  bubbling: 3,
};

// --- Native loader (the Event constructor mints native event handles through
// the module-level `createEvent` factory; the resolution chain is owned by
// js/native-loader.js, ADR-0005 §3/§6/§8/§9) -----------------------------

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
 * Full `Event` facade (T37 base, T38 completed).
 *
 * Construction mints a native event handle with the WebIDL init values; the
 * facade registry's `EventHandle` wrapper factory wraps an existing native
 * handle instead. Every base-`Event` property and method delegates to the
 * native event state, so the object handed to a listener is the same object
 * the caller dispatched (identity through the `ctx.wrap` cache). The four
 * phase constants are own instance data fields (baseline instance shape).
 */
export class Event {
  static NONE = 0;
  static CAPTURING_PHASE = 1;
  static AT_TARGET = 2;
  static BUBBLING_PHASE = 3;

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
    this.NONE = Event.NONE;
    this.CAPTURING_PHASE = Event.CAPTURING_PHASE;
    this.AT_TARGET = Event.AT_TARGET;
    this.BUBBLING_PHASE = Event.BUBBLING_PHASE;
  }
}

/**
 * `CustomEvent` facade (T38): adds `detail` (prototype getter over a symbol-
 * like slot) and `initCustomEvent`, matching the baseline instance shape.
 */
export class CustomEvent extends Event {
  constructor(type, eventInit = null) {
    super(type, eventInit);
    const init = eventInit == null ? {} : eventInit;
    EVENT_PAYLOADS.set(this, { detail: init.detail ?? null });
  }
}

/**
 * `UIEvent` facade (T38): the base for mouse/keyboard/focus/wheel/input
 * events. Its payload fields are own instance data fields like the baseline.
 */
export class UIEvent extends Event {
  static NONE = 0;
  static CAPTURING_PHASE = 1;
  static AT_TARGET = 2;
  static BUBBLING_PHASE = 3;

  constructor(type, eventInit = null) {
    super(type, eventInit);
    const init = eventInit == null ? {} : eventInit;
    this.detail = init.detail ?? 0;
    this.layerX = 0;
    this.layerY = 0;
    this.pageX = 0;
    this.pageY = 0;
    this.view = init.view ?? null;
  }
}

/**
 * `MouseEvent` facade (T38).
 */
export class MouseEvent extends UIEvent {
  constructor(type, eventInit = null) {
    super(type, eventInit);
    const init = eventInit == null ? {} : eventInit;
    this.altKey = init.altKey ?? false;
    this.button = init.button ?? 0;
    this.buttons = init.buttons ?? 0;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.ctrlKey = init.ctrlKey ?? false;
    this.metaKey = init.metaKey ?? false;
    this.movementX = init.movementX ?? 0;
    this.movementY = init.movementY ?? 0;
    this.offsetX = init.offsetX ?? 0;
    this.offsetY = init.offsetY ?? 0;
    this.region = init.region ?? "";
    this.relatedTarget = init.relatedTarget ?? null;
    this.screenX = init.screenX ?? 0;
    this.screenY = init.screenY ?? 0;
    this.shiftKey = init.shiftKey ?? false;
  }
}

/**
 * `KeyboardEvent` facade (T38): adds the `DOM_KEY_LOCATION_*` constants and
 * `getModifierState`.
 */
export class KeyboardEvent extends UIEvent {
  static DOM_KEY_LOCATION_STANDARD = 0;
  static DOM_KEY_LOCATION_LEFT = 1;
  static DOM_KEY_LOCATION_RIGHT = 2;
  static DOM_KEY_LOCATION_NUMPAD = 3;

  constructor(type, eventInit = null) {
    super(type, eventInit);
    const init = eventInit == null ? {} : eventInit;
    this.altKey = init.altKey ?? false;
    this.code = init.code ?? "";
    this.ctrlKey = init.ctrlKey ?? false;
    this.isComposing = init.isComposing ?? false;
    this.key = init.key ?? "";
    this.location = init.location ?? 0;
    this.metaKey = init.metaKey ?? false;
    this.repeat = init.repeat ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.keyCode = init.keyCode ?? 0;
    this.which = init.which ?? init.keyCode ?? 0;
  }
}

/**
 * `FocusEvent` facade (T38).
 */
export class FocusEvent extends UIEvent {
  constructor(type, eventInit = null) {
    super(type, eventInit);
    const init = eventInit == null ? {} : eventInit;
    this.relatedTarget = init.relatedTarget ?? null;
  }
}

/**
 * `WheelEvent` facade (T38): adds the `DOM_DELTA_*` constants.
 */
export class WheelEvent extends UIEvent {
  static DOM_DELTA_PIXEL = 0;
  static DOM_DELTA_LINE = 1;
  static DOM_DELTA_PAGE = 2;

  constructor(type, eventInit = null) {
    super(type, eventInit);
    const init = eventInit == null ? {} : eventInit;
    this.deltaX = init.deltaX ?? 0;
    this.deltaY = init.deltaY ?? 0;
    this.deltaZ = init.deltaZ ?? 0;
    this.deltaMode = init.deltaMode ?? 0;
  }
}

/**
 * `InputEvent` facade (T38).
 */
export class InputEvent extends UIEvent {
  constructor(type, eventInit = null) {
    super(type, eventInit);
    const init = eventInit == null ? {} : eventInit;
    this.data = init.data ?? "";
    this.dataTransfer = init.dataTransfer ?? null;
    this.inputType = init.inputType ?? "";
    this.isComposing = init.isComposing ?? false;
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

  // `window.Event` — the WHATWG constructor accessor on every window (T37),
  // plus the T38 concrete constructors the baseline window exposes.
  ctx.defineAccessor(Window.prototype, "Event", function getEvent() {
    return Event;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "CustomEvent", function getCustomEvent() {
    return CustomEvent;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "UIEvent", function getUIEvent() {
    return UIEvent;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "MouseEvent", function getMouseEvent() {
    return MouseEvent;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "KeyboardEvent", function getKeyboardEvent() {
    return KeyboardEvent;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "FocusEvent", function getFocusEvent() {
    return FocusEvent;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "WheelEvent", function getWheelEvent() {
    return WheelEvent;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "InputEvent", function getInputEvent() {
    return InputEvent;
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

  ctx.defineAccessor(Event.prototype, "timeStamp", function timeStamp() {
    return EVENT_HANDLES.get(this).timeStamp();
  }, undefined);

  ctx.defineAccessor(Event.prototype, "target", function target() {
    return ctx.wrap(EVENT_HANDLES.get(this).target());
  }, undefined);

  ctx.defineAccessor(Event.prototype, "currentTarget", function currentTarget() {
    return ctx.wrap(EVENT_HANDLES.get(this).currentTarget());
  }, undefined);

  ctx.defineAccessor(Event.prototype, "cancelBubble", function cancelBubble() {
    return EVENT_HANDLES.get(this).cancelBubble();
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

  ctx.defineMethod(Event.prototype, "initEvent", function initEvent(type, bubbles = false, cancelable = false) {
    EVENT_HANDLES.get(this).initEvent(String(type), Boolean(bubbles), Boolean(cancelable));
  });

  ctx.defineMethod(Event.prototype, "composedPath", function composedPath() {
    return (EVENT_HANDLES.get(this).composedPath() ?? []).map((handle) => ctx.wrap(handle));
  });

  // CustomEvent surface.
  ctx.defineAccessor(CustomEvent.prototype, "detail", function detail() {
    return EVENT_PAYLOADS.get(this)?.detail;
  }, undefined);

  ctx.defineMethod(CustomEvent.prototype, "initCustomEvent", function initCustomEvent(
    type,
    bubbles = false,
    cancelable = false,
    detail = null,
  ) {
    EVENT_HANDLES.get(this).setInitValues(String(type), Boolean(bubbles), Boolean(cancelable));
    EVENT_PAYLOADS.get(this).detail = detail;
  });

  // KeyboardEvent surface.
  ctx.defineMethod(KeyboardEvent.prototype, "getModifierState", function getModifierState(key) {
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'getModifierState' on 'KeyboardEvent': 1 argument required, but only 0 present.",
      );
    }
    switch (String(key).toLowerCase()) {
      case "alt":
      case "altgraph":
        return this.altKey;
      case "control":
        return this.ctrlKey;
      case "meta":
        return this.metaKey;
      case "shift":
        return this.shiftKey;
      default:
        return false;
    }
  });
}
