import { describe, expect, test } from "bun:test";
import { Window, Document, isNativeAvailable } from "../../index.js";
import { Node } from "../../js/facade/extensions/node.js";

// T23 cross-layer integration smoke tests.
//
// They drive the node creation and navigation surface through the official
// package entry (index.js → js/entry.js) and pin the acceptance criteria of
// the gate:
//
//   - JavaScript can build detached Element/Text through document.createElement
//     / document.createTextNode and read nodeType, nodeName and the basic
//     navigation relations (all null / empty while detached);
//   - the shared entry keeps exactly one set of exports — the low-level T19
//     bindings and the facade classes only — so the node surface stays on the
//     facade classes and Core remains the only tree-state source;
//   - each facade create call mints a distinct node, and the frozen descriptor
//     shapes (fixed non-writable creation methods) survive the entry wiring;
//   - the T21 destroyed-document error protocol is reachable through the entry
//     for every creation and navigation read.
//
// The structural block needs no native artifact; the runtime block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the T22A/T22B/T23B suites. Tree-shape identity is exercised in
// tests/bun/facade-node.test.js (T23B); here the facade is driven purely
// through the public entry.

const nativeAvailable = isNativeAvailable();

describe("root entry node surface (T23)", () => {
  test("the package entry keeps exactly one set of exports", async () => {
    const mod = await import("../../index.js");
    expect(Object.keys(mod).sort()).toEqual([
      "Browser",
      "BrowserContext",
      "BrowserErrorCaptureEnum",
      "BrowserFrame",
      "BrowserPage",
      "CSSConditionRule",
      "CSSContainerRule",
      "CSSFontFaceRule",
      "CSSGroupingRule",
      "CSSKeyframeRule",
      "CSSKeyframesRule",
      "CSSKeywordValue",
      "CSSMediaRule",
      "CSSRule",
      "CSSScopeRule",
      "CSSStyleDeclaration",
      "CSSStyleRule",
      "CSSStyleSheet",
      "CSSStyleValue",
      "CSSSupportsRule",
      "CustomEvent",
      "Document",
      "Event",
      "EventPhaseEnum",
      "FocusEvent",
      "InputEvent",
      "KeyboardEvent",
      "MediaList",
      "MediaQueryListEvent",
      "MouseEvent",
      "UIEvent",
      "VirtualConsoleLogLevelEnum",
      "VirtualConsolePrinter",
      "WheelEvent",
      "Window",
      "createDocument",
      "isNativeAvailable",
      "liveDocumentCount",
      "nativeAbiVersion",
      "project",
    ]);
  });

  test("Document creation methods are fixed method descriptors on the entry class", () => {
    for (const name of ["createElement", "createTextNode"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
      expect(descriptor, `${name} must be defined`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.writable).toBe(false);
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });

  test("the Node navigation surface is a non-enumerable accessor set on Node.prototype (T48A per-tag direct prototype)", () => {
    if (!nativeAvailable) return;
    const win = new Window();
    const div = win.document.createElement("div");
    // T48A: the direct prototype is the per-tag class (empty), so the
    // navigation accessors are inherited from Node.prototype — present: false
    // on the direct prototype, matching happy-dom.
    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(div), "nodeType")).toBeUndefined();
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
    win.destroy();
  });
});

describe.skipIf(!nativeAvailable)("root entry node creation and navigation (T23)", () => {
  test("createElement / createTextNode mint detached Element and Text through the entry", () => {
    const win = new Window();
    const doc = win.document;
    const div = doc.createElement("div");
    const text = doc.createTextNode("hello");

    expect(div.nodeType).toBe(1);
    expect(div.nodeName).toBe("DIV");
    expect(text.nodeType).toBe(3);
    expect(text.nodeName).toBe("#text");

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
    const win = new Window();
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

  test("after entry-level destroy every creation and navigation read fails per T21", () => {
    const win = new Window();
    const doc = win.document;
    const div = doc.createElement("div");
    const text = doc.createTextNode("x");

    win.destroy();

    const reads = [
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
    for (const read of reads) {
      const err = (() => {
        try {
          read();
          return undefined;
        } catch (caught) {
          return caught;
        }
      })();
      expect(err, "every read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
