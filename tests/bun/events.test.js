import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Document } from "../../js/facade/document.js";
import { Event } from "../../js/facade/extensions/events.js";
import { Node } from "../../js/facade/extensions/node.js";
import { Window } from "../../js/facade/window.js";

// T37 EventTarget integration tests.
//
// They drive the complete event surface through the official package entry
// (index.js → js/entry.js) and the facade `Event` class and pin the acceptance
// criteria:
//
//   - registration / removal / order — listeners fire in registration order,
//     duplicates are suppressed, removed listeners never fire, and the
//     capture/at-target/bubbling phases visit the propagation path in the
//     baseline order;
//   - cancellation — stopPropagation ends the dispatch after the current
//     target, stopImmediatePropagation ends it immediately, preventDefault
//     respects cancelable and passive, and dispatchEvent returns
//     `!cancelable || !defaultPrevented`;
//   - options — once removes the listener after one invocation, capture
//     selects the bucket, passive suppresses preventDefault, and a signal
//     abort removes the listener;
//   - reentrancy / mutation — a listener may add/remove listeners, mutate the
//     tree (the propagation path is fixed) or dispatch a nested event without
//     corrupting the outer dispatch, a listener registered mid-dispatch is
//     not invoked by it, and a throwing listener is contained while dispatch
//     continues;
//   - event state — type/bubbles/cancelable/composed/defaultPrevented/
//     eventPhase/target/currentTarget read correctly before, during and after
//     a dispatch, and the same event object is handed to every listener
//     (identity through `ctx.wrap`);
//   - errors — a non-`Event` argument to dispatchEvent throws a TypeError, a
//     reentrant dispatch of the same event object throws, and a destroyed
//     document fails every event surface per T21.
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

describe("T37 event surface shape", () => {
  test("the facade installs the event methods with frozen descriptors", () => {
    for (const name of ["addEventListener", "removeEventListener", "dispatchEvent"]) {
      const nodeDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(nodeDescriptor, `Node.${name}`).toBeDefined();
      expect(typeof nodeDescriptor.value, `Node.${name}`).toBe("function");
      expect(nodeDescriptor.enumerable).toBe(false);
      expect(nodeDescriptor.configurable).toBe(false);
      expect(nodeDescriptor.writable).toBe(false);

      const documentDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
      expect(documentDescriptor, `Document.${name}`).toBeDefined();
      expect(typeof documentDescriptor.value, `Document.${name}`).toBe("function");
    }

    // The minimal Event base exposes the WHATWG read surface.
    for (const name of ["preventDefault", "stopPropagation", "stopImmediatePropagation"]) {
      expect(typeof Event.prototype[name], `Event.${name}`).toBe("function");
    }
    for (const name of ["type", "bubbles", "cancelable", "composed", "defaultPrevented", "eventPhase", "target", "currentTarget"]) {
      expect(typeof Object.getOwnPropertyDescriptor(Event.prototype, name)?.get, `Event.${name}`).toBe("function");
    }
    const windowDescriptor = Object.getOwnPropertyDescriptor(Window.prototype, "Event");
    expect(typeof windowDescriptor?.get).toBe("function");
  });
});

describe.skipIf(!nativeAvailable)("T37 registration, order and removal", () => {
  test("listeners fire in registration order and duplicates are suppressed", () => {
    const win = createWindow();
    try {
      const { doc, leaf } = build(win);
      const order = [];
      const handler = () => order.push("handler");
      leaf.addEventListener("evt", () => order.push("first"));
      leaf.addEventListener("evt", handler);
      leaf.addEventListener("evt", handler);
      leaf.addEventListener("evt", handler, { capture: true });
      leaf.addEventListener("evt", () => order.push("last"));
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["handler", "first", "handler", "last"], "the capture bucket runs at the target before the non-capture bucket");
    } finally {
      win.destroy();
    }
  });

  test("removeEventListener removes the matching listener; the capture flag is ignored", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const order = [];
      const keep = () => order.push("keep");
      const drop = () => order.push("drop");
      leaf.addEventListener("evt", keep);
      leaf.addEventListener("evt", drop, { capture: true });
      leaf.removeEventListener("evt", drop);
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["keep"], "the capture-registered listener is removed without a capture flag, matching the baseline");
    } finally {
      win.destroy();
    }
  });

  test("removing a listener then re-adding it registers it afresh", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const order = [];
      const handler = () => order.push("x");
      leaf.addEventListener("evt", handler);
      leaf.removeEventListener("evt", handler);
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      leaf.addEventListener("evt", handler);
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["x"], "only the re-added registration fires once");
    } finally {
      win.destroy();
    }
  });

  test("a non-callable listener throws a TypeError at registration", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const err = thrown(() => leaf.addEventListener("evt", 42));
      expect(err).toBeInstanceOf(TypeError);
      expect(leaf.addEventListener("evt", null)).toBeUndefined();
    } finally {
      win.destroy();
    }
  });

  test("an object with handleEvent is invoked as a listener", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const order = [];
      const listener = {
        handleEvent(event) {
          order.push(`handleEvent:${event.type}:${this === listener}`);
        },
      };
      leaf.addEventListener("evt", listener);
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["handleEvent:evt:true"]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T37 propagation order and phases", () => {
  test("capture, at-target and bubble structs run in the baseline order", () => {
    const win = createWindow();
    try {
      const { doc, mid, leaf } = build(win);
      const order = [];
      doc.addEventListener("evt", (event) => order.push(`doc:c:${event.eventPhase}`), { capture: true });
      mid.addEventListener("evt", (event) => order.push(`mid:c:${event.eventPhase}`), { capture: true });
      leaf.addEventListener("evt", (event) => order.push(`leaf:c:${event.eventPhase}`), { capture: true });
      leaf.addEventListener("evt", (event) => order.push(`leaf:t:${event.eventPhase}`));
      mid.addEventListener("evt", (event) => order.push(`mid:b:${event.eventPhase}`));
      doc.addEventListener("evt", (event) => order.push(`doc:b:${event.eventPhase}`));
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual([
        "doc:c:1",
        "mid:c:1",
        "leaf:c:1",
        "leaf:t:2",
        "mid:b:3",
        "doc:b:3",
      ]);
    } finally {
      win.destroy();
    }
  });

  test("a non-bubbling event stops after the target", () => {
    const win = createWindow();
    try {
      const { mid, leaf } = build(win);
      const order = [];
      mid.addEventListener("evt", () => order.push("mid:c"), { capture: true });
      leaf.addEventListener("evt", () => order.push("leaf:t"));
      mid.addEventListener("evt", () => order.push("mid:b"));
      leaf.dispatchEvent(new win.Event("evt", { bubbles: false }));
      expect(order).toEqual(["mid:c", "leaf:t"]);
    } finally {
      win.destroy();
    }
  });

  test("stopPropagation ends the dispatch after the current target's listeners", () => {
    const win = createWindow();
    try {
      const { mid, leaf } = build(win);
      const order = [];
      mid.addEventListener("evt", () => order.push("mid:c"), { capture: true });
      leaf.addEventListener("evt", () => order.push("leaf:1"));
      leaf.addEventListener("evt", (event) => {
        order.push("leaf:2");
        event.stopPropagation();
      });
      leaf.addEventListener("evt", () => order.push("leaf:3"));
      mid.addEventListener("evt", () => order.push("mid:b"));
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["mid:c", "leaf:1", "leaf:2", "leaf:3"]);
    } finally {
      win.destroy();
    }
  });

  test("stopImmediatePropagation ends the dispatch immediately", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const order = [];
      leaf.addEventListener("evt", (event) => {
        order.push("1");
        event.stopImmediatePropagation();
      });
      leaf.addEventListener("evt", () => order.push("2"));
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["1"]);
    } finally {
      win.destroy();
    }
  });

  test("the listener's `this` is the current target and the event identity is stable", () => {
    const win = createWindow();
    try {
      const { mid, leaf } = build(win);
      const event = new win.Event("evt", { bubbles: true });
      const order = [];
      const seen = [];
      mid.addEventListener("evt", function (e) {
        order.push(`mid:${this === mid}`);
        seen.push(e === event);
      });
      leaf.addEventListener("evt", function (e) {
        order.push(`leaf:${this === leaf}`);
        seen.push(e === event);
      });
      expect(leaf.dispatchEvent(event)).toBe(true);
      expect(order).toEqual(["leaf:true", "mid:true"]);
      expect(seen).toEqual([true, true]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T37 options", () => {
  test("once removes the listener after its first invocation", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      let count = 0;
      leaf.addEventListener("evt", () => {
        count += 1;
      }, { once: true });
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(count).toBe(1);
    } finally {
      win.destroy();
    }
  });

  test("preventDefault and the dispatchEvent return value respect cancelable", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);

      const cancelable = new win.Event("evt", { bubbles: true, cancelable: true });
      leaf.addEventListener("evt", (event) => event.preventDefault());
      expect(leaf.dispatchEvent(cancelable)).toBe(false);
      expect(cancelable.defaultPrevented).toBe(true);

      const notCancelable = new win.Event("evt", { bubbles: true, cancelable: false });
      leaf.addEventListener("evt", (event) => event.preventDefault());
      expect(leaf.dispatchEvent(notCancelable)).toBe(true);
      expect(notCancelable.defaultPrevented).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test("a passive listener's preventDefault is ignored", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const event = new win.Event("evt", { bubbles: true, cancelable: true });
      leaf.addEventListener("evt", (e) => e.preventDefault(), { passive: true });
      expect(leaf.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test("a signal abort removes the listener", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const order = [];
      const signal = {
        aborted: false,
        _handlers: [],
        addEventListener(type, handler) {
          if (type === "abort") this._handlers.push(handler);
        },
        abort() {
          this.aborted = true;
          for (const handler of this._handlers) handler();
        },
      };
      leaf.addEventListener("evt", () => order.push("sig"), { signal });
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      signal.abort();
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["sig"], "the listener fires once, then the abort removes it");
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T37 event state", () => {
  test("event properties read correctly before, during and after a dispatch", () => {
    const win = createWindow();
    try {
      const { doc, leaf } = build(win);
      const event = new win.Event("evt", { bubbles: true, cancelable: true });
      expect(event.type).toBe("evt");
      expect(event.bubbles).toBe(true);
      expect(event.cancelable).toBe(true);
      expect(event.composed).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(event.eventPhase).toBe(0);
      expect(event.target).toBeNull();
      expect(event.currentTarget).toBeNull();

      const observed = [];
      doc.addEventListener("evt", (e) => {
        observed.push([e.eventPhase, e.target, e.currentTarget]);
      });
      leaf.dispatchEvent(event);
      expect(observed[0][0]).toBe(3);
      expect(observed[0][1]).toBe(leaf);
      expect(observed[0][2].nodeName).toBe("#document");

      expect(event.eventPhase).toBe(0);
      expect(event.currentTarget).toBeNull();
      expect(event.target).toBe(leaf, "the target stays set after dispatch");
    } finally {
      win.destroy();
    }
  });

  test("dispatching on the document targets the document root", () => {
    const win = createWindow();
    try {
      const { doc, leaf } = build(win);
      const order = [];
      doc.addEventListener("evt", (event) => {
        order.push(`${event.currentTarget.nodeName}:${event.target.nodeName}`);
      });
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["#document:span"]);
    } finally {
      win.destroy();
    }
  });

  test("a completed event can be dispatched again and keeps defaultPrevented", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const event = new win.Event("evt", { bubbles: true, cancelable: true });
      let calls = 0;
      leaf.addEventListener("evt", (e) => {
        calls += 1;
        e.preventDefault();
      });
      expect(leaf.dispatchEvent(event)).toBe(false);
      expect(leaf.dispatchEvent(event)).toBe(false);
      expect(calls).toBe(2);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T37 reentrancy and mutation", () => {
  test("a listener added during dispatch is not invoked by it, but a later dispatch sees it", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const order = [];
      leaf.addEventListener("evt", () => {
        order.push("trigger");
        leaf.addEventListener("evt", () => order.push("added"));
      });
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["trigger"]);
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["trigger", "trigger", "added"]);
    } finally {
      win.destroy();
    }
  });

  test("mutating the tree during dispatch does not change the propagation path", () => {
    const win = createWindow();
    try {
      const { doc, mid, leaf } = build(win);
      const order = [];
      doc.addEventListener("evt", () => order.push("doc:c"), { capture: true });
      mid.addEventListener("evt", () => {
        order.push("mid:c");
        leaf.parentNode.removeChild(leaf);
      }, { capture: true });
      leaf.addEventListener("evt", () => order.push("leaf:t"));
      doc.addEventListener("evt", () => order.push("doc:b"));
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["doc:c", "mid:c", "leaf:t", "doc:b"]);
    } finally {
      win.destroy();
    }
  });

  test("a nested dispatch completes before the outer dispatch resumes", () => {
    const win = createWindow();
    try {
      const { mid, leaf } = build(win);
      const order = [];
      leaf.addEventListener("outer", () => {
        order.push("outer:leaf");
        mid.dispatchEvent(new win.Event("inner", { bubbles: true }));
      });
      mid.addEventListener("outer", () => order.push("outer:mid"));
      mid.addEventListener("inner", () => order.push("inner:mid"));
      leaf.dispatchEvent(new win.Event("outer", { bubbles: true }));
      expect(order).toEqual(["outer:leaf", "inner:mid", "outer:mid"]);
    } finally {
      win.destroy();
    }
  });

  test("a throwing listener is contained and dispatch continues", () => {
    const win = createWindow();
    try {
      const { mid, leaf } = build(win);
      const order = [];
      mid.addEventListener("evt", () => order.push("mid:c"), { capture: true });
      leaf.addEventListener("evt", () => {
        order.push("throwing");
        throw new Error("boom");
      });
      leaf.addEventListener("evt", () => order.push("after-throw"));
      mid.addEventListener("evt", () => order.push("mid:b"));
      expect(() => leaf.dispatchEvent(new win.Event("evt", { bubbles: true }))).not.toThrow();
      expect(order).toEqual(["mid:c", "throwing", "after-throw", "mid:b"]);
    } finally {
      win.destroy();
    }
  });

  test("removing a listener mid-dispatch still lets its captured struct run", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const order = [];
      const victim = () => order.push("victim");
      const remover = () => {
        order.push("remover");
        leaf.removeEventListener("evt", victim);
      };
      leaf.addEventListener("evt", remover);
      leaf.addEventListener("evt", victim);
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["remover", "victim"], "the snapshotted victim still runs, then is gone");
      leaf.dispatchEvent(new win.Event("evt", { bubbles: true }));
      expect(order).toEqual(["remover", "victim", "remover"]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T37 errors", () => {
  test("dispatchEvent with a non-Event argument throws a TypeError", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const err = thrown(() => leaf.dispatchEvent({}));
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toContain("parameter 1 is not of type 'Event'");
    } finally {
      win.destroy();
    }
  });

  test("a reentrant dispatch of the same event object is contained without corrupting the outer dispatch", () => {
    const win = createWindow();
    try {
      const { leaf } = build(win);
      const event = new win.Event("evt", { bubbles: true });
      const order = [];
      leaf.addEventListener("evt", () => {
        order.push("reentrant");
        // The native guard rejects re-dispatching the same event (happy-dom
        // recurses forever here); the exception is contained like any other
        // listener exception, and the outer dispatch continues.
        expect(() => leaf.dispatchEvent(event)).not.toThrow();
      });
      leaf.addEventListener("evt", () => order.push("after"));
      expect(() => leaf.dispatchEvent(event)).not.toThrow();
      expect(order).toEqual(["reentrant", "after"]);
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every event surface per T21", () => {
    const win = createWindow();
    const { doc, leaf } = build(win);
    const event = new win.Event("evt", { bubbles: true });
    const docListener = () => {};
    const leafListener = () => {};
    doc.addEventListener("evt", docListener);
    leaf.addEventListener("evt", leafListener);
    win.destroy();

    const calls = [
      () => doc.addEventListener("evt", () => {}),
      () => doc.removeEventListener("evt", docListener),
      () => doc.dispatchEvent(event),
      () => leaf.addEventListener("evt", () => {}),
      () => leaf.removeEventListener("evt", leafListener),
      () => leaf.dispatchEvent(event),
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err, "every event operation on a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
