import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Node } from "../../js/facade/extensions/node.js";
import {
  install as installAttributes,
  seam as attributesSeam,
} from "../../js/facade/extensions/attributes.js";
import {
  install as installTextContent,
  seam as textContentSeam,
} from "../../js/facade/extensions/text-content.js";

// T25E attribute and textContent binding/facade tests.
//
// They pin the acceptance criteria of the vertical slice that connects the T25B
// (attributes) and T25C (textContent) Core contracts to the existing wrapper
// and JavaScript facade:
//
//   - the native `NodeHandle` gains exactly the six new symbols — getAttribute,
//     setAttribute, removeAttribute, hasAttribute (attributes_api.rs) and
//     textContent, setTextContent (text_api.rs) — with no duplicate export and
//     every read/write delegating to Core through the frozen seam;
//   - the facade installs the WHATWG attribute methods and the textContent
//     accessor on `Node.prototype` with the fixed descriptor shape, and every
//     call routes through `ctx.documentContext.handleOf` + the native handle, so
//     no second DOM state exists;
//   - Bun observes immediate changes: an attribute write is visible to the next
//     get/has read, a textContent write is visible to the next read and to the
//     existing navigation and childNodes results (T23/T24) — firstChild,
//     lastChild, childNodes and nodeName all stay in sync;
//   - string conversion (WebIDL DOMString shaping in the facade), null handling,
//     non-Element behaviour, deep trees, failure atomicity and wrapper identity
//     are covered end to end;
//   - error names/codes follow the frozen taxonomy: a non-Element attribute op
//     fails with ERR_MAD_DOM_HIERARCHY, an invalid attribute name with
//     ERR_MAD_DOM_INVALID_CHARACTER (list unchanged), a NUL textContent setter
//     value with ERR_MAD_DOM_INVALID_CHARACTER (node unchanged), and a destroyed
//     document with ERR_MAD_DOM_DOCUMENT_DESTROYED.
//
// Like the other native suites, the native-dependent block loads the locally
// built artifact (build/mad-dom.node) and skips without one, so a clean
// checkout still passes `npm run validate`. The structural block needs no
// native. The facade is wired through the public entry import below (which runs
// the registry exactly once).

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("attribute facade module shape (T25E)", () => {
  test("attributes.js exports exactly the install function and the frozen seam", async () => {
    const mod = await import("../../js/facade/extensions/attributes.js");
    expect(Object.keys(mod).sort()).toEqual(["install", "seam"]);
  });

  test("text-content.js exports exactly the install function and the frozen seam", async () => {
    const mod = await import("../../js/facade/extensions/text-content.js");
    expect(Object.keys(mod).sort()).toEqual(["install", "seam"]);
  });

  test("the seams stay placeholders until the T25 gate flips them", () => {
    expect(attributesSeam.owner).toBe("T25E");
    expect(attributesSeam.gate).toBe("T25");
    expect(attributesSeam.status).toBe("placeholder");
    expect(Object.isFrozen(attributesSeam)).toBe(true);

    expect(textContentSeam.owner).toBe("T25E");
    expect(textContentSeam.gate).toBe("T25");
    expect(textContentSeam.status).toBe("placeholder");
    expect(Object.isFrozen(textContentSeam)).toBe(true);
  });

  test("Node sits one level under Object.prototype with no enumerable surface", () => {
    expect(Object.getPrototypeOf(Node.prototype)).toBe(Object.prototype);
    expect(Object.keys(Node.prototype)).toEqual([]);
  });
});

describe("attribute and textContent descriptors (T25E)", () => {
  test("getAttribute, setAttribute, removeAttribute and hasAttribute are fixed method descriptors", () => {
    for (const name of ["getAttribute", "setAttribute", "removeAttribute", "hasAttribute"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be defined`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.writable).toBe(false);
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });

  test("textContent is a fixed accessor with a getter and a setter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.get).toBe("function");
    expect(typeof descriptor.set).toBe("function");
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });
});

describe("attribute and textContent install surface (T25E)", () => {
  test("installAttributes defines exactly the four attribute methods through ctx.defineMethod", () => {
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
    expect(() => installAttributes(mockCtx)).not.toThrow();
    expect(calls).toEqual([
      ["method", Node.prototype, "getAttribute", expect.any(Function)],
      ["method", Node.prototype, "setAttribute", expect.any(Function)],
      ["method", Node.prototype, "removeAttribute", expect.any(Function)],
      ["method", Node.prototype, "hasAttribute", expect.any(Function)],
    ]);
  });

  test("installTextContent defines exactly the textContent accessor through ctx.defineAccessor", () => {
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
    expect(() => installTextContent(mockCtx)).not.toThrow();
    expect(calls).toEqual([
      ["accessor", Node.prototype, "textContent", expect.any(Function), expect.any(Function)],
    ]);
  });
});

describe.skipIf(!nativeAvailable)("attribute read/write behaviour (T25E)", () => {
  test("get/set/has/remove round-trip and observe immediate changes", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      expect(el.getAttribute("class")).toBeNull();
      expect(el.hasAttribute("class")).toBe(false);

      el.setAttribute("class", "x");
      expect(el.getAttribute("class")).toBe("x");
      expect(el.hasAttribute("class")).toBe(true);

      el.setAttribute("class", "y");
      expect(el.getAttribute("class")).toBe("y");
      expect(el.hasAttribute("class")).toBe(true);

      expect(el.removeAttribute("class")).toBeUndefined();
      expect(el.getAttribute("class")).toBeNull();
      expect(el.hasAttribute("class")).toBe(false);

      // Removing an absent attribute is a no-op that still returns undefined.
      expect(el.removeAttribute("never-set")).toBeUndefined();
      expect(el.getAttribute("never-set")).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("multiple attributes coexist and reads stay independent", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("a", "1");
      el.setAttribute("b", "2");
      expect(el.getAttribute("a")).toBe("1");
      expect(el.getAttribute("b")).toBe("2");
      expect(el.hasAttribute("a")).toBe(true);
      expect(el.hasAttribute("b")).toBe(true);

      el.removeAttribute("a");
      expect(el.getAttribute("a")).toBeNull();
      expect(el.getAttribute("b")).toBe("2");
      expect(el.hasAttribute("a")).toBe(false);
      expect(el.hasAttribute("b")).toBe(true);
    } finally {
      win.destroy();
    }
  });

  test("values are stored verbatim: empty, whitespace, multi-byte and empty-name lookups", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("data-empty", "");
      expect(el.getAttribute("data-empty")).toBe("");
      expect(el.hasAttribute("data-empty")).toBe(true);

      el.setAttribute("data-space", "  a b  ");
      expect(el.getAttribute("data-space")).toBe("  a b  ");

      el.setAttribute("data-utf8", "你好 🌍");
      expect(el.getAttribute("data-utf8")).toBe("你好 🌍");

      // An unknown name is simply absent (null / false), never an error.
      expect(el.getAttribute("")).toBeNull();
      expect(el.hasAttribute("")).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test("WebIDL DOMString argument shaping converts non-string values", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("n", 123);
      expect(el.getAttribute("n")).toBe("123");

      el.setAttribute("nil", null);
      expect(el.getAttribute("nil")).toBe("null");

      el.setAttribute("undef", undefined);
      expect(el.getAttribute("undef")).toBe("undefined");

      el.setAttribute("bool", true);
      expect(el.getAttribute("bool")).toBe("true");

      // Names are coerced too: `true` stringifies to the valid name "true".
      el.setAttribute(true, "name-value");
      expect(el.getAttribute(true)).toBe("name-value");
    } finally {
      win.destroy();
    }
  });

  test("invalid attribute names fail with ERR_MAD_DOM_INVALID_CHARACTER and stay atomic", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      for (const bad of ["", "1bad", "has space", "-dash"]) {
        const err = thrown(() => el.setAttribute(bad, "x"));
        expect(err, `setAttribute(${JSON.stringify(bad)}) must throw`).toBeInstanceOf(Error);
        expect(err.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
        expect(err.message).toContain("InvalidCharacterError");
        // Failure atomicity: the failed call leaves the list unchanged.
        expect(el.getAttribute(bad)).toBeNull();
        expect(el.hasAttribute(bad)).toBe(false);
      }
    } finally {
      win.destroy();
    }
  });

  test("a non-Element node fails attribute operations with ERR_MAD_DOM_HIERARCHY", () => {
    const win = createWindow();
    const text = win.document.createTextNode("hi");
    try {
      for (const call of [
        () => text.getAttribute("x"),
        () => text.hasAttribute("x"),
        () => text.setAttribute("x", "y"),
        () => text.removeAttribute("x"),
      ]) {
        const err = thrown(call);
        expect(err, "a non-Element attribute operation must throw").toBeInstanceOf(Error);
        expect(err.code).toBe("ERR_MAD_DOM_HIERARCHY");
        expect(err.message).toContain("HierarchyRequestError");
      }
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every attribute read/write per T21", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    el.setAttribute("id", "x");
    win.destroy();

    const calls = [
      () => el.getAttribute("id"),
      () => el.hasAttribute("id"),
      () => el.setAttribute("x", "y"),
      () => el.removeAttribute("id"),
    ];
    for (const call of calls) {
      const err = thrown(call);
      expect(err, "every attribute op on a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});

describe.skipIf(!nativeAvailable)("textContent behaviour (T25E)", () => {
  test("the getter/setter round-trips and reflects immediate changes", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      expect(el.textContent).toBe("");
      el.textContent = "hello";
      expect(el.textContent).toBe("hello");
      el.textContent = "world";
      expect(el.textContent).toBe("world");
    } finally {
      win.destroy();
    }
  });

  test("the setter converts null to the empty string and clears children", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.textContent = "x";
      expect(el.textContent).toBe("x");
      el.textContent = null;
      expect(el.textContent).toBe("");
      expect(el.childNodes).toHaveLength(0);
      expect(el.firstChild).toBeNull();
      expect(el.lastChild).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("WebIDL DOMString shaping converts non-string setter values", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.textContent = 42;
      expect(el.textContent).toBe("42");
      el.textContent = true;
      expect(el.textContent).toBe("true");
      el.textContent = undefined;
      expect(el.textContent).toBe("undefined");
    } finally {
      win.destroy();
    }
  });

  test("setting textContent replaces children with one text node and syncs navigation/childNodes", () => {
    const win = createWindow();
    const doc = win.document;
    const el = doc.createElement("div");
    try {
      el.appendChild(doc.createElement("a"));
      el.appendChild(doc.createElement("b"));
      expect(el.childNodes).toHaveLength(2);

      el.textContent = "replaced";
      expect(el.textContent).toBe("replaced");
      expect(el.childNodes).toHaveLength(1);
      expect(el.firstChild).toBeInstanceOf(Node);
      expect(el.firstChild.nodeType).toBe(3);
      expect(el.firstChild.nodeName).toBe("#text");
      expect(el.lastChild).toBe(el.firstChild);
      expect(el.firstChild.parentNode).toBe(el);
    } finally {
      win.destroy();
    }
  });

  test("the setter with an empty value clears every child", () => {
    const win = createWindow();
    const doc = win.document;
    const el = doc.createElement("div");
    try {
      el.textContent = "x";
      expect(el.childNodes).toHaveLength(1);
      el.textContent = "";
      expect(el.textContent).toBe("");
      expect(el.childNodes).toHaveLength(0);
      expect(el.firstChild).toBeNull();
      expect(el.lastChild).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("deep trees read the tree-order concatenation of descendant text", () => {
    const win = createWindow();
    const doc = win.document;
    const root = doc.createElement("root");
    try {
      const a = doc.createElement("a");
      const b = doc.createElement("b");
      a.appendChild(doc.createTextNode("1"));
      b.appendChild(doc.createTextNode("2"));
      root.appendChild(a);
      root.appendChild(b);
      root.appendChild(doc.createTextNode("3"));
      expect(root.textContent).toBe("123");

      // The read is produced on demand: a later write is visible immediately.
      // Appending inside `b` puts the new text before root's own "3", so the
      // tree-order concatenation becomes "1" + "2" + "!" + "3".
      b.appendChild(doc.createTextNode("!"));
      expect(root.textContent).toBe("12!3");
    } finally {
      win.destroy();
    }
  });

  test("text nodes read and set their own data", () => {
    const win = createWindow();
    const text = win.document.createTextNode("data");
    try {
      expect(text.textContent).toBe("data");
      text.textContent = "changed";
      expect(text.textContent).toBe("changed");
      expect(text.nodeType).toBe(3);
    } finally {
      win.destroy();
    }
  });

  test("a NUL byte in the setter fails with ERR_MAD_DOM_INVALID_CHARACTER and keeps failure atomicity", () => {
    const win = createWindow();
    const doc = win.document;
    const el = doc.createElement("div");
    const child = doc.createElement("span");
    el.appendChild(child);
    const text = doc.createTextNode("keep");
    try {
      const err = thrown(() => {
        el.textContent = "a\u0000b";
      });
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
      expect(err.message).toContain("InvalidCharacterError");

      // Atomicity: the failed replacement leaves every child in place.
      expect(el.childNodes).toHaveLength(1);
      expect(el.firstChild).toBe(child);
      expect(el.textContent).toBe("");

      // A Text node's data is replaced atomically too: a NUL value is rejected
      // before the data field is written, so the old data survives.
      const textErr = thrown(() => {
        text.textContent = "a\u0000b";
      });
      expect(textErr).toBeInstanceOf(Error);
      expect(textErr.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
      expect(text.textContent).toBe("keep");
    } finally {
      win.destroy();
    }
  });

  test("wrapper identity is stable through textContent writes and reads", () => {
    const win = createWindow();
    const doc = win.document;
    const el = doc.createElement("div");
    try {
      el.textContent = "x";
      const text = el.firstChild;
      expect(text).toBeInstanceOf(Node);
      expect(el.firstChild).toBe(text);
      expect(el.firstChild).toBe(el.lastChild);
      expect(el.firstChild.parentNode).toBe(el);
      expect(el.textContent).toBe("x");

      // The existing navigation keeps returning the same wrapper after the set.
      el.textContent = "y";
      expect(el.textContent).toBe("y");
      expect(el.firstChild).not.toBe(text);
      expect(el.firstChild.parentNode).toBe(el);
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every textContent read/write per T21", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    win.destroy();

    const errRead = thrown(() => el.textContent);
    expect(errRead).toBeInstanceOf(Error);
    expect(errRead.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");

    const errWrite = thrown(() => {
      el.textContent = "x";
    });
    expect(errWrite).toBeInstanceOf(Error);
    expect(errWrite.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
  });
});
