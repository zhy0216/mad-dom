// `HTMLElement` base class, reflected attributes, `dataset` and base
// interaction facade extension (T39).
//
// Implements the T39 HTMLElement slice: the `HTMLElement` facade class with
// the reflected attribute surface (`id` / `className` / `title` / `dir` /
// `lang` / `hidden` / `inert` / `tabIndex` / `contentEditable` /
// `isContentEditable`), the live `dataset` `DOMStringMap`, and the base
// `click` / `focus` / `blur` interaction.
//
// # Prototype hierarchy (single-class model)
//
// MAD DOM wraps every node in one `Node` facade class, so the WHATWG
// `Element`↔`HTMLElement` class split is approximated by re-parenting
// `Node.prototype` onto the new `HTMLElement.prototype`:
// `Node.prototype → HTMLElement.prototype → Object.prototype`. The element
// surface (`id` / `className`, the attribute methods, `innerHTML`, ...) stays
// on `Node.prototype` (MAD DOM's element class), while the HTMLElement
// surface lives on `HTMLElement.prototype` exactly like happy-dom. Every
// wrapper is therefore `instanceof window.HTMLElement`, and the HTMLElement
// methods are inherited by every node — a text node reaches them and fails
// the Core element check (or reads through the attribute contract), the same
// honest single-class deviation the T25/T29 surfaces already record.
//
// # Reflected attributes are the attribute contract
//
// None of the reflected accessors keep state: every read is a live
// `getAttribute`, every write a `setAttribute` / `removeAttribute` on the same
// Core attribute storage (T25B), so reflection is two-way by construction — a
// `setAttribute` write is visible on the next property read and vice versa.
// The facade only shapes the WebIDL conversion (`id = 42` stores `"42"`,
// `title = null` stores `"null"`, `hidden`/`inert` are boolean-presence,
// `tabIndex` is a `long` with the happy-dom `Number` rules) and the
// `contentEditable` enum validation (the happy-dom `SyntaxError`).
//
// # dataset is a live DOMStringMap
//
// `dataset` returns one cached Proxy per element whose get/set/delete/`in`/
// `ownKeys`/`getOwnPropertyDescriptor` traps map camelCase keys to `data-*`
// attributes through the happy-dom `kebabToCamelCase` / `camelCaseToKebab`
// utilities and always re-read/re-write the Core attribute storage, so an
// existing `dataset` reflects later `setAttribute("data-*", ...)` changes and
// vice versa, and `el.dataset === el.dataset` holds.
//
// # Base interaction (happy-dom observable behavior)
//
// `click()` dispatches a bubbling/cancelable/composed `click` `Event`. `focus`
// / `blur` sequence the per-document active element through the T39 native
// contract (crates/mad-dom-bun/src/extensions/html_element_api.rs) in the
// happy-dom order — `canFocus`/`previousActive`/`clearActiveElement` →
// `blur`+`focusout` on the prior active element (when present) →
// `setActiveElement` → `focus`+`focusin` on the target — dispatching through
// the T37 propagation engine with the document lock released between every
// native call. `document.activeElement` reads the native stored element and
// falls back to `body` / `documentElement` / `null` exactly like happy-dom.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing else in the registry changes beyond the
// import and array entry.

import { Document } from "../document.js";
import { Node } from "./node.js";
import { Window } from "../window.js";
import { Event } from "./events.js";
import { flushCustomElementReactions } from "./custom-elements.js";

export const seam = Object.freeze({
  id: "facade/extensions/html-element",
  owner: "T39",
  gate: "T39",
  status: "implemented",
});

/**
 * `HTMLElement` facade base class (T39).
 *
 * Instances are never constructed directly: every node wrapper is a `Node`
 * whose prototype chain has `HTMLElement.prototype` as its parent (the
 * single-class approximation of the WHATWG `Element`/`HTMLElement` split), so
 * `el instanceof window.HTMLElement` holds and the HTMLElement surface is
 * inherited. The class body is empty; `install` wires the surface.
 */
export class HTMLElement {}

// One cached live `dataset` Proxy per element (stable identity, live reads).
const DATASET_MAPS = new WeakMap();

// The happy-dom camelCase↔kebab-case utilities behind the `data-*` mapping.
function kebabToCamelCase(text) {
  const parts = text.split("-");
  for (let i = 1; i < parts.length; i++) {
    parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
  }
  return parts.join("");
}

function camelCaseToKebab(text) {
  return String(text).replace(/[A-Z]+(?![a-z])|[A-Z]/g, (matched, offset) =>
    offset ? `-${matched.toLowerCase()}` : matched.toLowerCase(),
  );
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
    throw new TypeError(`HTMLElement.${role} requires a genuine Node facade wrapper`);
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
 * Returns the cached live `dataset` Proxy for `element`.
 *
 * Every trap maps the camelCase property key to its `data-*` attribute and
 * re-reads / re-writes the Core attribute storage through the native handle,
 * so no second DOM state exists (the mirror of happy-dom's `DOMStringMap`
 * Proxy over the element's attributes).
 */
function datasetFor(ctx, element) {
  let map = DATASET_MAPS.get(element);
  if (map === undefined) {
    const handle = ctx.documentContext.handleOf(element);
    const attributeName = (property) => `data-${camelCaseToKebab(property)}`;
    map = new Proxy(
      {},
      {
        get(_target, property) {
          const value = handle.getAttribute(attributeName(property));
          if (value !== null) return value;
          return undefined;
        },
        set(_target, property, value) {
          handle.setAttribute(attributeName(property), String(value));
          flushCustomElementReactions(ctx, handle);
          return true;
        },
        deleteProperty(_target, property) {
          handle.removeAttribute(attributeName(property));
          return true;
        },
        ownKeys() {
          const keys = [];
          for (const [name] of handle.getAttributes()) {
            if (name.startsWith("data-")) {
              keys.push(kebabToCamelCase(name.slice(5)));
            }
          }
          return keys;
        },
        has(_target, property) {
          return handle.hasAttribute(attributeName(property));
        },
        defineProperty(_target, property, descriptor) {
          if (descriptor.value === undefined) return false;
          handle.setAttribute(attributeName(property), String(descriptor.value));
          flushCustomElementReactions(ctx, handle);
          return true;
        },
        getOwnPropertyDescriptor(_target, property) {
          const value = handle.getAttribute(attributeName(property));
          if (!value) return undefined;
          return { value, writable: true, enumerable: true, configurable: true };
        },
      },
    );
    DATASET_MAPS.set(element, map);
  }
  return map;
}

/**
 * Installs the T39 HTMLElement surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  // The single-class prototype hierarchy: `Node` is MAD DOM's element class,
  // so `HTMLElement` sits directly above it (happy-dom: HTMLElement over
  // Element over Node).
  Object.setPrototypeOf(Node.prototype, HTMLElement.prototype);

  // `window.HTMLElement` — the WHATWG constructor accessor on every window.
  ctx.defineAccessor(Window.prototype, "HTMLElement", function getHTMLElement() {
    return HTMLElement;
  }, undefined);

  // `document.activeElement` — the stored focused element (stale-cleared by
  // Core), falling back to body / documentElement / null like happy-dom.
  ctx.defineAccessor(Document.prototype, "activeElement", function activeElement() {
    const active = ctx.wrap(
      facadeDocumentHandle(ctx, this, "activeElement").activeElement(),
    );
    if (active !== null) return active;
    return this.body ?? this.documentElement ?? null;
  }, undefined);

  // Element-level string reflection (happy-dom puts `id` / `className` on
  // `Element`, which is the `Node` class in the single-class model).
  ctx.defineAccessor(Node.prototype, "id", function id() {
    return facadeNodeHandle(ctx, this, "id").getAttribute("id") || "";
  }, function id(value) {
    const handle = facadeNodeHandle(ctx, this, "id");
    handle.setAttribute("id", String(value));
    flushCustomElementReactions(ctx, handle);
  });

  ctx.defineAccessor(Node.prototype, "className", function className() {
    return facadeNodeHandle(ctx, this, "className").getAttribute("class") || "";
  }, function className(value) {
    const handle = facadeNodeHandle(ctx, this, "className");
    handle.setAttribute("class", String(value));
    flushCustomElementReactions(ctx, handle);
  });

  // HTMLElement-level string reflection.
  ctx.defineAccessor(HTMLElement.prototype, "title", function title() {
    return facadeNodeHandle(ctx, this, "title").getAttribute("title") || "";
  }, function title(value) {
    const handle = facadeNodeHandle(ctx, this, "title");
    handle.setAttribute("title", String(value));
    flushCustomElementReactions(ctx, handle);
  });

  ctx.defineAccessor(HTMLElement.prototype, "dir", function dir() {
    return facadeNodeHandle(ctx, this, "dir").getAttribute("dir") || "";
  }, function dir(value) {
    const handle = facadeNodeHandle(ctx, this, "dir");
    handle.setAttribute("dir", String(value));
    flushCustomElementReactions(ctx, handle);
  });

  ctx.defineAccessor(HTMLElement.prototype, "lang", function lang() {
    return facadeNodeHandle(ctx, this, "lang").getAttribute("lang") || "";
  }, function lang(value) {
    const handle = facadeNodeHandle(ctx, this, "lang");
    handle.setAttribute("lang", String(value));
    flushCustomElementReactions(ctx, handle);
  });

  // Boolean reflection: presence of the attribute.
  ctx.defineAccessor(HTMLElement.prototype, "hidden", function hidden() {
    return facadeNodeHandle(ctx, this, "hidden").getAttribute("hidden") !== null;
  }, function hidden(value) {
    const handle = facadeNodeHandle(ctx, this, "hidden");
    if (!value) {
      handle.removeAttribute("hidden");
    } else {
      handle.setAttribute("hidden", "");
    }
    flushCustomElementReactions(ctx, handle);
  });

  ctx.defineAccessor(HTMLElement.prototype, "inert", function inert() {
    return facadeNodeHandle(ctx, this, "inert").getAttribute("inert") !== null;
  }, function inert(value) {
    const handle = facadeNodeHandle(ctx, this, "inert");
    if (!value) {
      handle.removeAttribute("inert");
    } else {
      handle.setAttribute("inert", "");
    }
    flushCustomElementReactions(ctx, handle);
  });

  // Number reflection: happy-dom's `long` rules (`Number` on the attribute,
  // `Number` on the setter with a `"0"` fallback for `NaN`).
  ctx.defineAccessor(HTMLElement.prototype, "tabIndex", function tabIndex() {
    const raw = facadeNodeHandle(ctx, this, "tabIndex").getAttribute("tabindex");
    if (raw !== null) {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? -1 : parsed;
    }
    return -1;
  }, function tabIndex(value) {
    const handle = facadeNodeHandle(ctx, this, "tabIndex");
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      handle.setAttribute("tabindex", "0");
    } else {
      handle.setAttribute("tabindex", String(parsed));
    }
    flushCustomElementReactions(ctx, handle);
  });

  // `contentEditable` enum reflection (happy-dom `SyntaxError` on an invalid
  // value; `isContentEditable` walks the parent chain for `inherit`).
  ctx.defineAccessor(HTMLElement.prototype, "contentEditable", function contentEditable() {
    const value = String(
      facadeNodeHandle(ctx, this, "contentEditable").getAttribute("contentEditable"),
    ).toLowerCase();
    switch (value) {
      case "false":
      case "true":
      case "plaintext-only":
        return value;
      default:
        return "inherit";
    }
  }, function contentEditable(value) {
    const normalized = String(value).toLowerCase();
    if (
      normalized === "false" ||
      normalized === "true" ||
      normalized === "plaintext-only" ||
      normalized === "inherit"
    ) {
      const handle = facadeNodeHandle(ctx, this, "contentEditable");
      handle.setAttribute("contentEditable", normalized);
      flushCustomElementReactions(ctx, handle);
      return;
    }
    throw new SyntaxError(
      `Failed to set the 'contentEditable' property on 'HTMLElement': The value provided ('${normalized}') is not one of 'true', 'false', 'plaintext-only', or 'inherit'.`,
    );
  });

  ctx.defineAccessor(HTMLElement.prototype, "isContentEditable", function isContentEditable() {
    const value = this.contentEditable;
    if (value === "true" || value === "plaintext-only") return true;
    if (value === "inherit") {
      const parent = this.parentNode;
      return parent ? parent.isContentEditable ?? false : false;
    }
    return false;
  }, undefined);

  // dataset: the live DOMStringMap over `data-*` attributes.
  ctx.defineAccessor(HTMLElement.prototype, "dataset", function dataset() {
    return datasetFor(ctx, this);
  }, undefined);

  // Base interaction: click dispatches a bubbling click Event; focus / blur
  // sequence the active element through the native contract and dispatch the
  // focusin/focus/focusout/blur events in the happy-dom order.
  ctx.defineMethod(HTMLElement.prototype, "click", function click() {
    this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true, composed: true }));
  });

  ctx.defineMethod(HTMLElement.prototype, "focus", function focus() {
    const handle = facadeNodeHandle(ctx, this, "focus");
    if (!handle.canFocus()) return;
    const previous = handle.previousActive();
    handle.clearActiveElement();
    if (previous !== null) {
      const previousNode = ctx.wrap(previous);
      previousNode.dispatchEvent(
        new Event("blur", { bubbles: false, composed: true, cancelable: true }),
      );
      previousNode.dispatchEvent(
        new Event("focusout", { bubbles: true, composed: true, cancelable: true }),
      );
    }
    handle.setActiveElement();
    this.dispatchEvent(new Event("focus", { bubbles: false, composed: true }));
    this.dispatchEvent(new Event("focusin", { bubbles: true, composed: true }));
  });

  ctx.defineMethod(HTMLElement.prototype, "blur", function blur() {
    const handle = facadeNodeHandle(ctx, this, "blur");
    if (!handle.isActive()) return;
    handle.clearActiveElement();
    this.dispatchEvent(new Event("blur", { bubbles: false, composed: true, cancelable: true }));
    this.dispatchEvent(new Event("focusout", { bubbles: true, composed: true, cancelable: true }));
  });
}
