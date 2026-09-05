// `querySelector` / `querySelectorAll` / `matches` / `closest` /
// `getElementById` facade extension (T31).
//
// Installs the WHATWG selector-query surface on `Document.prototype`,
// `Element.prototype` and `DocumentFragment.prototype` (T48A), delegating every
// read verbatim to the native T31 contract
// (crates/mad-dom-bun/src/extensions/query_api.rs) and through it to the Core
// document-order queries (T31) and the T30 parser/arena matcher. Like the rest
// of the facade, this module keeps **no second DOM state** and builds no index
// itself. General/scoped queries traverse Core on a cache miss. Bounded
// snapshots without pseudo-classes may be reused while both native mutation
// generations match; each call still returns a new static NodeList. Eligible
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
import { nodeDocumentStateOf, nodeInternalsOf } from "./classes.js";
import { snapshotNodes } from "./snapshot-node.js";

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
const QUERY_SNAPSHOTS = new WeakMap();
const MapConstructor = Map;
const weakGet = Function.prototype.call.bind(WeakMap.prototype.get);
const weakSet = Function.prototype.call.bind(WeakMap.prototype.set);

// A native-validated single compound with an HTML type selector can reject
// other element names from immutable metadata. This is especially useful for
// consumers checking a long list of element/attribute combinations. Everything
// outside this narrow grammar still uses the full native selector matcher.
const SUBJECT_TYPES = new Map();
const mapGet = Function.prototype.call.bind(Map.prototype.get);
const mapSet = Function.prototype.call.bind(Map.prototype.set);
const mapClear = Function.prototype.call.bind(Map.prototype.clear);
const regexExec = Function.prototype.call.bind(RegExp.prototype.exec);
const lowerCase = Function.prototype.call.bind(String.prototype.toLowerCase);
const stringIncludes = Function.prototype.call.bind(String.prototype.includes);
let subjectTypeCount = 0;
const TYPED_COMPOUND = /^([a-zA-Z][a-zA-Z0-9-]*)(?:(?:\[[^\]\\]*\])|(?::not\(\[[^\]\\]*\]\)))*$/;

function queryCache(parent, selector) {
  // Pseudo-classes such as :empty can change with character data without a
  // structural/attribute generation change. Leave them on the native path.
  if (selector.length > 4096 || stringIncludes(selector, ":")) return undefined;
  const state = nodeDocumentStateOf(parent);
  const tree = state?.epoch?.[0];
  const attributes = state?.attributeEpoch?.[0];
  if (tree === undefined || attributes === undefined || tree === -1 || attributes === -1 ||
      tree === -2147483648 || attributes === -2147483648) return undefined;
  let cache = weakGet(QUERY_SNAPSHOTS, parent);
  if (cache === undefined || cache.tree !== tree || cache.attributes !== attributes) {
    cache = { tree, attributes, entries: new MapConstructor(), count: 0, nodes: 0 };
    weakSet(QUERY_SNAPSHOTS, parent, cache);
  }
  return cache;
}

function saveQuery(parent, selector, items, cache) {
  // Native document setup or user code reached during wrapper conversion can
  // mutate the tree after the snapshot was taken. Never publish that snapshot
  // under the new generation.
  if (cache === undefined || queryCache(parent, selector) !== cache || items.length > 65536) return;
  if (cache.count === 32 || cache.nodes + items.length > 65536) {
    mapClear(cache.entries);
    cache.count = 0;
    cache.nodes = 0;
  }
  mapSet(cache.entries, selector, items);
  cache.count++;
  cache.nodes += items.length;
}

function rememberSubjectType(selector) {
  if (selector.length > 4096) return;
  const match = regexExec(TYPED_COMPOUND, selector);
  if (subjectTypeCount === 256) {
    mapClear(SUBJECT_TYPES);
    subjectTypeCount = 0;
  }
  mapSet(SUBJECT_TYPES, selector, match === null ? null : {
    name: lowerCase(match[1]), plain: match[1].length === selector.length,
  });
  subjectTypeCount++;
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
    const selector = String(selectors);
    const cache = queryCache(this, selector);
    const cached = cache === undefined ? undefined : mapGet(cache.entries, selector);
    if (cached !== undefined) return new StaticNodeList(cached);
    const items = facadeDocumentHandle(ctx, this, "querySelectorAll").querySelectorAll(selector)
      .map((handle) => ctx.wrap(handle));
    saveQuery(this, selector, items, cache);
    return new StaticNodeList(items);
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
    return queryNodeList(ctx, this, selectors);
  });

  ctx.defineMethod(DocumentFragment.prototype, "querySelector", function querySelector(selectors) {
    return ctx.wrap(facadeNodeHandle(ctx, this, "querySelector").querySelector(String(selectors)));
  });

  ctx.defineMethod(DocumentFragment.prototype, "querySelectorAll", function querySelectorAll(selectors) {
    return queryNodeList(ctx, this, selectors);
  });

  ctx.defineMethod(Element.prototype, "matches", function matches(selectors) {
    const selector = String(selectors);
    const internals = nodeInternalsOf(this);
    const state = internals?.documentState;
    const method = state?.nativeMethods.matchesToken;
    if (method !== undefined && internals.token !== undefined) {
      const subject = mapGet(SUBJECT_TYPES, selector);
      const epoch = state.epoch?.[0];
      if (subject != null && epoch !== undefined && epoch !== -1 && epoch !== -2147483648 &&
          internals.validEpoch === epoch && internals.nodeType === 1 &&
          typeof internals.nodeName === "string" && typeof internals.nodeNamespace === "string") {
        if (internals.nodeNamespace !== "http://www.w3.org/1999/xhtml" || internals.nodeName !== subject.name) return false;
        if (subject.plain) return true;
      }
      const result = method(internals.token, selector);
      // A successful native match also proves this token is still live.
      internals.validEpoch = state.epoch?.[0] ?? null;
      if (subject === undefined) rememberSubjectType(selector);
      return result;
    }
    return facadeNodeHandle(ctx, this, "matches").matches(selector);
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

function queryNodeList(ctx, parent, selectors) {
  const selector = String(selectors);
  const cache = queryCache(parent, selector);
  const cached = cache === undefined ? undefined : mapGet(cache.entries, selector);
  if (cached !== undefined) return new StaticNodeList(cached);
  const handle = facadeNodeHandle(ctx, parent, "querySelectorAll");
  const state = nodeDocumentStateOf(parent);
  const queryTokens = state?.nodeNativeMethodsOf(handle).querySelectorAllTokens;
  if (queryTokens === undefined || state.nativeMethods.materializeNodeToken === undefined) {
    const items = handle.querySelectorAll(selector).map((handle) => ctx.wrap(handle));
    saveQuery(parent, selector, items, cache);
    return new StaticNodeList(items);
  }
  const flat = queryTokens(handle, selector);
  const items = snapshotNodes(ctx, state, flat);
  saveQuery(parent, selector, items, cache);
  return new StaticNodeList(items);
}
