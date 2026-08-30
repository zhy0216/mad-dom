import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Document } from "../../js/facade/document.js";
import { StaticNodeList } from "../../js/facade/extensions/query.js";
import { Node, Element, DocumentFragment } from "../../js/facade/extensions/node.js";

// T31 selector query integration tests.
//
// They drive the complete selector-query surface through the official package
// entry (index.js → js/entry.js) and pin the acceptance criteria:
//
//   - `querySelectorAll` returns a *static* `NodeList` snapshot in document
//     order, and a later mutation of the tree never changes an already
//     returned collection (while a fresh query reflects it);
//   - `querySelector` returns the first document-order match (or `null`),
//     `matches` tests a single element and `closest` walks from the receiver
//     (itself included) up the ancestor chain;
//   - `getElementById` returns the first element whose id matches, without an
//     index;
//   - the query surface is wired per the WHATWG: `querySelector` /
//     `querySelectorAll` run on a Document or an Element scope and match
//     *descendants* only, the implied skeleton makes `document.querySelector("body")`
//     work on a fresh window, and all results keep wrapper identity (T20);
//   - errors follow the frozen taxonomy: an invalid selector throws
//     `ERR_MAD_DOM_SYNTAX`, a non-element receiver / non-ParentNode scope
//     throws `ERR_MAD_DOM_HIERARCHY`, a destroyed document throws
//     `ERR_MAD_DOM_DOCUMENT_DESTROYED`, and WebIDL DOMString shaping applies
//     to the selector / id arguments.
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
  window.document.body.innerHTML =
    '<ul id="list"><li class="item" data-i="0">first</li>' +
    '<li class="item" data-i="1">second</li><li data-i="2">third</li></ul>';
  return window.document;
}

describe("T31 selector query surface shape", () => {
  test("the facade installs the query methods with frozen descriptors", () => {
    for (const name of ["querySelector", "querySelectorAll", "getElementById"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
      expect(descriptor, `Document.${name}`).toBeDefined();
      expect(typeof descriptor.value, `Document.${name}`).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
      expect(descriptor.writable).toBe(false);
    }
    for (const name of ["querySelector", "querySelectorAll", "matches", "closest"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, name);
      expect(descriptor, `Element.${name}`).toBeDefined();
      expect(typeof descriptor.value, `Element.${name}`).toBe("function");
    }
    // T48A: DocumentFragment (and shadow roots through it) reaches the two
    // ParentNode queries; Text/Comment never hold them.
    for (const name of ["querySelector", "querySelectorAll"]) {
      const fragmentDescriptor = Object.getOwnPropertyDescriptor(DocumentFragment.prototype, name);
      expect(fragmentDescriptor, `DocumentFragment.${name}`).toBeDefined();
      expect(typeof fragmentDescriptor.value, `DocumentFragment.${name}`).toBe("function");
    }
    expect(Object.getOwnPropertyDescriptor(Node.prototype, "querySelector")).toBeUndefined();

    // The static query NodeList carries the WHATWG read surface.
    for (const name of ["item", "forEach", "entries", "keys", "values"]) {
      expect(typeof StaticNodeList.prototype[name], `StaticNodeList.${name}`).toBe("function");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(StaticNodeList.prototype, "length");
    expect(typeof lengthDescriptor.get).toBe("function");
  });
});

describe.skipIf(!nativeAvailable)("querySelectorAll (T31)", () => {
  test("returns a static NodeList snapshot in document order", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const items = doc.querySelectorAll("li.item");
      expect(items).toBeInstanceOf(StaticNodeList);
      expect(items.length).toBe(2);
      expect(Array.from(items, (li) => li.getAttribute("data-i"))).toEqual(["0", "1"]);
      expect(items.item(0).getAttribute("data-i")).toBe("0");
      expect(items[0].getAttribute("data-i")).toBe("0");
      expect(items.item(99)).toBeNull();

      // A selector with no matches yields an empty static collection.
      expect(doc.querySelectorAll("li.missing").length).toBe(0);
      expect(doc.querySelectorAll("li.missing").item(0)).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("a later mutation does not change an already returned collection", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const captured = doc.querySelectorAll("li.item");
      expect(captured.length).toBe(2);

      const first = doc.querySelector('[data-i="0"]');
      first.parentNode.removeChild(first);
      expect(captured.length, "the captured snapshot stays static").toBe(2);
      expect(captured[0].getAttribute("data-i")).toBe("0");
      // A fresh query reflects the mutation.
      expect(doc.querySelectorAll("li.item").length).toBe(1);
    } finally {
      win.destroy();
    }
  });

  test("each call returns a fresh collection while elements keep identity", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const first = doc.querySelectorAll("li.item");
      const second = doc.querySelectorAll("li.item");
      expect(first).not.toBe(second);
      // Same matched element wrapper (T20 identity) across collections.
      expect(first[0]).toBe(second[0]);
      expect(first[0]).toBe(doc.querySelector("li.item"));
    } finally {
      win.destroy();
    }
  });

  test("an element scope matches descendants only", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const list = doc.getElementById("list");
      expect(list.querySelectorAll("li").length).toBe(3);
      // The scope itself is never a candidate.
      expect(list.querySelector("ul")).toBeNull();
      // A child element scope narrows the search.
      expect(doc.querySelector(".item").querySelectorAll("li").length).toBe(0);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("querySelector (T31)", () => {
  test("returns the first document-order match or null", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      expect(doc.querySelector("li.item").getAttribute("data-i")).toBe("0");
      expect(doc.querySelector("li, span").getAttribute("data-i")).toBe("0");
      expect(doc.querySelector("li.missing")).toBeNull();

      // The implied skeleton is discoverable on a fresh window.
      const fresh = createWindow();
      try {
        expect(fresh.document.querySelector("body").nodeName).toBe("BODY");
        expect(fresh.document.querySelector("p")).toBeNull();
      } finally {
        fresh.destroy();
      }
    } finally {
      win.destroy();
    }
  });

  test("a selector with a syntax error throws the frozen taxonomy", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const err = thrown(() => doc.querySelector("div:::"));
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_SYNTAX");

      expect(thrown(() => doc.querySelectorAll("div >")).code).toBe("ERR_MAD_DOM_SYNTAX");
    } finally {
      win.destroy();
    }
  });

  test("WebIDL DOMString shaping applies to the selector argument", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const li = doc.querySelector(".item");
      // null becomes "null" — a valid type selector that matches nothing.
      expect(li.matches(null)).toBe(false);
      // 42 becomes "42" — a digit-led selector, so a syntax error.
      expect(thrown(() => li.matches(42)).code).toBe("ERR_MAD_DOM_SYNTAX");
      expect(li.matches("li.item")).toBe(true);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("matches and closest (T31)", () => {
  test("matches tests the element itself", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const second = doc.querySelectorAll("li.item")[1];
      expect(second.matches("li.item")).toBe(true);
      expect(second.matches(".item")).toBe(true);
      expect(second.matches("div")).toBe(false);
      expect(second.matches("li.item[data-i='1']")).toBe(true);
    } finally {
      win.destroy();
    }
  });

  test("closest walks up from the receiver itself", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const second = doc.querySelectorAll("li.item")[1];
      expect(second.closest("li.item").getAttribute("data-i")).toBe("1");
      expect(second.closest("ul").getAttribute("id")).toBe("list");
      expect(second.closest("li").getAttribute("data-i")).toBe("1");
      expect(second.closest("table")).toBeNull();
      // The receiver is a descendant of the body; the chain reaches the root.
      expect(second.closest("body").nodeName).toBe("BODY");
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("getElementById (T31)", () => {
  test("returns the first matching element or null", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const list = doc.getElementById("list");
      expect(list.nodeName).toBe("UL");
      expect(list).toBe(doc.body.firstChild);
      expect(doc.getElementById("nope")).toBeNull();
      expect(doc.getElementById("")).toBeNull();    } finally {
      win.destroy();
    }
  });

  test("a fresh document has nothing to find", () => {
    const win = createWindow();
    try {
      expect(win.document.getElementById("anything")).toBeNull();
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("query identity (T31)", () => {
  test("query results are the same wrappers across entry points", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const list = doc.getElementById("list");
      expect(doc.querySelector("#list")).toBe(list);
      expect(doc.querySelectorAll("ul")[0]).toBe(list);
      expect(list.firstChild).toBe(doc.querySelector("li.item"));
      // The live childNodes view agrees with the query surface.
      expect(list.childNodes[0]).toBe(doc.querySelector("li.item"));
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("static NodeList surface (T31)", () => {
  test("forEach / entries / keys / values / iterator behave like a NodeList", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const items = doc.querySelectorAll("li.item");

      const seen = [];
      items.forEach((li, index, list) => seen.push([index, li.getAttribute("data-i"), list === items]));
      expect(seen).toEqual([
        [0, "0", true],
        [1, "1", true],
      ]);

      expect(Array.from(items.entries())).toEqual([[0, items[0]], [1, items[1]]]);
      expect(Array.from(items.keys())).toEqual([0, 1]);
      expect(Array.from(items.values(), (li) => li.getAttribute("data-i"))).toEqual(["0", "1"]);
      expect(Array.from(items, (li) => li.nodeType)).toEqual([1, 1]);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("query errors (T31)", () => {
  test("non-element receivers hold no query members (T48A happy-dom parity)", () => {
    const win = createWindow();
    try {
      const doc = build(win);
      const text = doc.createTextNode("plain");

      // T48A: the query surface lives on Element/DocumentFragment.prototype, so
      // a Text node reads undefined and calling it throws TypeError (not a
      // function) — no Core element check is reached.
      for (const name of ["matches", "closest", "querySelector", "querySelectorAll"]) {
        expect(text[name], `${name} must be undefined on a Text node`).toBeUndefined();
      }
      expect(thrown(() => text.matches("li")).message).toContain("text.matches is not a function");
      expect(thrown(() => text.closest("li")).message).toContain("text.closest is not a function");
      expect(thrown(() => text.querySelector("li")).message).toContain("text.querySelector is not a function");
      expect(thrown(() => text.querySelectorAll("li")).message).toContain("text.querySelectorAll is not a function");
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every query surface per T21", () => {
    const win = createWindow();
    const doc = win.document;
    build(win);
    const li = doc.querySelector(".item");
    win.destroy();

    const reads = [
      () => doc.querySelector("li"),
      () => doc.querySelectorAll("li"),
      () => doc.getElementById("list"),
      () => li.matches("li"),
      () => li.closest("ul"),
    ];
    for (const read of reads) {
      const err = thrown(read);
      expect(err, "every query read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
