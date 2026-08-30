import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Document } from "../../js/facade/document.js";
import { Node } from "../../js/facade/extensions/node.js";
import { NodeFilter, NodeIterator, TreeWalker } from "../../js/facade/extensions/tree-traversal.js";
import { Window } from "../../js/facade/window.js";

// T35 TreeWalker / NodeIterator integration tests.
//
// They drive the complete traversal surface through the official package entry
// (index.js → js/entry.js) and the facade classes and pin the acceptance
// criteria:
//
//   - order — nextNode visits the subtree in document (pre)order and
//     previousNode walks it backwards, with and without a filter;
//   - filtering — whatToShow masks node types inline and the user filter
//     (function or acceptNode object) accepts/rejects/skips candidates,
//     REJECT pruning a subtree and SKIP descending into it;
//   - current node — currentNode reads and writes with stable identity through
//     ctx.wrap, and the directional methods (parentNode / firstChild /
//     lastChild / nextSibling / previousSibling) move it as specified;
//   - NodeIterator — the first nextNode filters the root itself, then walks in
//     document order; previousNode walks backwards;
//   - mutation — removing a node mid-walk never leaves the walker touching a
//     dangling id: the walk continues over the surviving tree and the removed
//     subtree's nodes are simply no longer visited;
//   - reentrancy — a filter that mutates the tree is observed by the next
//     step, and a throwing filter propagates out of the call while the current
//     node stays put;
//   - errors — a non-Node root/currentNode throws a TypeError, and a destroyed
//     document fails every Core-touching traversal surface per T21 (the pure
//     root/currentNode accessors keep returning the stored wrappers).
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
    '<div id="a"><span id="a1"></span></div><div id="b"><p id="b1"></p><p id="b2"></p></div>';
  const doc = window.document;
  const env = {
    doc,
    body: doc.body,
    a: doc.getElementById("a"),
    a1: doc.getElementById("a1"),
    b: doc.getElementById("b"),
    b1: doc.getElementById("b1"),
    b2: doc.getElementById("b2"),
  };
  // MAD DOM has no Element.id facade yet, so tests identify nodes by identity
  // against the captured references: `keys(nodes)` maps each one to its id
  // string (or its nodeName for nodes not in the map).
  const keyOf = new Map();
  for (const [name, node] of Object.entries(env)) {
    if (node instanceof Node) keyOf.set(node, name);
  }
  env.keys = (nodes) => nodes.map((node) => keyOf.get(node) ?? node.nodeName);
  return env;
}

/// Collects the nodes `nextNode()` returns until it is null.
function collectNodes(walker) {
  const nodes = [];
  let node;
  while ((node = walker.nextNode()) !== null) nodes.push(node);
  return nodes;
}

describe("T35 traversal surface shape", () => {
  test("NodeFilter constants match the baseline", () => {
    expect(NodeFilter.FILTER_ACCEPT).toBe(1);
    expect(NodeFilter.FILTER_REJECT).toBe(2);
    expect(NodeFilter.FILTER_SKIP).toBe(3);
    expect(NodeFilter.SHOW_ALL).toBe(-1);
    expect(NodeFilter.SHOW_ELEMENT).toBe(1);
    expect(NodeFilter.SHOW_ATTRIBUTE).toBe(2);
    expect(NodeFilter.SHOW_TEXT).toBe(4);
    expect(NodeFilter.SHOW_CDATA_SECTION).toBe(8);
    expect(NodeFilter.SHOW_ENTITY_REFERENCE).toBe(16);
    expect(NodeFilter.SHOW_ENTITY).toBe(32);
    expect(NodeFilter.SHOW_PROCESSING_INSTRUCTION).toBe(64);
    expect(NodeFilter.SHOW_COMMENT).toBe(128);
    expect(NodeFilter.SHOW_DOCUMENT).toBe(256);
    expect(NodeFilter.SHOW_DOCUMENT_TYPE).toBe(512);
    expect(NodeFilter.SHOW_DOCUMENT_FRAGMENT).toBe(1024);
    expect(NodeFilter.SHOW_NOTATION).toBe(2048);
  });

  test("the facade installs createTreeWalker/createNodeIterator with frozen descriptors", () => {
    for (const name of ["createTreeWalker", "createNodeIterator"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
      expect(descriptor, `Document.${name}`).toBeDefined();
      expect(typeof descriptor.value, `Document.${name}`).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
      expect(descriptor.writable).toBe(false);
    }
    for (const name of ["root", "whatToShow", "filter", "currentNode"]) {
      expect(
        Object.getOwnPropertyDescriptor(TreeWalker.prototype, name),
        `TreeWalker.${name}`,
      ).toBeDefined();
    }
    for (const name of [
      "parentNode",
      "firstChild",
      "lastChild",
      "nextSibling",
      "previousSibling",
      "nextNode",
      "previousNode",
    ]) {
      expect(typeof TreeWalker.prototype[name], `TreeWalker.${name}`).toBe("function");
    }
    for (const name of ["nextNode", "previousNode"]) {
      expect(typeof NodeIterator.prototype[name], `NodeIterator.${name}`).toBe("function");
    }
    // Window surface accessors.
    expect(Object.getOwnPropertyDescriptor(Window.prototype, "NodeFilter")).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(Window.prototype, "TreeWalker")).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(Window.prototype, "NodeIterator")).toBeDefined();
  });
});

describe.skipIf(!nativeAvailable)("T35 TreeWalker order and navigation", () => {
  test("nextNode visits the subtree in document pre-order", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT);
      expect(walker.root).toBe(env.body);
      expect(walker.currentNode).toBe(env.body);
      expect(env.keys(collectNodes(walker))).toEqual(["a", "a1", "b", "b1", "b2"]);
      expect(walker.currentNode).toBe(env.b2);
      expect(walker.nextNode()).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("previousNode walks the subtree backwards", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode() !== env.b2) {}
      const ids = [];
      let node;
      while ((node = walker.previousNode()) !== null) ids.push(env.keys([node])[0]);
      expect(ids).toEqual(["b1", "b", "a1", "a", "body"]);
    } finally {
      win.destroy();
    }
  });

  test("directional methods move the current node", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT);
      expect(walker.firstChild()).toBe(env.a);
      expect(walker.currentNode).toBe(env.a);
      expect(walker.firstChild()).toBe(env.a1);
      expect(walker.parentNode()).toBe(env.a);
      expect(walker.parentNode()).toBe(env.body);
      expect(walker.parentNode()).toBeNull();
      expect(walker.lastChild()).toBe(env.b);
      expect(walker.lastChild()).toBe(env.b2);
      expect(walker.previousSibling()).toBe(env.b1);
      expect(walker.nextSibling()).toBe(env.b2);
      expect(walker.nextSibling()).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("currentNode is settable and identity is stable through ctx.wrap", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT);
      walker.currentNode = env.a;
      expect(walker.currentNode).toBe(env.a);
      expect(walker.currentNode).toBe(walker.currentNode);
      expect(walker.nextNode()).toBe(env.a1);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T35 filtering and whatToShow", () => {
  test("a REJECT filter prunes the rejected subtree", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(
        env.body,
        win.NodeFilter.SHOW_ELEMENT,
        (node) => (node === env.a ? win.NodeFilter.FILTER_REJECT : win.NodeFilter.FILTER_ACCEPT),
      );
      expect(env.keys(collectNodes(walker))).toEqual(["b", "b1", "b2"]);
    } finally {
      win.destroy();
    }
  });

  test("a SKIP filter descends into the skipped subtree", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(
        env.body,
        win.NodeFilter.SHOW_ELEMENT,
        (node) => (node === env.a ? win.NodeFilter.FILTER_SKIP : win.NodeFilter.FILTER_ACCEPT),
      );
      expect(env.keys(collectNodes(walker))).toEqual(["a1", "b", "b1", "b2"]);
    } finally {
      win.destroy();
    }
  });

  test("an acceptNode object filter keeps `this` bound to the object", () => {
    const win = createWindow();
    try {
      const env = build(win);
      let seenThis = null;
      const filter = {
        acceptNode(node) {
          seenThis = this;
          return node === env.b1 ? win.NodeFilter.FILTER_REJECT : win.NodeFilter.FILTER_ACCEPT;
        },
      };
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT, filter);
      expect(env.keys(collectNodes(walker))).toEqual(["a", "a1", "b", "b2"]);
      expect(seenThis).toBe(filter);
    } finally {
      win.destroy();
    }
  });

  test("whatToShow masks node types inline", () => {
    const win = createWindow();
    try {
      const env = build(win);
      // SHOW_TEXT over an all-element subtree yields nothing.
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_TEXT);
      expect(walker.nextNode()).toBeNull();
      // A text node appended into the tree becomes visible to SHOW_TEXT and
      // invisible to SHOW_ELEMENT.
      const text = env.doc.createTextNode("hello");
      env.body.appendChild(text);
      const textWalker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_TEXT);
      expect(textWalker.nextNode()).toBe(text);
      const elWalker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT);
      const collected = collectNodes(elWalker);
      expect(collected).not.toContain(text);
      expect(env.keys(collected)).toEqual(["a", "a1", "b", "b1", "b2"]);
    } finally {
      win.destroy();
    }
  });

  test("whatToShow is returned raw (the -1 default) while filtering uses the mask", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(env.body);
      expect(walker.whatToShow).toBe(-1);
      expect(walker.filter).toBeNull();
      // Default SHOW_ALL visits every node.
      expect(walker.nextNode()).toBe(env.a);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T35 NodeIterator", () => {
  test("the first nextNode returns the root, then walks in document order", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const iterator = env.doc.createNodeIterator(env.body, win.NodeFilter.SHOW_ELEMENT);
      expect(iterator.root).toBe(env.body);
      expect(iterator.nextNode()).toBe(env.body);
      expect(env.keys(collectNodes(iterator))).toEqual(["a", "a1", "b", "b1", "b2"]);
      expect(iterator.nextNode()).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("the first nextNode skips a rejected root", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const iterator = env.doc.createNodeIterator(
        env.body,
        win.NodeFilter.SHOW_ELEMENT,
        (node) =>
          node === env.body ? win.NodeFilter.FILTER_REJECT : win.NodeFilter.FILTER_ACCEPT,
      );
      expect(iterator.nextNode()).toBe(env.a);
    } finally {
      win.destroy();
    }
  });

  test("previousNode walks backwards and nextNode resumes forward", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const iterator = env.doc.createNodeIterator(env.body, win.NodeFilter.SHOW_ELEMENT);
      while (iterator.nextNode() !== env.b1) {}
      // From p#b1: previous climbs to div#b, then to span#a1 (via the previous
      // sibling div#a's last-child chain), then next walks forward again.
      expect(iterator.previousNode()).toBe(env.b);
      expect(iterator.previousNode()).toBe(env.a1);
      expect(iterator.nextNode()).toBe(env.b);
      expect(iterator.nextNode()).toBe(env.b1);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T35 mutation and reentrancy", () => {
  test("removing a node mid-walk never leaves the walker touching a dangling id", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT);
      expect(walker.nextNode()).toBe(env.a);
      // Remove span#a1 (a's child) while the walker's current is div#a.
      env.a.removeChild(env.a1);
      expect(env.keys(collectNodes(walker))).toEqual(["b", "b1", "b2"]);
      expect(walker.currentNode).toBe(env.b2);
    } finally {
      win.destroy();
    }
  });

  test("removing a node mid-iterator never leaves the iterator touching a dangling id", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const iterator = env.doc.createNodeIterator(env.body, win.NodeFilter.SHOW_ELEMENT);
      expect(iterator.nextNode()).toBe(env.body);
      expect(iterator.nextNode()).toBe(env.a);
      // Remove span#a1 while the iterator's current is div#a; the iterator
      // continues at div#b and never revisits the removed subtree.
      env.a.removeChild(env.a1);
      expect(env.keys(collectNodes(iterator))).toEqual(["b", "b1", "b2"]);
      expect(iterator.nextNode()).toBeNull();
    } finally {
      win.destroy();
    }
  });

  test("a filter that mutates the tree is observed by the next step", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(
        env.body,
        win.NodeFilter.SHOW_ELEMENT,
        (node) => {
          if (node === env.a) {
            // Removing a1 mid-walk; the removed subtree is no longer visited.
            env.a.removeChild(env.a1);
          }
          return win.NodeFilter.FILTER_ACCEPT;
        },
      );
      const ids = env.keys(collectNodes(walker));
      expect(ids).toEqual(["a", "b", "b1", "b2"]);
      expect(ids).not.toContain("a1");
    } finally {
      win.destroy();
    }
  });

  test("a throwing filter propagates and leaves the current node unchanged", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT, () => {
        throw new Error("filter boom");
      });
      const error = thrown(() => walker.nextNode());
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("filter boom");
      expect(walker.currentNode).toBe(env.body);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T35 errors", () => {
  test("a non-Node root throws a TypeError", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const error = thrown(() => env.doc.createTreeWalker({}));
      expect(error).toBeInstanceOf(TypeError);
      const iteratorError = thrown(() => env.doc.createNodeIterator(null));
      expect(iteratorError).toBeInstanceOf(TypeError);
    } finally {
      win.destroy();
    }
  });

  test("a non-Node currentNode assignment throws a TypeError", () => {
    const win = createWindow();
    try {
      const env = build(win);
      const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT);
      const error = thrown(() => {
        walker.currentNode = 42;
      });
      expect(error).toBeInstanceOf(TypeError);
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every Core-touching traversal surface per T21", () => {
    const win = createWindow();
    const env = build(win);
    const walker = env.doc.createTreeWalker(env.body, win.NodeFilter.SHOW_ELEMENT);
    const iterator = env.doc.createNodeIterator(env.body, win.NodeFilter.SHOW_ELEMENT);
    win.destroy();
    // Core-touching operations fail with the frozen lifecycle error.
    for (const op of [
      () => walker.nextNode(),
      () => walker.parentNode(),
      () => {
        walker.currentNode = env.a;
      },
      () => iterator.nextNode(),
      () => iterator.previousNode(),
    ]) {
      const error = thrown(op);
      expect(error).toBeDefined();
      expect(error.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
    // Pure accessors keep returning the stored wrappers (no Core access).
    expect(walker.root).toBe(env.body);
    expect(walker.currentNode).toBe(env.body);
    expect(iterator.root).toBe(env.body);
  });
});
