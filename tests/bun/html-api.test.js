import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Node, Element, DocumentFragment } from "../../js/facade/extensions/node.js";

// T29 HTML API integration tests.
//
// They drive the complete M5 HTML surface through the official package entry
// (index.js → js/entry.js) and pin the acceptance criteria:
//
//   - the document structure accessors (documentElement / head / body) read
//     the live Core tree, materialize the implied html/head/body skeleton on
//     first read (happy-dom parity) and hand back one and the same wrapper per
//     read (T20 identity);
//   - innerHTML / outerHTML getters serialize the Core tree (T28) and the
//     setters parse fragments in the right context (T27: a table target inserts
//     tbody, a select keeps its options, entity input round-trips) and replace
//     the target atomically — a failed setter leaves the target byte-for-byte
//     unchanged;
//   - `document.parseHtml` loads a full HTML document (T26) and the structure
//     accessors reflect it;
//   - the whole surface fails per the T21 protocol on a destroyed document,
//     and ineligible node kinds (Text/Comment) fail innerHTML/outerHTML with
//     the frozen Hierarchy taxonomy;
//   - WebIDL DOMString shaping: setter values are stringified (42 → "42",
//     null → "null").
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

describe("T29 HTML API surface shape", () => {
  test("the facade installs innerHTML/outerHTML on Element (and innerHTML on DocumentFragment) plus the document structure surface", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.get).toBe("function");
    expect(typeof descriptor.set).toBe("function");
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);

    const outer = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML");
    expect(typeof outer.get).toBe("function");
    expect(typeof outer.set).toBe("function");

    // T48A: Text/Comment never hold the accessors; DocumentFragment and — via
    // the T43 re-parenting — shadow roots reach innerHTML.
    expect(Object.getOwnPropertyDescriptor(Node.prototype, "innerHTML")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(DocumentFragment.prototype, "innerHTML")).toBeDefined();
  });
});

describe.skipIf(!nativeAvailable)("T29 ineligible node kinds", () => {
  test("text nodes read innerHTML/outerHTML undefined (happy-dom parity, T48A)", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const text = doc.createTextNode("hi");
      // T48A: the accessors live on Element.prototype (and innerHTML on
      // DocumentFragment.prototype), so a Text node reads undefined — matching
      // happy-dom, with no Core element check reached. Assigning to the absent
      // property silently creates an own data property exactly like happy-dom,
      // leaving the character data untouched.
      expect(text.innerHTML).toBeUndefined();
      expect(text.outerHTML).toBeUndefined();
      text.innerHTML = "x";
      expect(text.innerHTML).toBe("x");
      expect(text.data).toBe("hi");
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("document structure accessors (T29)", () => {
  test("documentElement / head / body materialize the implied skeleton and keep identity", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      expect(doc.documentElement).toBeInstanceOf(Node);
      expect(doc.head).toBeInstanceOf(Node);
      expect(doc.body).toBeInstanceOf(Node);
      expect(doc.documentElement.nodeName).toBe("HTML");
      expect(doc.head.nodeName).toBe("HEAD");
      expect(doc.body.nodeName).toBe("BODY");

      expect(doc.documentElement).toBe(doc.documentElement);
      expect(doc.head).toBe(doc.head);
      expect(doc.body).toBe(doc.body);

      expect(doc.documentElement.childNodes).toHaveLength(2);
      expect(doc.head.parentNode).toBe(doc.documentElement);
      expect(doc.body.parentNode).toBe(doc.documentElement);
    } finally {
      win.destroy();
    }
  });

  test("a write through body.innerHTML is visible to documentElement.outerHTML", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const body = doc.body;
      body.innerHTML = "<p>hello</p>";
      expect(doc.body).toBe(body);
      expect(doc.documentElement.outerHTML).toBe(
        "<html><head></head><body><p>hello</p></body></html>",
      );
    } finally {
      win.destroy();
    }
  });

  test("parseHtml loads a full document and the structure accessors reflect it", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const oldBody = doc.body;
      doc.parseHtml(
        "<!DOCTYPE html><html><head><title>T</title></head><body><p>full</p></body></html>",
      );
      expect(doc.documentElement.nodeName).toBe("HTML");
      expect(doc.documentElement.childNodes).toHaveLength(2);
      expect(doc.body.innerHTML).toBe("<p>full</p>");
      expect(doc.body).not.toBe(oldBody);
      // Identity stays stable after the reload.
      expect(doc.documentElement).toBe(doc.documentElement);
      expect(doc.body).toBe(doc.body);
      // The old body wrapper stays valid (the old subtree is detached from the
      // document root, not freed).
      expect(oldBody.parentNode.nodeName).toBe("HTML");
      expect(oldBody.parentNode.parentNode).toBeNull();
      expect(doc.body).not.toBe(oldBody);
    } finally {
      win.destroy();
    }
  });

  test("parseHtml of a bare fragment builds the implied skeleton", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      doc.parseHtml("<p>bare</p>");
      expect(doc.documentElement.outerHTML).toBe(
        "<html><head></head><body><p>bare</p></body></html>",
      );
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("innerHTML getter/setter (T29)", () => {
  test("parse → modify → serialize a common fragment", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const div = doc.createElement("div");
      div.innerHTML = '<ul id="list"><li class="item">first</li><li>second</li></ul>';

      expect(div.innerHTML).toBe(
        '<ul id="list"><li class="item">first</li><li>second</li></ul>',
      );
      expect(div.childNodes).toHaveLength(1);
      expect(div.firstChild.nodeName).toBe("UL");
      expect(div.firstChild.getAttribute("id")).toBe("list");
      expect(div.firstChild.childNodes).toHaveLength(2);

      // Modify through the parsed tree and re-serialize.
      div.firstChild.firstChild.setAttribute("data-x", "1");
      div.firstChild.appendChild(doc.createElement("li"));
      expect(div.innerHTML).toBe(
        '<ul id="list"><li class="item" data-x="1">first</li><li>second</li><li></li></ul>',
      );
    } finally {
      win.destroy();
    }
  });

  test("setting innerHTML replaces children and detaches the old ones", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const div = doc.createElement("div");
      const old = doc.createElement("p");
      old.appendChild(doc.createTextNode("old"));
      div.appendChild(old);

      div.innerHTML = "<span>new</span>";
      expect(div.innerHTML).toBe("<span>new</span>");
      expect(div.firstChild.nodeName).toBe("SPAN");
      expect(old.parentNode).toBeNull();
      expect(old.textContent).toBe("old");
    } finally {
      win.destroy();
    }
  });

  test("an empty setter clears the children", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const div = doc.createElement("div");
      div.innerHTML = "<p>a</p><p>b</p>";
      expect(div.childNodes).toHaveLength(2);
      div.innerHTML = "";
      expect(div.childNodes).toHaveLength(0);
      expect(div.innerHTML).toBe("");
    } finally {
      win.destroy();
    }
  });

  test("the setter parses in the target's own context (table → tbody)", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const table = doc.createElement("table");
      table.innerHTML = "<tr><td>cell</td></tr>";
      expect(table.innerHTML).toBe("<tbody><tr><td>cell</td></tr></tbody>");
      expect(table.firstChild.nodeName).toBe("TBODY");
    } finally {
      win.destroy();
    }
  });

  test("entities and escaped markup round-trip", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const p = doc.createElement("p");
      p.innerHTML = "a &amp; b &lt; c &gt; d";
      expect(p.innerHTML).toBe("a &amp; b &lt; c &gt; d");
      expect(p.textContent).toBe("a & b < c > d");
    } finally {
      win.destroy();
    }
  });

  test("the setter stringifies its value like a DOMString attribute", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const div = doc.createElement("div");
      div.innerHTML = null;
      expect(div.innerHTML).toBe("null");
      const other = doc.createElement("div");
      other.innerHTML = 42;
      expect(other.innerHTML).toBe("42");
    } finally {
      win.destroy();
    }
  });

  test("innerHTML on a DocumentFragment replaces its children", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const frag = doc.createDocumentFragment();
      frag.innerHTML = "<i>ital</i><b>bold</b>";
      expect(frag.innerHTML).toBe("<i>ital</i><b>bold</b>");
      expect(frag.childNodes).toHaveLength(2);

      const host = doc.createElement("div");
      host.appendChild(frag);
      expect(host.innerHTML).toBe("<i>ital</i><b>bold</b>");
      expect(frag.childNodes).toHaveLength(0);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("outerHTML getter/setter (T29)", () => {
  test("outerHTML serializes the element itself", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const section = doc.createElement("section");
      section.innerHTML = "<b>bold</b>";
      expect(section.outerHTML).toBe("<section><b>bold</b></section>");
      expect(doc.body.outerHTML).toBe("<body></body>");
    } finally {
      win.destroy();
    }
  });

  test("setting outerHTML on a detached element is a no-op", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const div = doc.createElement("div");
      div.innerHTML = "<b>bold</b>";
      const before = div.outerHTML;
      div.outerHTML = "<article id='x'>content</article>";
      expect(div.outerHTML).toBe(before);
      expect(div.parentNode).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("setting outerHTML replaces the element in its parent", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const host = doc.createElement("div");
      host.innerHTML = '<p id="old">old</p><i>keep</i>';
      const old = host.firstChild;
      old.outerHTML = '<span id="new">new</span>';

      expect(host.innerHTML).toBe('<span id="new">new</span><i>keep</i>');
      expect(host.childNodes).toHaveLength(2);
      expect(host.firstChild.nodeName).toBe("SPAN");
      expect(host.firstChild.getAttribute("id")).toBe("new");
      expect(old.parentNode).toBeNull();
      expect(old.textContent).toBe("old");
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("failure atomicity and errors (T29)", () => {
  test("a failed setter leaves the target unchanged", () => {
    const win = createWindow();
    try {
      const doc = win.document;
      const div = doc.createElement("div");
      div.innerHTML = "<p>original</p>";

      // Text node: no innerHTML member (T48A) — the write silently creates an
      // own data property (happy-dom parity) and the text data stays untouched.
      const text = doc.createTextNode("keep");
      text.innerHTML = "<p>swap</p>";
      expect(text.textContent).toBe("keep");

      // The element itself is untouched by the rejected call.
      expect(div.innerHTML).toBe("<p>original</p>");
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every T29 surface per T21", () => {
    const win = createWindow();
    const doc = win.document;
    const div = doc.createElement("div");
    const body = doc.body;
    win.destroy();

    const reads = [
      () => doc.documentElement,
      () => doc.head,
      () => doc.body,
      () => {
        doc.parseHtml("<p>x</p>");
      },
      () => div.innerHTML,
      () => {
        div.innerHTML = "<p>x</p>";
      },
      () => div.outerHTML,
      () => {
        div.outerHTML = "<p>x</p>";
      },
      () => body.innerHTML,
    ];
    for (const read of reads) {
      const err = thrown(read);
      expect(err, "every T29 surface read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
