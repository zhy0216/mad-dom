import { describe, expect, test } from "bun:test";

import { Document } from "../../js/facade/document.js";
import { Node } from "../../js/facade/extensions/node.js";
import { install, seam as mutationSeam } from "../../js/facade/extensions/mutation.js";
import { createWindow } from "../../js/facade/window.js";
import { isNativeAvailable } from "../../index.js";

// T24C facade mutation tests.
//
// The native T24A/T24B methods intentionally return `undefined` and live on
// DocumentHandle. This suite pins the WHATWG adaptation on Node.prototype:
// wrapper handles are recovered through the document context, native Core is
// the only tree authority, and successful calls return the corresponding
// facade wrapper with stable identity.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function names(node) {
  return node.childNodes.map((child) => child.nodeName);
}

function destroy(window) {
  if (window !== undefined) window.destroy();
}

describe("facade mutation export shape (T24C)", () => {
  test("mutation.js exports only install and its frozen seam", async () => {
    const mod = await import("../../js/facade/extensions/mutation.js");
    expect(Object.keys(mod).sort()).toEqual(["install", "seam"]);
    expect(mutationSeam.id).toBe("facade/extensions/mutation");
    expect(mutationSeam.owner).toBe("T24C");
    expect(mutationSeam.gate).toBe("T24");
    expect(mutationSeam.status).toBe("implemented");
    expect(Object.isFrozen(mutationSeam)).toBe(true);
  });
});

describe("facade mutation installation (T24C)", () => {
  test("uses only the sanctioned defineMethod helper", () => {
    const calls = [];
    const context = {
      defineMethod: (...args) => calls.push(args),
      wrap(value) {
        return value;
      },
      documentContext: Object.freeze({ handleOf: () => null }),
    };

    expect(() => install(context)).not.toThrow();
    expect(calls.map(([, name]) => name)).toEqual([
      "createDocumentFragment",
      "appendChild",
      "insertBefore",
      "removeChild",
      "replaceChild",
    ]);
    for (const [target, name, fn] of calls) {
      expect(typeof fn, `${name} installer value`).toBe("function");
      expect(target === Document.prototype || target === Node.prototype).toBe(true);
    }
  });

  test("mutation methods and fragment creation have fixed descriptors", () => {
    const documentMethod = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "createDocumentFragment",
    );
    expect(documentMethod).toMatchObject({
      writable: false,
      enumerable: false,
      configurable: false,
    });
    expect(typeof documentMethod.value).toBe("function");

    for (const name of ["appendChild", "insertBefore", "removeChild", "replaceChild"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be an own method`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.writable).toBe(false);
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });
});

describe.skipIf(!nativeAvailable)("facade tree mutation (T24C)", () => {
  test("appendChild and insertBefore adapt arguments and return the inserted wrapper", () => {
    const window = createWindow();
    try {
      const document = window.document;
      const parent = document.createElement("parent");
      const first = document.createElement("first");
      const last = document.createElement("last");
      const middle = document.createElement("middle");

      expect(parent.appendChild(first)).toBe(first);
      expect(parent.appendChild(last)).toBe(last);
      expect(parent.insertBefore(middle, last)).toBe(middle);
      expect(names(parent)).toEqual(["first", "middle", "last"]);
      expect(parent.firstChild).toBe(first);
      expect(parent.lastChild).toBe(last);
      expect(middle.parentNode).toBe(parent);

      // Reordering is delegated to Core and does not mint a second wrapper.
      expect(parent.insertBefore(last, first)).toBe(last);
      expect(names(parent)).toEqual(["last", "first", "middle"]);
      expect(parent.childNodes[0]).toBe(last);
    } finally {
      destroy(window);
    }
  });

  test("removeChild returns the removed wrapper and keeps it live for reinsertion", () => {
    const window = createWindow();
    try {
      const document = window.document;
      const parent = document.createElement("parent");
      const child = document.createElement("child");
      const label = document.createTextNode("label");
      child.appendChild(label);
      parent.appendChild(child);

      expect(parent.removeChild(child)).toBe(child);
      expect(parent.childNodes).toEqual([]);
      expect(child.parentNode).toBeNull();
      expect(label.parentNode).toBe(child);
      expect(parent.appendChild(child)).toBe(child);
      expect(parent.firstChild).toBe(child);
      expect(child.firstChild).toBe(label);
    } finally {
      destroy(window);
    }
  });

  test("moving a subtree between parents preserves descendants and wrapper identity", () => {
    const window = createWindow();
    try {
      const document = window.document;
      const source = document.createElement("source");
      const target = document.createElement("target");
      const branch = document.createElement("branch");
      const leaf = document.createTextNode("leaf");
      branch.appendChild(leaf);
      source.appendChild(branch);

      expect(target.appendChild(branch)).toBe(branch);
      expect(source.childNodes).toEqual([]);
      expect(branch.parentNode).toBe(target);
      expect(branch.firstChild).toBe(leaf);
      expect(leaf.parentNode).toBe(branch);
      expect(target.firstChild).toBe(branch);
    } finally {
      destroy(window);
    }
  });

  test("replaceChild maps WHATWG argument and return order", () => {
    const window = createWindow();
    try {
      const document = window.document;
      const parent = document.createElement("parent");
      const oldChild = document.createElement("old");
      const newChild = document.createElement("new");
      parent.appendChild(oldChild);

      expect(parent.replaceChild(newChild, oldChild)).toBe(oldChild);
      expect(parent.firstChild).toBe(newChild);
      expect(oldChild.parentNode).toBeNull();
      expect(newChild.parentNode).toBe(parent);
    } finally {
      destroy(window);
    }
  });

  test("DocumentFragment is created and spliced by all native mutations", () => {
    const window = createWindow();
    try {
      const document = window.document;
      const parent = document.createElement("parent");
      const before = document.createElement("before");
      const after = document.createElement("after");
      const fragment = document.createDocumentFragment();
      const one = document.createElement("one");
      const two = document.createElement("two");

      parent.appendChild(before);
      parent.appendChild(after);
      fragment.appendChild(one);
      fragment.appendChild(two);

      expect(parent.insertBefore(fragment, after)).toBe(fragment);
      expect(names(parent)).toEqual(["before", "one", "two", "after"]);
      expect(fragment.childNodes).toEqual([]);
      expect(one.parentNode).toBe(parent);
      expect(two.parentNode).toBe(parent);

      const replacement = document.createDocumentFragment();
      const three = document.createElement("three");
      replacement.appendChild(three);
      expect(parent.replaceChild(replacement, one)).toBe(one);
      expect(names(parent)).toEqual(["before", "three", "two", "after"]);
      expect(replacement.childNodes).toEqual([]);
      expect(one.parentNode).toBeNull();
    } finally {
      destroy(window);
    }
  });

  test("cross-document and hierarchy failures are atomic", () => {
    const firstWindow = createWindow();
    const secondWindow = createWindow();
    try {
      const firstDocument = firstWindow.document;
      const secondDocument = secondWindow.document;
      const parent = firstDocument.createElement("parent");
      const child = firstDocument.createElement("child");
      const foreign = secondDocument.createElement("foreign");
      parent.appendChild(child);
      const before = names(parent);

      const wrongDocument = thrown(() => parent.appendChild(foreign));
      expect(wrongDocument).toBeInstanceOf(Error);
      expect(wrongDocument.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
      expect(names(parent)).toEqual(before);
      expect(foreign.parentNode).toBeNull();

      const self = thrown(() => parent.appendChild(parent));
      expect(self).toBeInstanceOf(Error);
      expect(self.code).toBe("ERR_MAD_DOM_HIERARCHY");
      expect(names(parent)).toEqual(before);

      const detachedReference = firstDocument.createElement("reference");
      const candidate = firstDocument.createElement("candidate");
      const badReference = thrown(() => parent.insertBefore(candidate, detachedReference));
      expect(badReference).toBeInstanceOf(Error);
      expect(badReference.code).toBe("ERR_MAD_DOM_HIERARCHY");
      expect(names(parent)).toEqual(before);
      expect(candidate.parentNode).toBeNull();

      const foreignReference = secondDocument.createElement("foreign-reference");
      const foreignReferenceError = thrown(() => parent.insertBefore(candidate, foreignReference));
      expect(foreignReferenceError).toBeInstanceOf(Error);
      expect(foreignReferenceError.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
      expect(names(parent)).toEqual(before);

      const branch = firstDocument.createElement("branch");
      const leaf = firstDocument.createElement("leaf");
      branch.appendChild(leaf);
      parent.appendChild(branch);
      const beforeCycle = names(parent);
      const cycleError = thrown(() => leaf.appendChild(parent));
      expect(cycleError).toBeInstanceOf(Error);
      expect(cycleError.code).toBe("ERR_MAD_DOM_HIERARCHY");
      expect(names(parent)).toEqual(beforeCycle);
      expect(branch.parentNode).toBe(parent);
      expect(leaf.parentNode).toBe(branch);
    } finally {
      destroy(firstWindow);
      destroy(secondWindow);
    }
  });

  test("invalid wrappers fail before any native tree write", () => {
    const window = createWindow();
    try {
      const document = window.document;
      const parent = document.createElement("parent");
      const child = document.createElement("child");

      for (const call of [
        () => parent.appendChild({}),
        () => parent.insertBefore(child, null),
        () => parent.removeChild(undefined),
        () => parent.replaceChild({}, child),
        () => Node.prototype.appendChild.call({}, child),
      ]) {
        const error = thrown(call);
        expect(error).toBeInstanceOf(TypeError);
      }
      expect(parent.childNodes).toEqual([]);
    } finally {
      destroy(window);
    }
  });

  test("failed replaceChild calls leave the old child and siblings untouched", () => {
    const firstWindow = createWindow();
    const secondWindow = createWindow();
    try {
      const firstDocument = firstWindow.document;
      const secondDocument = secondWindow.document;
      const parent = firstDocument.createElement("parent");
      const before = firstDocument.createElement("before");
      const oldChild = firstDocument.createElement("old");
      const after = firstDocument.createElement("after");
      const foreign = secondDocument.createElement("foreign");
      parent.appendChild(before);
      parent.appendChild(oldChild);
      parent.appendChild(after);
      const children = parent.childNodes;

      const foreignError = thrown(() => parent.replaceChild(foreign, oldChild));
      expect(foreignError).toBeInstanceOf(Error);
      expect(foreignError.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
      expect(parent.childNodes).toEqual(children);
      expect(oldChild.parentNode).toBe(parent);

      const ancestorError = thrown(() => parent.replaceChild(parent, oldChild));
      expect(ancestorError).toBeInstanceOf(Error);
      expect(ancestorError.code).toBe("ERR_MAD_DOM_HIERARCHY");
      expect(parent.childNodes).toEqual(children);
      expect(before.nextSibling).toBe(oldChild);
      expect(oldChild.nextSibling).toBe(after);
    } finally {
      destroy(firstWindow);
      destroy(secondWindow);
    }
  });

  test("destroyed document errors are preserved from the native boundary", () => {
    const window = createWindow();
    const document = window.document;
    const parent = document.createElement("parent");
    const child = document.createElement("child");
    window.destroy();

    for (const call of [
      () => parent.appendChild(child),
      () => parent.removeChild(child),
      () => parent.replaceChild(child, child),
    ]) {
      const error = thrown(call);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
