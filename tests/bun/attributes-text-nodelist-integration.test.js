import { describe, expect, test } from "bun:test";
import { Window, Document, isNativeAvailable } from "../../index.js";
import { Node } from "../../js/facade/extensions/node.js";

// T25 cross-module integration gate tests.
//
// They drive the complete M4 vertical slice through the official package entry
// (index.js → js/entry.js) and pin the interaction ordering of the four
// surfaces the gate joins:
//
//   - tree mutation (T24: appendChild / insertBefore / removeChild /
//     replaceChild),
//   - element attributes (T25E: getAttribute / setAttribute / removeAttribute /
//     hasAttribute),
//   - textContent (T25E getter/setter),
//   - the live childNodes NodeList (T25D, wired by this gate).
//
// The acceptance criteria are expressed as cross-module observations, not
// module-local ones:
//
//   - an already-captured childNodes object reflects every later tree and
//     textContent change immediately, in Core document order, and one and the
//     same NodeList object is handed back per parent;
//   - a textContent write is visible to the next textContent read, to the
//     navigation reads (firstChild/lastChild) and to the live childNodes
//     collection in the same observation order;
//   - an attribute write is visible to the next get/has read and is untouched
//     by concurrent textContent and mutation writes;
//   - every read/write through the facade routes to Core, so a destroyed
//     document fails every surface per the T21 error protocol.
//
// The structural block needs no native artifact; the runtime block skips
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

const nativeAvailable = isNativeAvailable();

describe("M4 vertical slice entry surface (T25)", () => {
  test("the package entry exposes exactly one set of exports", async () => {
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
      "CookieSameSiteEnum",
      "CustomEvent",
      "Document",
      "Event",
      "EventPhaseEnum",
      "FocusEvent",
      "GlobalWindow",
      "InputEvent",
      "KeyboardEvent",
      "MediaList",
      "MediaQueryListEvent",
      "MouseEvent",
      "UIEvent",
      "VirtualConsole",
      "VirtualConsoleLogLevelEnum",
      "VirtualConsoleLogTypeEnum",
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
});

describe.skipIf(!nativeAvailable)("cross-module observation ordering (T25)", () => {
  test("an existing childNodes object reflects append/insert/remove/replace immediately", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const parent = doc.createElement("parent");
      const first = doc.createElement("first");
      const middle = doc.createElement("middle");
      const last = doc.createElement("last");

      parent.appendChild(first);
      parent.appendChild(last);
      const list = parent.childNodes;
      expect(list).toHaveLength(2);

      parent.insertBefore(middle, last);
      expect(list).toHaveLength(3);
      expect(Array.from(list, (node) => node.nodeName)).toEqual(["FIRST", "MIDDLE", "LAST"]);

      parent.removeChild(middle);
      expect(list).toHaveLength(2);
      expect(Array.from(list, (node) => node.nodeName)).toEqual(["FIRST", "LAST"]);

      const replacement = doc.createElement("replacement");
      parent.replaceChild(replacement, first);
      expect(list).toHaveLength(2);
      expect(Array.from(list, (node) => node.nodeName)).toEqual(["REPLACEMENT", "LAST"]);
    } finally {
      win.destroy();
    }
  });

  test("an existing childNodes object reflects a textContent write immediately", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const el = doc.createElement("div");
      const marker = doc.createElement("marker");
      el.appendChild(marker);

      const list = el.childNodes;
      expect(list).toHaveLength(1);

      el.textContent = "hello";
      expect(list).toHaveLength(1);
      expect(list[0]).toBe(el.firstChild);
      expect(list[0]).toBe(el.lastChild);
      expect(list[0].nodeType).toBe(3);
      expect(list[0].textContent).toBe("hello");

      el.textContent = "";
      expect(list).toHaveLength(0);
      expect(el.firstChild).toBeNull();
      expect(el.lastChild).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("textContent reads observe tree mutations in document order", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const root = doc.createElement("root");
      const a = doc.createElement("a");
      const b = doc.createElement("b");
      a.appendChild(doc.createTextNode("1"));
      b.appendChild(doc.createTextNode("2"));
      root.appendChild(a);
      root.appendChild(b);

      expect(root.textContent).toBe("12");

      b.appendChild(doc.createTextNode("3"));
      expect(root.textContent).toBe("123");

      root.removeChild(a);
      expect(root.textContent).toBe("23");

      root.insertBefore(a, b);
      expect(root.textContent).toBe("123");
    } finally {
      win.destroy();
    }
  });

  test("attribute writes are immediate and survive textContent and mutation writes", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const el = doc.createElement("div");

      el.setAttribute("class", "x");
      expect(el.getAttribute("class")).toBe("x");
      expect(el.hasAttribute("class")).toBe(true);

      el.textContent = "text";
      expect(el.getAttribute("class")).toBe("x");

      const child = doc.createElement("span");
      child.setAttribute("data-k", "v");
      el.appendChild(child);
      expect(el.getAttribute("class")).toBe("x");
      expect(child.getAttribute("data-k")).toBe("v");

      el.removeAttribute("class");
      expect(el.getAttribute("class")).toBeNull();
      expect(el.hasAttribute("class")).toBe(false);
      expect(child.getAttribute("data-k")).toBe("v");
    } finally {
      win.destroy();
    }
  });

  test("attributes and textContent share the single Core state source", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const el = doc.createElement("div");
      el.setAttribute("id", "probe");

      el.textContent = "a";
      expect(el.textContent).toBe("a");
      expect(el.getAttribute("id")).toBe("probe");

      const list = el.childNodes;
      const text = list[0];
      text.textContent = "b";
      expect(el.textContent).toBe("b");
      expect(el.getAttribute("id")).toBe("probe");
      expect(list[0]).toBe(text);
    } finally {
      win.destroy();
    }
  });

  test("one and the same live NodeList object is handed back per parent", () => {
    const win = new Window();
    try {
      const doc = win.document;
      const parent = doc.createElement("div");
      const other = doc.createElement("div");
      expect(parent.childNodes).toBe(parent.childNodes);
      expect(parent.childNodes).not.toBe(other.childNodes);
      expect(parent.childNodes.constructor.name).toBe("NodeList");
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every M4 surface per T21", () => {
    const win = new Window();
    const doc = win.document;
    const el = doc.createElement("div");
    el.setAttribute("id", "x");
    const list = el.childNodes;
    win.destroy();

    const reads = [
      () => el.getAttribute("id"),
      () => el.hasAttribute("id"),
      () => el.setAttribute("a", "b"),
      () => el.removeAttribute("id"),
      () => el.textContent,
      () => {
        el.textContent = "x";
      },
      () => list.length,
      () => list[0],
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
      expect(err, "every M4 surface read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
