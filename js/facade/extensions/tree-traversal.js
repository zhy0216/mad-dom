// `TreeWalker` / `NodeIterator` / `NodeFilter` facade extension (T35).
//
// Installs the WHATWG traversal surface on `Document.prototype` —
// `createTreeWalker` / `createNodeIterator` — plus the `TreeWalker` /
// `NodeIterator` facade classes, the frozen `window.NodeFilter` constant
// object, and the `window.TreeWalker` / `window.NodeIterator` constructor
// accessors (surface parity with the baseline). Every traversal method
// delegates verbatim to the native T35 contract
// (crates/mad-dom-bun/src/extensions/traversal_api.rs) and through it to the
// Core traversal state machines (`mad_dom_core::traversal`), so the facade
// keeps **no second DOM state** and **no traversal logic**: Core owns the
// `whatToShow` mask and the pre-order / reverse / sibling algorithms, and the
// binding invokes the user filter one candidate at a time.
//
// # Walker state on the facade
//
// The walker's *position* (root / current / filter) lives in the native
// handle, which holds stable node wrappers — `walker.currentNode` reads
// through `ctx.wrap` so identity is the per-document weak cache. The facade
// only stores the two *configuration* values the baseline exposes as plain
// properties: the raw `whatToShow` (the native receives the coerced unsigned
// value, so the getter returns the raw `-1` default exactly like the
// baseline) and the user filter object/function (the native holds the wrapped
// function). These are configuration, not DOM state.
//
// # Filter wrapping
//
// The user filter is a function (called with the facade node) or an object
// with `acceptNode`. The facade wraps both into one stable function that
// receives the native node handle, converts it through the unique `ctx.wrap`
// entry and returns the raw `FILTER_*` number. A function filter is invoked
// with `this` unbound (a deliberate, unobserved simplification — the baseline
// binds it to the walker); an object filter's `acceptNode` keeps `this` bound
// to the filter object. The wrapper is *not* exception-swallowing: a throwing
// filter propagates out of the traversal call, matching the baseline.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes.

import { Document } from "../document.js";
import { Node } from "./node.js";
import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/tree-traversal",
  owner: "T35",
  gate: "T35",
  status: "implemented",
});

// Native handle behind each facade walker/iterator.
const WALKER_HANDLES = new WeakMap();
const ITER_HANDLES = new WeakMap();

// Raw `whatToShow` and the user filter object/function (configuration the
// baseline exposes as plain properties; the native receives the coerced mask
// and the wrapped filter).
const WALKER_WHAT = new WeakMap();
const WALKER_FILTER = new WeakMap();
const ITER_WHAT = new WeakMap();
const ITER_FILTER = new WeakMap();

/**
 * The WHATWG `NodeFilter` constant object (`window.NodeFilter`).
 *
 * `SHOW_ALL` is the signed `-1` exactly like the baseline; the traversal
 * compares it as the coerced `unsigned long` (`0xFFFFFFFF`).
 */
export const NodeFilter = Object.freeze({
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
  SHOW_ALL: -1,
  SHOW_ELEMENT: 1,
  SHOW_ATTRIBUTE: 2,
  SHOW_TEXT: 4,
  SHOW_CDATA_SECTION: 8,
  SHOW_ENTITY_REFERENCE: 16,
  SHOW_ENTITY: 32,
  SHOW_PROCESSING_INSTRUCTION: 64,
  SHOW_COMMENT: 128,
  SHOW_DOCUMENT: 256,
  SHOW_DOCUMENT_TYPE: 512,
  SHOW_DOCUMENT_FRAGMENT: 1024,
  SHOW_NOTATION: 2048,
});

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function isDocumentHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.destroy === "function" &&
    typeof handle.appendChild === "function"
  );
}

function isTreeWalkerHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nextNode === "function" &&
    typeof handle.setCurrentNode === "function"
  );
}

function isNodeIteratorHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nextNode === "function" &&
    typeof handle.previousNode === "function" &&
    typeof handle.whatToShow === "function" &&
    typeof handle.setCurrentNode !== "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

function facadeDocumentHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isDocumentHandle(handle)) {
    throw new TypeError(`Document.${role} requires a genuine Document facade wrapper`);
  }
  return handle;
}

/**
 * Wraps the user filter into the stable function the native binding stores.
 *
 * Accepts a function or an object with `acceptNode`; `null`/`undefined` means
 * "no filter" and is passed through as `null`.
 */
function wrapFilter(ctx, filter) {
  if (filter == null) return null;
  if (typeof filter === "function") {
    return function filterWrapper(nativeNode) {
      return filter(ctx.wrap(nativeNode));
    };
  }
  if (typeof filter.acceptNode === "function") {
    const acceptNode = filter.acceptNode;
    return function filterWrapper(nativeNode) {
      return acceptNode.call(filter, ctx.wrap(nativeNode));
    };
  }
  throw new TypeError(
    "Failed to execute 'createTreeWalker' on 'Document': parameter 3 is not of type 'NodeFilter'.",
  );
}

/**
 * Facade wrapper for a native `TreeWalkerHandle`.
 *
 * Construction is restricted: it requires a genuine native walker handle (only
 * minted by `document.createTreeWalker`); everything else throws a `TypeError`.
 */
export class TreeWalker {
  constructor(nativeHandle) {
    if (!isTreeWalkerHandle(nativeHandle)) {
      throw new TypeError(
        "TreeWalker can only be constructed from a genuine native TreeWalker handle",
      );
    }
    WALKER_HANDLES.set(this, nativeHandle);
  }
}

/**
 * Facade wrapper for a native `NodeIteratorHandle`.
 *
 * Construction is restricted like the walker: only
 * `document.createNodeIterator` mints a genuine native iterator handle.
 */
export class NodeIterator {
  constructor(nativeHandle) {
    if (!isNodeIteratorHandle(nativeHandle)) {
      throw new TypeError(
        "NodeIterator can only be constructed from a genuine native NodeIterator handle",
      );
    }
    ITER_HANDLES.set(this, nativeHandle);
  }
}

/**
 * Installs the T35 traversal surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  ctx.registerHandleType("TreeWalkerHandle", (handle) => new TreeWalker(handle));
  ctx.registerHandleType("NodeIteratorHandle", (handle) => new NodeIterator(handle));

  // Document surface.
  ctx.defineMethod(Document.prototype, "createTreeWalker", function createTreeWalker(root, whatToShow = -1, filter = null) {
    const handle = facadeDocumentHandle(ctx, this, "createTreeWalker");
    const rootHandle = facadeNodeHandle(ctx, root, "createTreeWalker");
    const nativeWalker = handle.createTreeWalker(rootHandle, whatToShow >>> 0, wrapFilter(ctx, filter));
    const walker = ctx.wrap(nativeWalker);
    WALKER_WHAT.set(walker, whatToShow);
    WALKER_FILTER.set(walker, filter);
    return walker;
  });

  ctx.defineMethod(Document.prototype, "createNodeIterator", function createNodeIterator(root, whatToShow = -1, filter = null) {
    const handle = facadeDocumentHandle(ctx, this, "createNodeIterator");
    const rootHandle = facadeNodeHandle(ctx, root, "createNodeIterator");
    const nativeIterator = handle.createNodeIterator(rootHandle, whatToShow >>> 0, wrapFilter(ctx, filter));
    const iterator = ctx.wrap(nativeIterator);
    ITER_WHAT.set(iterator, whatToShow);
    ITER_FILTER.set(iterator, filter);
    return iterator;
  });

  // Window surface: `window.NodeFilter` constants plus the constructor
  // accessors (surface parity with the baseline).
  ctx.defineAccessor(Window.prototype, "NodeFilter", function getNodeFilter() {
    return NodeFilter;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "TreeWalker", function getTreeWalker() {
    return TreeWalker;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "NodeIterator", function getNodeIterator() {
    return NodeIterator;
  }, undefined);

  // TreeWalker surface.
  ctx.defineAccessor(TreeWalker.prototype, "root", function root() {
    return ctx.wrap(WALKER_HANDLES.get(this).root());
  }, undefined);

  ctx.defineAccessor(TreeWalker.prototype, "whatToShow", function whatToShow() {
    return WALKER_WHAT.get(this);
  }, undefined);

  ctx.defineAccessor(TreeWalker.prototype, "filter", function filter() {
    return WALKER_FILTER.get(this);
  }, undefined);

  ctx.defineAccessor(TreeWalker.prototype, "currentNode", function currentNode() {
    return ctx.wrap(WALKER_HANDLES.get(this).currentNode());
  }, function setCurrentNode(node) {
    WALKER_HANDLES.get(this).setCurrentNode(facadeNodeHandle(ctx, node, "currentNode"));
  });

  ctx.defineMethod(TreeWalker.prototype, "parentNode", function parentNode() {
    return ctx.wrap(WALKER_HANDLES.get(this).parentNode());
  });

  ctx.defineMethod(TreeWalker.prototype, "firstChild", function firstChild() {
    return ctx.wrap(WALKER_HANDLES.get(this).firstChild());
  });

  ctx.defineMethod(TreeWalker.prototype, "lastChild", function lastChild() {
    return ctx.wrap(WALKER_HANDLES.get(this).lastChild());
  });

  ctx.defineMethod(TreeWalker.prototype, "nextSibling", function nextSibling() {
    return ctx.wrap(WALKER_HANDLES.get(this).nextSibling());
  });

  ctx.defineMethod(TreeWalker.prototype, "previousSibling", function previousSibling() {
    return ctx.wrap(WALKER_HANDLES.get(this).previousSibling());
  });

  ctx.defineMethod(TreeWalker.prototype, "nextNode", function nextNode() {
    return ctx.wrap(WALKER_HANDLES.get(this).nextNode());
  });

  ctx.defineMethod(TreeWalker.prototype, "previousNode", function previousNode() {
    return ctx.wrap(WALKER_HANDLES.get(this).previousNode());
  });

  // NodeIterator surface.
  ctx.defineAccessor(NodeIterator.prototype, "root", function root() {
    return ctx.wrap(ITER_HANDLES.get(this).root());
  }, undefined);

  ctx.defineAccessor(NodeIterator.prototype, "whatToShow", function whatToShow() {
    return ITER_WHAT.get(this);
  }, undefined);

  ctx.defineAccessor(NodeIterator.prototype, "filter", function filter() {
    return ITER_FILTER.get(this);
  }, undefined);

  ctx.defineMethod(NodeIterator.prototype, "nextNode", function nextNode() {
    return ctx.wrap(ITER_HANDLES.get(this).nextNode());
  });

  ctx.defineMethod(NodeIterator.prototype, "previousNode", function previousNode() {
    return ctx.wrap(ITER_HANDLES.get(this).previousNode());
  });
}
