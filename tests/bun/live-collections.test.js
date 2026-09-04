import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import { Document } from "../../js/facade/document.js";
import { HTMLCollection } from "../../js/facade/extensions/live-collections.js";
import { Node } from "../../js/facade/extensions/node.js";
import { loadNative } from "../../js/native-loader.js";

// T32 live collection integration tests.
//
// They drive the complete live-collection surface through the official package
// entry (index.js → js/entry.js) and pin the acceptance criteria:
//
//   - `getElementsByTagName` / `getElementsByClassName` return a *live*
//     `HTMLCollection`: an existing collection re-reads Core on every access
//     (length, item, namedItem, iteration, indexed and named reads), so a later
//     tree or attribute mutation is reflected immediately while a fresh query
//     agrees — no snapshot is ever kept;
//   - results come back in document order, tag matching is ASCII
//     case-insensitive, `"*"` matches every element, and class matching
//     requires every whitespace-separated token;
//   - the WHATWG `HTMLCollection` surface is wired: `length` / `item` /
//     `namedItem` / `Symbol.iterator` / `Symbol.toStringTag`, numeric index
//     reads, the named getter and `in` lookups, with `item` returning `null`
//     past the end and indexed reads returning `undefined`;
//   - identity semantics match happy-dom: each call mints a fresh collection
//     object while the matched element wrappers keep strict identity across
//     calls (T20);
//   - an `Element` scope matches descendants only; a fresh window's implied
//     skeleton answers like happy-dom's;
//   - errors follow the frozen taxonomy: a non-ParentNode scope throws
//     `ERR_MAD_DOM_HIERARCHY`, a destroyed document throws
//     `ERR_MAD_DOM_DOCUMENT_DESTROYED`, and WebIDL DOMString shaping applies to
//     the tag/class arguments. Empty or whitespace-only class names return an
//     empty collection (the WHATWG rule; happy-dom throws on them — a recorded
//     deviation pinned here).
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
    '<ul id="list" name="menu"><li class="item a" data-i="0">first</li>' +
    '<li class="item b" data-i="1">second</li><li data-i="2">third</li>' +
    '<span class="item a" id="tail" data-i="3">fourth</span></ul>' +
    '<p class="a">p</p>';
  return window.document;
}

describe("T32 live collection surface shape", () => {
  test("the facade installs the methods with frozen descriptors", () => {
    for (const name of ["getElementsByTagName", "getElementsByClassName"]) {
      const documentDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
      expect(documentDescriptor, `Document.${name}`).toBeDefined();
      expect(typeof documentDescriptor.value, `Document.${name}`).toBe("function");
      expect(documentDescriptor.enumerable).toBe(false);
      expect(documentDescriptor.configurable).toBe(false);
      expect(documentDescriptor.writable).toBe(false);

      const nodeDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(nodeDescriptor, `Node.${name}`).toBeDefined();
      expect(typeof nodeDescriptor.value, `Node.${name}`).toBe("function");
    }

    // The HTMLCollection carries the WHATWG read surface.
    for (const name of ["item", "namedItem", "toString", "toLocaleString"]) {
      expect(typeof HTMLCollection.prototype[name], `HTMLCollection.${name}`).toBe("function");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(HTMLCollection.prototype, "length");
    expect(typeof lengthDescriptor.get).toBe("function");
    const tagDescriptor = Object.getOwnPropertyDescriptor(HTMLCollection.prototype, Symbol.toStringTag);
    expect(typeof tagDescriptor.get).toBe("function");
    expect(typeof HTMLCollection.prototype[Symbol.iterator]).toBe("function");
  });

  test("length falls back to the node-producing query for an older native handle", () => {
    const tagReads = [];
    const legacyHandle = {
      getElementsByTagName(name) {
        tagReads.push(name);
        return [];
      },
      getElementsByClassName() {
        return [];
      },
    };
    const collection = new HTMLCollection(legacyHandle, "tag", "li");

    expect(collection.length).toBe(0);
    expect(tagReads).toEqual(["li"]);
  });
});

describe.skipIf(!nativeAvailable)("getElementsByTagName (T32)", () => {
  test("validates cheaply and counts length without materializing result nodes", () => {
    const nativeWindow = loadNative().createWindow();
    const nativeDocument = nativeWindow.document();
    const getByTag = nativeDocument.getElementsByTagName.bind(nativeDocument);
    const getByClass = nativeDocument.getElementsByClassName.bind(nativeDocument);
    const countByTag = nativeDocument.countElementsByTagName.bind(nativeDocument);
    const countByClass = nativeDocument.countElementsByClassName.bind(nativeDocument);
    const tagReads = [];
    const classReads = [];
    const tagCounts = [];
    const classCounts = [];
    nativeDocument.getElementsByTagName = (name) => {
      tagReads.push(name);
      return getByTag(name);
    };
    nativeDocument.getElementsByClassName = (name) => {
      classReads.push(name);
      return getByClass(name);
    };
    nativeDocument.countElementsByTagName = (name) => {
      tagCounts.push(name);
      return countByTag(name);
    };
    nativeDocument.countElementsByClassName = (name) => {
      classCounts.push(name);
      return countByClass(name);
    };

    const win = new Window(nativeWindow);
    try {
      const doc = build(win);
      tagReads.length = 0;
      classReads.length = 0;

      const lis = doc.getElementsByTagName("li");
      expect(tagReads).toEqual([]);
      expect(classReads).toEqual([""]);

      expect(lis.length).toBe(3);
      expect(tagCounts).toEqual(["li"]);
      expect(tagReads).toEqual([]);
      expect(classReads).toEqual([""]);

      // Node-producing reads keep using the full query and wrapper path.
      expect(lis[0].nodeName).toBe("LI");
      expect(tagReads).toEqual(["li"]);

      tagReads.length = 0;
      classReads.length = 0;
      tagCounts.length = 0;
      classCounts.length = 0;
      const items = doc.getElementsByClassName("item");
      expect(classReads).toEqual([""]);
      expect(items.length).toBe(3);
      expect(classCounts).toEqual(["item"]);
      expect(classReads).toEqual([""]);
    } finally {
      win.destroy();
    }
  });

  test("returns a live HTMLCollection in document order with case-insensitive tags", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const lis = doc.getElementsByTagName("li");
      expect(lis).toBeInstanceOf(HTMLCollection);
      expect(lis.length).toBe(3);
      expect(Array.from(lis, (li) => li.getAttribute("data-i"))).toEqual(["0", "1", "2"]);
      expect(doc.getElementsByTagName("LI").length).toBe(3);
      expect(doc.getElementsByTagName("Li").length).toBe(3);
      expect(doc.getElementsByTagName("*").length).toBe(9);
      expect(doc.getElementsByTagName("table").length).toBe(0);
      expect(doc.getElementsByTagName("").length).toBe(0);
    } finally {
      win.destroy();
    }
  });

  test("an element scope matches descendants only", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const list = doc.getElementById("list");
      expect(list.getElementsByTagName("li").length).toBe(3);
      expect(list.getElementsByTagName("ul").length).toBe(0);
      expect(list.getElementsByTagName("*").length).toBe(4);
      expect(doc.getElementsByTagName("p")[0].getElementsByTagName("span").length).toBe(0);
    } finally {
      win.destroy();
    }
  });

  test("a fresh window's implied skeleton answers like happy-dom", () => {
    const win = new Window();
    try {
      const doc = win.document;
      expect(doc.getElementsByTagName("html").length).toBe(1);
      expect(doc.getElementsByTagName("body").length).toBe(1);
      expect(doc.getElementsByTagName("*").length).toBe(3);
      expect(doc.getElementsByTagName("p").length).toBe(0);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("getElementsByClassName (T32)", () => {
  test("matches every whitespace token, in document order", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const a = doc.getElementsByClassName("a");
      // The trailing `<p class="a">` also matches, but carries no data-i.
      expect(Array.from(a, (el) => el.getAttribute("data-i"))).toEqual(["0", "3", null]);
      expect(doc.getElementsByClassName("item").length).toBe(3);
      expect(doc.getElementsByClassName("item a").length).toBe(2);
      expect(doc.getElementsByClassName("a item").length).toBe(2);
      expect(doc.getElementsByClassName("  item   a  ").length).toBe(2);
      expect(doc.getElementsByClassName("zzz").length).toBe(0);
    } finally {
      win.destroy();
    }
  });

  test("empty or whitespace-only class names are an empty collection", () => {
    const win = new Window();
    try {
      const doc = build(win);
      // The WHATWG rule; happy-dom throws a DOMException on these inputs
      // (a recorded deviation, covered by the Bun tests rather than the
      // differential scenario).
      expect(doc.getElementsByClassName("").length).toBe(0);
      expect(doc.getElementsByClassName("   ").length).toBe(0);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("HTMLCollection read surface (T32)", () => {
  test("item / indexed reads / iteration behave like happy-dom", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const items = doc.getElementsByClassName("item");
      expect(items.item(0).getAttribute("data-i")).toBe("0");
      expect(items.item(99)).toBeNull();
      expect(items.item(-1)).toBeNull();
      expect(items[1].getAttribute("data-i")).toBe("1");
      expect(items[99]).toBeUndefined();
      expect(Array.from(items).length).toBe(3);
      expect(Object.prototype.toString.call(items)).toBe("[object HTMLCollection]");
    } finally {
      win.destroy();
    }
  });

  test("namedItem matches the id or name attribute, and the named getter works", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const uls = doc.getElementsByTagName("ul");
      expect(uls.namedItem("list").getAttribute("id")).toBe("list");
      expect(uls.namedItem("menu").getAttribute("id")).toBe("list");
      expect(uls.namedItem("nope")).toBeNull();
      expect(uls["list"].getAttribute("id")).toBe("list");
      expect(uls["menu"].getAttribute("id")).toBe("list");
      expect(uls["nope"]).toBeUndefined();
      expect("list" in uls).toBe(true);
      expect("0" in uls).toBe(true);
      expect("99" in uls).toBe(false);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("live semantics (T32)", () => {
  test("an existing collection reflects a later attribute change", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const items = doc.getElementsByClassName("item");
      expect(items.length).toBe(3);

      doc.querySelector('[data-i="0"]').setAttribute("class", "b");
      expect(items.length, "the same collection reflects the attribute change").toBe(2);
      expect(items.item(0).getAttribute("data-i")).toBe("1");
      expect(doc.getElementsByClassName("item").length).toBe(2);
    } finally {
      win.destroy();
    }
  });

  test("an existing collection reflects a later tree mutation", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const divs = doc.getElementsByTagName("div");
      expect(divs.length).toBe(0);

      doc.body.appendChild(doc.createElement("div"));
      expect(divs.length, "the same collection reflects the append").toBe(1);
      expect(divs[0].nodeName).toBe("DIV");

      doc.body.removeChild(divs[0]);
      expect(divs.length, "the same collection reflects the removal").toBe(0);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("identity semantics (T32)", () => {
  test("each call mints a fresh collection while elements keep identity", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const first = doc.getElementsByTagName("li");
      const second = doc.getElementsByTagName("li");
      expect(first).not.toBe(second);
      expect(first[0]).toBe(second[0]);
      expect(first[0]).toBe(doc.querySelector("li"));
      // A document collection and an element-scoped collection share wrappers.
      expect(doc.getElementsByTagName("li")[0]).toBe(
        doc.getElementById("list").getElementsByTagName("li")[0],
      );
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("live collection errors and shaping (T32)", () => {
  test("non-ParentNode scopes fail with Hierarchy", () => {
    const win = new Window();
    try {
      const doc = build(win);
      const text = doc.createTextNode("plain");
      expect(thrown(() => text.getElementsByTagName("li")).code).toBe("ERR_MAD_DOM_HIERARCHY");
      expect(thrown(() => text.getElementsByClassName("a")).code).toBe("ERR_MAD_DOM_HIERARCHY");
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every live collection read per T21", () => {
    const win = new Window();
    const doc = win.document;
    build(win);
    const lis = doc.getElementsByTagName("li");
    win.destroy();

    for (const read of [() => doc.getElementsByTagName("li"), () => lis.length, () => lis.item(0)]) {
      const err = thrown(read);
      expect(err, "every live collection read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });

  test("WebIDL DOMString shaping applies to the tag and class arguments", () => {
    const win = new Window();
    try {
      const doc = build(win);
      // null becomes "null" — a valid tag/class that matches nothing.
      expect(doc.getElementsByTagName(null).length).toBe(0);
      expect(doc.getElementsByClassName(null).length).toBe(0);
      // 42 becomes "42" — a digit-led tag that matches nothing.
      expect(doc.getElementsByTagName(42).length).toBe(0);
    } finally {
      win.destroy();
    }
  });
});
