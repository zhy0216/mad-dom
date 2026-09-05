// `HTMLElement` base class, reflected attributes, `dataset` and base
// interaction facade extension (T39).
//
// Implements the T39 HTMLElement slice: the `HTMLElement` facade class with
// the reflected attribute surface (`id` / `className` / `title` / `dir` /
// `lang` / `hidden` / `inert` / `tabIndex` / `contentEditable` /
// `isContentEditable`), the live `dataset` `DOMStringMap`, and the base
// `click` / `focus` / `blur` interaction.
//
// # Prototype hierarchy (T48A class hierarchy)
//
// Since T48A the facade owns the WHATWG class chain: `Node` is the base,
// `Element extends Node`, `HTMLElement extends Element`, and per-tag classes
// (`HTMLDivElement` etc.) extend `HTMLElement`. The element surface (`id` /
// `className`, the attribute methods, `innerHTML`, the query methods,
// `tagName` / `localName`) lives on `Element.prototype`; the HTMLElement
// surface lives on `HTMLElement.prototype` exactly like happy-dom. Every
// element wrapper is `instanceof window.HTMLElement` (and its per-tag class),
// and Text / Comment are plain `Node`s that never reach the element members —
// `text.getAttribute` reads `undefined` and calling it throws
// `TypeError: ... is not a function`, matching happy-dom.
//
// # Reflected attributes are the attribute contract
//
// Every write is a `setAttribute` / `removeAttribute` on the same Core
// attribute storage (T25B). `id` / `className` may reuse an exact scalar value
// while Core's structure and attribute generations match; every mutation
// invalidates it before the next read. Reflection is therefore two-way by
// construction without a second authoritative attribute store.
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
import { Element, registerElementClass, setElementFallbackClasses } from "./node.js";
import { Window } from "../window.js";
import { Event } from "./events.js";
import { flushCustomElementReactions } from "./custom-elements.js";
import { readCachedAttribute } from "./attribute-cache.js";

export const seam = Object.freeze({
  id: "facade/extensions/html-element",
  owner: "T39",
  gate: "T39",
  status: "implemented",
});

/**
 * `HTMLElement` facade base class (T39, T48A).
 *
 * Since T48A `HTMLElement` is a genuine class between `Element` and the
 * per-tag element classes: `per-tag → HTMLElement → Element → Node`, matching
 * the WHATWG / happy-dom chain. Instances are never constructed directly: the
 * element surface is wired on `HTMLElement.prototype` and every element
 * wrapper inherits it (the T48A per-tag direct prototypes sit above).
 */
export class HTMLElement extends Element {}

/**
 * Per-tag element classes (T48A).
 *
 * One empty class per common HTML tag, generated so `constructor.name` matches
 * the WHATWG name (`HTMLDivElement` etc.) and `Object.getPrototypeOf(el)`
 * lines up with happy-dom (`getAttribute` / `textContent` are inherited, so
 * they read `present: false` on the direct prototype). Each class is exported
 * and registered in the `node.js` per-tag table so `createElement` / parse /
 * import select it as the direct prototype.
 */
export const HTMLUnknownElement = class HTMLUnknownElement extends HTMLElement {};
export const HTMLDivElement = class HTMLDivElement extends HTMLElement {};
export const HTMLSpanElement = class HTMLSpanElement extends HTMLElement {};
export const HTMLParagraphElement = class HTMLParagraphElement extends HTMLElement {};
export const HTMLAnchorElement = class HTMLAnchorElement extends HTMLElement {};
export const HTMLBodyElement = class HTMLBodyElement extends HTMLElement {};
export const HTMLHeadingElement = class HTMLHeadingElement extends HTMLElement {};
export const HTMLUListElement = class HTMLUListElement extends HTMLElement {};
export const HTMLOListElement = class HTMLOListElement extends HTMLElement {};
export const HTMLLIElement = class HTMLLIElement extends HTMLElement {};
export const HTMLTableElement = class HTMLTableElement extends HTMLElement {};
export const HTMLTableCaptionElement = class HTMLTableCaptionElement extends HTMLElement {};
export const HTMLTableRowElement = class HTMLTableRowElement extends HTMLElement {};
export const HTMLTableCellElement = class HTMLTableCellElement extends HTMLElement {};
export const HTMLTableSectionElement = class HTMLTableSectionElement extends HTMLElement {};
export const HTMLBRElement = class HTMLBRElement extends HTMLElement {};
export const HTMLHRElement = class HTMLHRElement extends HTMLElement {};
export const HTMLFormElement = class HTMLFormElement extends HTMLElement {};
export const HTMLInputElement = class HTMLInputElement extends HTMLElement {};
export const HTMLButtonElement = class HTMLButtonElement extends HTMLElement {};
export const HTMLSelectElement = class HTMLSelectElement extends HTMLElement {};
export const HTMLOptionElement = class HTMLOptionElement extends HTMLElement {};
export const HTMLTextAreaElement = class HTMLTextAreaElement extends HTMLElement {};
export const HTMLLabelElement = class HTMLLabelElement extends HTMLElement {};
export const HTMLImageElement = class HTMLImageElement extends HTMLElement {};
export const HTMLScriptElement = class HTMLScriptElement extends HTMLElement {};
export const HTMLStyleElement = class HTMLStyleElement extends HTMLElement {};
export const HTMLLinkElement = class HTMLLinkElement extends HTMLElement {};
export const HTMLMetaElement = class HTMLMetaElement extends HTMLElement {};
export const HTMLTitleElement = class HTMLTitleElement extends HTMLElement {};
export const HTMLHeadElement = class HTMLHeadElement extends HTMLElement {};
export const HTMLHtmlElement = class HTMLHtmlElement extends HTMLElement {};
export const HTMLQuoteElement = class HTMLQuoteElement extends HTMLElement {};
export const HTMLSlotElement = class HTMLSlotElement extends HTMLElement {};
export const HTMLTemplateElement = class HTMLTemplateElement extends HTMLElement {};

// Common-tag → direct prototype table (T48A), mirroring the happy-dom
// selection: every class here becomes the wrapper's direct prototype. Tags not
// listed fall back to `HTMLUnknownElement` (plain name) or `HTMLElement`
// (hyphenated, an undefined custom-element-style name) exactly like happy-dom.
const PER_TAG = [
  ["html", HTMLHtmlElement],
  ["head", HTMLHeadElement],
  ["body", HTMLBodyElement],
  ["title", HTMLTitleElement],
  ["div", HTMLDivElement],
  ["span", HTMLSpanElement],
  ["p", HTMLParagraphElement],
  ["a", HTMLAnchorElement],
  ["h1", HTMLHeadingElement],
  ["h2", HTMLHeadingElement],
  ["h3", HTMLHeadingElement],
  ["h4", HTMLHeadingElement],
  ["h5", HTMLHeadingElement],
  ["h6", HTMLHeadingElement],
  ["ul", HTMLUListElement],
  ["ol", HTMLOListElement],
  ["li", HTMLLIElement],
  ["table", HTMLTableElement],
  ["caption", HTMLTableCaptionElement],
  ["tr", HTMLTableRowElement],
  ["td", HTMLTableCellElement],
  ["th", HTMLTableCellElement],
  ["thead", HTMLTableSectionElement],
  ["tbody", HTMLTableSectionElement],
  ["tfoot", HTMLTableSectionElement],
  ["br", HTMLBRElement],
  ["hr", HTMLHRElement],
  ["form", HTMLFormElement],
  ["input", HTMLInputElement],
  ["button", HTMLButtonElement],
  ["select", HTMLSelectElement],
  ["option", HTMLOptionElement],
  ["textarea", HTMLTextAreaElement],
  ["label", HTMLLabelElement],
  ["img", HTMLImageElement],
  ["script", HTMLScriptElement],
  ["style", HTMLStyleElement],
  ["link", HTMLLinkElement],
  ["meta", HTMLMetaElement],
  ["blockquote", HTMLQuoteElement],
  ["q", HTMLQuoteElement],
  ["slot", HTMLSlotElement],
  ["template", HTMLTemplateElement],
  ["section", HTMLElement],
];

const PER_TAG_WINDOW_ACCESSORS = Object.freeze({
  HTMLUnknownElement,
  HTMLDivElement,
  HTMLSpanElement,
  HTMLParagraphElement,
  HTMLAnchorElement,
  HTMLBodyElement,
  HTMLHeadingElement,
  HTMLUListElement,
  HTMLOListElement,
  HTMLLIElement,
  HTMLTableElement,
  HTMLTableCaptionElement,
  HTMLTableRowElement,
  HTMLTableCellElement,
  HTMLTableSectionElement,
  HTMLBRElement,
  HTMLHRElement,
  HTMLFormElement,
  HTMLInputElement,
  HTMLButtonElement,
  HTMLSelectElement,
  HTMLOptionElement,
  HTMLTextAreaElement,
  HTMLLabelElement,
  HTMLImageElement,
  HTMLScriptElement,
  HTMLStyleElement,
  HTMLLinkElement,
  HTMLMetaElement,
  HTMLTitleElement,
  HTMLHeadElement,
  HTMLHtmlElement,
  HTMLQuoteElement,
  HTMLSlotElement,
  HTMLTemplateElement,
});

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
 *
 * Exported for the svg extension: happy-dom's `SVGElement` exposes the same
 * live `dataset` surface as `HTMLElement`.
 */
export function datasetFor(ctx, element) {
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
  // The T48A prototype hierarchy: `HTMLElement extends Element extends Node`
  // through class syntax (no re-parenting needed). Register the per-tag direct
  // prototypes and the unknown-name fallbacks so the node creation / parse /
  // import wrap path selects them (node.js createNodeWrapper).
  for (const [tag, elementClass] of PER_TAG) {
    registerElementClass(tag, elementClass);
  }
  setElementFallbackClasses(HTMLElement, HTMLUnknownElement);

  // `window.HTMLElement` — the WHATWG constructor accessor on every window.
  ctx.defineAccessor(Window.prototype, "HTMLElement", function getHTMLElement() {
    return HTMLElement;
  }, undefined);

  // `window.HTML*Element` — the per-tag constructor accessors (T48A), matching
  // the happy-dom window surface.
  for (const [name, elementClass] of Object.entries(PER_TAG_WINDOW_ACCESSORS)) {
    ctx.defineAccessor(Window.prototype, name, function getPerTagElement() {
      return elementClass;
    }, undefined);
  }

  // `document.activeElement` — the stored focused element (stale-cleared by
  // Core), falling back to body / documentElement / null like happy-dom.
  ctx.defineAccessor(Document.prototype, "activeElement", function activeElement() {
    const active = ctx.wrap(
      facadeDocumentHandle(ctx, this, "activeElement").activeElement(),
    );
    if (active !== null) return active;
    return this.body ?? this.documentElement ?? null;
  }, undefined);

  // Element-level string reflection (T48A: on `Element.prototype`, matching
  // happy-dom; Text/Comment never reach them).
  ctx.defineAccessor(Element.prototype, "id", function id() {
    const handle = facadeNodeHandle(ctx, this, "id");
    return readCachedAttribute(this, handle, "id") || "";
  }, function id(value) {
    const handle = facadeNodeHandle(ctx, this, "id");
    handle.setAttribute("id", String(value));
    flushCustomElementReactions(ctx, handle);
  });

  ctx.defineAccessor(Element.prototype, "className", function className() {
    const handle = facadeNodeHandle(ctx, this, "className");
    return readCachedAttribute(this, handle, "class") || "";
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
      facadeNodeHandle(ctx, this, "contentEditable").getAttribute("contenteditable"),
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
      handle.setAttribute("contenteditable", normalized);
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

  // `innerText` (happy-dom HTMLElement parity): the getter renders the text the
  // way happy-dom does — a disconnected element reads its `textContent`, while a
  // connected one walks the children, skipping `<script>` / `<style>` / `<svg>`,
  // honoring the computed `display` / `text-transform`, and joining block / flex
  // runs with newlines. The setter clears the children and rebuilds them as text
  // nodes separated by `<br>` for every `\n` / `\r`.
  ctx.defineAccessor(HTMLElement.prototype, "innerText", function innerText() {
    const handle = facadeNodeHandle(ctx, this, "innerText");
    if (!handle.isConnected()) {
      return this.textContent;
    }
    const documentFacade = ctx.wrap(handle.ownerDocument());
    const windowFacade = ctx.windowFacadeOfDocument(documentFacade);
    let result = "";
    for (const childNode of this.childNodes) {
      const childHandle = ctx.documentContext.handleOf(childNode);
      const childNodeType = childHandle.nodeType();
      if (childNodeType === 1) {
        const tagName = childNode.tagName;
        if (tagName !== "SCRIPT" && tagName !== "STYLE" && tagName !== "svg") {
          const computedStyle = windowFacade ? windowFacade.getComputedStyle(childNode) : null;
          const display = computedStyle ? computedStyle.display : "";
          if (display !== "none") {
            const textTransform = computedStyle ? computedStyle.textTransform : "";
            const childInnerText = childNode.innerText;
            // Only add newline if it's a block/flex element and there's more
            // content coming after.
            if ((display === "block" || display === "flex") && result && childInnerText) {
              result += "\n";
            }
            let text = childInnerText;
            switch (textTransform) {
              case "uppercase":
                text = text.toUpperCase();
                break;
              case "lowercase":
                text = text.toLowerCase();
                break;
              case "capitalize":
                text = text.replace(/(^|\s)\S/g, (l) => l.toUpperCase());
                break;
            }
            result += text;
          }
        }
      } else if (childNodeType === 3) {
        result += childNode.textContent.replace(/[\n\r]/, "");
      }
    }
    return result;
  }, function innerText(text) {
    const handle = facadeNodeHandle(ctx, this, "innerText");
    const childNodes = this.childNodes;
    while (childNodes.length) {
      this.removeChild(childNodes[0]);
    }
    const texts = String(text).split(/[\n\r]/);
    const ownerDocument = ctx.wrap(handle.ownerDocument());
    for (let i = 0, max = texts.length; i < max; i++) {
      if (i !== 0) {
        this.appendChild(ownerDocument.createElement("br"));
      }
      this.appendChild(ownerDocument.createTextNode(texts[i]));
    }
  });

  // dataset: the live DOMStringMap over `data-*` attributes.
  ctx.defineAccessor(HTMLElement.prototype, "dataset", function dataset() {
    return datasetFor(ctx, this);
  }, undefined);

  // accessKey and the layout dimension reads (W6): happy-dom exposes an
  // `accesskey` attribute reflection and the always-zero offset/client box
  // getters on HTMLElement (no layout engine).
  ctx.defineAccessor(HTMLElement.prototype, "accessKey", function accessKey() {
    return facadeNodeHandle(ctx, this, "accessKey").getAttribute("accesskey") || "";
  }, function accessKey(v) {
    facadeNodeHandle(ctx, this, "accessKey").setAttribute("accesskey", String(v));
  });
  for (const property of [
    "offsetHeight",
    "offsetWidth",
    "offsetLeft",
    "offsetTop",
    "clientHeight",
    "clientWidth",
    "clientLeft",
    "clientTop",
  ]) {
    ctx.defineAccessor(HTMLElement.prototype, property, function layoutZero() {
      return 0;
    }, undefined);
  }

  // popover enum reflection (happy-dom: null default, "auto" for the empty
  // value, "manual" for any other value).
  ctx.defineAccessor(HTMLElement.prototype, "popover", function popover() {
    const value = facadeNodeHandle(ctx, this, "popover").getAttribute("popover");
    switch (value) {
      case null:
        return null;
      case "":
      case "auto":
        return "auto";
      default:
        return "manual";
    }
  }, function popover(value) {
    const handle = facadeNodeHandle(ctx, this, "popover");
    if (value === null) {
      handle.removeAttribute("popover");
      return;
    }
    handle.setAttribute("popover", String(value));
  });

  // Base interaction: click dispatches a bubbling click Event; focus / blur
  // sequence the active element through the native contract and dispatch the
  // focusin/focus/focusout/blur events in the happy-dom order. The `click`
  // property is configurable so the hdunit nodes wave can layer the
  // HTMLDetailsElement summary-toggle default action on top (T06).
  ctx.defineMethod(HTMLElement.prototype, "click", function click() {
    this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true, composed: true }));
  }, { configurable: true });

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
