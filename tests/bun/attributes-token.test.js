import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Document } from "../../js/facade/document.js";
import { Node, Element } from "../../js/facade/extensions/node.js";
import { HTMLElement } from "../../js/facade/extensions/html-element.js";
import {
  Attr,
  DOMTokenList,
  NamedNodeMap,
  install as installAttributeNodes,
  seam as attributeNodesSeam,
} from "../../js/facade/extensions/attribute-nodes.js";

// T34 attribute-node and token-list binding/facade tests.
//
// They pin the acceptance criteria of the vertical slice that connects the T34
// Core contract (crates/mad-dom-core/src/dom/attribute_nodes.rs) to the
// wrapper and JavaScript facade through the new M7 native extension
// (crates/mad-dom-bun/src/extensions/attribute_nodes_api.rs):
//
//   - `Element.attributes` hands back one and the same live `NamedNodeMap` per
//     element whose length / item / getNamedItem / indexed / named-getter /
//     iteration surface re-reads the ordered attribute list from Core on every
//     access, and whose `Attr` wrappers keep stable identity per attribute
//     name;
//   - the `Attr` surface (name / localName / prefix / namespaceURI / specified
//     / nodeType / ownerElement) and the `value` write-through update the
//     element's Core attribute storage, so no second DOM state exists;
//   - `Element.classList` hands back one and the same live `DOMTokenList` per
//     element whose mutators (add / remove / toggle / replace / contains) and
//     `value` accessor stay bidirectionally in sync with the `class`
//     attribute: a classList write is visible to getAttribute and an external
//     class write is visible to the next classList read;
//   - `document.createAttribute` mints a detached `Attr` and validates the
//     qualified name through Core;
//   - invalid tokens fail with the frozen taxonomy (ERR_MAD_DOM_SYNTAX for the
//     empty token, ERR_MAD_DOM_INVALID_CHARACTER for a whitespace token) and
//     leave the attribute unchanged; these are the documented WHATWG-over-
//     happy-dom deviations;
//   - a mutator that empties the token set removes the `class` attribute (the
//     WHATWG update steps; happy-dom stores `""` — a documented deviation);
//   - non-element nodes read `attributes` / `classList` as `null` and a
//     destroyed document fails every read/write per T21.
//
// Like the other native suites, the native-dependent block loads the locally
// built artifact (build/mad-dom.node) and skips without one. The structural
// block needs no native.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("attribute-node facade module shape (T34)", () => {
  test("attribute-nodes.js exports the classes, install and the frozen seam", async () => {
    const mod = await import("../../js/facade/extensions/attribute-nodes.js");
    expect(Object.keys(mod).sort()).toEqual([
      "Attr",
      "DOMTokenList",
      "NamedNodeMap",
      "install",
      "seam",
    ]);
  });

  test("the seam is flipped to implemented by the T34 gate", () => {
    expect(attributeNodesSeam.owner).toBe("T34");
    expect(attributeNodesSeam.gate).toBe("T34");
    expect(attributeNodesSeam.status).toBe("implemented");
    expect(Object.isFrozen(attributeNodesSeam)).toBe(true);
  });

  test("the T48A hierarchy: Element over Node, HTMLElement over Element, with no enumerable surface", () => {
    expect(Object.getPrototypeOf(Element.prototype)).toBe(Node.prototype);
    expect(Object.getPrototypeOf(HTMLElement.prototype)).toBe(Element.prototype);
    expect(Object.keys(Node.prototype)).toEqual([]);
  });
});

describe("attribute-node descriptors (T34)", () => {
  test("attributes / classList / namespaceURI are fixed accessors on Node.prototype", () => {
    for (const name of ["attributes", "classList", "namespaceURI"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be defined`).toBeDefined();
      expect(typeof descriptor.get).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });

  test("createAttribute is a fixed method on Document.prototype", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "createAttribute");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.value).toBe("function");
    expect(descriptor.writable).toBe(false);
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });
});

describe("attribute-node install surface (T34)", () => {
  test("installAttributeNodes defines the accessors and methods through ctx helpers", () => {
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
    expect(() => installAttributeNodes(mockCtx)).not.toThrow();

    const accessors = calls.filter(([kind]) => kind === "accessor").map(([, , name]) => name);
    const methods = calls.filter(([kind]) => kind === "method").map(([, , name]) => name);

    // Node accessors plus the NamedNodeMap / Attr / DOMTokenList prototype
    // accessors.
    for (const name of ["attributes", "classList", "namespaceURI", "length", "value"]) {
      expect(accessors, `${name} accessor must be installed`).toContain(name);
    }
    // Document.createAttribute and the NamedNodeMap / DOMTokenList methods.
    for (const name of ["createAttribute", "item", "getNamedItem", "add", "remove", "toggle", "replace", "contains"]) {
      expect(methods, `${name} method must be installed`).toContain(name);
    }
  });
});

describe.skipIf(!nativeAvailable)("NamedNodeMap read surface (T34)", () => {
  test("element.attributes is one live NamedNodeMap per element with the read surface", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("id", "root");
      el.setAttribute("class", "a b c");
      el.setAttribute("data-x", "1");

      const attrs = el.attributes;
      expect(attrs).toBeInstanceOf(NamedNodeMap);
      expect(el.attributes).toBe(attrs);
      expect(attrs.constructor.name).toBe("NamedNodeMap");
      expect(Object.prototype.toString.call(attrs)).toBe("[object NamedNodeMap]");

      expect(attrs.length).toBe(3);
      expect(attrs.item(0).name).toBe("id");
      expect(attrs.item(0).value).toBe("root");
      expect(attrs.item(99)).toBeNull();
      expect(attrs[1].name).toBe("class");
      expect(attrs[99]).toBeNull();
      expect(attrs.getNamedItem("class").value).toBe("a b c");
      expect(attrs.getNamedItem("nope")).toBeNull();
      expect(attrs["id"].name).toBe("id");
      expect(attrs["nope"]).toBeUndefined();
      expect(attrs.toString()).toBe("[object NamedNodeMap]");

      expect("id" in attrs).toBe(false);
      expect(0 in attrs).toBe(true);
      expect(99 in attrs).toBe(false);

      expect(Array.from(attrs, (attr) => attr.name)).toEqual(["id", "class", "data-x"]);
    } finally {
      win.destroy();
    }
  });

  test("Attr wrappers keep stable identity per attribute name", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("a", "1");
      const attrs = el.attributes;
      expect(attrs[0]).toBe(attrs[0]);
      expect(attrs.item(0)).toBe(attrs[0]);
      expect(attrs.getNamedItem("a")).toBe(attrs["a"]);
    } finally {
      win.destroy();
    }
  });

  test("Attr fixed fields and the live value write-through", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("id", "root");
      const attr = el.attributes[0];
      expect(attr.nodeType).toBe(2);
      expect(attr.name).toBe("id");
      expect(attr.localName).toBe("id");
      expect(attr.prefix).toBeNull();
      expect(attr.namespaceURI).toBeNull();
      expect(attr.specified).toBe(true);
      expect(attr.nodeName).toBe("id");
      expect(attr.ownerElement).toBe(el);
      expect(attr.value).toBe("root");

      attr.value = "newroot";
      expect(el.getAttribute("id")).toBe("newroot");
      expect(attr.value).toBe("newroot");
      expect(el.attributes[0].value).toBe("newroot");
    } finally {
      win.destroy();
    }
  });

  test("a retained NamedNodeMap stays live after external attribute changes", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("a", "1");
      el.setAttribute("b", "2");
      const attrs = el.attributes;
      expect(attrs.length).toBe(2);

      el.setAttribute("a", "updated");
      expect(attrs.length).toBe(2);
      expect(attrs.getNamedItem("a").value).toBe("updated");
      expect(attrs[0].value).toBe("updated");

      el.removeAttribute("b");
      expect(attrs.length).toBe(1);
      expect(attrs.getNamedItem("b")).toBeNull();
      expect(attrs[1]).toBeNull();

      el.setAttribute("c", "3");
      expect(attrs.length).toBe(2);
      expect(attrs[1].name).toBe("c");
    } finally {
      win.destroy();
    }
  });

  test("document.createAttribute mints a detached Attr and validates the name", () => {
    const win = createWindow();
    const doc = win.document;
    try {
      const created = doc.createAttribute("data-new");
      expect(created).toBeInstanceOf(Attr);
      expect(created.name).toBe("data-new");
      expect(created.localName).toBe("data-new");
      expect(created.value).toBeNull();
      expect(created.nodeType).toBe(2);
      expect(created.specified).toBe(true);
      expect(created.ownerElement).toBeNull();

      created.value = "v";
      expect(created.value).toBe("v");
      expect(created.ownerElement).toBeNull();

      const err = thrown(() => doc.createAttribute("1bad"));
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
    } finally {
      win.destroy();
    }
  });

  test("non-element nodes read attributes and classList as null, and namespaceURI as null", () => {
    const win = createWindow();
    const text = win.document.createTextNode("hi");
    try {
      expect(text.attributes).toBeNull();
      expect(text.classList).toBeNull();
      expect(text.namespaceURI).toBeNull();
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("DOMTokenList mutators and class sync (T34)", () => {
  test("classList is one live DOMTokenList per element with the read surface", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("class", "x y");
      const cl = el.classList;
      expect(cl).toBeInstanceOf(DOMTokenList);
      expect(el.classList).toBe(cl);
      expect(cl.constructor.name).toBe("DOMTokenList");
      expect(Object.prototype.toString.call(cl)).toBe("[object Object]");

      expect(cl.length).toBe(2);
      expect(cl.value).toBe("x y");
      expect(cl.item(0)).toBe("x");
      expect(cl.item(99)).toBeNull();
      expect(cl[0]).toBe("x");
      expect(cl[1]).toBe("y");
      expect(cl[2]).toBeUndefined();
      expect(cl.contains("x")).toBe(true);
      expect(cl.contains("nope")).toBe(false);
      expect(cl.contains("")).toBe(false);

      expect("x" in cl).toBe(false);
      expect(0 in cl).toBe(true);
      expect(2 in cl).toBe(false);

      expect(Array.from(cl)).toEqual(["x", "y"]);
      expect(Array.from(cl.entries())).toEqual([[0, "x"], [1, "y"]]);
      expect(Array.from(cl.keys())).toEqual([0, 1]);
      expect(Array.from(cl.values())).toEqual(["x", "y"]);
      expect(cl.toString()).toBe("x y");

      const seen = [];
      cl.forEach((token, index) => seen.push([index, token]));
      expect(seen).toEqual([[0, "x"], [1, "y"]]);
    } finally {
      win.destroy();
    }
  });

  test("classList.add/remove write back through the class attribute (single Core state)", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("class", "x y");
      const cl = el.classList;

      cl.add("z");
      expect(el.getAttribute("class")).toBe("x y z");
      expect(cl.value).toBe("x y z");

      cl.add("x", "w");
      expect(el.getAttribute("class")).toBe("x y z w");

      cl.remove("a");
      expect(el.getAttribute("class")).toBe("x y z w");

      cl.remove("x");
      expect(el.getAttribute("class")).toBe("y z w");
      expect(cl.contains("x")).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test("classList.toggle returns the resulting presence with and without force", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      const cl = el.classList;
      expect(cl.toggle("a")).toBe(true);
      expect(el.getAttribute("class")).toBe("a");
      expect(cl.toggle("a")).toBe(false);
      // The WHATWG update steps remove the attribute when the set is empty.
      expect(el.getAttribute("class")).toBeNull();
      expect(el.hasAttribute("class")).toBe(false);
      expect(cl.value).toBe("");

      expect(cl.toggle("b", true)).toBe(true);
      expect(cl.toggle("b", true)).toBe(true);
      expect(el.getAttribute("class")).toBe("b");
      expect(cl.toggle("b", false)).toBe(false);
      expect(el.hasAttribute("class")).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test("classList.replace returns true/false and updates the attribute", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("class", "a b");
      const cl = el.classList;
      expect(cl.replace("a", "c")).toBe(true);
      expect(el.getAttribute("class")).toBe("c b");
      expect(cl.replace("nope", "c")).toBe(false);
      expect(el.getAttribute("class")).toBe("c b");
    } finally {
      win.destroy();
    }
  });

  test("the value accessor stores and reads the raw attribute string verbatim", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      const cl = el.classList;
      cl.value = "  p  q   r ";
      expect(el.getAttribute("class")).toBe("  p  q   r ");
      expect(cl.value).toBe("  p  q   r ");
      expect(cl.length).toBe(3);
      expect(Array.from(cl)).toEqual(["p", "q", "r"]);
    } finally {
      win.destroy();
    }
  });

  test("a retained classList stays live after external class changes", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("class", "outer");
      const cl = el.classList;
      expect(cl.value).toBe("outer");
      expect(cl.length).toBe(1);

      el.setAttribute("class", "a b");
      expect(cl.value).toBe("a b");
      expect(cl.length).toBe(2);
      expect(cl.contains("outer")).toBe(false);

      el.removeAttribute("class");
      expect(cl.value).toBe("");
      expect(cl.length).toBe(0);
      expect(cl.contains("a")).toBe(false);

      // And a classList write is visible to a retained attribute read too.
      cl.add("back");
      expect(el.getAttribute("class")).toBe("back");
    } finally {
      win.destroy();
    }
  });

  test("empty and whitespace tokens fail with the frozen taxonomy and stay atomic", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    try {
      el.setAttribute("class", "keep");
      const cl = el.classList;

      const empty = thrown(() => cl.add(""));
      expect(empty).toBeInstanceOf(Error);
      expect(empty.code).toBe("ERR_MAD_DOM_SYNTAX");
      expect(empty.message).toContain("SyntaxError");

      const whitespace = thrown(() => cl.add("a b"));
      expect(whitespace).toBeInstanceOf(Error);
      expect(whitespace.code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
      expect(whitespace.message).toContain("InvalidCharacterError");

      // Failure atomicity: the rejected calls leave the attribute unchanged.
      expect(el.getAttribute("class")).toBe("keep");

      // The whole mutator family validates.
      expect(thrown(() => cl.remove("")).code).toBe("ERR_MAD_DOM_SYNTAX");
      expect(thrown(() => cl.remove("a b")).code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
      expect(thrown(() => cl.toggle("")).code).toBe("ERR_MAD_DOM_SYNTAX");
      expect(thrown(() => cl.toggle("a b")).code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
      expect(thrown(() => cl.replace("", "x")).code).toBe("ERR_MAD_DOM_SYNTAX");
      expect(thrown(() => cl.replace("keep", "")).code).toBe("ERR_MAD_DOM_SYNTAX");
      expect(thrown(() => cl.replace("a b", "x")).code).toBe("ERR_MAD_DOM_INVALID_CHARACTER");
      expect(el.getAttribute("class")).toBe("keep");
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every attribute-node read/write per T21", () => {
    const win = createWindow();
    const el = win.document.createElement("div");
    el.setAttribute("class", "x");
    const attrs = el.attributes;
    const cl = el.classList;
    win.destroy();

    for (const call of [
      () => attrs.length,
      () => attrs.item(0),
      () => attrs.getNamedItem("class"),
      () => attrs[0].value,
      () => cl.length,
      () => cl.value,
      () => cl.contains("x"),
      () => cl.add("y"),
      () => cl.toggle("y"),
    ]) {
      const err = thrown(call);
      expect(err, "every attribute-node/token op on a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
