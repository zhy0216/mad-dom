// T33 extended-node JavaScript surface integration tests.
//
// Exercises the T33 facade + native + Core slice end to end through the public
// `createWindow()` surface: `CharacterData` (`data` / `length` / `nodeValue` /
// `substringData` / `appendData` / `insertData` / `deleteData` /
// `replaceData`), `Text.splitText`, `createProcessingInstruction` /
// `createComment`, `ProcessingInstruction.target`, the `DocumentType` payload
// reads, `document.doctype`, and the clone family (`cloneNode` / `importNode` /
// `adoptNode`) — including cross-document separation (no `NodeId` reuse) and
// the frozen error taxonomy.
import { afterAll, describe, expect, test } from "bun:test";
import { createWindow } from "../../index.js";

// Every created window is tracked and destroyed after the file's tests, so no
// document outlives this suite and the shared-process live-document counter
// (asserted by the native GC tests) stays clean.
const createdWindows = [];

function freshWindow() {
  const win = createWindow();
  createdWindows.push(win);
  return win;
}

function fresh() {
  return freshWindow().document;
}

function openSecondWindow() {
  return freshWindow();
}

afterAll(() => {
  for (const win of createdWindows) {
    win.destroy();
  }
});

// ---- CharacterData surface ----

describe("CharacterData surface (T33)", () => {
  test("data and length read and write on Text, Comment and ProcessingInstruction", () => {
    const document = fresh();
    const text = document.createTextNode("hello");
    const comment = document.createComment("a comment");
    const pi = document.createProcessingInstruction("xml-stylesheet", "href=x");

    expect(text.data).toBe("hello");
    expect(text.length).toBe(5);
    expect(comment.data).toBe("a comment");
    expect(comment.length).toBe(9);
    expect(pi.data).toBe("href=x");
    expect(pi.length).toBe(6);

    text.data = "world";
    expect(text.data).toBe("world");
    expect(text.length).toBe(5);
    comment.data = 42;
    expect(comment.data).toBe("42");
    pi.data = "y";
    expect(pi.data).toBe("y");
  });

  test("data setter coerces with String like a WebIDL DOMString", () => {
    const document = fresh();
    const text = document.createTextNode("x");
    text.data = 42;
    expect(text.data).toBe("42");
    text.data = null;
    expect(text.data).toBe("null");
    text.data = false;
    expect(text.data).toBe("false");
  });

  test("data / length read undefined on non-character-data kinds", () => {
    const document = fresh();
    const element = document.createElement("div");
    expect(element.data).toBeUndefined();
    expect(element.length).toBeUndefined();
  });

  test("nodeValue reads and writes data, null on other kinds", () => {
    const document = fresh();
    const text = document.createTextNode("a");
    const element = document.createElement("div");

    expect(text.nodeValue).toBe("a");
    text.nodeValue = "b";
    expect(text.nodeValue).toBe("b");
    expect(text.data).toBe("b");

    expect(element.nodeValue).toBeNull();
    element.nodeValue = "x";
    expect(element.nodeValue).toBeNull();
  });

  test("substringData follows the WHATWG offset semantics", () => {
    const document = fresh();
    const text = document.createTextNode("hello world");
    expect(text.substringData(0, 5)).toBe("hello");
    expect(text.substringData(6, 5)).toBe("world");
    expect(text.substringData(6, 100)).toBe("world");
    expect(text.substringData(100, 5)).toBe("");
  });

  test("appendData / insertData / deleteData / replaceData mutate in place", () => {
    const document = fresh();
    const text = document.createTextNode("hello world");
    text.appendData("!");
    expect(text.data).toBe("hello world!");
    text.insertData(6, "beautiful ");
    expect(text.data).toBe("hello beautiful world!");
    text.deleteData(0, 5);
    expect(text.data).toBe(" beautiful world!");
    text.replaceData(0, 5, "X");
    expect(text.data).toBe("Xtiful world!");
  });

  test("offset arguments are ToUint32-shaped and work on Comment and PI", () => {
    const document = fresh();
    const text = document.createTextNode("abcdef");
    text.deleteData(0.9, 2);
    expect(text.data).toBe("cdef");
    const comment = document.createComment("a comment");
    expect(comment.substringData(2, 4)).toBe("comm");
    const pi = document.createProcessingInstruction("xml-stylesheet", "abcdef");
    pi.replaceData(1, 2, "XY");
    expect(pi.data).toBe("aXYdef");
  });

  test("mutators throw the frozen taxonomy on ineligible kinds", () => {
    const document = fresh();
    const element = document.createElement("div");
    const fragment = document.createDocumentFragment();
    for (const node of [element, fragment]) {
      expect(() => node.substringData(0, 1)).toThrow(/.+ERR_MAD_DOM_HIERARCHY/);
      expect(() => node.appendData("x")).toThrow(/.+ERR_MAD_DOM_HIERARCHY/);
      expect(() => node.insertData(0, "x")).toThrow(/.+ERR_MAD_DOM_HIERARCHY/);
      expect(() => node.deleteData(0, 1)).toThrow(/.+ERR_MAD_DOM_HIERARCHY/);
      expect(() => node.replaceData(0, 1, "x")).toThrow(/.+ERR_MAD_DOM_HIERARCHY/);
    }
  });

  test("out-of-range insert/delete/replace offsets throw ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS atomically", () => {
    const document = fresh();
    const text = document.createTextNode("abc");
    expect(() => text.insertData(4, "x")).toThrow(/.+ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS/);
    expect(() => text.deleteData(4, 1)).toThrow(/.+ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS/);
    expect(() => text.replaceData(4, 1, "x")).toThrow(/.+ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS/);
    expect(text.data).toBe("abc");
  });

  test("a NUL byte in a data write is stored verbatim", () => {
    const document = fresh();
    const text = document.createTextNode("keep");
    text.data = "a\u0000b";
    expect(text.data).toBe("a\u0000b");
    text.appendData("c\u0000d");
    expect(text.data).toBe("a\u0000bc\u0000d");
    text.replaceData(0, 1, "\u0000");
    expect(text.data).toBe("\u0000\u0000bc\u0000d");
  });
});

// ---- splitText ----

describe("Text.splitText (T33)", () => {
  test("splits a text in the tree and inserts the tail right after it", () => {
    const document = fresh();
    const parent = document.createElement("p");
    const text = document.createTextNode("abcdef");
    parent.appendChild(text);

    const tail = text.splitText(3);
    expect(text.data).toBe("abc");
    expect(tail.data).toBe("def");
    expect(tail.nodeType).toBe(3);
    expect(tail.parentNode).toBe(parent);
    expect(Array.from(parent.childNodes, (node) => node.data)).toEqual(["abc", "def"]);
    expect(text.nextSibling).toBe(tail);
    expect(tail.previousSibling).toBe(text);
  });

  test("split at 0 and at the length", () => {
    const document = fresh();
    const parent = document.createElement("p");
    const text = document.createTextNode("abc");
    parent.appendChild(text);

    const tail = text.splitText(0);
    expect(text.data).toBe("");
    expect(tail.data).toBe("abc");
    expect(parent.childNodes.length).toBe(2);

    const empty = tail.splitText(3);
    expect(tail.data).toBe("abc");
    expect(empty.data).toBe("");
  });

  test("a detached text stays detached after splitting", () => {
    const document = fresh();
    const text = document.createTextNode("detached");
    const tail = text.splitText(2);
    expect(text.data).toBe("de");
    expect(tail.data).toBe("tached");
    expect(text.parentNode).toBeNull();
    expect(tail.parentNode).toBeNull();
  });

  test("out-of-range offset throws ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS", () => {
    const document = fresh();
    const text = document.createTextNode("abc");
    expect(() => text.splitText(4)).toThrow(/.+ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS/);
    expect(text.data).toBe("abc");
  });

  test("a non-Text receiver throws ERR_MAD_DOM_HIERARCHY", () => {
    const document = fresh();
    const comment = document.createComment("c");
    const pi = document.createProcessingInstruction("xml-stylesheet", "d");
    expect(() => comment.splitText(0)).toThrow(/.+ERR_MAD_DOM_HIERARCHY/);
    expect(() => pi.splitText(0)).toThrow(/.+ERR_MAD_DOM_HIERARCHY/);
  });
});

// ---- ProcessingInstruction ----

describe("ProcessingInstruction (T33)", () => {
  test("createProcessingInstruction returns a typed, detached node", () => {
    const document = fresh();
    const pi = document.createProcessingInstruction("xml-stylesheet", "href=\"style.css\"");
    expect(pi.nodeType).toBe(7);
    expect(pi.nodeName).toBe("xml-stylesheet");
    expect(pi.target).toBe("xml-stylesheet");
    expect(pi.data).toBe("href=\"style.css\"");
    expect(pi.parentNode).toBeNull();
  });

  test("invalid targets and ?>/NUL data", () => {
    const document = fresh();
    expect(() => document.createProcessingInstruction("", "d")).toThrow(
      /.+ERR_MAD_DOM_INVALID_CHARACTER/,
    );
    expect(() => document.createProcessingInstruction("1xml", "d")).toThrow(
      /.+ERR_MAD_DOM_INVALID_CHARACTER/,
    );
    expect(() => document.createProcessingInstruction("a b", "d")).toThrow(
      /.+ERR_MAD_DOM_INVALID_CHARACTER/,
    );
    expect(() => document.createProcessingInstruction("target", "a?>b")).toThrow(
      /.+ERR_MAD_DOM_INVALID_CHARACTER/,
    );
    // NUL in PI data is stored verbatim (T48B text-data alignment).
    const pi = document.createProcessingInstruction("target", "a\u0000b");
    expect(pi.data).toBe("a\u0000b");
  });

  test("target reads undefined on other node kinds", () => {
    const document = fresh();
    const text = document.createTextNode("x");
    expect(text.target).toBeUndefined();
  });
});

// ---- createComment ----

describe("Document.createComment (T33)", () => {
  test("creates a detached Comment node with coerced data", () => {
    const document = fresh();
    const comment = document.createComment("note");
    expect(comment.nodeType).toBe(8);
    expect(comment.nodeName).toBe("#comment");
    expect(comment.data).toBe("note");
    expect(document.createComment(42).data).toBe("42");
  });
});

// ---- clone family ----

describe("cloneNode / importNode / adoptNode (T33)", () => {
  test("cloneNode shallow copies the node but not the children", () => {
    const document = fresh();
    const div = document.createElement("div");
    div.setAttribute("id", "a");
    const span = document.createElement("span");
    span.appendChild(document.createTextNode("hi"));
    div.appendChild(span);

    const shallow = div.cloneNode(false);
    expect(shallow).not.toBe(div);
    expect(shallow.getAttribute("id")).toBe("a");
    expect(shallow.childNodes.length).toBe(0);
    expect(shallow.parentNode).toBeNull();
    expect(div.childNodes.length).toBe(1);
  });

  test("cloneNode deep copies the subtree with fresh node identities", () => {
    const document = fresh();
    const div = document.createElement("div");
    const span = document.createElement("span");
    const text = document.createTextNode("hi");
    span.appendChild(text);
    div.appendChild(span);

    const deep = div.cloneNode(true);
    expect(deep).not.toBe(div);
    expect(deep.childNodes.length).toBe(1);
    expect(deep.firstChild).not.toBe(span);
    expect(deep.firstChild.firstChild).not.toBe(text);
    expect(deep.firstChild.firstChild.data).toBe("hi");
    expect(deep.firstChild.firstChild.parentNode).toBe(deep.firstChild);
  });

  test("cloneNode preserves data for Text, Comment, PI and DocumentFragment", () => {
    const document = fresh();
    const text = document.createTextNode("hi");
    expect(text.cloneNode(true).data).toBe("hi");
    const comment = document.createComment("note");
    expect(comment.cloneNode(true).data).toBe("note");
    const pi = document.createProcessingInstruction("xml-stylesheet", "href=x");
    const piClone = pi.cloneNode(true);
    expect(piClone.data).toBe("href=x");
    expect(piClone.target).toBe("xml-stylesheet");
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement("x"));
    expect(fragment.cloneNode(true).childNodes.length).toBe(1);
    expect(fragment.cloneNode(false).childNodes.length).toBe(0);
  });

  test("importNode copies into this document leaving the source untouched", () => {
    const document = fresh();
    const div = document.createElement("outer");
    const inner = document.createElement("inner");
    inner.setAttribute("k", "v");
    div.appendChild(inner);

    const imported = document.importNode(div, true);
    expect(imported).not.toBe(div);
    expect(imported.childNodes.length).toBe(1);
    expect(imported.firstChild.getAttribute("k")).toBe("v");
    expect(imported.parentNode).toBeNull();
    expect(div.childNodes.length).toBe(1, "source untouched");

    expect(document.importNode(div, false).childNodes.length).toBe(0);
  });

  test("importNode across documents hands back a fresh target-document node", () => {
    const sourceWindow = openSecondWindow();
    const sourceDocument = sourceWindow.document;
    const text = sourceDocument.createTextNode("abc");
    const pi = sourceDocument.createProcessingInstruction("xml-stylesheet", "d=x");

    const imported = fresh().importNode(text, false);
    expect(imported).not.toBe(text);
    expect(imported.data).toBe("abc");
    expect(text.parentNode).toBeNull();
    expect(fresh().importNode(pi, false).data).toBe("d=x");
  });

  test("adoptNode on a same-document node detaches it and returns the same node", () => {
    const document = fresh();
    const parent = document.createElement("p");
    const child = document.createElement("c");
    parent.appendChild(child);

    const adopted = document.adoptNode(child);
    expect(adopted).toBe(child);
    expect(child.parentNode).toBeNull();
    expect(parent.childNodes.length).toBe(0);
  });

  test("adoptNode across documents moves the subtree into this document", () => {
    const document = fresh();
    const sourceWindow = openSecondWindow();
    const sourceDocument = sourceWindow.document;
    const container = sourceDocument.createElement("container");
    const src = sourceDocument.createElement("src");
    const child = sourceDocument.createElement("child");
    container.appendChild(src);
    src.appendChild(child);

    const adopted = document.adoptNode(src);
    expect(adopted).not.toBe(src);
    expect(adopted.nodeType).toBe(1);
    expect(adopted.parentNode).toBeNull();
    expect(adopted.firstChild.nodeType).toBe(1);
    expect(container.childNodes.length).toBe(0, "source tree repaired");
  });
});

// ---- DocumentType / document.doctype ----

describe("DocumentType and document.doctype (T33)", () => {
  test("a fresh document has no doctype", () => {
    const document = fresh();
    expect(document.doctype).toBeNull();
  });

  test("a parsed doctype exposes name/publicId/systemId with stable identity", () => {
    const document = fresh();
    document.parseHtml(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html><body></body></html>',
    );
    const dt = document.doctype;
    expect(dt).not.toBeNull();
    expect(dt.nodeType).toBe(10);
    expect(dt.nodeName).toBe("html");
    expect(dt.name).toBe("html");
    expect(dt.publicId).toBe("-//W3C//DTD XHTML 1.0 Strict//EN");
    expect(dt.systemId).toBe("http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd");
    expect(document.doctype).toBe(dt);
    expect(dt.cloneNode(true).nodeName).toBe("html");
  });

  test("doctype reads are undefined on other node kinds", () => {
    const document = fresh();
    const text = document.createTextNode("x");
    expect(text.name).toBeUndefined();
    expect(text.publicId).toBeUndefined();
    expect(text.systemId).toBeUndefined();
  });
});

// ---- cross-document separation ----

describe("cross-document separation (T33)", () => {
  test("a stale adopted handle fails with ERR_MAD_DOM_STALE_HANDLE", () => {
    const document = fresh();
    const sourceDocument = openSecondWindow().document;
    const src = sourceDocument.createElement("src");
    document.adoptNode(src);

    // The old source handle outlived its slot: every read fails with the
    // frozen stale-handle taxonomy instead of aliasing a new node.
    expect(() => src.nodeName()).toThrow(/.+ERR_MAD_DOM_STALE_HANDLE/);
  });

  test("a destroyed document rejects the extended-node surface", () => {
    const window = openSecondWindow();
    const document = window.document;
    const text = document.createTextNode("x");
    window.destroy();
    expect(() => text.substringData(0, 1)).toThrow(/.+ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    expect(() => text.splitText(0)).toThrow(/.+ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    expect(() => text.data).toThrow(/.+ERR_MAD_DOM_DOCUMENT_DESTROYED/);
  });
});
