import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createWindow, Window, seam as windowSeam } from "../../js/facade/window.js";
import { Document, seam as documentSeam } from "../../js/facade/document.js";
import { installExtensions, seam as registrySeam } from "../../js/facade/extensions/index.js";
import { isNativeAvailable, liveDocumentCount } from "../../index.js";

// T22B JavaScript Window/Document facade tests.
//
// They pin the facade contract against the frozen native contract
// (tests/bun/fixtures/native-window-document.contract.json, T22A):
//
//   - Bun can create a Window and read its Document; repeated reads obey T20
//     wrapper identity through the unique conversion entry (ctx.wrap);
//   - Window/Document construction is restricted to genuine native handles;
//     prototype chain, property descriptors and export shapes are pinned;
//   - lifecycle forwarding: Window.destroy / Document.destroy reach the native
//     handle, are idempotent, and a destroyed document keeps its facade
//     identity while every Core-touching operation fails with the frozen T21
//     error (ERR_MAD_DOM_DOCUMENT_DESTROYED);
//   - later facade subtasks only need to add or modify their own extension
//     file: the registry imports the extension modules and calls whatever
//     `install(ctx)` they export.
//
// The facade keeps no second DOM state: the fixture and every assertion below
// derive from native handles. Native-dependent tests load the locally built
// artifact (`npm run dev:build`, or MAD_DOM_NATIVE_PATH); like the T22A suite
// they skip without one so a clean checkout still passes `npm run validate`.
// The structural block (export shape, descriptors, fixture) needs no native.

const CONTRACT_PATH = fileURLToPath(
  new URL("./fixtures/facade-window-document.contract.json", import.meta.url),
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

// Lazy native-module access. `describe.skipIf` still evaluates its callback
// body at registration time, so an eager `loadNative()` here would throw on a
// checkout without the dev artifact even though the suite is meant to skip.
let nativeModule = null;
function native() {
  nativeModule ??= loadNative();
  return nativeModule;
}

describe("facade contract fixture (T22B)", () => {
  test("the facade contract fixture is structurally complete", () => {
    expect(contract.schema).toBe("mad-dom/facade-window-document-contract/1");
    expect(contract.owner).toBe("T22B");
    expect(contract.gate).toBe("T22");
    expect(contract.frozenFor).toEqual(["T23B", "T24C", "T25D", "T25E"]);
    expect(contract.base).toBe("native-window-document.contract.json");
    expect(contract.classes.Window.members).toHaveProperty("document");
    expect(contract.classes.Window.members).toHaveProperty("destroy");
    expect(contract.classes.Document.members).toHaveProperty("destroy");
    expect(contract.lifecycle.destroyedError.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });
});

describe("facade export shapes (T22B)", () => {
  test("window.js exports exactly createWindow, Window and the frozen seam", async () => {
    const mod = await import("../../js/facade/window.js");
    expect(Object.keys(mod).sort()).toEqual(["Window", "createWindow", "seam"]);
    expect(windowSeam.owner).toBe("T22B");
    expect(Object.isFrozen(windowSeam)).toBe(true);
  });

  test("document.js exports exactly Document and the frozen seam", async () => {
    const mod = await import("../../js/facade/document.js");
    expect(Object.keys(mod).sort()).toEqual(["Document", "seam"]);
    expect(documentSeam.owner).toBe("T22B");
    expect(Object.isFrozen(documentSeam)).toBe(true);
  });

  test("extensions/index.js exports exactly installExtensions and the frozen seam", async () => {
    const mod = await import("../../js/facade/extensions/index.js");
    expect(Object.keys(mod).sort()).toEqual(["installExtensions", "seam"]);
    expect(registrySeam.owner).toBe("T22B");
    expect(Object.isFrozen(registrySeam)).toBe(true);
  });
});

describe("facade prototype chains (T22B)", () => {
  test("Window and Document sit one level under Object.prototype", () => {
    expect(Object.getPrototypeOf(Window.prototype)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(Document.prototype)).toBe(Object.prototype);
  });

  test("no own enumerable surface leaks on classes, prototypes or instances", () => {
    expect(Object.keys(Window.prototype)).toEqual([]);
    expect(Object.keys(Document.prototype)).toEqual([]);
  });
});

describe("facade property descriptors (T22B)", () => {
  test("Window.document is a non-enumerable, non-configurable accessor without a setter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Window.prototype, "document");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.get).toBe("function");
    expect(descriptor.set).toBeUndefined();
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });

  test("Window.destroy is a fixed method descriptor", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Window.prototype, "destroy");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.value).toBe("function");
    expect(descriptor.writable).toBe(false);
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });

  test("Document.destroy is a fixed method descriptor", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "destroy");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.value).toBe("function");
    expect(descriptor.writable).toBe(false);
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });
});

describe("facade construction restrictions (T22B, updated by T48)", () => {
  test("Window is user-constructible like happy-dom: new Window() mints a fresh window", () => {
    if (!nativeAvailable) return;
    const before = liveDocumentCount();
    const win = new Window();
    expect(win).toBeInstanceOf(Window);
    expect(win.document).toBeInstanceOf(Document);
    expect(liveDocumentCount()).toBe(before + 1);
    win.destroy();
    expect(liveDocumentCount()).toBe(before);
  });

  test("new Window(options) mints a window and honors the url option", () => {
    if (!nativeAvailable) return;
    const win = new Window({ url: "https://mad-dom.test/x" });
    expect(win).toBeInstanceOf(Window);
    expect(win.location.href).toBe("https://mad-dom.test/x");
    expect(win.document.URL).toBe("https://mad-dom.test/x");
    win.destroy();
  });

  test("Window still throws for null, plain non-handle values and wrong native handles", () => {
    if (!nativeAvailable) {
      expect(() => new Window()).toThrow(TypeError);
      return;
    }
    const nativeWindow = native().createWindow();
    const nativeDocument = native().createDocument();
    try {
      expect(() => new Window(null)).toThrow(TypeError);
      expect(() => new Window("nope")).toThrow(TypeError);
      expect(() => new Window(nativeDocument)).toThrow(TypeError);
    } finally {
      nativeWindow.destroy();
      nativeDocument.destroy();
    }
  });

  test("Window can still be constructed from a genuine native window handle", () => {
    if (!nativeAvailable) return;
    const nativeWindow = native().createWindow();
    const win = new Window(nativeWindow);
    expect(win).toBeInstanceOf(Window);
    win.destroy();
  });

  test("Document cannot be constructed from nothing or from a non-document handle", () => {
    expect(() => new Document()).toThrow(TypeError);
    expect(() => new Document(null)).toThrow(TypeError);
    expect(() => new Document({})).toThrow(TypeError);
    expect(thrown(() => new Document()).message).toContain("genuine native Document handle");
  });

  test("a genuine native DocumentHandle cannot construct a Window and vice versa", () => {
    if (!nativeAvailable) return;
    const nativeDocument = native().createDocument();
    const nativeWindow = native().createWindow();
    try {
      expect(() => new Window(nativeDocument)).toThrow(TypeError);
      expect(() => new Document(nativeWindow)).toThrow(TypeError);
    } finally {
      nativeWindow.destroy();
      nativeDocument.destroy();
    }
  });
});

describe("facade registry (T22B)", () => {
  test("installExtensions tolerates a plain ctx and drives every implemented extension", () => {
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
    // node.js (T23B), query.js (T31), events.js (T37), tree-traversal.js (T35)
    // and mutation-observer.js (T41) export `install` and are picked up
    // automatically; the remaining capability extensions stay silent. Here we
    // only pin that the registry drives them through `ctx` without further
    // edits: the wrapper types registered so far.
    const registered = calls.filter(([kind]) => kind === "registerHandleType");
    expect(registered).toEqual([
      ["registerHandleType", "NodeHandle", expect.any(Function)],
      ["registerHandleType", "EventHandle", expect.any(Function)],
      ["registerHandleType", "TreeWalkerHandle", expect.any(Function)],
      ["registerHandleType", "NodeIteratorHandle", expect.any(Function)],
      ["registerHandleType", "MutationObserverHandle", expect.any(Function)],
      ["registerHandleType", "MutationRecordHandle", expect.any(Function)],
      ["registerHandleType", "RangeHandle", expect.any(Function)],
      ["registerHandleType", "SelectionHandle", expect.any(Function)],
    ]);
    expect(calls.some(([kind, target]) => kind === "method" && target === Document.prototype)).toBe(true);
    expect(calls.length).toBeGreaterThan(0);

    // Re-installing into a recording context must not replace the conversion
    // context used by real collections, regardless of test-file order.
    if (nativeAvailable) {
      const win = createWindow();
      try {
        const element = win.document.createElement("div");
        element.id = "item";
        element.className = "item";
        win.document.body.appendChild(element);
        for (const collection of [
          win.document.getElementsByTagName("div"),
          win.document.body.getElementsByClassName("item"),
        ]) {
          expect(collection.length).toBe(1);
          expect(collection[0]).toBe(element);
          expect(collection.item(0)).toBe(element);
          expect(collection.namedItem("item")).toBe(element);
          expect([...collection]).toEqual([element]);
        }
      } finally {
        win.destroy();
      }
    }
  });
});

describe.skipIf(!nativeAvailable)("facade Window/Document lifecycle (T22B)", () => {

  test("createWindow returns a Window facade owning a fresh Document", () => {
    const before = liveDocumentCount();
    const win = createWindow();
    expect(win).toBeInstanceOf(Window);
    expect(Object.getPrototypeOf(win)).toBe(Window.prototype);
    expect(win.constructor).toBe(Window);
    expect(liveDocumentCount()).toBe(before + 1);

    const doc = win.document;
    expect(doc).toBeInstanceOf(Document);
    expect(Object.getPrototypeOf(doc)).toBe(Document.prototype);
    expect(doc.constructor).toBe(Document);
    expect(liveDocumentCount()).toBe(before + 1);

    win.destroy();
    expect(liveDocumentCount()).toBe(before);
  });

  test("window.document hands back one and the same object on every read (T20 identity)", () => {
    const win = createWindow();
    const doc = win.document;
    expect(win.document).toBe(doc);
    expect(win.document).toBe(win.document);
    win.destroy();
  });

  test("cross-window documents never share facade identity", () => {
    const winA = createWindow();
    const winB = createWindow();
    expect(winA).not.toBe(winB);
    expect(winA.document).not.toBe(winB.document);
    winA.destroy();
    winB.destroy();
  });

  test("constructing a Window facade from a genuine native handle works", () => {
    const nativeWindow = native().createWindow();
    const win = new Window(nativeWindow);
    const doc = win.document;
    expect(win).toBeInstanceOf(Window);
    expect(doc).toBeInstanceOf(Document);
    win.destroy();
  });

  test("Window.destroy and Document.destroy forward to the native handle", () => {
    const before = liveDocumentCount();
    const win = createWindow();
    const doc = win.document;

    // Document.destroy drops the document on its own.
    doc.destroy();
    expect(liveDocumentCount()).toBe(before);
    // The pure accessor keeps handing back the same (now-destroyed) facade.
    expect(win.document).toBe(doc);

    // A fresh window, destroyed through the window facade.
    const win2 = createWindow();
    win2.destroy();
    expect(liveDocumentCount()).toBe(before);
  });

  test("destroy is idempotent and never throws through the facade", () => {
    const win = createWindow();
    const doc = win.document;
    win.destroy();
    expect(() => win.destroy()).not.toThrow();
    expect(() => doc.destroy()).not.toThrow();
    expect(win.document).toBe(doc);
  });

  test("after facade destroy every Core-touching operation fails with the frozen T21 error", () => {
    const nativeWindow = native().createWindow();
    const nativeDocument = nativeWindow.document();
    const win = new Window(nativeWindow);
    const doc = win.document;

    win.destroy();

    // The facade surface stays live for pure accessors and idempotent calls.
    expect(win.document).toBe(doc);
    expect(() => win.destroy()).not.toThrow();
    expect(() => doc.destroy()).not.toThrow();

    // The underlying document is destroyed: every Core-touching operation on
    // any handle fails per T21 with the frozen code and message.
    const err = thrown(() => nativeDocument.createElement("div"));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    expect(err.message).toBe("[ERR_MAD_DOM_DOCUMENT_DESTROYED] the document has been destroyed");
  });
});
