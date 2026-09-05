// Live `childNodes` / `NodeList` facade extension (T25D).
//
// Implements the live childNodes collection behaviour without introducing any
// query index or `HTMLCollection`: a `NodeList` is bound to one parent node and
// re-reads that parent's children from Core on every access, so an existing
// collection reflects tree changes immediately while never caching a second
// authoritative tree state.
//
// # Native reads and wrapper identity
//
// Current bindings transfer document-scoped tokens plus immutable node kinds
// through DocumentHandle.childNodesTokens(). The facade creates canonical
// wrappers lazily through the same conversion used by queries/navigation.
// Older bindings and direct raw-handle collections keep NodeHandle.childNodes().
// Both paths read the current Core child list on every access. A token never
// exposes a Core NodeId, and native validation retains lifecycle errors.
//
// # Snapshot vs live boundary
//
// `Node.prototype.childNodes` was frozen by T23B as a *snapshot* array of
// wrapped children (js/facade/extensions/node.js). The T25 gate rewired that
// accessor to this module's `liveChildNodes`, so today `childNodes` hands back
// the live collection directly: `NodeList` re-reads the same native surface on
// every access (length, index, iteration) and keeps a stable per-parent identity
// (`liveChildNodes`).
//
// # Lifecycle and identity
//
// A `NodeList` holds its native parent or facade wrapper strongly, so a live
// collection keeps its document's arena readable under GC (T20 ownership chain)
// exactly like a node wrapper does. The per-parent cache (`LIVE_LISTS`) is weak:
// a `NodeList` nobody references is collected together with its parent, and the
// same parent hands back one and the same `NodeList` object while it is alive.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes. The `seam`
// metadata was flipped from `"placeholder"` to `"implemented"` by the T25 gate
// (tests/bun/seam.test.js pins that shape).

import { nodeInternalsOf, nodeHandleOf } from "./classes.js";
import { snapshotNodes } from "./snapshot-node.js";

export const seam = Object.freeze({
  id: "facade/extensions/child-nodelist",
  owner: "T25D",
  gate: "T25",
  // The seam status was flipped from "placeholder" to "implemented" by the T25
  // gate (tests/bun/seam.test.js pins that shape).
  status: "implemented",
});

// The owning Window facade of a native node handle (happy-dom NodeList.forEach
// defaults the callback `this` to the Window instance). `ctx.wrap` converts the
// parent's owner document and `windowFacadeOfDocument` resolves its window.
function windowFacadeOfParent(ctx, parentHandle) {
  try {
    const state = nodeInternalsOf(parentHandle)?.documentState;
    const documentFacade = ctx.wrap(state === undefined ? parentHandle.ownerDocument() : state.documentHandle);
    const windowFacade = ctx.windowFacadeOfDocument(documentFacade);
    return windowFacade ?? undefined;
  } catch {
    return undefined;
  }
}

// Native parent handle or facade wrapper behind each list, keyed by its proxy
// object: the Proxy forwards every method receiver to the proxy itself, so
// module state is reachable through the exact object JavaScript holds.
const PARENT_HANDLES = new WeakMap();

// Per-parent live collection cache (native handle or facade → NodeList). Weak so
// the facade never pins a parent; a returned NodeList holds its parent's
// handle strongly (T20 ownership chain).
const LIVE_LISTS = new WeakMap();

function childCount(list) {
  const parent = PARENT_HANDLES.get(list);
  const internals = nodeInternalsOf(parent);
  const method = internals?.documentState?.nativeMethods.childNodesTokens;
  if (method !== undefined && internals.token !== undefined) {
    return (method(internals.token).length - 1) / 2;
  }
  return (internals === undefined ? parent : nodeHandleOf(parent)).childNodes().length;
}

function readNodes(ctx, list) {
  const parent = PARENT_HANDLES.get(list);
  const internals = nodeInternalsOf(parent);
  const state = internals?.documentState;
  const method = state?.nativeMethods.childNodesTokens;
  if (method !== undefined && internals.token !== undefined && state.nativeMethods.materializeNodeToken !== undefined) {
    return snapshotNodes(ctx, state, method(internals.token));
  }
  const handle = internals === undefined ? parent : nodeHandleOf(parent);
  return handle.childNodes().map((node) => ctx.wrap(node));
}

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

// True canonical array indices ("0", "1", …, "4294967294"); everything else
// returns null so non-index properties fall through to the prototype surface.
function toArrayIndex(property) {
  if (typeof property !== "string") return null;
  const index = Number(property);
  if (!Number.isInteger(index) || index < 0 || index > 0xfffffffe) return null;
  if (String(index) !== property) return null;
  return index;
}

/**
 * Live `NodeList` facade for one parent node.
 *
 * Construction requires a genuine native node handle or an authenticated
 * facade node with its private document state. Instances are normally produced through `liveChildNodes`.
 *
 * The returned object is a Proxy over the real instance: numeric index reads
 * (`list[0]`), `length`, `item` and the iteration surface all re-read the
 * parent's children from Core on every access, so the collection is live while
 * keeping no second copy of the tree.
 */
export class NodeList {
  constructor(parentHandle) {
    const internals = nodeInternalsOf(parentHandle);
    if (!(internals?.documentState !== undefined &&
        (internals.token !== undefined || isNodeHandle(internals.handle))) && !isNodeHandle(parentHandle)) {
      throw new TypeError(
        "NodeList can only be constructed from a genuine native Node handle",
      );
    }
    const proxy = new Proxy(this, {
      get(target, property, receiver) {
        const index = toArrayIndex(property);
        if (index !== null) {
          // Array-index reads return the wrapped node, or `undefined` past the
          // end — exactly like a real NodeList, and unlike `item()` which
          // returns `null`.
          const item = Reflect.get(target, "item", receiver);
          const node = item.call(receiver, index);
          return node ?? undefined;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    PARENT_HANDLES.set(proxy, parentHandle);
    return proxy;
  }
}

/**
 * Returns the live childNodes collection for `parentHandle`, reusing one and
 * the same `NodeList` object per parent while it stays alive.
 */
export function liveChildNodes(parentHandle) {
  let list = LIVE_LISTS.get(parentHandle);
  if (list === undefined) {
    list = new NodeList(parentHandle);
    LIVE_LISTS.set(parentHandle, list);
  }
  return list;
}

/**
 * Installs the live `NodeList` surface.
 *
 * `ctx.defineMethod` / `ctx.defineAccessor` are the only property-definition
 * paths used; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface. Every read
 * re-delegates to the native parent handle through the `ctx.wrap` conversion
 * entry captured here, so no second authoritative tree state exists.
 */
export function install(ctx) {
  ctx.defineAccessor(NodeList.prototype, "length", function length() {
    return childCount(this);
  }, undefined);

  ctx.defineMethod(NodeList.prototype, "item", function item(index) {
    const nodes = readNodes(ctx, this);
    const position = index >>> 0;
    if (position >= nodes.length) return null;
    return nodes[position];
  });

  ctx.defineMethod(NodeList.prototype, "forEach", function forEach(callback, thisArg) {
    if (typeof callback !== "function") {
      throw new TypeError("NodeList.forEach requires a callback function");
    }
    // happy-dom defaults `this` to the owning Window instance when no `thisArg`
    // is provided; the owner document of the parent node resolves the window.
    const defaultThis = windowFacadeOfParent(ctx, PARENT_HANDLES.get(this));
    const nodes = readNodes(ctx, this);
    for (let i = 0; i < nodes.length; i += 1) {
      callback.call(thisArg === undefined ? defaultThis : thisArg, nodes[i], i, this);
    }
  });

  ctx.defineMethod(NodeList.prototype, "entries", function* entries() {
    const nodes = readNodes(ctx, this);
    for (let i = 0; i < nodes.length; i += 1) {
      yield [i, nodes[i]];
    }
  });

  ctx.defineMethod(NodeList.prototype, "keys", function* keys() {
    const length = childCount(this);
    for (let i = 0; i < length; i += 1) {
      yield i;
    }
  });

  ctx.defineMethod(NodeList.prototype, "values", function* values() {
    const nodes = readNodes(ctx, this);
    for (let i = 0; i < nodes.length; i += 1) {
      yield nodes[i];
    }
  });

  ctx.defineMethod(NodeList.prototype, Symbol.iterator, function* values() {
    const nodes = readNodes(ctx, this);
    for (let i = 0; i < nodes.length; i += 1) {
      yield nodes[i];
    }
  });

  // `[object NodeList]` from `Object.prototype.toString` (happy-dom NodeList
  // defines the `Symbol.toStringTag`).
  ctx.defineAccessor(NodeList.prototype, Symbol.toStringTag, function toStringTag() {
    return "NodeList";
  }, undefined);
}
