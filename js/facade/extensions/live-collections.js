// Live `getElementsByTagName` / `getElementsByClassName` collection facade
// extension (T32).
//
// Implements the WHATWG live `HTMLCollection` surface without copying DOM
// state: a collection is bound to one native scope handle plus its query key.
// Item-producing reads re-run the native query. `length` uses the native
// result-allocation-free count companion and may reuse that scalar only while
// Core's structural/attribute generation views prove it current. An existing
// collection therefore reflects every relevant mutation immediately.
//
// # Frozen contract (T32)
//
// Every item-producing read delegates to the native live-collection contract
// (crates/mad-dom-bun/src/extensions/live_collections.rs) and every produced
// element funnels through `ctx.wrap` (the unique conversion entry), so element
// wrapper identity mirrors the native per-document weak cache (T20). The Core
// T32 query index (when enabled) lives entirely inside Core and is kept in
// lock step by the mutation/attribute API; facade count caches are derived
// values guarded by Core-maintained generations, never an independent index.
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
import { nodeInternalsOf } from "./classes.js";
import { Node } from "./node.js";

export const seam = Object.freeze({
  id: "facade/extensions/live-collections",
  owner: "T32",
  gate: "T32",
  status: "implemented",
});

// Native scope, query key and count memo behind each HTMLCollection. Keeping
// this state off the Proxy target preserves the built-in Proxy invariants for
// reflection and lets callers seal/freeze a collection without freezing the
// live query's internal cache.
const COLLECTION_STATES = new WeakMap();
const MapConstructor = Map;
const ProxyConstructor = Proxy;
const weakMapGet = Function.prototype.call.bind(WeakMap.prototype.get);
const weakMapSet = Function.prototype.call.bind(WeakMap.prototype.set);
const mapDelete = Function.prototype.call.bind(Map.prototype.delete);
const mapGet = Function.prototype.call.bind(Map.prototype.get);
const mapHas = Function.prototype.call.bind(Map.prototype.has);
const mapKeys = Function.prototype.call.bind(Map.prototype.keys);
const mapSet = Function.prototype.call.bind(Map.prototype.set);
const mapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size").get;
const mapSize = Function.prototype.call.bind(mapSizeGetter);
const mapIteratorNext = Function.prototype.call.bind(
  Object.getPrototypeOf(mapKeys(new MapConstructor())).next,
);
const objectCreate = Object.create;
const objectGetPrototypeOf = Object.getPrototypeOf;
const bindFunction = Function.prototype.call.bind(Function.prototype.bind);
const reflectGet = Reflect.get;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectIsExtensible = Reflect.isExtensible;
const reflectOwnKeys = Reflect.ownKeys;

// Native writes this terminal value to every registered structural epoch view
// before releasing the Core document. A cached read must never hide the
// frozen destroyed-document error.
const DESTROYED_EPOCH = -2147483648;
const CACHE_DISABLED_EPOCH = -1;

function optionalNativeMethod(handle, name) {
  // Keep the explicit plain-object legacy harness working while rejecting
  // inherited Object.prototype capabilities on both it and native handles.
  const ownDescriptor = reflectGetOwnPropertyDescriptor(handle, name);
  if (typeof ownDescriptor?.value === "function") {
    return bindFunction(ownDescriptor.value, handle);
  }
  const prototype = objectGetPrototypeOf(handle);
  const descriptor = prototype === null
    ? undefined
    : reflectGetOwnPropertyDescriptor(prototype, name);
  return typeof descriptor?.value === "function"
    ? bindFunction(descriptor.value, handle)
    : undefined;
}

// Tag membership is immutable for a node, so a tag collection's cardinality
// can change only when tree relations change. Share the last count between
// fresh collection objects for the same genuine facade scope; the structural
// epoch makes this an exact cache, while the WeakMap keeps scopes collectible.
const TAG_COUNTS = new WeakMap();
const CLASS_COUNTS = new WeakMap();
const MAX_SHARED_COUNT_KEYS = 32;

function rememberCount(counts, key, value) {
  // Query strings are user-controlled. Keep the cross-collection reuse useful
  // for hot keys without allowing a long-lived scope to retain an unbounded
  // set of one-off names.
  if (!mapHas(counts, key) && mapSize(counts) >= MAX_SHARED_COUNT_KEYS) {
    mapDelete(counts, mapIteratorNext(mapKeys(counts)).value);
  }
  mapSet(counts, key, value);
}

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
 * `item`, `namedItem`, numeric index reads, the named getter and iteration
 * re-read matching elements from Core. `length` may reuse a generation-valid
 * scalar count, so the collection stays live without copying the tree.
 */
export class HTMLCollection {
  constructor(scopeHandle, kind, key, initialCount) {
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
    // This record is mutable after construction as epoch-guarded counts are
    // refreshed. Keep it off Object.prototype so application-installed
    // setters with names such as `count` cannot intercept private cache
    // writes performed after module initialization.
    const state = objectCreate(null);
    state.scopeHandle = scopeHandle;
    state.kind = kind;
    state.key = key;
    state.count = undefined;
    state.countStructureEpoch = undefined;
    state.countAttributeEpoch = undefined;
    state.structureEpochView = undefined;
    state.attributeEpochView = undefined;
    state.countMethod = optionalNativeMethod(
      scopeHandle,
      kind === "tag" ? "countElementsByTagName" : "countElementsByClassName",
    );
    if (initialCount !== undefined) {
      state.count = initialCount.value;
      state.countStructureEpoch = initialCount.structureEpoch;
      state.countAttributeEpoch = initialCount.attributeEpoch;
      state.structureEpochView = initialCount.structureEpochView;
      state.attributeEpochView = initialCount.attributeEpochView;
    }
    weakMapSet(COLLECTION_STATES, this, state);
    const proxy = new ProxyConstructor(this, {
      get(target, property, receiver) {
        if (property === "length") {
          return readLength(target);
        }
        if (property in target || typeof property === "symbol") {
          return reflectGet(target, property, receiver);
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
        const own = reflectGetOwnPropertyDescriptor(target, property);
        if (own !== undefined) return own;
        if (
          !reflectIsExtensible(target) ||
          property in target ||
          typeof property === "symbol"
        ) {
          return undefined;
        }
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
        const keys = reflectOwnKeys(target);
        if (!reflectIsExtensible(target)) return keys;
        const appendKey = (key) => {
          for (let i = 0; i < keys.length; i += 1) {
            if (keys[i] === key) return;
          }
          keys[keys.length] = key;
        };
        const items = readItems(target);
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const name = item.getAttribute("id") || item.getAttribute("name");
          appendKey(String(i));
          if (name) appendKey(name);
        }
        return keys;
      },
    });
    weakMapSet(COLLECTION_STATES, proxy, state);
    return proxy;
  }
}

/**
 * Re-reads the matched element wrappers of `collection` from Core through the
 * native scope handle — the live read behind every item-producing accessor.
 */
function readItems(collection) {
  const { scopeHandle, kind, key } = weakMapGet(COLLECTION_STATES, collection);
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
  const state = weakMapGet(COLLECTION_STATES, collection);
  const { scopeHandle, kind, key, structureEpochView, attributeEpochView } = state;
  if (structureEpochView !== undefined) {
    const structureEpoch = structureEpochView[0];
    const attributeEpoch = attributeEpochView?.[0];
    if (
      structureEpoch !== DESTROYED_EPOCH &&
      structureEpoch !== CACHE_DISABLED_EPOCH &&
      structureEpoch === state.countStructureEpoch &&
      (kind === "tag" ||
        (attributeEpoch !== DESTROYED_EPOCH &&
          attributeEpoch !== CACHE_DISABLED_EPOCH &&
          attributeEpoch === state.countAttributeEpoch))
    ) {
      return state.count;
    }
  }
  const count = state.countMethod;
  if (count !== undefined) {
    const value = count(key);
    if (structureEpochView !== undefined) {
      state.count = value;
      state.countStructureEpoch = structureEpochView[0];
      state.countAttributeEpoch = attributeEpochView?.[0];
    }
    return value;
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
  // Prototype methods keep their original installation context. Keep the
  // item reader on that same context when a recording context re-drives the
  // registry without replacing the installed methods.
  if (windowCtx === null) windowCtx = ctx;

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
 * Current bindings validate and obtain the initial cardinality through the
 * requested native count method, then share that scalar while the relevant
 * Core generations remain unchanged. Older bindings retain the empty-class
 * validation read and fully native-on-access behavior. Both paths preserve
 * invocation-time lifecycle/affinity/`ParentNode` errors and fresh collection
 * identity.
 */
function liveCollection(ctx, receiver, kind, key) {
  const scopeHandle = facadeScopeHandle(ctx, receiver, kind === "tag" ? "getElementsByTagName" : "getElementsByClassName");
  const count = optionalNativeMethod(
    scopeHandle,
    kind === "tag" ? "countElementsByTagName" : "countElementsByClassName",
  );
  if (count !== undefined) {
    const internals = nodeInternalsOf(receiver);
    const state = internals?.documentState;
    const structureEpochView = state?.epoch;
    const attributeEpochView = state?.attributeEpoch;
    const canCache =
      structureEpochView !== null && structureEpochView !== undefined &&
      (kind === "tag" ||
        (attributeEpochView !== null && attributeEpochView !== undefined));
    if (canCache) {
      const structureEpoch = structureEpochView[0];
      const attributeEpoch = attributeEpochView?.[0];
      const sharedCounts = kind === "tag" ? TAG_COUNTS : CLASS_COUNTS;
      let counts = weakMapGet(sharedCounts, receiver);
      const cached = counts === undefined ? undefined : mapGet(counts, key);
      const scopeIsCurrent =
        receiver instanceof Document || internals.validEpoch === structureEpoch;
      if (
        structureEpoch !== DESTROYED_EPOCH &&
        structureEpoch !== CACHE_DISABLED_EPOCH &&
        (kind === "tag" ||
          (attributeEpoch !== DESTROYED_EPOCH &&
            attributeEpoch !== CACHE_DISABLED_EPOCH)) &&
        scopeIsCurrent &&
        cached !== undefined &&
        cached.structureEpoch === structureEpoch &&
        (kind === "tag" || cached.attributeEpoch === attributeEpoch)
      ) {
        return new HTMLCollection(scopeHandle, kind, key, {
          value: cached.value,
          structureEpoch,
          attributeEpoch,
          structureEpochView,
          attributeEpochView,
        });
      }

      // Counting validates lifecycle, affinity and ParentNode scope in the
      // same native read. Remember the successful validation epoch for node
      // scopes so a subsequent unchanged call can use the shared count.
      const value = count(key);
      const currentStructureEpoch = structureEpochView[0];
      const currentAttributeEpoch = attributeEpochView?.[0];
      if (!(receiver instanceof Document)) {
        internals.validEpoch = currentStructureEpoch;
      }
      if (counts === undefined) {
        counts = new MapConstructor();
        weakMapSet(sharedCounts, receiver, counts);
      }
      rememberCount(counts, key, {
        structureEpoch: currentStructureEpoch,
        attributeEpoch: currentAttributeEpoch,
        value,
      });
      return new HTMLCollection(scopeHandle, kind, key, {
        value,
        structureEpoch: currentStructureEpoch,
        attributeEpoch: currentAttributeEpoch,
        structureEpochView,
        attributeEpochView,
      });
    }
  }

  // Older bindings have no generation views/count companions. Keep the
  // original eager native validation and direct live reads for those paths.
  scopeHandle.getElementsByClassName("");
  return new HTMLCollection(scopeHandle, kind, key);
}
