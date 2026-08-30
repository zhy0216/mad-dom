import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable, liveDocumentCount } from "../../index.js";
import { Window } from "../../js/facade/window.js";

// T41 MutationObserver integration tests.
//
// They drive the complete observer surface through the official package entry
// (index.js → js/entry.js → the facade MutationObserver reached via
// `window.MutationObserver`) and pin the acceptance criteria:
//
//   - observe/disconnect/takeRecords and the option validation — the happy-dom
//     baseline TypeError checks (no enabled type, attributeOldValue /
//     characterDataOldValue / attributeFilter guards) and the auto-enabling
//     behavior;
//   - record contents — childList add/remove records (the removed record
//     carries the previous/next siblings), attributes records (oldValue always
//     populated, attributeFilter selection), characterData records;
//   - subtree observations receive records of descendant mutations while a
//     non-subtree observer does not;
//   - batching and ordering — records accumulated in the same task are
//     delivered in one callback in mutation order, per (observer, target)
//     listener (two observed targets deliver two callbacks), and the
//     observer callback's second argument is the very object the caller
//     constructed;
//   - takeRecords suppresses the queued delivery, a later mutation delivers
//     again; disconnect stops delivery; re-observing a target replaces its
//     options (spec behavior);
//   - callback exceptions are contained per listener: one throwing observer
//     never prevents another observer's delivery;
//   - lifecycle — no observer keeps records or callbacks alive after the
//     observer is collected, and a destroyed document fails the observer
//     surface per T21.
//
// Node references inside records are read synchronously inside the callback
// (the normal MutationObserver usage), avoiding the documented T20 transient
// wrapper gap that appears when a node wrapper is re-minted after GC.
//
// The structural block needs no native artifact; the runtime block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

const nativeAvailable = isNativeAvailable();

// Drains the microtask queue so queued observer deliveries fire.
async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

// Runs a synchronous GC and drains one macrotask so napi finalizers fire.
async function collectGarbage() {
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function recordShape(record) {
  return {
    type: record.type,
    targetType: record.target.nodeType,
    targetName: record.target.nodeName,
    added: record.addedNodes.map((node) => node.nodeType),
    removed: record.removedNodes.map((node) => node.nodeType),
    prev: record.previousSibling === null ? null : record.previousSibling.nodeType,
    next: record.nextSibling === null ? null : record.nextSibling.nodeType,
    attributeName: record.attributeName,
    attributeNamespace: record.attributeNamespace,
    oldValue: record.oldValue,
  };
}

function build(window) {
  const parent = window.document.createElement("parent");
  const a = window.document.createElement("a");
  const b = window.document.createElement("b");
  parent.appendChild(a);
  parent.appendChild(b);
  window.document.body.appendChild(parent);
  return { doc: window.document, parent, a, b };
}

describe("T41 MutationObserver surface shape", () => {
  test("the facade installs MutationObserver on the window with frozen descriptors", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Window.prototype, "MutationObserver");
    expect(typeof descriptor?.get).toBe("function");

    const win = createWindow();
    try {
      const MO = win.MutationObserver;
      expect(typeof MO).toBe("function");
      for (const name of ["observe", "disconnect", "takeRecords"]) {
        const protoDescriptor = Object.getOwnPropertyDescriptor(MO.prototype, name);
        expect(protoDescriptor, `MutationObserver.${name}`).toBeDefined();
        expect(typeof protoDescriptor.value, `MutationObserver.${name}`).toBe("function");
        expect(protoDescriptor.enumerable).toBe(false);
        expect(protoDescriptor.configurable).toBe(false);
        expect(protoDescriptor.writable).toBe(false);
      }
    } finally {
      win.destroy();
    }
  });

  test("the callback's second argument is the very observer the caller constructed", async () => {
    if (!nativeAvailable) return;
    const win = createWindow();
    try {
      const { parent } = build(win);
      let identity = false;
      const observer = new win.MutationObserver((_records, observed) => {
        identity = observed === observer;
      });
      observer.observe(parent, { childList: true });
      parent.appendChild(win.document.createElement("x"));
      await flush();
      expect(identity).toBe(true);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T41 option validation", () => {
  test("observe requires a genuine Node target", () => {
    const win = createWindow();
    try {
      const { parent } = build(win);
      const observer = new win.MutationObserver(() => {});
      expect(() => observer.observe(null, { childList: true })).toThrow(
        "The first parameter \"target\" should be of type \"Node\".",
      );
      expect(() => observer.observe({}, { childList: true })).toThrow(TypeError);
      void parent;
    } finally {
      win.destroy();
    }
  });

  test("at least one of childList / attributes / characterData must be enabled", () => {
    const win = createWindow();
    try {
      const { parent } = build(win);
      const observer = new win.MutationObserver(() => {});
      expect(() => observer.observe(parent, {})).toThrow(
        "The options object must set at least one of 'attributes', 'characterData', or 'childList' to true.",
      );
      expect(() => observer.observe(parent)).toThrow(
        "The options object must set at least one of 'attributes', 'characterData', or 'childList' to true.",
      );
      // A single flag is valid.
      expect(() => observer.observe(parent, { childList: true })).not.toThrow();
      expect(() => observer.observe(parent, { attributes: false, characterData: false })).toThrow(TypeError);
    } finally {
      win.destroy();
    }
  });

  test("attributeOldValue / attributeFilter require attributes not be false", () => {
    const win = createWindow();
    try {
      const { parent } = build(win);
      const observer = new win.MutationObserver(() => {});
      expect(() => observer.observe(parent, { attributeOldValue: true, attributes: false })).toThrow(
        "The options object may only set 'attributeOldValue' to true when 'attributes' is true or not present.",
      );
      expect(() => observer.observe(parent, { attributeFilter: ["id"], attributes: false })).toThrow(
        "The options object may only set 'attributeFilter' when 'attributes' is true or not present.",
      );
      // Without `attributes`, the oldValue / filter flags auto-enable it.
      expect(() => observer.observe(parent, { attributeOldValue: true })).not.toThrow();
      expect(() => observer.observe(parent, { attributeFilter: ["id"] })).not.toThrow();
    } finally {
      win.destroy();
    }
  });

  test("characterDataOldValue requires characterData not be false", () => {
    const win = createWindow();
    try {
      const { parent } = build(win);
      const observer = new win.MutationObserver(() => {});
      expect(() => observer.observe(parent, { characterDataOldValue: true, characterData: false })).toThrow(
        "The options object may only set 'characterDataOldValue' to true when 'characterData' is true or not present.",
      );
      expect(() => observer.observe(parent, { characterDataOldValue: true })).not.toThrow();
    } finally {
      win.destroy();
    }
  });

  test("a non-function callback throws at construction", () => {
    const win = createWindow();
    try {
      const MO = win.MutationObserver;
      expect(() => new MO(42)).toThrow("parameter 1 is not of type 'Function'");
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T41 childList records", () => {
  test("append and remove queue childList records with the baseline sibling fields", async () => {
    const win = createWindow();
    try {
      const { doc, parent, a, b } = build(win);
      const order = [];
      const observer = new win.MutationObserver((records) => order.push(records.map(recordShape)));
      observer.observe(parent, { childList: true });

      const text = doc.createTextNode("t");
      parent.appendChild(text); // parent = [a, b, text]
      parent.removeChild(a); // parent = [b, text]

      await flush();
      expect(order).toEqual([
        [
          {
            type: "childList",
            targetType: 1,
            targetName: "parent",
            added: [3],
            removed: [],
            prev: null,
            next: null,
            attributeName: null,
            attributeNamespace: null,
            oldValue: null,
          },
          {
            type: "childList",
            targetType: 1,
            targetName: "parent",
            added: [],
            removed: [1],
            prev: null,
            next: 1,
            attributeName: null,
            attributeNamespace: null,
            oldValue: null,
          },
        ],
      ]);
      void b;
    } finally {
      win.destroy();
    }
  });

  test("a move reports a removal on the old parent and an addition on the new one", async () => {
    const win = createWindow();
    try {
      const { doc, parent, a } = build(win);
      const other = doc.createElement("other");
      doc.body.appendChild(other);
      const order = [];
      const onParent = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.target.nodeName, r.removedNodes.length, r.addedNodes.length])),
      );
      const onOther = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.target.nodeName, r.removedNodes.length, r.addedNodes.length])),
      );
      onParent.observe(parent, { childList: true });
      onOther.observe(other, { childList: true });

      other.appendChild(a); // move a out of parent into other
      await flush();
      expect(order).toEqual([[["parent", 1, 0]], [["other", 0, 1]]]);
    } finally {
      win.destroy();
    }
  });

  test("replaceChild reports the addition before the removal (baseline order)", async () => {
    const win = createWindow();
    try {
      const { doc, parent, a, b } = build(win);
      const order = [];
      const observer = new win.MutationObserver((records) => order.push(records.map(recordShape)));
      observer.observe(parent, { childList: true });

      const replacement = doc.createElement("replacement");
      parent.replaceChild(replacement, a); // parent = [replacement, b]
      await flush();
      expect(order[0].map((r) => [r.type, r.added.length, r.removed.length])).toEqual([
        ["childList", 1, 0],
        ["childList", 0, 1],
      ]);
      expect(order[0][0].added[0]).toBe(1);
      expect(order[0][1].removed[0]).toBe(1);
      expect(order[0][1].prev).toBe(1);
      expect(order[0][1].next).toBe(1);
      void b;
    } finally {
      win.destroy();
    }
  });

  test("a DocumentFragment insertion records one addition per child", async () => {
    const win = createWindow();
    try {
      const { doc, parent } = build(win);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.addedNodes.length, r.target.nodeName])),
      );
      observer.observe(parent, { childList: true });

      const fragment = doc.createDocumentFragment();
      fragment.appendChild(doc.createElement("f1"));
      fragment.appendChild(doc.createElement("f2"));
      parent.appendChild(fragment);
      await flush();
      expect(order).toEqual([
        [
          [1, "parent"],
          [1, "parent"],
        ],
      ]);
    } finally {
      win.destroy();
    }
  });

  test("subtree observations receive records of descendant mutations", async () => {
    const win = createWindow();
    try {
      const { doc, parent, a } = build(win);
      const order = [];
      const subtree = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.target.nodeName, r.addedNodes.length])),
      );
      const direct = new win.MutationObserver(() => order.push(["direct-fired"]));
      subtree.observe(parent, { childList: true, subtree: true });
      direct.observe(parent, { childList: true, subtree: false });

      a.appendChild(doc.createElement("deep"));
      await flush();
      expect(order).toEqual([[["a", 1]]]);
    } finally {
      win.destroy();
    }
  });

  test("textContent on an observed element records the removals and the addition", async () => {
    const win = createWindow();
    try {
      const { doc, parent } = build(win);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.removedNodes.length, r.addedNodes.length])),
      );
      observer.observe(parent, { childList: true });

      parent.textContent = "replaced";
      await flush();
      expect(order[0].length).toBe(3); // two removals (a, b) then one addition (text node)
      expect(order[0]).toEqual([
        [1, 0],
        [1, 0],
        [0, 1],
      ]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T41 attributes and characterData records", () => {
  test("setAttribute and removeAttribute record the attribute with its old value", async () => {
    const win = createWindow();
    try {
      const { parent } = build(win);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.type, r.attributeName, r.attributeNamespace, r.oldValue])),
      );
      observer.observe(parent, { attributes: true });

      parent.setAttribute("id", "x");
      parent.setAttribute("id", "y");
      parent.setAttribute("id", "y"); // same value still records (baseline)
      parent.removeAttribute("id");
      await flush();
      expect(order).toEqual([
        [
          ["attributes", "id", null, null],
          ["attributes", "id", null, "x"],
          ["attributes", "id", null, "y"],
          ["attributes", "id", null, "y"],
        ],
      ]);
    } finally {
      win.destroy();
    }
  });

  test("attributeFilter selects only the listed attributes", async () => {
    const win = createWindow();
    try {
      const { parent } = build(win);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.attributeName, r.oldValue])),
      );
      observer.observe(parent, { attributes: true, attributeFilter: ["class"] });

      parent.setAttribute("id", "z"); // filtered out
      parent.setAttribute("class", "c1");
      await flush();
      expect(order).toEqual([[["class", null]]]);
    } finally {
      win.destroy();
    }
  });

  test("characterData writes record the old data", async () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      const text = doc.createTextNode("hi");
      doc.body.appendChild(text);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.type, r.oldValue])),
      );
      observer.observe(text, { characterData: true });

      text.data = "hello";
      text.appendData(" world");
      await flush();
      expect(order).toEqual([
        [
          ["characterData", "hi"],
          ["characterData", "hello"],
        ],
      ]);
    } finally {
      win.destroy();
    }
  });

  test("splitText records the childList addition before the characterData change", async () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      const parent = doc.createElement("p");
      const text = doc.createTextNode("hello");
      parent.appendChild(text);
      doc.body.appendChild(parent);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(records.map((r) => [r.type, r.addedNodes.length, r.oldValue])),
      );
      observer.observe(parent, { childList: true, subtree: true, characterData: true });

      text.splitText(2);
      await flush();
      expect(order).toEqual([
        [
          ["childList", 1, null],
          ["characterData", 0, "hello"],
        ],
      ]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T41 batching, ordering and microtask delivery", () => {
  test("records from the same task batch into one callback in mutation order", async () => {
    const win = createWindow();
    try {
      const { doc, parent } = build(win);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(records.map((r) => r.type)),
      );
      observer.observe(parent, { childList: true });

      parent.appendChild(doc.createElement("x"));
      parent.appendChild(doc.createElement("y"));
      parent.removeChild(parent.firstChild);
      await flush();
      expect(order).toEqual([["childList", "childList", "childList"]]);
    } finally {
      win.destroy();
    }
  });

  test("two observed targets are delivered by two separate callbacks (per-listener batching)", async () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      const t1 = doc.createElement("t1");
      const t2 = doc.createElement("t2");
      doc.body.appendChild(t1);
      doc.body.appendChild(t2);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(`${records[0].target.nodeName}:${records.length}`),
      );
      observer.observe(t1, { childList: true });
      observer.observe(t2, { childList: true });

      t1.appendChild(doc.createElement("c1"));
      t2.appendChild(doc.createElement("c2"));
      await flush();
      expect(order).toEqual(["t1:1", "t2:1"]);
    } finally {
      win.destroy();
    }
  });

  test("takeRecords suppresses the queued delivery; a later mutation delivers again", async () => {
    const win = createWindow();
    try {
      const { doc, parent } = build(win);
      const calls = [];
      const observer = new win.MutationObserver((records) => calls.push(records.length));
      observer.observe(parent, { childList: true });

      parent.appendChild(doc.createElement("x"));
      const taken = observer.takeRecords();
      expect(taken.length).toBe(1);
      expect(taken[0].type).toBe("childList");
      expect(taken[0].addedNodes.length).toBe(1);

      await flush();
      expect(calls).toEqual([]);

      parent.appendChild(doc.createElement("y"));
      await flush();
      expect(calls).toEqual([1]);
    } finally {
      win.destroy();
    }
  });

  test("disconnect stops delivery for later mutations", async () => {
    const win = createWindow();
    try {
      const { doc, parent } = build(win);
      const calls = [];
      const observer = new win.MutationObserver(() => calls.push(1));
      observer.observe(parent, { childList: true });
      observer.disconnect();

      parent.appendChild(doc.createElement("x"));
      await flush();
      expect(calls).toEqual([]);
    } finally {
      win.destroy();
    }
  });

  test("a throwing observer callback is contained: other observers still deliver", async () => {
    const win = createWindow();
    try {
      const { doc, parent } = build(win);
      const calls = [];
      const healthyCalls = [];
      let throwCalls = 0;
      // A throwing callback must not prevent the healthy observer's delivery
      // (each (observer, target) listener runs its own microtask), and the
      // throwing observer itself must keep functioning on later batches (its
      // queue was drained before the callback ran, so nothing is lost).
      const throwing = new win.MutationObserver(() => {
        throwCalls += 1;
        throw new Error("observer boom");
      });
      const healthy = new win.MutationObserver((records) => {
        healthyCalls.push(records.length);
      });
      throwing.observe(parent, { childList: true });
      healthy.observe(parent, { childList: true });

      parent.appendChild(doc.createElement("x"));
      await flush();
      expect(healthyCalls).toEqual([1]);

      parent.appendChild(doc.createElement("y"));
      await flush();
      expect(healthyCalls).toEqual([1, 1]);
      expect(throwCalls).toBe(2);
      expect(calls).toEqual([]);
    } finally {
      win.destroy();
    }
  });

  test("re-observing the same target replaces its options (spec behavior)", async () => {
    const win = createWindow();
    try {
      const { doc, parent } = build(win);
      const order = [];
      const observer = new win.MutationObserver((records) =>
        order.push(records.map((r) => r.type)),
      );
      observer.observe(parent, { childList: true });
      observer.observe(parent, { attributes: true });

      parent.appendChild(doc.createElement("x")); // no longer observed (childList replaced)
      parent.setAttribute("id", "z");
      await flush();
      expect(order).toEqual([["attributes"]]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T41 lifecycle and errors", () => {
  test("a destroyed document fails the observer surface per T21", () => {
    const win = createWindow();
    const { parent } = build(win);
    const observer = new win.MutationObserver(() => {});
    observer.observe(parent, { childList: true });
    win.destroy();

    const thrown = (fn) => {
      try {
        fn();
        return undefined;
      } catch (error) {
        return error;
      }
    };
    expect(thrown(() => observer.observe(parent, { childList: true })).code).toBe(
      "ERR_MAD_DOM_DOCUMENT_DESTROYED",
    );
    expect(thrown(() => observer.disconnect()).code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    expect(thrown(() => observer.takeRecords()).code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });

  test("observing a node of another window's document fails per T21", () => {
    const win = createWindow();
    const foreign = createWindow();
    try {
      const { parent } = build(win);
      const foreignParent = foreign.document.createElement("other");
      const observer = new win.MutationObserver(() => {});
      observer.observe(parent, { childList: true });
      const err = (() => {
        try {
          observer.observe(foreignParent, { childList: true });
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    } finally {
      win.destroy();
      foreign.destroy();
    }
  });

  test("an observer and its records are collectable: no document leak and no dangling delivery", async () => {
    // The observer handle holds a strong reference to its document (the T20
    // ownership chain), so a collected observer must release that reference and
    // its callback; the Core records it queued are dropped with the document,
    // so nothing survives. Frame isolation mirrors gc.test.js so no register /
    // spill copy of the wrappers outlives the helper frames.
    await collectGarbage();
    const before = liveDocumentCount();

    let delivered = null;
    let win;
    const spawn = () => {
      win = createWindow();
      const parent = win.document.createElement("parent");
      win.document.body.appendChild(parent);
      const observer = new win.MutationObserver((records) => {
        delivered = records.length;
      });
      observer.observe(parent, { childList: true });
      parent.appendChild(win.document.createElement("x"));
    };
    spawn();
    await flush();
    expect(delivered).toBe(1);
    win.destroy();
    win = null;

    await collectGarbage();
    expect(liveDocumentCount()).toBe(before);

    // A later mutation on a fresh window is unaffected (no dangling observer
    // state leaks into the next document).
    const freshWin = createWindow();
    try {
      const { parent } = build(freshWin);
      const calls = [];
      const observer = new freshWin.MutationObserver((records) => calls.push(records.length));
      observer.observe(parent, { childList: true });
      parent.appendChild(freshWin.document.createElement("y"));
      await flush();
      expect(calls).toEqual([1]);
    } finally {
      freshWin.destroy();
    }
  });
});
