// Live `getElementsByTagName` / `getElementsByClassName` collection facade
// extension (T32).
//
// Implements the WHATWG live `HTMLCollection` surface without keeping any
// second DOM state: a collection is bound to one native scope handle (the
// document, or the element it was created on) plus the query key, and re-reads
// Core on every access — length uses the native result-allocation-free count
// companion when available, while item, namedItem, indexed reads, iteration
// and the named getter re-run the native `getElementsByTagName` /
// `getElementsByClassName` node read. An existing collection therefore
// reflects any tree or attribute change immediately (the "live" acceptance).
//
// # Frozen contract (T32)
//
// Every read delegates to the native live-collection contract
// (crates/mad-dom-bun/src/extensions/live_collections.rs) and every produced
// element funnels through `ctx.wrap` (the unique conversion entry), so element
// wrapper identity mirrors the native per-document weak cache (T20). The Core
// T32 query index (when enabled) lives entirely inside Core and is kept in
// lock step by the mutation/attribute API; this facade never touches it.
//
// # Surface and identity
//
// The shape deliberately mirrors happy-dom's `HTMLCollection` observation for
// observation: a Proxy over the real instance whose `get` trap answers
// `length` first, then prototype/symbol properties, then numeric indices, then
// the named getter (an element whose `id` or `name` attribute equals the
// property name, via `namedItem`). `item` returns `null` past the end, indexed
// reads return `undefined`, `namedItem` returns `null` for a missing name, and
// the collection is iterable. Each `getElementsBy*` call mints a fresh
// `HTMLCollection` while the matched element wrappers keep strict identity
// across calls — exactly like happy-dom.
//
// # WebIDL argument shaping
//
// The tag/class arguments are coerced with `String` exactly like a WebIDL
// `DOMString` argument (`getElementsByTagName(null)` becomes `"null"`), so the
// native handle receives a plain string and Core stays the single source of
// tree truth. Empty or whitespace-only class names yield an empty collection
// (the WHATWG rule; happy-dom throws on them, which the Bun tests pin as our
// documented deviation).
//
// # Errors
//
// The native contract owns the DOM rules and the facade only forwards the
// frozen error: a non-`ParentNode` scope (`getElementsByTagName` on a `Text`
// node) throws `ERR_MAD_DOM_HIERARCHY`, and a destroyed document fails per
// T21.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes.

import { Document } from "../document.js";
import { Node } from "./node.js";

export const seam = Object.freeze({
  id: "facade/extensions/live-collections",
  owner: "T32",
  gate: "T32",
  status: "implemented",
});

// Native scope handle + query key behind each HTMLCollection instance, keyed
// by the live proxy object: the Proxy forwards every method receiver to the
// proxy itself, so module state is reachable through the exact object JS
// holds.
const COLLECTION_STATE = new WeakMap();

function isCollectionScopeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.getElementsByTagName === "function" &&
    typeof handle.getElementsByClassName === "function"
  );
}

function facadeScopeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isCollectionScopeHandle(handle)) {
    // A manually constructed Document/Node around a native handle is
    // intentionally not part of the reverse conversion cache. The live
    // collections accept only wrappers for which the facade can recover the
    // owning native handle, so native affinity and ownership checks remain
    // authoritative.
    throw new TypeError(`${role} requires a genuine Document or Element facade wrapper`);
  }
  return handle;
}

/**
 * Live `HTMLCollection` facade for one scope and one query key.
 *
 * Construction is restricted: it requires a genuine native scope handle (only
 * minted by the native binding), so no facade surface can fabricate a
 * collection. Instances are normally produced through `liveCollection`.
 *
 * The returned object is a Proxy over the real instance: `length`, `item`,
 * `namedItem`, numeric index reads, the named getter and the iteration surface
 * all re-read the scope's matching elements from Core on every access, so the
 * collection is live while keeping no second copy of the tree.
 */
export class HTMLCollection {
  constructor(scopeHandle, kind, key) {
    if (!isCollectionScopeHandle(scopeHandle)) {
      throw new TypeError(
        "HTMLCollection can only be constructed from a genuine native scope handle",
      );
    }
    if (kind !== "tag" && kind !== "class") {
      throw new TypeError("HTMLCollection requires a tag or class query kind");
    }
    if (typeof key !== "string") {
      throw new TypeError("HTMLCollection requires a string query key");
    }
    const proxy = new Proxy(this, {
      get(target, property, receiver) {
        if (property === "length") {
          return readLength(target);
        }
        if (property in target || typeof property === "symbol") {
          return Reflect.get(target, property, receiver);
        }
        const index = Number(property);
        if (!Number.isNaN(index)) {
          return readItems(target)[index];
        }
        return namedItemOf(target, property) ?? undefined;
      },
      has(target, property) {
        if (property in target) return true;
        const items = readItems(target);
        const index = Number(property);
        if (!Number.isNaN(index) && index >= 0 && index < items.length) return true;
        property = String(property);
        for (const item of items) {
          const name = item.getAttribute("id") || item.getAttribute("name");
          if (name && name === property) return true;
        }
        return false;
      },
      getOwnPropertyDescriptor(target, property) {
        if (property in target || typeof property === "symbol") return undefined;
        const items = readItems(target);
        const index = Number(property);
        if (!Number.isNaN(index) && index >= 0 && index < items.length) {
          return { value: items[index], writable: false, enumerable: true, configurable: true };
        }
        for (const item of items) {
          const name = item.getAttribute("id") || item.getAttribute("name");
          if (name && name === property) {
            return { value: item, writable: false, enumerable: true, configurable: true };
          }
        }
        return undefined;
      },
      ownKeys(target) {
        const keys = [];
        const items = readItems(target);
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const name = item.getAttribute("id") || item.getAttribute("name");
          keys.push(String(i));
          if (name) keys.push(name);
        }
        return keys;
      },
    });
    COLLECTION_STATE.set(proxy, { scopeHandle, kind, key });
    // The Proxy traps receive the real instance (`target`), while the
    // prototype methods are called with `this` bound to the proxy, so the
    // state is reachable under both keys — the shared object is the same.
    COLLECTION_STATE.set(this, { scopeHandle, kind, key });
    return proxy;
  }
}

/**
 * Re-reads the matched element wrappers of `collection` from Core through the
 * native scope handle — the single live read behind every accessor.
 */
function readItems(collection) {
  const { scopeHandle, kind, key } = COLLECTION_STATE.get(collection);
  const handles =
    kind === "tag"
      ? scopeHandle.getElementsByTagName(key)
      : scopeHandle.getElementsByClassName(key);
  return handles.map((handle) => windowCtx.wrap(handle));
}

/**
 * Re-counts the live query without materializing matched node wrappers when
 * the native binding provides the count companion. The fallback preserves
 * compatibility with older platform packages carrying only the original T32
 * node-producing methods.
 */
function readLength(collection) {
  const { scopeHandle, kind, key } = COLLECTION_STATE.get(collection);
  const count =
    kind === "tag"
      ? scopeHandle.countElementsByTagName
      : scopeHandle.countElementsByClassName;
  if (typeof count === "function") {
    return count.call(scopeHandle, key);
  }
  return readItems(collection).length;
}

// The `ctx` captured at install time (the unique conversion entry). Module
// state lives in `readItems`, so this only bridges the install closure to the
// prototype methods.
let windowCtx = null;

function namedItemOf(collection, name) {
  name = String(name);
  for (const item of readItems(collection)) {
    if (item.getAttribute("id") === name || item.getAttribute("name") === name) {
      return item;
    }
  }
  return null;
}

/**
 * Installs the T32 live collection surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  windowCtx = ctx;

  // Document surface.
  ctx.defineMethod(Document.prototype, "getElementsByTagName", function getElementsByTagName(tagName) {
    return liveCollection(ctx, this, "tag", String(tagName));
  });

  ctx.defineMethod(Document.prototype, "getElementsByClassName", function getElementsByClassName(className) {
    return liveCollection(ctx, this, "class", String(className));
  });

  // Element (Node) surface.
  ctx.defineMethod(Node.prototype, "getElementsByTagName", function getElementsByTagName(tagName) {
    return liveCollection(ctx, this, "tag", String(tagName));
  });

  ctx.defineMethod(Node.prototype, "getElementsByClassName", function getElementsByClassName(className) {
    return liveCollection(ctx, this, "class", String(className));
  });

  // HTMLCollection prototype surface (happy-dom-observable shape).
  ctx.defineAccessor(HTMLCollection.prototype, "length", function length() {
    return readLength(this);
  }, undefined);

  ctx.defineMethod(HTMLCollection.prototype, "item", function item(index) {
    const items = readItems(this);
    return index >= 0 && items[index] ? items[index] : null;
  });

  ctx.defineMethod(HTMLCollection.prototype, "namedItem", function namedItem(name) {
    return namedItemOf(this, name);
  });

  ctx.defineMethod(HTMLCollection.prototype, Symbol.iterator, function values() {
    return readItems(this)[Symbol.iterator]();
  });

  ctx.defineAccessor(HTMLCollection.prototype, Symbol.toStringTag, function toStringTag() {
    return "HTMLCollection";
  }, undefined);

  ctx.defineMethod(HTMLCollection.prototype, "toString", function toString() {
    return "[object HTMLCollection]";
  });

  ctx.defineMethod(HTMLCollection.prototype, "toLocaleString", function toLocaleString() {
    return "[object HTMLCollection]";
  });
}

/**
 * Mints a live `HTMLCollection` bound to the scope behind `receiver`.
 *
 * The scope is validated eagerly with the native empty-class query. Core
 * performs the same affinity, lifecycle and `ParentNode` checks for both live
 * collection kinds, then returns immediately for an empty class-token list.
 * This keeps invocation-time errors (and Document's implied-skeleton setup)
 * without traversing and wrapping the requested result once here and again on
 * the first collection read. The collection itself stays lazy and re-reads
 * the requested query from Core on every access.
 */
function liveCollection(ctx, receiver, kind, key) {
  const scopeHandle = facadeScopeHandle(ctx, receiver, kind === "tag" ? "getElementsByTagName" : "getElementsByClassName");
  scopeHandle.getElementsByClassName("");
  return new HTMLCollection(scopeHandle, kind, key);
}
