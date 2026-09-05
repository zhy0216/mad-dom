// `NamedNodeMap` / `Attr` / `DOMTokenList` facade extension (T34).
//
// Installs the WHATWG attribute-node and token-list surface on `Node.prototype`
// and `Document.prototype` — `Element.attributes` (a live `NamedNodeMap` of
// `Attr` wrappers), `Element.classList` (a live `DOMTokenList` over the `class`
// attribute), `Element.namespaceURI` and `document.createAttribute` — with
// every read delegated to the native T34 contract
// (crates/mad-dom-bun/src/extensions/attribute_nodes_api.rs) and through it to
// the Core `attribute_nodes` module. Like the rest of the facade, this module
// keeps **no second DOM state**: a `NamedNodeMap` / `DOMTokenList` / `Attr`
// re-reads Core on every access, so a retained collection reflects a later
// attribute write immediately, and every `classList` mutation routes back
// through the element's attribute storage (the single Core state).
//
// # Surface and identity
//
// * `Element.attributes` hands back one and the same `NamedNodeMap` proxy per
//   element (stable identity). The proxy mirrors happy-dom's observable shape:
//   `length` first, then prototype/symbol properties, then numeric indices
//   (`null` past the end, matching happy-dom), then the named getter (`Attr` or
//   `undefined`). `item` / `getNamedItem` / iteration / `toStringTag` /
//   `toString` live on the prototype.
// * Each `Attr` wrapper is cached per `(element, attribute-name)` and re-reads
//   its `value` from Core, so `element.attributes[0] === element.attributes[0]`
//   holds and a write through `attr.value` is immediately visible to every
//   reader. (happy-dom replaces the `Attr` object on every `setAttribute`; MAD
//   DOM keeps one live wrapper per name — a documented deviation pinned by the
//   Bun tests.)
// * `Element.classList` hands back one and the same live `DOMTokenList` proxy
//   per element over the `class` attribute: `length` / `item` / `value` /
//   `contains` / `add` / `remove` / `toggle` / `replace` and the iteration
//   surface (`values` / `keys` / `entries` / `forEach` / `Symbol.iterator`).
//   The `value` accessor reads/writes the raw `class` attribute verbatim while
//   the token operations go through the WHATWG ordered set.
// * Non-element nodes read `attributes` / `classList` as `null` (happy-dom
//   leaves those properties absent, giving `undefined`; the accessor presence
//   itself is the documented deviation). `namespaceURI` reads the element
//   namespace and `null` for other kinds, matching happy-dom.
//
// # Bidirectional `classList` ↔ `class` sync
//
// Both directions are live: a `classList.add` writes the joined token set back
// into the `class` attribute through Core (so `getAttribute("class")` agrees),
// and an external `setAttribute("class", …)` / `removeAttribute("class")` is
// visible to the next `classList` read. There is no second copy of the tokens —
// every read re-derives the ordered set from the attribute value.
//
// # WebIDL argument shaping
//
// Tokens, names and the `value` setter are coerced with `String` exactly like
// a WebIDL `DOMString` (`classList.add("x", 1)` adds `"x"` and `"1"`); `toggle`
// shapes `force` with `Boolean` when it is not `undefined`. This is pure
// argument shaping — no DOM state is produced here — so the native handle
// receives plain strings and Core stays the single source of attribute truth.
//
// # Errors
//
// The native contract owns the DOM rules: an empty token fails with
// `ERR_MAD_DOM_SYNTAX`, a whitespace token with `ERR_MAD_DOM_INVALID_CHARACTER`
// (both atomically, the WHATWG contract — happy-dom accepts them, a documented
// deviation), a non-element `attributes`/`classList` mutation with
// `ERR_MAD_DOM_HIERARCHY`, and a destroyed document per T21. The facade only
// forwards the frozen error.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes.

import { Document } from "../document.js";
import { Node } from "./node.js";
import { Element } from "./classes.js";
import { HTMLAnchorElement, HTMLLinkElement } from "./html-element.js";

export const seam = Object.freeze({
  id: "facade/extensions/attribute-nodes",
  owner: "T34",
  gate: "T34",
  status: "implemented",
});

// Native element handle behind each NamedNodeMap / DOMTokenList, and the
// element handle + name behind each Attr. Attr identity is cached per
// (element, attribute-name) so repeated reads hand back one and the same
// wrapper; the NamedNodeMap / DOMTokenList caches give one collection per
// element. All caches are weak on the native handle, so a facade object never
// pins its element.
const NAMED_NODE_MAP_STATE = new WeakMap();
const TOKEN_LIST_STATE = new WeakMap();
const ATTR_STATE = new WeakMap();
const ELEMENT_NAMED_NODE_MAPS = new WeakMap();
const ELEMENT_TOKEN_LISTS = new WeakMap();
const ELEMENT_ATTRS = new WeakMap();

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

// NamedNodeMap / DOMTokenList / Attr wrappers are minted by module functions;
// the install-time `ctx` is closed over by the accessors that must wrap a node
// (Attr.ownerElement).

/**
 * Live `NamedNodeMap` facade for one element.
 *
 * Construction is restricted to a genuine native node handle. Instances are
 * normally produced through `element.attributes` (one per element). The
 * returned object is a Proxy over the real instance: `length`, `item`,
 * `getNamedItem`, numeric index reads, the named getter and the iteration
 * surface all re-read the element's ordered attribute list from Core on every
 * access, so the map is live while keeping no second copy of the attributes.
 */
export class NamedNodeMap {
  constructor(elementHandle) {
    if (!isNodeHandle(elementHandle)) {
      throw new TypeError("NamedNodeMap can only be constructed from a genuine native node handle");
    }
    const proxy = new Proxy(this, {
      get(target, property, receiver) {
        if (property === "length") {
          return attributePairs(target).length;
        }
        if (property in target || typeof property === "symbol") {
          return Reflect.get(target, property, receiver);
        }
        const index = Number(property);
        if (!Number.isNaN(index)) {
          return itemOf(target, index);
        }
        return namedItemOf(target, property) ?? undefined;
      },
      has(target, property) {
        if (typeof property === "symbol") return false;
        if (property in target) return true;
        const index = Number(property);
        if (!Number.isNaN(index) && index >= 0 && index < attributePairs(target).length) {
          return true;
        }
        return false;
      },
      getOwnPropertyDescriptor(target, property) {
        if (property in target || typeof property === "symbol") return undefined;
        const index = Number(property);
        if (!Number.isNaN(index)) {
          const attribute = itemOf(target, index);
          if (attribute) {
            return { value: attribute, writable: false, enumerable: true, configurable: true };
          }
        }
        return undefined;
      },
      ownKeys(target) {
        const keys = [];
        for (let index = 0; index < attributePairs(target).length; index += 1) {
          keys.push(String(index));
        }
        return keys;
      },
    });
    NAMED_NODE_MAP_STATE.set(proxy, { elementHandle });
    // The Proxy traps receive the real instance (`target`), while the
    // prototype methods are called with `this` bound to the proxy, so the
    // state is reachable under both keys — the shared object is the same.
    NAMED_NODE_MAP_STATE.set(this, { elementHandle });
    return proxy;
  }
}

/**
 * Live `Attr` wrapper for one element attribute (or a detached attribute from
 * `document.createAttribute`).
 *
 * `name` / `localName` / `prefix` / `namespaceURI` / `specified` / `nodeType`
 * are fixed; `value` re-reads (and writes through to) the element's Core
 * attribute storage when attached, and its own stored string when detached.
 */
export class Attr {
  constructor(elementHandle, name, detachedValue = null) {
    if (elementHandle !== null && !isNodeHandle(elementHandle)) {
      throw new TypeError("Attr can only be constructed from a genuine native node handle or null");
    }
    if (typeof name !== "string") {
      throw new TypeError("Attr requires a string attribute name");
    }
    ATTR_STATE.set(this, { elementHandle, name, detachedValue });
  }
}

/**
 * Live `DOMTokenList` facade for one element and one attribute (the `class`
 * attribute from `Element.classList`).
 *
 * Construction is restricted to a genuine native node handle plus an attribute
 * name. The returned object is a Proxy over the real instance: `length`,
 * `item`, numeric index reads and the iteration surface re-read the ordered
 * token set from Core on every access, while `value` reads/writes the raw
 * attribute string verbatim.
 */
export class DOMTokenList {
  constructor(elementHandle, name, supportedTokens = null) {
    if (!isNodeHandle(elementHandle)) {
      throw new TypeError("DOMTokenList can only be constructed from a genuine native node handle");
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("DOMTokenList requires a string attribute name");
    }
    const proxy = new Proxy(this, {
      get(target, property, receiver) {
        if (property === "length") {
          return tokenItems(target).length;
        }
        if (property in target || typeof property === "symbol") {
          return Reflect.get(target, property, receiver);
        }
        const index = Number(property);
        if (!Number.isNaN(index)) {
          return tokenItems(target)[index];
        }
        return undefined;
      },
      has(target, property) {
        if (property in target) return true;
        if (typeof property === "symbol") return false;
        const index = Number(property);
        return !Number.isNaN(index) && index >= 0 && index < tokenItems(target).length;
      },
      getOwnPropertyDescriptor(target, property) {
        if (property in target || typeof property === "symbol") return undefined;
        const index = Number(property);
        const items = tokenItems(target);
        if (!Number.isNaN(index) && items[index]) {
          return { value: items[index], writable: false, enumerable: true, configurable: true };
        }
        return undefined;
      },
      ownKeys(target) {
        return Object.keys(tokenItems(target));
      },
    });
    const state = { elementHandle, name, supportedTokens: supportedTokens ?? [] };
    TOKEN_LIST_STATE.set(proxy, state);
    TOKEN_LIST_STATE.set(this, state);
    return proxy;
  }
}

/**
 * Re-reads the element's ordered attribute list from Core through the native
 * element handle — the single live read behind every NamedNodeMap accessor.
 */
function attributePairs(map) {
  const { elementHandle } = NAMED_NODE_MAP_STATE.get(map);
  return elementHandle.getAttributes();
}

/**
 * Returns the `Attr` wrapper for the attribute at `index`, or `null` past the
 * end. Wrappers are cached per (element, name) so identity is stable.
 */
function itemOf(map, index) {
  const pairs = attributePairs(map);
  if (index < 0 || index >= pairs.length) return null;
  return attrOf(map, pairs[index][0]);
}

/**
 * Returns the `Attr` wrapper for the named attribute, or `null` when absent.
 */
function namedItemOf(map, name) {
  name = String(name);
  const pairs = attributePairs(map);
  for (const [attrName] of pairs) {
    if (attrName === name) return attrOf(map, attrName);
  }
  return null;
}

/**
 * Returns the cached `Attr` wrapper for `(elementHandle, name)`, minting it on
 * a miss.
 */
function attrOf(map, name) {
  const { elementHandle } = NAMED_NODE_MAP_STATE.get(map);
  let byName = ELEMENT_ATTRS.get(elementHandle);
  if (!byName) {
    byName = new Map();
    ELEMENT_ATTRS.set(elementHandle, byName);
  }
  let attribute = byName.get(name);
  if (!attribute) {
    attribute = new Attr(elementHandle, name, null);
    byName.set(name, attribute);
  }
  return attribute;
}

/**
 * Re-reads the ordered token set of the bound attribute from Core through the
 * native element handle — the single live read behind every DOMTokenList
 * accessor.
 */
function tokenItems(list) {
  const { elementHandle, name } = TOKEN_LIST_STATE.get(list);
  return elementHandle.tokenList(name);
}

/**
 * Mints (or returns the cached) live `NamedNodeMap` for `elementHandle`.
 */
function namedNodeMapOf(elementHandle) {
  let map = ELEMENT_NAMED_NODE_MAPS.get(elementHandle);
  if (!map) {
    map = new NamedNodeMap(elementHandle);
    ELEMENT_NAMED_NODE_MAPS.set(elementHandle, map);
  }
  return map;
}

/**
 * Mints (or returns the cached) live `DOMTokenList` for
 * `(elementHandle, name)`. `supportedTokens` is the optional fixed token
 * allow-list the `supports()` method checks against (the `rel` token list of
 * `HTMLLinkElement`, which happy-dom hardcodes to
 * `['stylesheet', 'modulepreload', 'preload']`); a token list without one
 * reports `false` for every token, matching the baseline.
 */
function tokenListOf(elementHandle, name, supportedTokens = null) {
  const cacheKey = supportedTokens === null ? name : `${name}\u0000tokens`;
  let byElement = ELEMENT_TOKEN_LISTS.get(elementHandle);
  if (!byElement) {
    byElement = new Map();
    ELEMENT_TOKEN_LISTS.set(elementHandle, byElement);
  }
  let list = byElement.get(cacheKey);
  if (!list) {
    list = new DOMTokenList(elementHandle, name, supportedTokens);
    byElement.set(cacheKey, list);
  }
  return list;
}

/**
 * Installs the T34 attribute-node and token-list surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  // Document surface: `createAttribute` validates the qualified name through
  // Core and mints a detached `Attr`.
  ctx.defineMethod(Document.prototype, "createAttribute", function createAttribute(name) {
    name = String(name);
    facadeDocumentHandle(ctx, this, "createAttribute").validateAttributeName(name);
    return new Attr(null, name, null);
  });

  // Node surface: the element attribute-node accessors. `attributes` and
  // `classList` read `null` on non-elements (the accessor itself is present on
  // every node, unlike happy-dom where Text lacks the property); `namespaceURI`
  // reads the element namespace and `null` for other kinds.
  ctx.defineAccessor(Node.prototype, "attributes", function attributes() {
    const handle = facadeNodeHandle(ctx, this, "attributes");
    if (handle.nodeType() !== 1) return null;
    return namedNodeMapOf(handle);
  }, undefined);

  ctx.defineMethod(Element.prototype, "getAttributeNode", function getAttributeNode(name) {
    const handle = facadeNodeHandle(ctx, this, "getAttributeNode");
    name = String(name);
    if (handle.namespaceUri() === "http://www.w3.org/1999/xhtml") name = name.toLowerCase();
    return handle.hasAttribute(name) ? attrOf(namedNodeMapOf(handle), name) : null;
  });

  ctx.defineAccessor(Node.prototype, "classList", function classList() {
    const handle = facadeNodeHandle(ctx, this, "classList");
    if (handle.nodeType() !== 1) return null;
    return tokenListOf(handle, "class");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "namespaceURI", function namespaceURI() {
    return facadeNodeHandle(ctx, this, "namespaceURI").namespaceUri();
  }, undefined);

  // --- NamedNodeMap prototype surface (happy-dom-observable shape) ---
  ctx.defineAccessor(NamedNodeMap.prototype, "length", function length() {
    return attributePairs(this).length;
  }, undefined);

  ctx.defineMethod(NamedNodeMap.prototype, "item", function item(index) {
    return itemOf(this, index);
  });

  ctx.defineMethod(NamedNodeMap.prototype, "getNamedItem", function getNamedItem(name) {
    return namedItemOf(this, name);
  });

  ctx.defineMethod(NamedNodeMap.prototype, Symbol.iterator, function values() {
    return itemsOf(this)[Symbol.iterator]();
  });

  ctx.defineAccessor(NamedNodeMap.prototype, Symbol.toStringTag, function toStringTag() {
    return "NamedNodeMap";
  }, undefined);

  ctx.defineMethod(NamedNodeMap.prototype, "toString", function toString() {
    return "[object NamedNodeMap]";
  });

  // --- Attr prototype surface ---
  ctx.defineAccessor(Attr.prototype, "name", function name() {
    return ATTR_STATE.get(this).name;
  }, undefined);

  ctx.defineAccessor(Attr.prototype, "localName", function localName() {
    return ATTR_STATE.get(this).name;
  }, undefined);

  ctx.defineAccessor(Attr.prototype, "prefix", function prefix() {
    return null;
  }, undefined);

  ctx.defineAccessor(Attr.prototype, "namespaceURI", function namespaceURI() {
    return null;
  }, undefined);

  ctx.defineAccessor(Attr.prototype, "specified", function specified() {
    return true;
  }, undefined);

  ctx.defineAccessor(Attr.prototype, "nodeType", function nodeType() {
    return 2;
  }, undefined);

  ctx.defineAccessor(Attr.prototype, "nodeName", function nodeName() {
    return ATTR_STATE.get(this).name;
  }, undefined);

  ctx.defineAccessor(Attr.prototype, "ownerElement", function ownerElement() {
    const { elementHandle } = ATTR_STATE.get(this);
    return elementHandle === null ? null : ctx.wrap(elementHandle);
  }, undefined);

  ctx.defineAccessor(Attr.prototype, "value", function value() {
    const state = ATTR_STATE.get(this);
    return state.elementHandle === null
      ? state.detachedValue
      : state.elementHandle.getAttribute(state.name);
  }, function value(newValue) {
    const state = ATTR_STATE.get(this);
    if (state.elementHandle === null) {
      state.detachedValue = String(newValue);
      return;
    }
    state.elementHandle.setAttribute(state.name, String(newValue));
  });

  // The WHATWG `Attr.nodeValue` / `textContent` alias the attribute value
  // (happy-dom reports `null` / `""`, a documented deviation pinned by the
  // Bun tests).
  ctx.defineAccessor(Attr.prototype, "nodeValue", function nodeValue() {
    return this.value;
  }, function nodeValue(newValue) {
    this.value = newValue;
  });

  ctx.defineAccessor(Attr.prototype, "textContent", function textContent() {
    return this.value ?? "";
  }, function textContent(newValue) {
    this.value = newValue;
  });

  // --- DOMTokenList prototype surface ---
  ctx.defineAccessor(DOMTokenList.prototype, "length", function length() {
    return tokenItems(this).length;
  }, undefined);

  ctx.defineAccessor(DOMTokenList.prototype, "value", function value() {
    const { elementHandle, name } = TOKEN_LIST_STATE.get(this);
    return elementHandle.getAttribute(name) ?? "";
  }, function value(newValue) {
    const { elementHandle, name } = TOKEN_LIST_STATE.get(this);
    elementHandle.setAttribute(name, String(newValue));
  });

  ctx.defineMethod(DOMTokenList.prototype, "item", function item(index) {
    const items = tokenItems(this);
    const normalized = Number.isNaN(Number(index)) ? 0 : Number(index);
    return items[normalized] ?? null;
  });

  ctx.defineMethod(DOMTokenList.prototype, "contains", function contains(token) {
    const { elementHandle, name } = TOKEN_LIST_STATE.get(this);
    return elementHandle.tokenListContains(name, String(token));
  });

  ctx.defineMethod(DOMTokenList.prototype, "add", function add(...tokens) {
    const { elementHandle, name } = TOKEN_LIST_STATE.get(this);
    elementHandle.tokenListAdd(name, tokens.map(String));
  });

  ctx.defineMethod(DOMTokenList.prototype, "remove", function remove(...tokens) {
    const { elementHandle, name } = TOKEN_LIST_STATE.get(this);
    elementHandle.tokenListRemove(name, tokens.map(String));
  });

  ctx.defineMethod(DOMTokenList.prototype, "toggle", function toggle(token, force) {
    const { elementHandle, name } = TOKEN_LIST_STATE.get(this);
    const shaped = force === undefined ? undefined : Boolean(force);
    return elementHandle.tokenListToggle(name, String(token), shaped);
  });

  ctx.defineMethod(DOMTokenList.prototype, "replace", function replace(oldToken, newToken) {
    const { elementHandle, name } = TOKEN_LIST_STATE.get(this);
    return elementHandle.tokenListReplace(name, String(oldToken), String(newToken));
  });

  // `supports` checks the token against the list's fixed allow-list (empty for
  // a plain `classList`), matching happy-dom: it never throws and reports
  // `false` for lists without a declared token set.
  ctx.defineMethod(DOMTokenList.prototype, "supports", function supports(token) {
    return TOKEN_LIST_STATE.get(this).supportedTokens.includes(String(token));
  });

  // Iteration surface: the token list is re-read from Core on every call, so
  // the iterators are live like the rest of the surface. `Symbol.toStringTag`
  // is deliberately absent, matching happy-dom (`Object.prototype.toString`
  // yields "[object Object]").
  ctx.defineMethod(DOMTokenList.prototype, Symbol.iterator, function values() {
    return tokenItems(this).values();
  });

  ctx.defineMethod(DOMTokenList.prototype, "values", function values() {
    return tokenItems(this).values();
  });

  ctx.defineMethod(DOMTokenList.prototype, "keys", function keys() {
    return tokenItems(this).keys();
  });

  ctx.defineMethod(DOMTokenList.prototype, "entries", function entries() {
    return tokenItems(this).entries();
  });

  ctx.defineMethod(DOMTokenList.prototype, "forEach", function forEach(callback, thisArg) {
    if (typeof callback !== "function") {
      throw new TypeError("DOMTokenList.forEach requires a callback function");
    }
    // happy-dom defaults `thisArg` to the owning element's Window instance.
    let thisArgValue = thisArg;
    if (thisArgValue === undefined) {
      const { elementHandle } = TOKEN_LIST_STATE.get(this);
      thisArgValue = ctx.windowFacadeOfDocument(ctx.wrap(elementHandle.ownerDocument()));
    }
    const items = tokenItems(this);
    for (let index = 0; index < items.length; index += 1) {
      callback.call(thisArgValue, items[index], index, this);
    }
  });

  ctx.defineMethod(DOMTokenList.prototype, "toString", function toString() {
    return this.value || "";
  });

  // `relList` on `<link>` / `<a>`: a live `DOMTokenList` over the `rel`
  // attribute. `HTMLLinkElement` carries the hardcoded supported-token
  // allow-list the baseline uses (`stylesheet` / `modulepreload` / `preload`);
  // `HTMLAnchorElement` has no declared token set, so its `supports()` always
  // reports `false`.
  ctx.defineAccessor(HTMLLinkElement.prototype, "relList", function relList() {
    const handle = facadeNodeHandle(ctx, this, "relList");
    return tokenListOf(handle, "rel", ["stylesheet", "modulepreload", "preload"]);
  }, function relList(value) {
    facadeNodeHandle(ctx, this, "relList").setAttribute("rel", String(value));
  });

  ctx.defineAccessor(HTMLAnchorElement.prototype, "relList", function relList() {
    const handle = facadeNodeHandle(ctx, this, "relList");
    return tokenListOf(handle, "rel");
  }, function relList(value) {
    facadeNodeHandle(ctx, this, "relList").setAttribute("rel", String(value));
  });
}

/**
 * Returns the ordered `Attr` wrappers of `map` (the iteration surface backing
 * `Symbol.iterator` / `Array.from`).
 */
function itemsOf(map) {
  return attributePairs(map).map(([name]) => attrOf(map, name));
}
