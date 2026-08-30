import { describe, expect, test } from "bun:test";
import {
  Window,
  CustomEvent,
  Event,
  EventPhaseEnum,
  FocusEvent,
  InputEvent,
  isNativeAvailable,
  KeyboardEvent,
  MouseEvent,
  UIEvent,
  WheelEvent,
} from "../../index.js";

// T38 event-class tests.
//
// They drive the completed `Event` surface and the first batch of concrete
// event classes (`CustomEvent`, `UIEvent`, `MouseEvent`, `KeyboardEvent`,
// `FocusEvent`, `WheelEvent`, `InputEvent`) through the official package entry
// and pin the acceptance criteria:
//
//   - exports / prototypes / descriptors / construction / defaults — the
//     classes are exported from the package entry and reachable through the
//     window, the prototype chains follow the baseline (`CustomEvent` →
//     `Event`, `MouseEvent` → `UIEvent` → `Event`), the phase constants are
//     static and own-instance data fields, the concrete-class payload fields
//     are own instance data fields with the baseline default values, and
//     `CustomEvent.detail` stays behind the prototype getter;
//   - stable behaviors — `timeStamp` is a positive number fixed at
//     construction, `composedPath` returns the propagation path of the target
//     (empty before dispatch, `[target]` for a detached node, the ancestor
//     chain up to the document root for a connected node), `initEvent` /
//     `initCustomEvent` re-initialize per the baseline, and `cancelBubble`
//     reflects `stopPropagation` as a read-only getter;
//   - dispatch integration — a `CustomEvent` / `MouseEvent` dispatches through
//     the T37 engine with the same object handed to every listener and its
//     payload readable inside listeners;
//   - reuse guard — an event that is already being dispatched cannot be
//     dispatched again, a completed event can be re-dispatched, and the
//     baseline allows `initEvent` during a dispatch;
//   - `KeyboardEvent.getModifierState` — the named modifier flags are honored,
//     unknown keys return false and a missing argument throws the baseline
//     TypeError.
//
// The structural block needs no native artifact; the runtime block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function build(window) {
  window.document.body.innerHTML = '<div id="mid"><span id="leaf">leaf</span></div>';
  return {
    doc: window.document,
    mid: window.document.getElementById("mid"),
    leaf: window.document.getElementById("leaf"),
  };
}

describe("T38 event-class module exports", () => {
  test("the event classes and EventPhaseEnum are exported from the package entry", () => {
    for (const name of [
      "Event",
      "CustomEvent",
      "UIEvent",
      "MouseEvent",
      "KeyboardEvent",
      "FocusEvent",
      "WheelEvent",
      "InputEvent",
    ]) {
      const Constructor = { Event, CustomEvent, UIEvent, MouseEvent, KeyboardEvent, FocusEvent, WheelEvent, InputEvent }[name];
      expect(typeof Constructor, name).toBe("function");
      expect(Constructor.length, `${name}.length`).toBe(1);
      expect(Constructor.name, name).toBe(name);
    }
    expect(EventPhaseEnum).toEqual({
      0: "none",
      1: "capturing",
      2: "atTarget",
      3: "bubbling",
      none: 0,
      capturing: 1,
      atTarget: 2,
      bubbling: 3,
    });
    expect(EventPhaseEnum.bubbling).toBe(3);
    expect(EventPhaseEnum[2]).toBe("atTarget");
  });

  test("the phase constants are static data fields with the baseline values", () => {
    expect(Event.NONE).toBe(0);
    expect(Event.CAPTURING_PHASE).toBe(1);
    expect(Event.AT_TARGET).toBe(2);
    expect(Event.BUBBLING_PHASE).toBe(3);
    // UIEvent redeclares them (baseline static layout); the leaf classes do not.
    expect(UIEvent.NONE).toBe(0);
    expect(Object.getOwnPropertyDescriptor(UIEvent, "NONE")?.value).toBe(0);
    expect(Object.getOwnPropertyDescriptor(MouseEvent, "NONE")).toBeUndefined();

    expect(KeyboardEvent.DOM_KEY_LOCATION_STANDARD).toBe(0);
    expect(KeyboardEvent.DOM_KEY_LOCATION_LEFT).toBe(1);
    expect(KeyboardEvent.DOM_KEY_LOCATION_RIGHT).toBe(2);
    expect(KeyboardEvent.DOM_KEY_LOCATION_NUMPAD).toBe(3);

    expect(WheelEvent.DOM_DELTA_PIXEL).toBe(0);
    expect(WheelEvent.DOM_DELTA_LINE).toBe(1);
    expect(WheelEvent.DOM_DELTA_PAGE).toBe(2);
  });

  test("the window exposes every event constructor accessor", () => {
    const win = new Window();
    try {
      expect(typeof win.Event).toBe("function");
      for (const name of ["CustomEvent", "UIEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "WheelEvent", "InputEvent"]) {
        expect(typeof win[name], `window.${name}`).toBe("function");
      }
    } finally {
      win.destroy();
    }
  });

  test("the prototype chains follow the baseline hierarchy", () => {
    expect(Object.getPrototypeOf(UIEvent.prototype)).toBe(Event.prototype);

    for (const Constructor of [MouseEvent, KeyboardEvent, FocusEvent, WheelEvent, InputEvent]) {
      expect(Object.getPrototypeOf(Constructor.prototype), `${Constructor.name} extends`).toBe(UIEvent.prototype);
      expect(Constructor.prototype instanceof Event).toBe(true);
    }
    expect(Object.getPrototypeOf(CustomEvent.prototype)).toBe(Event.prototype);
    expect(MouseEvent.prototype instanceof UIEvent).toBe(true);
  });
});

describe("T38 construction and defaults", () => {
  test("Event instances carry the phase constants and the base default reads", () => {
    const win = new Window();
    try {
      const event = new win.Event("evt", { bubbles: true, cancelable: true });
      expect(Object.keys(event)).toEqual(["NONE", "CAPTURING_PHASE", "AT_TARGET", "BUBBLING_PHASE"]);
      expect(event.NONE).toBe(0);
      expect(event.CAPTURING_PHASE).toBe(1);
      expect(event.AT_TARGET).toBe(2);
      expect(event.BUBBLING_PHASE).toBe(3);
      expect(event.type).toBe("evt");
      expect(event.bubbles).toBe(true);
      expect(event.cancelable).toBe(true);
      expect(event.composed).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(event.eventPhase).toBe(0);
      expect(event.target).toBeNull();
      expect(event.currentTarget).toBeNull();
      expect(event.cancelBubble).toBe(false);

      const defaults = new win.Event("plain");
      expect(defaults.bubbles).toBe(false);
      expect(defaults.cancelable).toBe(false);
      expect(defaults.composed).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test("CustomEvent defaults detail to null and exposes it via the prototype getter", () => {
    const win = new Window();
    try {
      const event = new win.CustomEvent("ready", { detail: { attempt: 1 } });
      expect(event.detail).toEqual({ attempt: 1 });
      expect(event instanceof win.Event).toBe(true);
      // The baseline keeps detail out of the own-instance key set.
      expect(Object.getOwnPropertyDescriptor(event, "detail")).toBeUndefined();
      expect(typeof Object.getOwnPropertyDescriptor(win.CustomEvent.prototype, "detail")?.get).toBe("function");

      expect(new win.CustomEvent("plain").detail).toBeNull();
      expect(new win.CustomEvent("plain", { detail: 0 }).detail).toBe(0);
    } finally {
      win.destroy();
    }
  });

  test("the concrete event classes expose the baseline default values as own data fields", () => {
    const win = new Window();
    try {
      const ui = new win.UIEvent("ui");
      expect(ui.detail).toBe(0);
      expect(ui.layerX).toBe(0);
      expect(ui.layerY).toBe(0);
      expect(ui.pageX).toBe(0);
      expect(ui.pageY).toBe(0);
      expect(ui.view).toBeNull();

      const mouse = new win.MouseEvent("click");
      expect(mouse.altKey).toBe(false);
      expect(mouse.button).toBe(0);
      expect(mouse.buttons).toBe(0);
      expect(mouse.clientX).toBe(0);
      expect(mouse.clientY).toBe(0);
      expect(mouse.ctrlKey).toBe(false);
      expect(mouse.metaKey).toBe(false);
      expect(mouse.movementX).toBe(0);
      expect(mouse.movementY).toBe(0);
      expect(mouse.offsetX).toBe(0);
      expect(mouse.offsetY).toBe(0);
      expect(mouse.region).toBe("");
      expect(mouse.relatedTarget).toBeNull();
      expect(mouse.screenX).toBe(0);
      expect(mouse.screenY).toBe(0);
      expect(mouse.shiftKey).toBe(false);

      const keyboard = new win.KeyboardEvent("keydown");
      expect(keyboard.key).toBe("");
      expect(keyboard.code).toBe("");
      expect(keyboard.location).toBe(0);
      expect(keyboard.repeat).toBe(false);
      expect(keyboard.isComposing).toBe(false);
      expect(keyboard.keyCode).toBe(0);
      expect(keyboard.which).toBe(0);
      expect(keyboard.altKey).toBe(false);
      expect(keyboard.ctrlKey).toBe(false);
      expect(keyboard.metaKey).toBe(false);
      expect(keyboard.shiftKey).toBe(false);

      expect(new win.FocusEvent("focus").relatedTarget).toBeNull();

      const wheel = new win.WheelEvent("wheel");
      expect(wheel.deltaX).toBe(0);
      expect(wheel.deltaY).toBe(0);
      expect(wheel.deltaZ).toBe(0);
      expect(wheel.deltaMode).toBe(0);

      const input = new win.InputEvent("input");
      expect(input.data).toBe("");
      expect(input.dataTransfer).toBeNull();
      expect(input.inputType).toBe("");
      expect(input.isComposing).toBe(false);

      // The payload fields are own instance data fields (baseline descriptor
      // shape: writable, enumerable, configurable).
      const descriptor = Object.getOwnPropertyDescriptor(mouse, "screenX");
      expect(descriptor).toEqual({
        value: 0,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } finally {
      win.destroy();
    }
  });

  test("init values flow into the concrete event classes", () => {
    const win = new Window();
    try {
      const mouse = new win.MouseEvent("click", {
        screenX: 10,
        screenY: 20,
        clientX: 30,
        clientY: 40,
        button: 2,
        buttons: 4,
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
        metaKey: true,
        detail: 1,
        relatedTarget: win.document.getElementById("mid"),
        view: win,
      });
      expect(mouse.screenX).toBe(10);
      expect(mouse.screenY).toBe(20);
      expect(mouse.clientX).toBe(30);
      expect(mouse.clientY).toBe(40);
      expect(mouse.button).toBe(2);
      expect(mouse.buttons).toBe(4);
      expect(mouse.ctrlKey).toBe(true);
      expect(mouse.shiftKey).toBe(true);
      expect(mouse.altKey).toBe(true);
      expect(mouse.metaKey).toBe(true);
      expect(mouse.detail).toBe(1);
      expect(mouse.relatedTarget).toBe(win.document.getElementById("mid"));
      expect(mouse.view).toBe(win);

      const keyboard = new win.KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13 });
      expect(keyboard.key).toBe("Enter");
      expect(keyboard.code).toBe("Enter");
      expect(keyboard.keyCode).toBe(13);
      expect(keyboard.which).toBe(13);

      // `which` falls back to `keyCode` when absent (baseline).
      expect(new win.KeyboardEvent("x", { keyCode: 5 }).which).toBe(5);

      const wheel = new win.WheelEvent("wheel", { deltaX: 1, deltaY: 2, deltaZ: 3, deltaMode: 1 });
      expect(wheel.deltaX).toBe(1);
      expect(wheel.deltaY).toBe(2);
      expect(wheel.deltaZ).toBe(3);
      expect(wheel.deltaMode).toBe(1);

      const focus = new win.FocusEvent("focus", { relatedTarget: win.document.getElementById("leaf") });
      expect(focus.relatedTarget).toBe(win.document.getElementById("leaf"));

      const input = new win.InputEvent("input", { data: "x", inputType: "insertText", isComposing: true });
      expect(input.data).toBe("x");
      expect(input.inputType).toBe("insertText");
      expect(input.isComposing).toBe(true);

      const ui = new win.UIEvent("ui", { detail: 5, view: win });
      expect(ui.detail).toBe(5);
      expect(ui.view).toBe(win);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T38 stable event behaviors", () => {
  test("timeStamp is a positive number fixed at construction", () => {
    const win = new Window();
    try {
      const a = new win.Event("a");
      const b = new win.Event("b");
      expect(typeof a.timeStamp).toBe("number");
      expect(a.timeStamp).toBeGreaterThan(0);
      expect(b.timeStamp).toBeGreaterThan(0);
      // Each construction mints its own stamp (performance.now() baseline).
      expect(a.timeStamp).not.toBe(b.timeStamp);
      // The stamp never changes.
      const before = a.timeStamp;
      a.initEvent("renamed", true, false);
      expect(a.timeStamp).toBe(before);
    } finally {
      win.destroy();
    }
  });

  test("composedPath returns the propagation path, not currentTarget", () => {
    const win = new Window();
    try {
      const { doc, mid, leaf } = build(win);

      // Before any dispatch the path is empty.
      const fresh = new win.Event("evt", { bubbles: true });
      expect(fresh.composedPath()).toEqual([]);

      // A detached element reports only itself.
      const detached = win.document.createElement("p");
      const detachedEvent = new win.Event("evt", { bubbles: true });
      let detachedPath = null;
      detached.addEventListener("evt", () => {
        detachedPath = detachedEvent.composedPath();
      });
      detached.dispatchEvent(detachedEvent);
      expect(detachedPath).toHaveLength(1);
      expect(detachedPath[0]).toBe(detached);

      // A connected element walks its ancestor chain up to the document root
      // (the window hop is a T45 gap; composedPath here ends at the document).
      const event = new win.Event("evt", { bubbles: true });
      let connectedPath = null;
      leaf.addEventListener("evt", (observed) => {
        connectedPath = observed.composedPath();
      });
      mid.addEventListener("evt", (observed) => {
        expect(observed.composedPath()[0]).toBe(leaf, "the path is fixed from the original target");
      }, { capture: true });
      leaf.dispatchEvent(event);
      expect(connectedPath[0]).toBe(leaf);
      expect(connectedPath[connectedPath.length - 1].nodeType).toBe(9, "the path ends at the document root");
      expect(connectedPath).toContain(mid);
      expect(connectedPath).toContain(doc.documentElement);
      expect(connectedPath).toContain(doc.body);

      // The path survives the dispatch (target stays set, baseline behavior).
      expect(event.composedPath()[0]).toBe(leaf);
    } finally {
      win.destroy();
    }
  });

  test("initEvent re-initializes and resets the cancellation flags", () => {
    const win = new Window();
    try {
      const { leaf } = build(win);
      const event = new win.Event("evt", { bubbles: false, cancelable: true });
      leaf.addEventListener("evt", (e) => e.preventDefault());
      leaf.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);

      event.initEvent("renamed", true, false);
      expect(event.type).toBe("renamed");
      expect(event.bubbles).toBe(true);
      expect(event.cancelable).toBe(false);
      expect(event.defaultPrevented).toBe(false, "initEvent resets defaultPrevented");

      // The event dispatches under the new type.
      const order = [];
      leaf.addEventListener("renamed", () => order.push("renamed"));
      leaf.dispatchEvent(event);
      expect(order).toEqual(["renamed"]);
    } finally {
      win.destroy();
    }
  });

  test("initCustomEvent re-initializes the CustomEvent payload", () => {
    const win = new Window();
    try {
      const event = new win.CustomEvent("ready", { bubbles: true, detail: { a: 1 } });
      event.initCustomEvent("renamed", false, false, { b: 2 });
      expect(event.type).toBe("renamed");
      expect(event.bubbles).toBe(false);
      expect(event.cancelable).toBe(false);
      expect(event.detail).toEqual({ b: 2 });
      expect(event.initCustomEvent("x", true, true)).toBeUndefined();
    } finally {
      win.destroy();
    }
  });

  test("cancelBubble reflects stopPropagation as a read-only getter", () => {
    const win = new Window();
    try {
      const event = new win.Event("evt", { bubbles: true });
      expect(event.cancelBubble).toBe(false);
      event.stopPropagation();
      expect(event.cancelBubble).toBe(true);

      const err = thrown(() => {
        event.cancelBubble = false;
      });
      expect(err).toBeInstanceOf(TypeError);
      expect(event.cancelBubble).toBe(true, "the assignment is ignored (read-only getter)");
    } finally {
      win.destroy();
    }
  });

  test("KeyboardEvent.getModifierState honors the modifier flags", () => {
    const win = new Window();
    try {
      const event = new win.KeyboardEvent("keydown", {
        altKey: true,
        ctrlKey: true,
        shiftKey: true,
        metaKey: true,
      });
      expect(event.getModifierState("Alt")).toBe(true);
      expect(event.getModifierState("altgraph")).toBe(true, "AltGraph maps to altKey (baseline)");
      expect(event.getModifierState("Control")).toBe(true);
      expect(event.getModifierState("Shift")).toBe(true);
      expect(event.getModifierState("Meta")).toBe(true);
      expect(event.getModifierState("CapsLock")).toBe(false);
      expect(event.getModifierState("Fn")).toBe(false);

      const err = thrown(() => event.getModifierState());
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toContain("1 argument required");
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T38 dispatch integration and reuse guard", () => {
  test("a CustomEvent dispatches with identity and its detail readable in listeners", () => {
    const win = new Window();
    try {
      const { doc, leaf } = build(win);
      const event = new win.CustomEvent("ready", { bubbles: true, cancelable: true, detail: { attempt: 1 } });
      const seen = [];
      leaf.addEventListener("ready", (e) => seen.push({ identity: e === event, detail: e.detail.attempt, type: e.type }));
      doc.addEventListener("ready", (e) => seen.push({ bubbles: e.bubbles, target: e.target === leaf }));
      expect(leaf.dispatchEvent(event)).toBe(true);
      expect(seen).toEqual([
        { identity: true, detail: 1, type: "ready" },
        { bubbles: true, target: true },
      ]);
    } finally {
      win.destroy();
    }
  });

  test("a MouseEvent dispatches and reaches bubbling listeners with its payload", () => {
    const win = new Window();
    try {
      const { mid, leaf } = build(win);
      const event = new win.MouseEvent("click", { bubbles: true, clientX: 12, button: 1 });
      const seen = [];
      mid.addEventListener("click", (e) => seen.push({ x: e.clientX, button: e.button }));
      leaf.dispatchEvent(event);
      expect(seen).toEqual([{ x: 12, button: 1 }]);
    } finally {
      win.destroy();
    }
  });

  test("an already-dispatching event cannot be dispatched again", () => {
    const win = new Window();
    try {
      const { leaf } = build(win);
      const event = new win.Event("evt", { bubbles: true });
      let reentrantError = null;
      leaf.addEventListener("evt", () => {
        const err = thrown(() => leaf.dispatchEvent(event));
        if (err) reentrantError = err;
      });
      expect(() => leaf.dispatchEvent(event)).not.toThrow();
      expect(reentrantError).toBeInstanceOf(Error);
      expect(reentrantError.code).toBe("ERR_MAD_DOM_INVALID_STATE");
    } finally {
      win.destroy();
    }
  });

  test("a completed event can be dispatched again", () => {
    const win = new Window();
    try {
      const { leaf } = build(win);
      const event = new win.Event("evt", { bubbles: true });
      let calls = 0;
      leaf.addEventListener("evt", () => {
        calls += 1;
      });
      expect(leaf.dispatchEvent(event)).toBe(true);
      expect(leaf.dispatchEvent(event)).toBe(true);
      expect(calls).toBe(2);
    } finally {
      win.destroy();
    }
  });

  test("the baseline allows initEvent during a dispatch", () => {
    const win = new Window();
    try {
      const { leaf } = build(win);
      const event = new win.Event("orig", { bubbles: false, cancelable: false });
      const observed = [];
      leaf.addEventListener("orig", () => {
        event.initEvent("changed", true, true);
        observed.push([event.type, event.bubbles, event.cancelable]);
      });
      leaf.dispatchEvent(event);
      expect(observed).toEqual([["changed", true, true]]);
    } finally {
      win.destroy();
    }
  });
});
