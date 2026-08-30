// Live `childNodes` / `NodeList` facade extension (T25D).
//
// Implements the live childNodes collection behaviour without introducing any
// query index or `HTMLCollection`: a `NodeList` is bound to one parent node and
// re-reads that parent's children from Core on every access, so an existing
// collection reflects tree changes immediately while never caching a second
// authoritative tree state.
//
// # Frozen contract (T23A / T23B / T24)
//
// Every read delegates to the audited native navigation read
// `NodeHandle.childNodes()` (T23A, crates/mad-dom-bun/src/extensions/
// collection_api.rs) and every produced element funnels through `ctx.wrap` (the
// unique conversion entry), so element wrapper identity mirrors the native
// per-document weak cache (T20). Mutations go through the frozen T24C facade
// (`appendChild` / `insertBefore` / `removeChild` / `replaceChild`); a
// `NodeList` never mutates the tree itself and holds exactly the parent's
// opaque native handle — a Core `NodeId` never crosses this seam as a primitive
// and no stale id is ever dereferenced.
//
// # Snapshot vs live boundary
//
// `Node.prototype.childNodes` was frozen by T23B as a *snapshot* array of
// wrapped children (js/facade/extensions/node.js). This module owns the *live*
// collection: `NodeList` re-reads the same native surface on every access
// (length, index, iteration) and keeps a stable per-parent identity
// (`liveChildNodes`). Wiring `Node.prototype.childNodes` to return this live
// collection is the T25 gate's integration step; until then the facade still
// hands back the T23B snapshot.
//
// # Lifecycle and identity
//
// A `NodeList` holds the parent's native node handle strongly, so a live
// collection keeps its document's arena readable under GC (T20 ownership chain)
// exactly like a node wrapper does. The per-parent cache (`LIVE_LISTS`) is weak:
// a `NodeList` nobody references is collected together with its parent, and the
// same parent hands back one and the same `NodeList` object while it is alive.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes. The `seam`
// metadata stays `"placeholder"` until the T25 gate flips it.

export const seam = Object.freeze({
  id: "facade/extensions/child-nodelist",
  owner: "T25D",
  gate: "T25",
  status: "placeholder",
});

// Native parent handle behind each NodeList instance, keyed by the live proxy
// object: the Proxy forwards every method receiver to the proxy itself, so
// module state is reachable through the exact object JavaScript holds.
const PARENT_HANDLES = new WeakMap();

// Per-parent live collection cache (native parent handle → NodeList). Weak so
// the facade never pins a parent; a returned NodeList holds its parent's
// handle strongly (T20 ownership chain).
const LIVE_LISTS = new WeakMap();

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
 * Construction is restricted: it requires a genuine native node handle (only
 * minted by the native binding), so no facade surface can fabricate a
 * collection. Instances are normally produced through `liveChildNodes`.
 *
 * The returned object is a Proxy over the real instance: numeric index reads
 * (`list[0]`), `length`, `item` and the iteration surface all re-read the
 * parent's children from Core on every access, so the collection is live while
 * keeping no second copy of the tree.
 */
export class NodeList {
  constructor(parentHandle) {
    if (!isNodeHandle(parentHandle)) {
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
    return PARENT_HANDLES.get(this).childNodes().length;
  }, undefined);

  ctx.defineMethod(NodeList.prototype, "item", function item(index) {
    const nodes = PARENT_HANDLES.get(this).childNodes();
    const position = index >>> 0;
    if (position >= nodes.length) return null;
    return ctx.wrap(nodes[position]);
  });

  ctx.defineMethod(NodeList.prototype, "forEach", function forEach(callback, thisArg) {
    if (typeof callback !== "function") {
      throw new TypeError("NodeList.forEach requires a callback function");
    }
    const nodes = PARENT_HANDLES.get(this).childNodes();
    for (let i = 0; i < nodes.length; i += 1) {
      callback.call(thisArg, ctx.wrap(nodes[i]), i, this);
    }
  });

  ctx.defineMethod(NodeList.prototype, "entries", function* entries() {
    const nodes = PARENT_HANDLES.get(this).childNodes();
    for (let i = 0; i < nodes.length; i += 1) {
      yield [i, ctx.wrap(nodes[i])];
    }
  });

  ctx.defineMethod(NodeList.prototype, "keys", function* keys() {
    const nodes = PARENT_HANDLES.get(this).childNodes();
    for (let i = 0; i < nodes.length; i += 1) {
      yield i;
    }
  });

  ctx.defineMethod(NodeList.prototype, "values", function* values() {
    const nodes = PARENT_HANDLES.get(this).childNodes();
    for (let i = 0; i < nodes.length; i += 1) {
      yield ctx.wrap(nodes[i]);
    }
  });

  ctx.defineMethod(NodeList.prototype, Symbol.iterator, function* values() {
    const nodes = PARENT_HANDLES.get(this).childNodes();
    for (let i = 0; i < nodes.length; i += 1) {
      yield ctx.wrap(nodes[i]);
    }
  });
}
