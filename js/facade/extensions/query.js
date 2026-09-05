// `querySelector` / `querySelectorAll` / `matches` / `closest` /
// `getElementById` facade extension (T31).
//
// Installs the WHATWG selector-query surface on `Document.prototype`,
// `Element.prototype` and `DocumentFragment.prototype` (T48A), delegating every
// read verbatim to the native T31 contract
// (crates/mad-dom-bun/src/extensions/query_api.rs) and through it to the Core
// document-order queries (T31) and the T30 parser/arena matcher. Like the rest
// of the facade, this module keeps **no second DOM state** and builds no index
// itself. General/scoped selectors are fresh Core traversals; eligible
// document id reads may activate Core's private mutation-maintained `by_id`
// acceleration map, so every mutation surface remains immediately visible to
// the next query.
//
// # Static `NodeList` semantics
//
// `querySelectorAll` returns a *static* `NodeList` — a snapshot of the queried
// matches captured at call time, exactly like the WHATWG and happy-dom. The
// native entry returns the matched node handles of one Core traversal; this
// module wraps them once and never updates the collection, so an already
// returned `NodeList` is unaffected by later tree mutations (unlike the T25D
// *live* `childNodes` `NodeList`, which re-reads its parent on every access).
// Each `querySelectorAll` call mints a fresh `StaticNodeList`, matching the
// WHATWG "new NodeList" semantics.
//
// # WebIDL argument shaping
//
// The selector / id arguments are coerced with `String` exactly like a WebIDL
// `DOMString` argument: `el.matches(42)` becomes `matches("42")` and
// `document.querySelectorAll(null)` becomes `querySelectorAll("null")`. This
// is pure argument shaping — no DOM state is produced here — so the native
// handle still receives a plain string and Core stays the single source of
// tree truth.
//
// # Errors
//
// The native contract owns the DOM rules and the facade only forwards the
// frozen error: an invalid selector throws the `ERR_MAD_DOM_SYNTAX` taxonomy,
// a non-element `matches`/`closest` receiver or a non-`ParentNode` query scope
// throws `ERR_MAD_DOM_HIERARCHY`, and a destroyed document fails per T21.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes.

import { Document } from "../document.js";
import { Element, DocumentFragment } from "./node.js";

export const seam = Object.freeze({
  id: "facade/extensions/query",
  owner: "T31",
  gate: "T31",
  status: "implemented",
});

// Wrapped snapshot items behind each StaticNodeList instance, keyed by the
// live proxy object: the Proxy forwards every method receiver to the proxy
// itself, so module state is reachable through the exact object JS holds.
const STATIC_ITEMS = new WeakMap();

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

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    // A manually constructed Node around a native handle is intentionally not
    // part of the reverse conversion cache. The query methods accept only
    // wrappers for which the facade can recover the owning native handle, so
    // native affinity and ownership checks remain authoritative.
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
 * Static `NodeList` facade for a snapshot of queried elements.
 *
 * Construction is restricted: it requires the wrapped items array produced by
 * `ctx.wrap` (the unique conversion entry), so no facade surface can fabricate
 * a collection. The returned object is a Proxy over the real instance: numeric
 * index reads (`list[0]`) read the captured snapshot, `length` and the
 * iteration surface expose exactly the matches the query returned — a later
 * mutation of the tree never changes them.
 */
export class StaticNodeList {
  constructor(items) {
    if (!Array.isArray(items)) {
      throw new TypeError(
        "StaticNodeList can only be constructed from the wrapped items of a query",
      );
    }
    const proxy = new Proxy(this, {
      get(target, property, receiver) {
        const index = toArrayIndex(property);
        if (index !== null) {
          const item = Reflect.get(target, "item", receiver);
          return item.call(receiver, index) ?? undefined;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    STATIC_ITEMS.set(proxy, items);
    return proxy;
  }
}

/**
 * Installs the T31 selector-query surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  // Document surface.
  ctx.defineMethod(Document.prototype, "querySelector", function querySelector(selectors) {
    return ctx.wrap(
      facadeDocumentHandle(ctx, this, "querySelector").querySelector(String(selectors)),
    );
  });

  ctx.defineMethod(Document.prototype, "querySelectorAll", function querySelectorAll(selectors) {
    return staticNodeList(
      ctx,
      facadeDocumentHandle(ctx, this, "querySelectorAll").querySelectorAll(String(selectors)),
    );
  });

  ctx.defineMethod(Document.prototype, "getElementById", function getElementById(elementId) {
    return ctx.wrap(
      facadeDocumentHandle(ctx, this, "getElementById").getElementById(String(elementId)),
    );
  });

  // Element (Element) and ParentNode (DocumentFragment) surface (T48A: the
  // query methods moved off `Node.prototype` onto `Element.prototype`, with
  // `querySelector` / `querySelectorAll` additionally on
  // `DocumentFragment.prototype` so fragments and — through the T43
  // re-parenting — shadow roots reach them; `matches` / `closest` are element
  // only, exactly like happy-dom). Text / Comment are plain `Node`s and read
  // `undefined`.
  ctx.defineMethod(Element.prototype, "querySelector", function querySelector(selectors) {
    return ctx.wrap(facadeNodeHandle(ctx, this, "querySelector").querySelector(String(selectors)));
  });

  ctx.defineMethod(Element.prototype, "querySelectorAll", function querySelectorAll(selectors) {
    return staticNodeList(
      ctx,
      facadeNodeHandle(ctx, this, "querySelectorAll").querySelectorAll(String(selectors)),
    );
  });

  ctx.defineMethod(DocumentFragment.prototype, "querySelector", function querySelector(selectors) {
    return ctx.wrap(facadeNodeHandle(ctx, this, "querySelector").querySelector(String(selectors)));
  });

  ctx.defineMethod(DocumentFragment.prototype, "querySelectorAll", function querySelectorAll(selectors) {
    return staticNodeList(
      ctx,
      facadeNodeHandle(ctx, this, "querySelectorAll").querySelectorAll(String(selectors)),
    );
  });

  ctx.defineMethod(Element.prototype, "matches", function matches(selectors) {
    return facadeNodeHandle(ctx, this, "matches").matches(String(selectors));
  });

  ctx.defineMethod(Element.prototype, "closest", function closest(selectors) {
    return ctx.wrap(facadeNodeHandle(ctx, this, "closest").closest(String(selectors)));
  });

  // StaticNodeList prototype surface.
  ctx.defineAccessor(StaticNodeList.prototype, "length", function length() {
    return STATIC_ITEMS.get(this).length;
  }, undefined);

  ctx.defineMethod(StaticNodeList.prototype, "item", function item(index) {
    const items = STATIC_ITEMS.get(this);
    const position = index >>> 0;
    if (position >= items.length) return null;
    return items[position];
  });

  ctx.defineMethod(StaticNodeList.prototype, "forEach", function forEach(callback, thisArg) {
    if (typeof callback !== "function") {
      throw new TypeError("NodeList.forEach requires a callback function");
    }
    const items = STATIC_ITEMS.get(this);
    for (let i = 0; i < items.length; i += 1) {
      callback.call(thisArg, items[i], i, this);
    }
  });

  ctx.defineMethod(StaticNodeList.prototype, "entries", function* entries() {
    const items = STATIC_ITEMS.get(this);
    for (let i = 0; i < items.length; i += 1) {
      yield [i, items[i]];
    }
  });

  ctx.defineMethod(StaticNodeList.prototype, "keys", function* keys() {
    const items = STATIC_ITEMS.get(this);
    for (let i = 0; i < items.length; i += 1) {
      yield i;
    }
  });

  ctx.defineMethod(StaticNodeList.prototype, "values", function* values() {
    const items = STATIC_ITEMS.get(this);
    for (let i = 0; i < items.length; i += 1) {
      yield items[i];
    }
  });

  ctx.defineMethod(StaticNodeList.prototype, Symbol.iterator, function* values() {
    const items = STATIC_ITEMS.get(this);
    for (let i = 0; i < items.length; i += 1) {
      yield items[i];
    }
  });
}

/**
 * Wraps the matched native handles of one query into a static `NodeList`.
 */
function staticNodeList(ctx, handles) {
  return new StaticNodeList(handles.map((handle) => ctx.wrap(handle)));
}
