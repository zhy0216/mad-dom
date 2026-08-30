import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createWindow, Window } from "../../js/facade/window.js";
import { Document } from "../../js/facade/document.js";
import { Node, seam as nodeSeam } from "../../js/facade/extensions/node.js";
import { installExtensions, seam as registrySeam } from "../../js/facade/extensions/index.js";
import { isNativeAvailable } from "../../index.js";

// T23B JavaScript node creation and navigation facade tests.
//
// They implement the frozen native node contract
// (tests/bun/fixtures/native-node-contract.json, T23A) as JavaScript facade
// surface in js/facade/extensions/node.js and pin the acceptance criteria:
//
//   - Bun can create detached Element/Text through document.createElement /
//     document.createTextNode and stably read nodeType, nodeName and every
//     navigation relation (all null while detached);
//   - repeated facade reads of the same native node satisfy strict identity,
//     because every node-producing read funnels through the unique conversion
//     entry (ctx.wrap) which mirrors the native per-document weak wrapper
//     cache (T20);
//   - construction is restricted to genuine native Node handles; prototype
//     chain, property descriptors and export shapes are pinned;
//   - exceptions and the type fixture (tests/bun/fixtures/facade-node.contract.json)
//     carry the frozen evidence (ERR_MAD_DOM_INVALID_CHARACTER on bad element
//     names, ERR_MAD_DOM_DOCUMENT_DESTROYED after destroy);
//   - the module is picked up by the facade registry purely by exporting
//     install(ctx) — no registry or entry change is needed.
//
// Like the other native suites, the native-dependent block loads the locally
// built artifact (build/mad-dom.node) and skips without one, so a clean
// checkout still passes `npm run validate`. The structural block needs no
// native. Tree relations are built with the native DocumentHandle.appendChild
// because facade mutation (T24C) is out of scope; the facade is exercised
// exclusively through its own surface.

const CONTRACT_PATH = fileURLToPath(
  new URL("./fixtures/facade-node.contract.json", import.meta.url),
);
const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));

const nativeAvailable = isNativeAvailable();

function loadNative() {
  const explicit = process.env.MAD_DOM_NATIVE_PATH;
  const path =
    (explicit && (isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit))) ||
    fileURLToPath(new URL("../../build/mad-dom.node", import.meta.url));
  return createRequire(import.meta.url)(path);
}

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

// Lazy native-module access: `describe.skipIf` still evaluates its callback at
// registration time, so an eager loadNative() here would throw on a checkout
// without the dev artifact even though the suite is meant to skip.
let nativeModule = null;
function native() {
  nativeModule ??= loadNative();
  return nativeModule;
}

describe("facade node contract fixture (T23B)", () => {
  test("the facade node contract fixture is structurally complete", () => {
    expect(contract.schema).toBe("mad-dom/facade-node-contract/1");
    expect(contract.owner).toBe("T23B");
    expect(contract.gate).toBe("T23");
    expect(contract.status).toBe("frozen");
    expect(contract.base).toBe("native-node-contract.json");

    const creation = contract.creation.Document;
    expect(creation).toHaveProperty("createElement");
    expect(creation).toHaveProperty("createTextNode");

    const members = contract.classes.Node.members;
    for (const name of [
      "nodeType",
      "nodeName",
      "parentNode",
      "firstChild",
      "lastChild",
      "previousSibling",
      "nextSibling",
      "childNodes",
    ]) {
      expect(members, `${name} must be a frozen member`).toHaveProperty(name);
      expect(members[name].kind).toBe("accessor");
    }

    expect(contract.classes.Node.prototypeOf).toBe("Object");
    expect(contract.conversionEntry).toHaveProperty(["ctx.wrap"]);
    expect(contract.identity.rule).toContain("ctx.wrap");
    expect(contract.errors.invalidCharacter.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
    expect(contract.errors.destroyed.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });
});

describe("facade node export shapes (T23B)", () => {
  test("node.js exports exactly Node, install and the frozen seam", async () => {
    const mod = await import("../../js/facade/extensions/node.js");
    expect(Object.keys(mod).sort()).toEqual(["Node", "install", "seam"]);
    expect(nodeSeam.owner).toBe("T23B");
    expect(nodeSeam.gate).toBe("T23");
    expect(Object.isFrozen(nodeSeam)).toBe(true);
  });

  test("node.js seam is flipped to implemented by the T23 gate", () => {
    expect(nodeSeam.status).toBe("implemented");
  });
});

describe("facade node prototype chains (T23B)", () => {
  test("Node sits one level under Object.prototype", () => {
    expect(Object.getPrototypeOf(Node.prototype)).toBe(Object.prototype);
  });

  test("no own enumerable surface leaks on the Node prototype", () => {
    expect(Object.keys(Node.prototype)).toEqual([]);
  });
});

describe("facade node property descriptors (T23B)", () => {
  test("Document creation methods are fixed method descriptors", () => {
    for (const name of ["createElement", "createTextNode"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
      expect(descriptor, `${name} must be defined`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.writable).toBe(false);
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });

  test("Node navigation properties are non-enumerable accessors without setters", () => {
    for (const name of [
      "nodeType",
      "nodeName",
      "parentNode",
      "firstChild",
      "lastChild",
      "previousSibling",
      "nextSibling",
      "childNodes",
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be defined`).toBeDefined();
      expect(typeof descriptor.get).toBe("function");
      expect(descriptor.set).toBeUndefined();
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });
});

describe("facade node construction restrictions (T23B)", () => {
  test("Node cannot be constructed from nothing or from a non-node handle", () => {
    expect(() => new Node()).toThrow(TypeError);
    expect(() => new Node(null)).toThrow(TypeError);
    expect(() => new Node(undefined)).toThrow(TypeError);
    expect(() => new Node({})).toThrow(TypeError);
    expect(thrown(() => new Node()).message).toContain("genuine native Node handle");
  });

  test("a genuine native NodeHandle constructs a Node; other handles are rejected", () => {
    if (!nativeAvailable) return;
    const nativeDocument = native().createDocument();
    try {
      const handle = nativeDocument.createElement("div");
      const node = new Node(handle);
      expect(node).toBeInstanceOf(Node);
      expect(Object.getPrototypeOf(node)).toBe(Node.prototype);
      expect(node.nodeName).toBe("div");

      // A DocumentHandle must not construct a Node.
      expect(() => new Node(nativeDocument)).toThrow(TypeError);
    } finally {
      nativeDocument.destroy();
    }
  });
});

describe("facade registry drives the node extension (T23B)", () => {
  test("installExtensions calls node.js install once with the ctx helpers", () => {
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
    expect(() => installExtensions(mockCtx)).not.toThrow();

    // The node extension's own calls remain exactly the frozen surface. T24C
    // now also contributes mutation methods through the same registry, so
    // select the T23-owned entries before asserting their shape.
    const nodeCalls = calls.filter(([kind, target, name]) =>
      (kind === "registerHandleType" && target === "NodeHandle") ||
      (kind === "method" && target === Document.prototype &&
        (name === "createElement" || name === "createTextNode")) ||
      (kind === "accessor" && target === Node.prototype &&
        [
          "nodeType",
          "nodeName",
          "parentNode",
          "firstChild",
          "lastChild",
          "previousSibling",
          "nextSibling",
          "childNodes",
        ].includes(name)),
    );
    expect(nodeCalls).toEqual([
      ["registerHandleType", "NodeHandle", expect.any(Function)],
      ["method", Document.prototype, "createElement", expect.any(Function)],
      ["method", Document.prototype, "createTextNode", expect.any(Function)],
      ["accessor", Node.prototype, "nodeType", expect.any(Function), undefined],
      ["accessor", Node.prototype, "nodeName", expect.any(Function), undefined],
      ["accessor", Node.prototype, "parentNode", expect.any(Function), undefined],
      ["accessor", Node.prototype, "firstChild", expect.any(Function), undefined],
      ["accessor", Node.prototype, "lastChild", expect.any(Function), undefined],
      ["accessor", Node.prototype, "previousSibling", expect.any(Function), undefined],
      ["accessor", Node.prototype, "nextSibling", expect.any(Function), undefined],
      ["accessor", Node.prototype, "childNodes", expect.any(Function), undefined],
    ]);
  });

  test("the registry seam shape is unchanged", () => {
    expect(registrySeam.owner).toBe("T22B");
    expect(registrySeam.status).toBe("implemented");
  });
});

describe.skipIf(!nativeAvailable)("facade node creation and navigation (T23B)", () => {

  test("createElement / createTextNode mint detached Element and Text through the facade", () => {
    const win = createWindow();
    const doc = win.document;
    const div = doc.createElement("div");
    const text = doc.createTextNode("hello");

    expect(div).toBeInstanceOf(Node);
    expect(div.nodeType).toBe(1);
    expect(div.nodeName).toBe("div");

    expect(text).toBeInstanceOf(Node);
    expect(text.nodeType).toBe(3);
    expect(text.nodeName).toBe("#text");

    // Detached: no parent, no children, no siblings.
    for (const node of [div, text]) {
      expect(node.parentNode).toBeNull();
      expect(node.firstChild).toBeNull();
      expect(node.lastChild).toBeNull();
      expect(node.previousSibling).toBeNull();
      expect(node.nextSibling).toBeNull();
      expect(node.childNodes).toHaveLength(0);
    }

    win.destroy();
  });

  test("each facade create call mints a distinct node", () => {
    const win = createWindow();
    const doc = win.document;
    const a = doc.createElement("div");
    const b = doc.createElement("div");
    const textA = doc.createTextNode("x");
    const textB = doc.createTextNode("x");
    expect(a).not.toBe(b);
    expect(textA).not.toBe(textB);
    expect(textA.nodeName).toBe(textB.nodeName);
    expect(doc.createElement("span")).not.toBe(doc.createElement("span"));
    win.destroy();
  });

  test("facade creates route through the unique conversion entry with stable window/document identity", () => {
    const win = createWindow();
    const doc = win.document;
    expect(win.document).toBe(doc);
    expect(doc.createElement("div")).toBeInstanceOf(Node);
    expect(win.document).toBe(doc);
    win.destroy();
  });

  test("invalid element names throw the frozen error through the facade", () => {
    const win = createWindow();
    const doc = win.document;
    const err = thrown(() => doc.createElement("1div"));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
    expect(err.message).toContain("InvalidCharacterError");
    win.destroy();
  });

  test("navigation returns stable facade wrapper identity on repeated reads", () => {
    // Build the tree at the native level (facade mutation is T24C's scope);
    // exercise every read through the facade. The root is wrapped directly
    // from its genuine native handle; every node reached through navigation
    // is produced by ctx.wrap, so repeated reads are strictly identical.
    const nativeWindow = native().createWindow();
    const nativeDocument = nativeWindow.document();
    const win = new Window(nativeWindow);
    const doc = win.document;

    const ulHandle = nativeDocument.createElement("ul");
    const aHandle = nativeDocument.createElement("li");
    const bHandle = nativeDocument.createElement("li");
    const labelHandle = nativeDocument.createText("first");
    nativeDocument.appendChild(ulHandle, aHandle);
    nativeDocument.appendChild(ulHandle, bHandle);
    nativeDocument.appendChild(aHandle, labelHandle);

    const ul = new Node(ulHandle);
    const a = ul.firstChild;
    const b = a.nextSibling;
    const label = a.firstChild;

    expect(a).toBeInstanceOf(Node);
    expect(ul.firstChild).toBe(a);
    expect(ul.firstChild).toBe(ul.firstChild);
    expect(ul.lastChild).toBe(b);
    expect(ul.lastChild).toBe(ul.lastChild);
    expect(a.nextSibling).toBe(b);
    expect(b.previousSibling).toBe(a);
    expect(a.parentNode).toBe(a.parentNode);
    expect(a.parentNode.nodeName).toBe("ul");
    expect(label.parentNode).toBe(a);
    expect(label.previousSibling).toBeNull();
    expect(label.nextSibling).toBeNull();

    // childNodes hands back the T25D live NodeList with the stable wrappers,
    // in order, on every read; one and the same collection object per parent.
    const kids = ul.childNodes;
    expect(kids).toHaveLength(2);
    expect(kids[0]).toBe(a);
    expect(kids[1]).toBe(b);
    expect(ul.childNodes).toBe(kids);
    expect(ul.childNodes[0]).toBe(a);
    expect(ul.childNodes[1]).toBe(b);

    // Empty relations.
    expect(b.firstChild).toBeNull();
    expect(b.lastChild).toBeNull();
    expect(b.childNodes).toHaveLength(0);

    win.destroy();
  });

  test("after facade destroy every creation and navigation read fails per T21", () => {
    const nativeWindow = native().createWindow();
    const nativeDocument = nativeWindow.document();
    const win = new Window(nativeWindow);
    const doc = win.document;
    const div = doc.createElement("div");
    const text = doc.createTextNode("x");

    win.destroy();

    const calls = [
      () => doc.createElement("span"),
      () => doc.createTextNode("y"),
      () => div.nodeType,
      () => div.nodeName,
      () => div.parentNode,
      () => div.firstChild,
      () => div.lastChild,
      () => div.previousSibling,
      () => div.nextSibling,
      // The live childNodes accessor hands back the NodeList object without a
      // native read (T25D); every *collection* read re-enters Core and fails.
      () => div.childNodes.length,
      () => text.nodeName,
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err, "every read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
    expect(thrown(() => div.nodeName).message).toBe(
      "[ERR_MAD_DOM_DOCUMENT_DESTROYED] the document has been destroyed",
    );
  });
});
