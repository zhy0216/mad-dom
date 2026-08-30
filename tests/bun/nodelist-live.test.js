import { describe, expect, test } from "bun:test";
import {
  createDocument,
  isNativeAvailable,
  liveDocumentCount,
} from "../../index.js";
import { Node } from "../../js/facade/extensions/node.js";
import {
  NodeList,
  install as installNodeList,
  liveChildNodes,
  seam,
} from "../../js/facade/extensions/child-nodelist.js";

// T25D live childNodes / NodeList facade tests.
//
// They pin the acceptance criteria of the live collection module:
//
//   - an existing NodeList reflects append/insert/move/remove/replace
//     immediately, in Core document order, because every access re-reads the
//     frozen native `NodeHandle.childNodes()` read (T23A) instead of caching a
//     second tree state;
//   - the collection keeps no second authoritative DOM state and never touches
//     a NodeId directly — it holds the parent's opaque native handle and
//     delegates every read to Core, so a destroyed document fails per T21 and
//     no stale id is ever dereferenced;
//   - live length, index access (list[0]), item(), iteration (for...of,
//     Array.from, forEach, entries, keys, values) and wrapper identity (one
//     NodeList per parent, stable wrapped elements through ctx.wrap) are
//     exercised end to end;
//   - empty collections and the GC lifecycle are covered: a live NodeList
//     keeps its document arena readable while alive and is collectable with it.
//
// Like the other native suites, the native-dependent block loads the locally
// built artifact (build/mad-dom.node) and skips without one, so a clean
// checkout still passes `npm run validate`. The structural block needs no
// native. The facade is wired through the public entry import below (which
// runs the registry exactly once); trees are built with the native
// DocumentHandle mutation surface because wiring `Node.prototype.childNodes`
// to return this live collection is the T25 gate's integration step — until
// then the T23B snapshot accessor is unchanged.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function namesOf(list) {
  return Array.from(list, (node) => node.nodeName);
}

function drainEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectGarbage() {
  Bun.gc(true);
  await drainEventLoop();
}

describe("live childNodes facade module shape (T25D)", () => {
  test("child-nodelist.js exports exactly the live collection surface", async () => {
    const mod = await import("../../js/facade/extensions/child-nodelist.js");
    expect(Object.keys(mod).sort()).toEqual(["NodeList", "install", "liveChildNodes", "seam"]);
  });

  test("the seam stays a placeholder until the T25 gate flips it", () => {
    expect(seam.owner).toBe("T25D");
    expect(seam.gate).toBe("T25");
    expect(seam.status).toBe("placeholder");
    expect(Object.isFrozen(seam)).toBe(true);
  });

  test("NodeList sits one level under Object.prototype with no enumerable surface", () => {
    expect(Object.getPrototypeOf(NodeList.prototype)).toBe(Object.prototype);
    expect(Object.keys(NodeList.prototype)).toEqual([]);
  });
});

describe("live NodeList construction restrictions (T25D)", () => {
  test("NodeList cannot be constructed from nothing or from a non-node handle", () => {
    expect(() => new NodeList()).toThrow(TypeError);
    expect(() => new NodeList(null)).toThrow(TypeError);
    expect(() => new NodeList(undefined)).toThrow(TypeError);
    expect(() => new NodeList({})).toThrow(TypeError);
    expect(thrown(() => new NodeList()).message).toContain("genuine native Node handle");
  });

  test("a DocumentHandle or an object without the node surface is rejected", () => {
    if (!nativeAvailable) return;
    const doc = createDocument();
    try {
      expect(() => new NodeList(doc)).toThrow(TypeError);
      expect(() => new NodeList({ nodeType() {}, nodeName() {} })).toThrow(TypeError);
    } finally {
      doc.destroy();
    }
  });
});

describe("live NodeList prototype surface (T25D)", () => {
  test("length is a fixed non-enumerable accessor without a setter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(NodeList.prototype, "length");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.get).toBe("function");
    expect(descriptor.set).toBeUndefined();
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });

  test("item, forEach, entries, keys, values and the iterator are fixed method descriptors", () => {
    for (const name of ["item", "forEach", "entries", "keys", "values", Symbol.iterator]) {
      const descriptor = Object.getOwnPropertyDescriptor(NodeList.prototype, name);
      expect(descriptor, `${String(name)} must be defined`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.writable).toBe(false);
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });

  test("install defines the surface through the sanctioned ctx helpers only", () => {
    const calls = [];
    const mockCtx = {
      wrap() {
        throw new Error("wrap must not fire during install");
      },
      defineMethod: (...args) => calls.push(["method", ...args]),
      defineAccessor: (...args) => calls.push(["accessor", ...args]),
      documentContext: Object.freeze({ handleOf: () => null }),
      registerHandleType: (...args) => calls.push(["registerHandleType", ...args]),
    };
    expect(() => installNodeList(mockCtx)).not.toThrow();
    expect(calls).toEqual([
      ["accessor", NodeList.prototype, "length", expect.any(Function), undefined],
      ["method", NodeList.prototype, "item", expect.any(Function)],
      ["method", NodeList.prototype, "forEach", expect.any(Function)],
      ["method", NodeList.prototype, "entries", expect.any(Function)],
      ["method", NodeList.prototype, "keys", expect.any(Function)],
      ["method", NodeList.prototype, "values", expect.any(Function)],
      ["method", NodeList.prototype, Symbol.iterator, expect.any(Function)],
    ]);
  });
});

describe.skipIf(!nativeAvailable)("live NodeList behaviour (T25D)", () => {
  test("length and iteration reflect append/insert/move/remove/replace immediately", () => {
    const doc = createDocument();
    const parent = doc.createElement("ul");
    const first = doc.createElement("first");
    const middle = doc.createElement("middle");
    const last = doc.createElement("last");
    const replacement = doc.createElement("replacement");

    doc.appendChild(parent, first);
    doc.appendChild(parent, last);
    const list = new NodeList(parent);
    expect(list.length).toBe(2);
    expect(namesOf(list)).toEqual(["first", "last"]);

    doc.insertBefore(parent, middle, last);
    expect(list.length).toBe(3);
    expect(namesOf(list)).toEqual(["first", "middle", "last"]);

    // Moving an existing child is an ordinary native mutation, not a facade
    // tree update — the collection still reflects it.
    doc.appendChild(parent, first);
    expect(list.length).toBe(3);
    expect(namesOf(list)).toEqual(["middle", "last", "first"]);

    doc.removeChild(parent, middle);
    expect(list.length).toBe(2);
    expect(namesOf(list)).toEqual(["last", "first"]);

    doc.replaceChild(parent, first, replacement);
    expect(list.length).toBe(2);
    expect(namesOf(list)).toEqual(["last", "replacement"]);
    doc.destroy();
  });

  test("indexed access and item() match Core document order and stay stable", () => {
    const doc = createDocument();
    const parent = doc.createElement("div");
    const a = doc.createElement("a");
    const text = doc.createText("text");
    doc.appendChild(parent, a);
    doc.appendChild(parent, text);
    const list = new NodeList(parent);

    expect(list[0]).toBeInstanceOf(Node);
    expect(list[0]).toBe(list[0]);
    expect(list[0]).toBe(list.item(0));
    expect(list[1]).toBe(list.item(1));
    expect(list[0]).not.toBe(list[1]);
    expect(list[0].nodeType).toBe(1);
    expect(list[1].nodeType).toBe(3);

    // Out-of-range: array-index reads are undefined, item() is null.
    expect(list[2]).toBeUndefined();
    expect(list.item(2)).toBeNull();
    expect(list[-1]).toBeUndefined();
    doc.destroy();
  });

  test("the iteration surface reflects the live children", () => {
    const doc = createDocument();
    const parent = doc.createElement("ul");
    const a = doc.createElement("li");
    const b = doc.createElement("li");
    const c = doc.createElement("li");
    doc.appendChild(parent, a);
    doc.appendChild(parent, b);
    const list = new NodeList(parent);

    expect(Array.from(list)).toHaveLength(2);

    const forOf = [];
    for (const node of list) forOf.push(node);
    expect(forOf).toHaveLength(2);
    expect(forOf[0]).toBe(list[0]);
    expect(forOf[1]).toBe(list[1]);

    const forEachSeen = [];
    const listArg = [];
    list.forEach((node, index, self) => {
      forEachSeen.push([index, node.nodeName]);
      listArg.push(self);
    });
    expect(forEachSeen).toEqual([
      [0, "li"],
      [1, "li"],
    ]);
    expect(listArg[0]).toBe(list);
    expect(listArg[1]).toBe(list);

    expect([...list.keys()]).toEqual([0, 1]);
    expect([...list.values()]).toEqual([list[0], list[1]]);
    expect([...list.entries()]).toEqual([
      [0, list[0]],
      [1, list[1]],
    ]);

    doc.appendChild(parent, c);
    expect(Array.from(list)).toHaveLength(3);
    doc.destroy();
  });

  test("a leaf parent has an empty live collection", () => {
    const doc = createDocument();
    const parent = doc.createElement("span");
    const list = new NodeList(parent);
    expect(list.length).toBe(0);
    expect(list[0]).toBeUndefined();
    expect(list.item(0)).toBeNull();
    expect(Array.from(list)).toEqual([]);
    doc.destroy();
  });

  test("one and the same live NodeList is handed back per parent", () => {
    const doc = createDocument();
    const parent = doc.createElement("div");
    doc.appendChild(parent, doc.createElement("span"));
    expect(liveChildNodes(parent)).toBeInstanceOf(NodeList);
    expect(liveChildNodes(parent)).toBe(liveChildNodes(parent));

    const other = doc.createElement("div");
    expect(liveChildNodes(parent)).not.toBe(liveChildNodes(other));
    doc.destroy();
  });

  test("a destroyed document fails every live collection read per T21", () => {
    const doc = createDocument();
    const parent = doc.createElement("div");
    const list = new NodeList(parent);
    doc.destroy();

    const reads = [
      () => list.length,
      () => list.item(0),
      () => list[0],
      () => Array.from(list),
      () => list.forEach(() => {}),
    ];
    for (const read of reads) {
      const err = thrown(read);
      expect(err, "every collection read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });

  test("a live NodeList keeps its document arena alive and stays collectable", async () => {
    // Settle lingering documents from earlier tests so the baseline is clean
    // and the deltas below are precise. Creation and reads run in their own
    // function frames (JSC scans the machine stack conservatively, so stale
    // register/spill copies must not outlive the helper frames).
    await collectGarbage();
    const before = liveDocumentCount();

    let survivor = null;
    const spawn = () => {
      const doc = createDocument();
      const parent = doc.createElement("ul");
      doc.appendChild(parent, doc.createElement("li"));
      survivor = new NodeList(parent);
      expect(survivor.length).toBe(1);
    };
    const probeLength = (list) => list.length;

    spawn();
    await collectGarbage();

    // The lone NodeList keeps the parent handle (and with it the document
    // arena) alive, and the collection stays fully readable.
    expect(liveDocumentCount()).toBe(before + 1);
    expect(probeLength(survivor)).toBe(1);

    survivor = null;
    await collectGarbage();
    expect(liveDocumentCount()).toBe(before);
  });
});
