// Real differential scenario (T38): the concrete event classes.
//
// Scope is exactly the T38 slice — the completed `Event` base (phase
// constants, timeStamp, cancelBubble, composedPath, initEvent), the first
// batch of concrete classes (CustomEvent / UIEvent / MouseEvent / KeyboardEvent
// / FocusEvent / WheelEvent / InputEvent), their construction defaults, own
// instance descriptor shape, static constants and dispatch integration — plus
// the module-level EventPhaseEnum.
//
// The observations use values, event order, identity relations, prototype
// chains and instance descriptors — never element `nodeName` (the frozen T23A
// casing gap), never prototype-accessor descriptors (the frozen facade layout
// gap), never non-string event types (mad-dom WebIDL-coerces where happy-dom
// stores the raw value) and never `composedPath` on a connected element (the
// document→window hop is a T45 gap, so the path is probed only while empty or
// on a detached target, where both sides agree).
export const id = "dom-event-classes";
export const description = "real differential: Event base completion (constants/timeStamp/cancelBubble/composedPath/initEvent), CustomEvent/UIEvent/MouseEvent/KeyboardEvent/FocusEvent/WheelEvent/InputEvent construction defaults, descriptors and dispatch integration";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    document.body.innerHTML = '<div id="mid"><span id="leaf">leaf</span></div>';
    const leaf = document.getElementById("leaf");
    const mid = document.getElementById("mid");

    // 1. Construction defaults and the base Event surface.
    {
      const e = new window.Event("evt", { bubbles: true, cancelable: true });
      api.record.value("event-type", e.type);
      api.record.value("event-bubbles", e.bubbles);
      api.record.value("event-cancelable", e.cancelable);
      api.record.value("event-composed", e.composed);
      api.record.value("event-default-prevented", e.defaultPrevented);
      api.record.value("event-phase-before-dispatch", e.eventPhase);
      api.record.value("event-target-before-dispatch-null", e.target === null);
      api.record.value("event-current-target-before-dispatch-null", e.currentTarget === null);
      api.record.value("event-cancel-bubble", e.cancelBubble);
      api.record.value("event-time-stamp-type", typeof e.timeStamp);
      api.record.value("event-time-stamp-positive", e.timeStamp > 0);
      api.record.value("event-time-stamp-stable", e.timeStamp === e.timeStamp);
      // The phase constants are own instance keys (baseline instance shape).
      api.record.value("event-own-keys", Object.keys(e));
    }

    // 2. Static phase constants and EventPhaseEnum values.
    {
      api.record.value("event-none", window.Event.NONE);
      api.record.value("event-capturing", window.Event.CAPTURING_PHASE);
      api.record.value("event-at-target", window.Event.AT_TARGET);
      api.record.value("event-bubbling-phase", window.Event.BUBBLING_PHASE);
      api.record.value("event-phase-enum-none", entry.EventPhaseEnum?.none ?? window.Event.NONE);
      api.record.value("event-phase-enum-bubbling", entry.EventPhaseEnum?.bubbling ?? window.Event.BUBBLING_PHASE);
      api.record.value("ui-event-none", window.UIEvent.NONE);
    }

    // 3. CustomEvent construction, defaults and dispatch identity.
    {
      const detail = { attempt: 1 };
      const e = new window.CustomEvent("ready", { bubbles: true, cancelable: true, detail });
      api.record.value("custom-type", e.type);
      api.record.value("custom-bubbles", e.bubbles);
      api.record.value("custom-cancelable", e.cancelable);
      api.record.value("custom-detail-value", e.detail);
      api.record.identity("custom-detail-is-same-object", e.detail, detail);
      api.record.value("custom-instance-of-event", e instanceof window.Event);
      api.record.value("custom-detail-own-absent", Object.getOwnPropertyDescriptor(e, "detail") === undefined);

      api.record.value("custom-default-detail-null", new window.CustomEvent("plain").detail === null);

      let seen = null;
      leaf.addEventListener("ready", (event) => {
        seen = { identity: event === e, detail: event.detail.attempt };
      });
      api.record.value("custom-dispatch-return", leaf.dispatchEvent(e));
      api.record.value("custom-dispatch-identity", seen?.identity);
      api.record.value("custom-dispatch-detail", seen?.detail);

      // initCustomEvent re-initializes the payload.
      e.initCustomEvent("renamed", false, false, { b: 2 });
      api.record.value("custom-after-init-type", e.type);
      api.record.value("custom-after-init-bubbles", e.bubbles);
      api.record.value("custom-after-init-cancelable", e.cancelable);
      api.record.value("custom-after-init-detail", e.detail);
    }

    // 4. UIEvent / MouseEvent construction defaults, own-instance descriptors
    // and init-value flow.
    {
      const ui = new window.UIEvent("ui");
      api.record.value("ui-detail-default", ui.detail);
      api.record.value("ui-view-default-null", ui.view === null);

      const mouse = new window.MouseEvent("click", {
        bubbles: true,
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
        relatedTarget: mid,
        view: window,
      });
      api.record.value("mouse-screen-x", mouse.screenX);
      api.record.value("mouse-client-x", mouse.clientX);
      api.record.value("mouse-button", mouse.button);
      api.record.value("mouse-buttons", mouse.buttons);
      api.record.value("mouse-ctrl-key", mouse.ctrlKey);
      api.record.value("mouse-detail", mouse.detail);
      api.record.identity("mouse-related-target-is-mid", mouse.relatedTarget, mid);
      api.record.identity("mouse-view-is-window", mouse.view, window);
      api.record.value("mouse-instance-of-ui-event", mouse instanceof window.UIEvent);
      api.record.value("mouse-instance-of-event", mouse instanceof window.Event);
      api.record.value("mouse-default-region", new window.MouseEvent("x").region);
      api.record.value("mouse-default-alt-key", new window.MouseEvent("x").altKey);
      // The payload fields are own instance data fields (baseline descriptor).
      const descriptor = Object.getOwnPropertyDescriptor(mouse, "screenX");
      api.record.value("mouse-screen-x-descriptor", {
        writable: descriptor?.writable,
        enumerable: descriptor?.enumerable,
        configurable: descriptor?.configurable,
      });

      let seen = null;
      mid.addEventListener("click", (event) => {
        seen = { identity: event === mouse, x: event.clientX, button: event.button };
      });
      leaf.addEventListener("click", () => {});
      api.record.value("mouse-dispatch-return", leaf.dispatchEvent(mouse));
      api.record.value("mouse-dispatch-identity", seen?.identity);
      api.record.value("mouse-dispatch-client-x", seen?.x);
    }

    // 5. KeyboardEvent constants, defaults and getModifierState.
    {
      const keyboard = new window.KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        location: 1,
        repeat: true,
        ctrlKey: true,
        isComposing: true,
      });
      api.record.value("keyboard-key", keyboard.key);
      api.record.value("keyboard-code", keyboard.code);
      api.record.value("keyboard-key-code", keyboard.keyCode);
      api.record.value("keyboard-which", keyboard.which);
      api.record.value("keyboard-location", keyboard.location);
      api.record.value("keyboard-repeat", keyboard.repeat);
      api.record.value("keyboard-ctrl-key", keyboard.ctrlKey);
      api.record.value("keyboard-is-composing", keyboard.isComposing);
      api.record.value("keyboard-default-key", new window.KeyboardEvent("x").key);
      api.record.value("keyboard-which-falls-back-to-key-code", new window.KeyboardEvent("x", { keyCode: 5 }).which);
      api.record.value("keyboard-location-standard", window.KeyboardEvent.DOM_KEY_LOCATION_STANDARD);
      api.record.value("keyboard-location-left", window.KeyboardEvent.DOM_KEY_LOCATION_LEFT);
      api.record.value("keyboard-location-right", window.KeyboardEvent.DOM_KEY_LOCATION_RIGHT);
      api.record.value("keyboard-location-numpad", window.KeyboardEvent.DOM_KEY_LOCATION_NUMPAD);
      api.record.value("keyboard-modifier-control", keyboard.getModifierState("Control"));
      api.record.value("keyboard-modifier-altgraph", keyboard.getModifierState("altgraph"));
      api.record.value("keyboard-modifier-unknown", keyboard.getModifierState("CapsLock"));
    }

    // 6. FocusEvent / WheelEvent / InputEvent.
    {
      const focus = new window.FocusEvent("focus", { relatedTarget: mid });
      api.record.identity("focus-related-target-is-mid", focus.relatedTarget, mid);
      api.record.value("focus-instance-of-ui-event", focus instanceof window.UIEvent);

      const wheel = new window.WheelEvent("wheel", { deltaX: 1, deltaY: 2, deltaZ: 3, deltaMode: 1 });
      api.record.value("wheel-delta-x", wheel.deltaX);
      api.record.value("wheel-delta-y", wheel.deltaY);
      api.record.value("wheel-delta-z", wheel.deltaZ);
      api.record.value("wheel-delta-mode", wheel.deltaMode);
      api.record.value("wheel-delta-pixel", window.WheelEvent.DOM_DELTA_PIXEL);
      api.record.value("wheel-delta-line", window.WheelEvent.DOM_DELTA_LINE);
      api.record.value("wheel-delta-page", window.WheelEvent.DOM_DELTA_PAGE);

      const input = new window.InputEvent("input", { data: "x", inputType: "insertText", isComposing: true });
      api.record.value("input-data", input.data);
      api.record.value("input-input-type", input.inputType);
      api.record.value("input-is-composing", input.isComposing);
      api.record.value("input-default-data", new window.InputEvent("x").data);
      api.record.value("input-instance-of-ui-event", input instanceof window.UIEvent);
    }

    // 7. initEvent re-initializes and resets the cancellation flags.
    {
      const e = new window.Event("evt", { bubbles: false, cancelable: true });
      leaf.addEventListener("evt", (event) => event.preventDefault());
      leaf.dispatchEvent(e);
      api.record.value("init-before-default-prevented", e.defaultPrevented);
      e.initEvent("renamed", true, false);
      api.record.value("init-after-type", e.type);
      api.record.value("init-after-bubbles", e.bubbles);
      api.record.value("init-after-cancelable", e.cancelable);
      api.record.value("init-after-default-prevented", e.defaultPrevented);
    }

    // 8. composedPath: empty before dispatch, the target alone for a detached
    // node (the connected-element window hop is a T45 gap, so it is not
    // probed here).
    {
      const fresh = new window.Event("evt", { bubbles: true });
      api.record.value("composed-path-before-dispatch-length", fresh.composedPath().length);

      const detached = document.createElement("p");
      const detachedEvent = new window.Event("evt", { bubbles: true });
      let path = null;
      detached.addEventListener("evt", () => {
        path = detachedEvent.composedPath();
      });
      detached.dispatchEvent(detachedEvent);
      api.record.value("composed-path-detached-length", path.length);
      api.record.identity("composed-path-detached-first-is-target", path[0], detached);
    }

    // 9. The window exposes the concrete constructors.
    {
      for (const name of ["Event", "CustomEvent", "UIEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "WheelEvent", "InputEvent"]) {
        api.record.value(`window-constructor-${name.toLowerCase()}`, typeof window[name]);
      }
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
