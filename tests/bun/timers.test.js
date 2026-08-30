import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable, liveDocumentCount } from "../../index.js";
import { Window } from "../../js/facade/window.js";

// T47 timer / task-scheduling / script-evaluation integration tests.
//
// They drive the complete window async surface through the official package
// entry (index.js → js/entry.js → the facade timers extension reached via
// `window.setTimeout` etc.) and pin the acceptance criteria:
//
//   - the baseline public surface — setTimeout / clearTimeout / setInterval /
//     clearInterval / requestAnimationFrame / cancelAnimationFrame /
//     queueMicrotask (and the window-level EventTarget + ErrorEvent) — is
//     installed on `Window.prototype` with frozen descriptors; happy-dom
//     exposes no `setImmediate`/`clearImmediate` on the window, and neither do
//     we;
//   - timers are scheduled by Bun: callbacks receive their args, `clearTimeout`
//     / `clearInterval` / `cancelAnimationFrame` cancel, intervals repeat, rAF
//     passes a finite numeric timestamp, and the microtask/macrotask boundary
//     is exactly Bun's;
//   - task ordering is pinned: events and Custom Element reactions are
//     synchronous, Promise and MutationObserver deliveries are microtasks in
//     queue order, and timers run after the microtask checkpoint;
//   - script errors and async callback errors propagate like the baseline:
//     `eval` throws synchronously to the caller, a throwing timeout / interval
//     / rAF callback is caught and re-dispatched as a window `error` event
//     (an interval additionally clears itself), and a returned rejected Promise
//     is routed to the same `error` event;
//   - `eval` runs against the owning window's globals (document / window /
//     HTMLElement / setTimeout / URL) without polluting the process globals;
//   - releasing a Window leaves neither an orphaned timer nor a native
//     resource: a collected window clears its still-pending timers and its
//     document is reclaimed, so `liveDocumentCount()` returns to baseline.
//
// The structural block needs no native artifact; the runtime blocks skip
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

const nativeAvailable = isNativeAvailable();

// Drains the microtask queue and a few macrotasks so scheduled timers fire.
async function settle(turns = 3) {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Runs several synchronous GC passes and drains macrotasks so napi finalizers
// and the window FinalizationRegistry cleanup run (Bun defers them to the next
// event-loop turn). Multiple rounds are needed: collecting the window facade
// and then releasing the async state it carried takes more than one pass,
// especially when earlier test files have loaded many modules.
async function collectGarbage() {
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("T47 window async surface shape", () => {
  test("the facade installs the baseline timer surface with frozen descriptors", () => {
    const methods = [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "queueMicrotask",
      "eval",
      "addEventListener",
      "removeEventListener",
      "dispatchEvent",
    ];
    for (const name of methods) {
      const descriptor = Object.getOwnPropertyDescriptor(Window.prototype, name);
      expect(descriptor, `Window.prototype.${name}`).toBeDefined();
      expect(typeof descriptor.value, `Window.prototype.${name}`).toBe("function");
      expect(descriptor.enumerable, `${name}.enumerable`).toBe(false);
      expect(descriptor.configurable, `${name}.configurable`).toBe(false);
      expect(descriptor.writable, `${name}.writable`).toBe(false);
    }
    expect(Object.getOwnPropertyDescriptor(Window.prototype, "ErrorEvent").get).toBeTypeOf("function");

    const win = createWindow();
    try {
      // happy-dom's window exposes no setImmediate / clearImmediate (only
      // requestAnimationFrame is immediate-backed); the baseline reads both as
      // undefined, and so do we.
      expect(win.setImmediate).toBeUndefined();
      expect(win.clearImmediate).toBeUndefined();
      expect(typeof win.setTimeout).toBe("function");
      expect(typeof win.ErrorEvent).toBe("function");
      // happy-dom parity: the window exposes itself under the standard aliases.
      expect(win.window).toBe(win);
      expect(win.self).toBe(win);
      expect(win.globalThis).toBe(win);
      expect(win.top).toBe(win);
      expect(win.parent).toBe(win);
      const event = new win.ErrorEvent("error", { message: "m", error: new Error("e") });
      expect(event.type).toBe("error");
      expect(event.message).toBe("m");
      expect(event.error.message).toBe("e");
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T47 timers are scheduled by Bun", () => {
  test("setTimeout fires with the extra args and clearTimeout cancels", async () => {
    const win = createWindow();
    try {
      const order = [];
      const id = win.setTimeout((a, b) => order.push([a, b]), 5, 1, "x");
      expect(typeof id).toBe("object");
      await settle();
      expect(order).toEqual([[1, "x"]]);

      const cancelledId = win.setTimeout(() => order.push("cancelled"), 10);
      win.clearTimeout(cancelledId);
      await settle();
      expect(order).toEqual([[1, "x"]]);
    } finally {
      win.destroy();
    }
  });

  test("setInterval repeats until clearInterval", async () => {
    const win = createWindow();
    try {
      const ticks = [];
      const id = win.setInterval((n) => ticks.push(n), 5, 7);
      await settle(6);
      win.clearInterval(id);
      const afterClear = ticks.length;
      await settle(6);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.every((n) => n === 7)).toBe(true);
      expect(ticks.length).toBe(afterClear);
    } finally {
      win.destroy();
    }
  });

  test("requestAnimationFrame fires once with a numeric timestamp and cancelAnimationFrame cancels", async () => {
    const win = createWindow();
    try {
      const fired = [];
      const id = win.requestAnimationFrame((timestamp) => fired.push(["raf", timestamp]));
      const cancelled = win.requestAnimationFrame(() => fired.push(["cancelled"]));
      win.cancelAnimationFrame(cancelled);
      await settle();
      expect(fired.length).toBe(1);
      expect(fired[0][0]).toBe("raf");
      expect(typeof fired[0][1]).toBe("number");
      expect(Number.isFinite(fired[0][1])).toBe(true);
      void id;
    } finally {
      win.destroy();
    }
  });

  test("queueMicrotask runs the callback on the microtask queue", async () => {
    const win = createWindow();
    try {
      const order = [];
      win.queueMicrotask(() => order.push("qm"));
      Promise.resolve().then(() => order.push("promise"));
      await settle();
      expect(order).toEqual(["qm", "promise"]);
    } finally {
      win.destroy();
    }
  });

  test("task order is pinned: events/custom-element reactions sync, promises + MutationObserver microtasks, timers after", async () => {
    const win = createWindow();
    try {
      const order = [];
      class XEl extends win.HTMLElement {
        connectedCallback() {
          order.push("connected");
        }
        attributeChangedCallback() {
          order.push("attr-changed");
        }
        static get observedAttributes() {
          return ["id"];
        }
      }
      win.customElements.define("x-el", XEl);

      order.push("sync1");
      Promise.resolve().then(() => order.push("promise1"));
      const el = win.document.createElement("x-el");
      el.setAttribute("id", "a"); // synchronous attributeChanged reaction
      win.document.body.appendChild(el); // synchronous connected reaction
      order.push("sync2");
      el.setAttribute("id", "b"); // synchronous attributeChanged reaction

      const mo = new win.MutationObserver(() => order.push("mo"));
      mo.observe(win.document.body, { childList: true, subtree: true });
      Promise.resolve().then(() => order.push("promise2"));
      win.document.body.appendChild(win.document.createElement("plain")); // queues the MO microtask
      win.setTimeout(() => order.push("timer0"), 0);
      win.setTimeout(() => order.push("timer5"), 5);
      order.push("sync3");

      await settle(8);
      expect(order).toEqual([
        "sync1",
        "attr-changed",
        "connected",
        "sync2",
        "attr-changed",
        "sync3",
        "promise1",
        "promise2",
        "mo",
        "timer0",
        "timer5",
      ]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T47 error propagation", () => {
  test("a throwing timeout callback dispatches a window error event, not an uncaught error", async () => {
    const win = createWindow();
    try {
      const events = [];
      win.addEventListener("error", (event) => {
        events.push({
          type: event.type,
          message: event.message,
          errorName: event.error?.name,
          errorMessage: event.error?.message,
          filename: event.filename,
          lineno: event.lineno,
        });
      });
      win.setTimeout(() => {
        throw new Error("timer boom");
      }, 0);
      await settle();
      expect(events).toEqual([
        {
          type: "error",
          message: "timer boom",
          errorName: "Error",
          errorMessage: "timer boom",
          filename: "",
          lineno: 0,
        },
      ]);
    } finally {
      win.destroy();
    }
  });

  test("a throwing interval callback dispatches an error event and clears itself", async () => {
    const win = createWindow();
    try {
      const events = [];
      win.addEventListener("error", (event) => events.push(event.error.message));
      win.setInterval(() => {
        throw new Error("interval boom");
      }, 5);
      await settle(8);
      expect(events.length).toBe(1);
      expect(events[0]).toBe("interval boom");
    } finally {
      win.destroy();
    }
  });

  test("a rejected promise returned by a timer callback is routed to the error event", async () => {
    const win = createWindow();
    try {
      const events = [];
      win.addEventListener("error", (event) => events.push(event.error.message));
      win.setTimeout(() => Promise.reject(new Error("async boom")), 0);
      await settle(8);
      expect(events).toEqual(["async boom"]);
    } finally {
      win.destroy();
    }
  });

  test("removeEventListener stops the error delivery", async () => {
    const win = createWindow();
    try {
      const events = [];
      const handler = (event) => events.push(event.error.message);
      win.addEventListener("error", handler);
      win.removeEventListener("error", handler);
      win.setTimeout(() => {
        throw new Error("silent boom");
      }, 0);
      await settle();
      expect(events).toEqual([]);
    } finally {
      win.destroy();
    }
  });

  test("a throwing eval script propagates synchronously to the caller", () => {
    const win = createWindow();
    try {
      let thrown;
      try {
        win.eval("throw new Error('script boom')");
      } catch (error) {
        thrown = error;
      }
      // node:vm (the same engine happy-dom uses) throws a VM-realm error that
      // is not `instanceof Error` in the outer realm, but carries the baseline
      // name / message / constructor shape.
      expect(thrown).toBeDefined();
      expect(thrown.name).toBe("Error");
      expect(thrown.message).toBe("script boom");
      expect(thrown.constructor?.name).toBe("Error");
      expect(win.eval("1 + 2 * 3")).toBe(7);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T47 script evaluation with window globals", () => {
  test("eval resolves the owning window's document/window/constructors/timers", () => {
    const win = createWindow();
    try {
      expect(win.eval("typeof document")).toBe("object");
      expect(win.eval("typeof window")).toBe("object");
      expect(win.eval("typeof HTMLElement")).toBe("function");
      expect(win.eval("typeof setTimeout")).toBe("function");
      expect(win.eval("typeof URL")).toBe("function");
      expect(win.eval("typeof Promise")).toBe("function");
      expect(win.eval("document.body !== null")).toBe(true);
      expect(win.eval("document.createElement('div').nodeType")).toBe(1);
      expect(win.eval("this === window")).toBe(true);
      expect(win.eval("(function(){ var n = 0; return function(){ return ++n; }; })()()")).toBe(1);
      expect(win.eval("'a' + 'b'")).toBe("ab");
    } finally {
      win.destroy();
    }
  });

  test("eval uses the owning window, not a shared global", () => {
    const winA = createWindow();
    const winB = createWindow();
    try {
      winA.document.body.setAttribute("data-owner", "a");
      expect(winB.eval("document.body.hasAttribute('data-owner')")).toBe(false);
      expect(winA.eval("document.body.getAttribute('data-owner')")).toBe("a");
    } finally {
      winA.destroy();
      winB.destroy();
    }
  });

  test("eval assignments and declarations do not pollute the process globals", () => {
    const win = createWindow();
    try {
      expect(globalThis.__madDomEvalProbe).toBeUndefined();
      win.eval("__madDomEvalProbe = 42");
      expect(globalThis.__madDomEvalProbe).toBeUndefined();
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T47 lifecycle: releasing a window leaves no orphans", () => {
  test("a released window's pending timers are cleared and its document reclaimed", async () => {
    await collectGarbage();
    const before = liveDocumentCount();

    let fired = [];
    let winRef = null;
    let docRef = null;
    const spawn = () => {
      const win = createWindow();
      winRef = new WeakRef(win);
      docRef = new WeakRef(win.document);
      win.setInterval(() => fired.push("interval"), 5000);
      win.setTimeout(() => fired.push("timeout"), 5000);
      win.requestAnimationFrame(() => fired.push("raf"));
      win.queueMicrotask(() => fired.push("qm"));
      const el = win.document.createElement("div");
      win.document.body.appendChild(el);
    };
    spawn();

    await collectGarbage();
    expect(winRef.deref()).toBeUndefined();
    expect(docRef.deref()).toBeUndefined();
    expect(liveDocumentCount()).toBe(before);

    // The pending 5-second timers were cleared with the window: nothing fires
    // into the void long after release.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fired).toEqual([]);

    // A fresh window on the same code path still schedules normally.
    const win = createWindow();
    try {
      const order = [];
      win.setTimeout(() => order.push("alive"), 5);
      await settle();
      expect(order).toEqual(["alive"]);
    } finally {
      win.destroy();
    }
  });

  test("destroying a window never leaves an uncaught async error behind", async () => {
    const win = createWindow();
    const events = [];
    win.addEventListener("error", (event) => events.push(event.error.message));
    const el = win.document.createElement("div");
    win.document.body.appendChild(el);
    win.setTimeout(() => el.textContent = "x", 5);
    win.destroy();

    // The callback may still fire after destroy (Bun owns the timer); if it
    // touches the destroyed document it is contained as a window error event
    // instead of crashing the process.
    await settle();
    expect(events.every((message) => message.includes("destroyed"))).toBe(true);
  });
});
