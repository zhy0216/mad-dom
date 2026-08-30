import { describe, expect, test } from "bun:test";
import { createWindow, Document, isNativeAvailable } from "../../index.js";

// T24 cross-layer integration smoke tests.
//
// They drive the tree mutation surface through the official package entry
// (index.js → js/entry.js) and pin the acceptance criteria of the gate:
//
//   - JavaScript can build and mutate a basic DOM tree through the entry:
//     appendChild / insertBefore / removeChild / replaceChild plus
//     createDocumentFragment, covering insert, move, delete and replace;
//   - the shared entry keeps exactly one set of exports — the low-level T19
//     bindings and the facade classes only — so the mutation surface stays on
//     the facade classes and Core remains the only tree-state source;
//   - the frozen descriptor shapes (fixed non-writable mutation methods) and
//     the WHATWG return-value convention survive the entry wiring;
//   - the T21 destroyed-document error protocol is reachable through the entry
//     for every mutation call, and a failed mutation leaves the observable
//     tree unchanged.
//
// The structural block needs no native artifact; the runtime block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the T22A/T22B/T23B/T24C suites. Return values, moving and
// DocumentFragment splicing are exercised in detail in
// tests/bun/facade-mutation.test.js (T24C); here the facade is driven purely
// through the public entry.

const nativeAvailable = isNativeAvailable();

describe("root entry mutation surface (T24)", () => {
  test("the package entry keeps exactly one set of exports", async () => {
    const mod = await import("../../index.js");
    expect(Object.keys(mod).sort()).toEqual([
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
      "WheelEvent",
      "Window",
      "createDocument",
      "createWindow",
      "isNativeAvailable",
      "liveDocumentCount",
      "nativeAbiVersion",
      "project",
    ]);
  });

  test("Document.createDocumentFragment is a fixed method descriptor on the entry class", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "createDocumentFragment");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.value).toBe("function");
    expect(descriptor.writable).toBe(false);
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });
});

describe.skipIf(!nativeAvailable)("root entry tree mutation (T24)", () => {
  test("the Node mutation methods are fixed non-enumerable method descriptors behind the created wrapper", () => {
    const win = createWindow();
    const parent = win.document.createElement("parent");
    const prototype = Object.getPrototypeOf(parent);
    for (const name of ["appendChild", "insertBefore", "removeChild", "replaceChild"]) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      expect(descriptor, `${name} must be defined`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.writable).toBe(false);
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
    win.destroy();
  });

  test("append / insert / remove / replace build and reshape a tree through the entry", () => {
    const win = createWindow();
    const doc = win.document;
    const parent = doc.createElement("parent");
    const first = doc.createElement("first");
    const middle = doc.createElement("middle");
    const last = doc.createElement("last");
    const text = doc.createTextNode("text");

    expect(parent.appendChild(first)).toBe(first);
    expect(parent.appendChild(text)).toBe(text);
    expect(parent.appendChild(last)).toBe(last);
    expect(parent.insertBefore(middle, last)).toBe(middle);
    expect(Array.from(parent.childNodes, (node) => node.nodeName)).toEqual([
      "FIRST",
      "#text",
      "MIDDLE",
      "LAST",
    ]);

    // Move: re-appending an existing child reorders, it is not a duplicate.
    expect(parent.appendChild(first)).toBe(first);
    expect(Array.from(parent.childNodes, (node) => node.nodeName)).toEqual([
      "#text",
      "MIDDLE",
      "LAST",
      "FIRST",
    ]);

    // Delete: removeChild detaches the node but keeps it live and re-insertable.
    expect(parent.removeChild(middle)).toBe(middle);
    expect(middle.parentNode).toBeNull();
    expect(parent.childNodes).toHaveLength(3);
    expect(parent.insertBefore(middle, last)).toBe(middle);
    expect(middle.parentNode).toBe(parent);

    // Replace: replaceChild swaps the child and returns the removed one.
    const replacement = doc.createElement("replacement");
    expect(parent.replaceChild(replacement, text)).toBe(text);
    expect(text.parentNode).toBeNull();
    expect(replacement.parentNode).toBe(parent);
    expect(Array.from(parent.childNodes, (node) => node.nodeName)).toEqual([
      "REPLACEMENT",
      "MIDDLE",
      "LAST",
      "FIRST",
    ]);
    win.destroy();
  });

  test("DocumentFragment is created and spliced through the entry", () => {
    const win = createWindow();
    const doc = win.document;
    const fragment = doc.createDocumentFragment();
    expect(fragment.nodeType).toBe(11);
    expect(fragment.nodeName).toBe("#document-fragment");

    const parent = doc.createElement("parent");
    const one = doc.createElement("one");
    const two = doc.createElement("two");
    fragment.appendChild(one);
    fragment.appendChild(two);
    parent.appendChild(fragment);

    expect(fragment.childNodes).toHaveLength(0);
    expect(Array.from(parent.childNodes, (node) => node.nodeName)).toEqual(["ONE", "TWO"]);
    expect(one.parentNode).toBe(parent);
    expect(two.parentNode).toBe(parent);
    win.destroy();
  });

  test("a failed mutation leaves the observable tree unchanged", () => {
    const win = createWindow();
    const doc = win.document;
    const parent = doc.createElement("parent");
    const child = doc.createElement("child");
    parent.appendChild(child);
    const before = Array.from(parent.childNodes);

    const throwAround = (fn) => {
      try {
        fn();
        return undefined;
      } catch (error) {
        return error;
      }
    };

    const selfError = throwAround(() => parent.appendChild(parent));
    expect(selfError).toBeInstanceOf(Error);
    expect(selfError.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expect(Array.from(parent.childNodes)).toEqual(before);

    const detachedReference = doc.createElement("reference");
    const candidate = doc.createElement("candidate");
    const referenceError = throwAround(() => parent.insertBefore(candidate, detachedReference));
    expect(referenceError).toBeInstanceOf(Error);
    expect(referenceError.code).toBe("ERR_MAD_DOM_HIERARCHY");
    expect(Array.from(parent.childNodes)).toEqual(before);
    expect(candidate.parentNode).toBeNull();

    const wrongDocument = (() => {
      const foreign = createWindow();
      try {
        const foreignNode = foreign.document.createElement("foreign");
        return throwAround(() => parent.appendChild(foreignNode));
      } finally {
        foreign.destroy();
      }
    })();
    expect(wrongDocument).toBeInstanceOf(Error);
    expect(wrongDocument.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
    expect(Array.from(parent.childNodes)).toEqual(before);
    win.destroy();
  });

  test("after entry-level destroy every mutation fails per T21", () => {
    const win = createWindow();
    const doc = win.document;
    const parent = doc.createElement("parent");
    const child = doc.createElement("child");
    const fragment = doc.createDocumentFragment();

    win.destroy();

    const mutations = [
      () => doc.createElement("span"),
      () => doc.createTextNode("y"),
      () => doc.createDocumentFragment(),
      () => parent.appendChild(child),
      () => parent.insertBefore(child, child),
      () => parent.removeChild(child),
      () => parent.replaceChild(child, child),
    ];
    for (const mutation of mutations) {
      const err = (() => {
        try {
          mutation();
          return undefined;
        } catch (caught) {
          return caught;
        }
      })();
      expect(err, "every mutation of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
