// hdunit nodes wave facade additions (T06).
//
// The nodes subsystem wave enables the vendored happy-dom node tests. Most
// WHATWG surfaces they exercise are already native (the binding exposes the
// full CharacterData / form / attribute contract); this extension wires the
// remaining facade surface and the per-tag element classes happy-dom tests
// construct:
//
//   - per-window `window.Text` / `window.Comment` constructor accessors that
//     mint detached character-data nodes (`new window.Text('x')`), matching
//     happy-dom's WindowContextClassExtender;
//   - `document.createComment`;
//   - the per-tag element classes happy-dom defines (`HTMLBaseElement`,
//     `HTMLDListElement`, `HTMLDataElement`, `HTMLDataListElement`,
//     `HTMLDetailsElement`, `HTMLDialogElement`, `HTMLEmbedElement`,
//     `HTMLLegendElement`, `HTMLMapElement`, `HTMLMenuElement`,
//     `HTMLMeterElement`, `HTMLModElement`, `HTMLParamElement`,
//     `HTMLPictureElement`, `HTMLPreElement`, `HTMLProgressElement`,
//     `HTMLSourceElement`, `HTMLTableColElement`, `HTMLTimeElement`) plus
//     their reflected attributes;
//   - the `Symbol.toStringTag`-driven `[object <Name>]` contract (Node base);
//   - `Text.wholeText` / `Text.splitText` (DOMException-shaped) and
//     `Comment`/`Text.toString`;
//   - element URL reflection (`href` / `src` / `cite`) resolved against the
//     owning window location;
//   - the `on<event>` handler-attribute accessors (global window/body events)
//     with script evaluation gated by `enableJavaScriptEvaluation`;
//   - `input.files` (FileList) and the per-window `happyDOM.setURL` helper.
//
// Everything here is facade-only: no second DOM state, every read/write routes
// through the native handle and `ctx.wrap` stays the unique conversion entry.

import {
  Node,
  Element,
  DocumentFragment,
  CharacterData,
  Text,
  Comment,
  nodeHandleOf,
  registerElementClass,
} from "./classes.js";
import { Document } from "../document.js";
import { Window } from "../window.js";
import {
  HTMLElement,
  HTMLBodyElement,
  HTMLMetaElement,
  HTMLOptionElement,
  HTMLQuoteElement,
  HTMLTableSectionElement,
  HTMLTitleElement,
  HTMLLIElement,
  HTMLOListElement,
  HTMLAnchorElement,
  HTMLLinkElement,
  HTMLButtonElement,
  HTMLInputElement,
  HTMLSelectElement,
  HTMLTextAreaElement,
  HTMLTableCellElement,
  HTMLScriptElement,
  HTMLImageElement,
} from "./html-element.js";
import { HTMLCollection } from "./live-collections.js";
import { DOMTokenList } from "./attribute-nodes.js";
import { flushCustomElementReactions } from "./custom-elements.js";
import { rethrowDomError, webidlMessage } from "./dom-error.js";
import { Event } from "./events.js";

export const seam = Object.freeze({
  id: "facade/extensions/hdunit-nodes",
  owner: "T06",
  gate: "T06",
  status: "implemented",
});

// DOMException / File: happy-dom tests construct and assert `instanceof` these
// classes. `DOMException` reuses the Bun / Web host constructor (the same one
// `window.DOMException` exposes), so `toThrow(DOMException)` matches the host
// surface. `File` is the facade `File` (lightweight wave, T08) — the vendored
// file tests spy on `Date.now()` for the default `lastModified`, which the host
// `File` does not honor; re-exporting the single facade `File` keeps the nodes
// wave (`new File([], 'name')` / `input.files`) and the file wave on one class.
export const DOMException = globalThis.DOMException;
export { File } from "./lightweight.js";

// --- per-tag element classes (T06) ------------------------------------------

export const HTMLBaseElement = class HTMLBaseElement extends HTMLElement {};
export const HTMLDListElement = class HTMLDListElement extends HTMLElement {};
export const HTMLDataElement = class HTMLDataElement extends HTMLElement {};
export const HTMLDataListElement = class HTMLDataListElement extends HTMLElement {};
export const HTMLDetailsElement = class HTMLDetailsElement extends HTMLElement {};
export const HTMLDialogElement = class HTMLDialogElement extends HTMLElement {};
export const HTMLEmbedElement = class HTMLEmbedElement extends HTMLElement {};
export const HTMLLegendElement = class HTMLLegendElement extends HTMLElement {};
export const HTMLMapElement = class HTMLMapElement extends HTMLElement {};
export const HTMLMenuElement = class HTMLMenuElement extends HTMLElement {};
export const HTMLMeterElement = class HTMLMeterElement extends HTMLElement {};
export const HTMLModElement = class HTMLModElement extends HTMLElement {};
export const HTMLParamElement = class HTMLParamElement extends HTMLElement {};
export const HTMLPictureElement = class HTMLPictureElement extends HTMLElement {};
export const HTMLPreElement = class HTMLPreElement extends HTMLElement {};
export const HTMLProgressElement = class HTMLProgressElement extends HTMLElement {};
export const HTMLSourceElement = class HTMLSourceElement extends HTMLElement {};
export const HTMLTableColElement = class HTMLTableColElement extends HTMLElement {};
export const HTMLTimeElement = class HTMLTimeElement extends HTMLElement {};
export const HTMLOptGroupElement = class HTMLOptGroupElement extends HTMLElement {};
export const HTMLAreaElement = class HTMLAreaElement extends HTMLElement {};
export const HTMLIFrameElement = class HTMLIFrameElement extends HTMLElement {};
export const HTMLObjectElement = class HTMLObjectElement extends HTMLElement {};
export const HTMLOutputElement = class HTMLOutputElement extends HTMLElement {};
export const HTMLTrackElement = class HTMLTrackElement extends HTMLElement {};
export const HTMLCanvasElement = class HTMLCanvasElement extends HTMLElement {};

const PER_TAG = [
  ["base", HTMLBaseElement],
  ["area", HTMLAreaElement],
  ["iframe", HTMLIFrameElement],
  ["object", HTMLObjectElement],
  ["output", HTMLOutputElement],
  ["track", HTMLTrackElement],
  ["canvas", HTMLCanvasElement],
  ["dl", HTMLDListElement],
  ["data", HTMLDataElement],
  ["datalist", HTMLDataListElement],
  ["details", HTMLDetailsElement],
  ["dialog", HTMLDialogElement],
  ["embed", HTMLEmbedElement],
  ["legend", HTMLLegendElement],
  ["map", HTMLMapElement],
  ["menu", HTMLMenuElement],
  ["meter", HTMLMeterElement],
  ["ins", HTMLModElement],
  ["del", HTMLModElement],
  ["param", HTMLParamElement],
  ["picture", HTMLPictureElement],
  ["pre", HTMLPreElement],
  ["progress", HTMLProgressElement],
  ["source", HTMLSourceElement],
  ["col", HTMLTableColElement],
  ["colgroup", HTMLTableColElement],
  ["optgroup", HTMLOptGroupElement],
  ["time", HTMLTimeElement],
];

// --- helpers ----------------------------------------------------------------

function handleOf(value) {
  const handle = nodeHandleOf(value);
  if (handle === undefined) {
    throw new TypeError("the receiver is not a genuine Node facade wrapper");
  }
  return handle;
}

// The owning document facade of a node (native `owner_document` + the unique
// wrap entry), so detached elements still resolve their window.
function documentOf(ctx, node) {
  return ctx.wrap(handleOf(node).ownerDocument());
}

function windowOf(ctx, node) {
  return ctx.windowFacadeOfDocument(documentOf(ctx, node));
}

// happy-dom element URL reflection (`cite` / `href` / `src`): the attribute
// value resolved against the owning window location, falling back to the raw
// attribute when resolution fails (default `about:blank` base throws).
function absoluteURL(ctx, node, value) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const win = windowOf(ctx, node);
  const base = win?.location?.href;
  if (base === undefined || base === null || raw === "") return raw;
  try {
    return new URL(raw, base).href;
  } catch {
    return raw;
  }
}

// happy-dom stores HTML attribute names in lowercase (WHATWG case-insensitive
// attribute matching); the element-specific reflection helpers write/read the
// normalized name through the case-sensitive native handle.
function reflectAttr(name) {
  return String(name).toLowerCase();
}

// happy-dom `long` reflection (Number on the attribute, `"0"` fallback on a
// NaN write) and `unsigned long` reflection.
function longReflect(attr, fallbackOnMissing) {
  return {
    get(handle) {
      const raw = handle.getAttribute(attr);
      if (raw === null) return fallbackOnMissing;
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? fallbackOnMissing : parsed;
    },
    set(handle, value) {
      const parsed = Number(value);
      handle.setAttribute(attr, Number.isNaN(parsed) ? "0" : String(parsed));
    },
  };
}

// happy-dom boolean (presence) reflection.
function boolReflect(attr) {
  return {
    get(handle) {
      return handle.getAttribute(attr) !== null;
    },
    set(handle, value) {
      if (value) handle.setAttribute(attr, "");
      else handle.removeAttribute(attr);
    },
  };
}

// --- event-handler (`on<event>`) attribute accessors -------------------------
//
// happy-dom's ElementEventAttributeUtility: a `on<event>` read returns the
// listener stored by assignment, else compiles the `on<event>` attribute string
// in the owning window context (gated by `enableJavaScriptEvaluation`); a
// `on<event>` write stores the listener, removes the attribute and wires it as
// a real event listener so `dispatchEvent` invokes it.

const EVENT_HANDLERS = new WeakMap();

function handlersOf(element) {
  let handlers = EVENT_HANDLERS.get(element);
  if (handlers === undefined) {
    handlers = new Map();
    EVENT_HANDLERS.set(element, handlers);
  }
  return handlers;
}

function eventHandlerGetter(ctx, element, eventName) {
  const handlers = handlersOf(element);
  const stored = handlers.get(eventName);
  if (stored !== undefined) return stored;
  const handle = handleOf(element);
  const code = handle.getAttribute(`on${eventName}`);
  if (code === null || code === "") return null;
  const win = windowOf(ctx, element);
  if (win === undefined) return null;
  let listener;
  try {
    // happy-dom compiles the attribute into `(function($happy_dom, event) { … })`
    // evaluated in the window global scope (so `window` is the facade window).
    // The facade compiles the same shape with `new Function` closing over the
    // owning window facade and binds the element as `this`.
    const factory = new Function("window", `return function anonymous($happy_dom, event) { ${code} };`);
    listener = factory(win).bind(element);
  } catch {
    return null;
  }
  handlers.set(eventName, listener);
  return listener;
}

function eventHandlerSetter(ctx, element, eventName, value) {
  const handle = handleOf(element);
  handle.removeAttribute(`on${eventName}`);
  const handlers = handlersOf(element);
  const previous = handlers.get(eventName);
  if (previous !== undefined) {
    element.removeEventListener(eventName, previous);
  }
  if (typeof value === "function") {
    handlers.set(eventName, value);
    element.addEventListener(eventName, value);
  } else {
    handlers.delete(eventName);
  }
}

// Exported for the svg extension: happy-dom's `SVGElement` / animation
// element expose the same `on<event>` handler-attribute accessors as
// `HTMLElement` / the global window surface.
export { eventHandlerGetter, eventHandlerSetter };

const GLOBAL_EVENT_NAMES = [
  "afterprint",
  "beforeprint",
  "beforeunload",
  "gamepadconnected",
  "gamepaddisconnected",
  "hashchange",
  "languagechange",
  "message",
  "messageerror",
  "offline",
  "online",
  "pagehide",
  "pageshow",
  "popstate",
  "rejectionhandled",
  "storage",
  "unhandledrejection",
  "unload",
  "load",
  "error",
  "resize",
  "scroll",
];

// --- HTMLHyperlinkElementUtility (anchor / area URL surface) -----------------
//
// happy-dom's HTMLHyperlinkElementUtility: every getter parses the resolved
// `href` (`new URL(href, ownerDocument.location.href)`, falling back to the raw
// attribute when resolution fails) and reads a URL part; every part setter
// parses the resolved href into a URL, mutates the part and writes the mutated
// `url.href` back to the "href" attribute. The facade mirrors that exactly with
// the host URL constructor, so the observable surface matches the baseline.

function hyperlinkResolvedHref(ctx, element) {
  const handle = handleOf(element);
  if (handle.getAttribute("href") === null) return "";
  const raw = handle.getAttribute("href");
  const base = windowOf(ctx, element)?.location?.href;
  try {
    return base ? new URL(raw, base).href : raw;
  } catch {
    return raw;
  }
}

function hyperlinkURL(ctx, element) {
  return new URL(hyperlinkResolvedHref(ctx, element));
}

const HYPERLINK_PARTS = [
  "hash",
  "host",
  "hostname",
  "origin",
  "pathname",
  "port",
  "protocol",
  "search",
  "username",
  "password",
];

function installHyperlinkSurface(ctx, Class) {
  // The read-only `origin` getter (no setter in happy-dom).
  ctx.defineAccessor(Class.prototype, "origin", function origin() {
    try {
      return hyperlinkURL(ctx, this).origin;
    } catch {
      return "";
    }
  }, undefined);

  for (const part of HYPERLINK_PARTS) {
    if (part === "origin") continue;
    ctx.defineAccessor(Class.prototype, part, function urlPartGetter() {
      if (part === "hash") {
        const raw = handleOf(this).getAttribute("href");
        if (raw !== null && raw[0] === "#") return raw;
      }
      try {
        return hyperlinkURL(ctx, this)[part];
      } catch {
        return "";
      }
    }, function urlPartSetter(value) {
      let url;
      try {
        url = hyperlinkURL(ctx, this);
      } catch {
        return;
      }
      url[part] = value;
      handleOf(this).setAttribute("href", url.href);
    });
  }
}

// --- install ----------------------------------------------------------------

export function install(ctx) {
  // Per-tag element classes (T06): register so createElement / parse / import
  // select them as the direct wrapper prototype.
  for (const [tag, elementClass] of PER_TAG) {
    registerElementClass(tag, elementClass);
  }

  // `window.Text` / `window.Comment` / `window.CharacterData` — per-window
  // subclasses that mint a detached node through the window's document, like
  // happy-dom's WindowContextClassExtender. `new window.Text('x')` creates a
  // detached text node (`instanceof` the imported base class holds).
  const WINDOW_CHARACTER_DATA = new WeakMap();
  function characterDataClassFor(windowFacade, Base, name, create) {
    let entry = WINDOW_CHARACTER_DATA.get(windowFacade);
    if (entry === undefined) {
      entry = { Text: null, Comment: null, CharacterData: null };
      WINDOW_CHARACTER_DATA.set(windowFacade, entry);
    }
    if (entry[name] === null) {
      const docHandle = ctx.documentContext.handleOf(windowFacade.document);
      const cls = class extends Base {
        constructor(data) {
          const handle = create(docHandle, data);
          super(handle);
          ctx.registerWrap?.(handle, this);
        }
      };
      Object.defineProperty(cls, "name", { value: name });
      entry[name] = cls;
    }
    return entry[name];
  }

  ctx.defineAccessor(Window.prototype, "Text", function getText() {
    return characterDataClassFor(this, Text, "Text", (docHandle, data) =>
      docHandle.createText(String(data ?? "")),
    );
  }, undefined);
  ctx.defineAccessor(Window.prototype, "Comment", function getComment() {
    return characterDataClassFor(this, Comment, "Comment", (docHandle, data) =>
      docHandle.createComment(String(data ?? "")),
    );
  }, undefined);
  ctx.defineAccessor(Window.prototype, "CharacterData", function getCharacterData() {
    return characterDataClassFor(this, CharacterData, "CharacterData", (docHandle, data) =>
      docHandle.createText(String(data ?? "")),
    );
  }, undefined);

  // `document.createComment` is provided by the T33 extended-nodes extension.

  // `Node.ownerDocument` — the owning document of any node (detached nodes
  // included), resolved through the native `owner_document` + the unique wrap
  // entry so identity matches `window.document`.
  ctx.defineAccessor(Node.prototype, "ownerDocument", function ownerDocument() {
    return ctx.wrap(handleOf(this).ownerDocument());
  }, undefined);

  // `Element.children` — a live element-children collection (only child
  // elements, nodeType 1), mirroring the WHATWG ParentNode.children.
  ctx.defineAccessor(Element.prototype, "children", function children() {
    return childrenOf(ctx, this);
  }, undefined);

  // `Node.append(...nodes)` — ParentNode.append (string arguments become text
  // nodes), and `ChildNode.remove` — both used across the vendored tests.
  ctx.defineMethod(Node.prototype, "append", function append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") {
        this.appendChild(ctx.wrap(handleOf(this).ownerDocument().createText(String(node))));
      } else {
        this.appendChild(node);
      }
    }
  });
  ctx.defineMethod(Node.prototype, "remove", function remove() {
    const parent = handleOf(this).parentNode();
    if (parent !== null) {
      ctx.wrap(parent).removeChild(this);
    }
  });

  // `Node.contains` — whether `other` is a descendant of (or equal to) this
  // node. `null` / `undefined` (and any non-node) reads `false`, matching
  // happy-dom.
  ctx.defineMethod(Node.prototype, "contains", function contains(other) {
    if (other === null || other === undefined) return false;
    const otherHandle = handleOf(other);
    if (otherHandle === undefined) return false;
    const thisHandle = handleOf(this);
    if (otherHandle === thisHandle) return true;
    for (let parent = otherHandle.parentNode(); parent !== null; parent = parent.parentNode()) {
      if (parent === thisHandle) return true;
    }
    return false;
  });

  // `Node.hasChildNodes()` — whether this node has any child nodes.
  ctx.defineMethod(Node.prototype, "hasChildNodes", function hasChildNodes() {
    return handleOf(this).childNodes().length > 0;
  });

  // `Node.isSameNode(other)` — whether `other` is the very same node object.
  ctx.defineMethod(Node.prototype, "isSameNode", function isSameNode(other) {
    return this === other;
  });

  // `Node.parentElement` — the nearest element ancestor, or null.
  ctx.defineAccessor(Node.prototype, "parentElement", function parentElement() {
    for (let parent = handleOf(this).parentNode(); parent !== null; parent = parent.parentNode()) {
      if (parent.nodeType() === 1) return ctx.wrap(parent);
    }
    return null;
  }, undefined);

  // `Node.previousElementSibling` / `nextElementSibling` — the nearest element
  // sibling in either direction, or null (happy-dom NonDocumentChildNode).
  ctx.defineAccessor(Node.prototype, "previousElementSibling", function previousElementSibling() {
    for (let sibling = handleOf(this).previousSibling(); sibling !== null; sibling = sibling.previousSibling()) {
      if (sibling.nodeType() === 1) return ctx.wrap(sibling);
    }
    return null;
  }, undefined);
  ctx.defineAccessor(Node.prototype, "nextElementSibling", function nextElementSibling() {
    for (let sibling = handleOf(this).nextSibling(); sibling !== null; sibling = sibling.nextSibling()) {
      if (sibling.nodeType() === 1) return ctx.wrap(sibling);
    }
    return null;
  }, undefined);

  // ParentNode element getters (`firstElementChild` / `lastElementChild` /
  // `childElementCount`) on Element and DocumentFragment (happy-dom
  // ParentNode). `children` already lives on Element; install it on
  // DocumentFragment too.
  const parentNodeElementAccessors = (Class) => {
    ctx.defineAccessor(Class.prototype, "firstElementChild", function firstElementChild() {
      return firstElementChildOf(ctx, this);
    }, undefined);
    ctx.defineAccessor(Class.prototype, "lastElementChild", function lastElementChild() {
      return lastElementChildOf(ctx, this);
    }, undefined);
    ctx.defineAccessor(Class.prototype, "childElementCount", function childElementCount() {
      return childElementCountOf(ctx, this);
    }, undefined);
  };
  parentNodeElementAccessors(Element);
  parentNodeElementAccessors(DocumentFragment);
  ctx.defineAccessor(DocumentFragment.prototype, "children", function children() {
    return childrenOf(ctx, this);
  }, undefined);

  // `Node.prepend(...nodes)` / `Node.replaceChildren(...nodes)` — ParentNode
  // mutation (string arguments become text nodes).
  ctx.defineMethod(Node.prototype, "prepend", function prepend(...nodes) {
    const firstChild = this.firstChild;
    for (const node of nodes) {
      const child = typeof node === "string" ? textNodeOf(ctx, this, node) : node;
      if (firstChild === null) this.appendChild(child);
      else this.insertBefore(child, firstChild);
    }
  });
  ctx.defineMethod(Node.prototype, "replaceChildren", function replaceChildren(...nodes) {
    while (this.firstChild !== null) {
      this.removeChild(this.firstChild);
    }
    for (const node of nodes) {
      this.appendChild(typeof node === "string" ? textNodeOf(ctx, this, node) : node);
    }
  });

  // `Node.before(...nodes)` / `Node.after(...nodes)` / `Node.replaceWith(...nodes)`
  // — ChildNode mutation (string arguments become text nodes; no-op when this
  // node has no parent).
  ctx.defineMethod(Node.prototype, "before", function before(...nodes) {
    const parent = this.parentNode;
    if (parent === null) return;
    for (const node of nodes) {
      parent.insertBefore(typeof node === "string" ? textNodeOf(ctx, this, node) : node, this);
    }
  });
  ctx.defineMethod(Node.prototype, "after", function after(...nodes) {
    const parent = this.parentNode;
    if (parent === null) return;
    const nextSibling = this.nextSibling;
    for (const node of nodes) {
      const child = typeof node === "string" ? textNodeOf(ctx, this, node) : node;
      if (nextSibling === null) parent.appendChild(child);
      else parent.insertBefore(child, nextSibling);
    }
  });
  ctx.defineMethod(Node.prototype, "replaceWith", function replaceWith(...nodes) {
    const parent = this.parentNode;
    if (parent === null) return;
    const nextSibling = this.nextSibling;
    parent.removeChild(this);
    for (const node of nodes) {
      const child = typeof node === "string" ? textNodeOf(ctx, this, node) : node;
      if (nextSibling === null) parent.appendChild(child);
      else parent.insertBefore(child, nextSibling);
    }
  });

  // `Node.normalize()` — merge adjacent Text nodes and drop empty ones,
  // recursing into element children (happy-dom Node.normalize).
  ctx.defineMethod(Node.prototype, "normalize", function normalize() {
    const children = Array.from(this.childNodes);
    let run = [];
    const flush = (before) => {
      if (run.length === 0) return;
      const merged = run.map((child) => child.data ?? "").join("");
      if (merged !== "") {
        const text = this.ownerDocument.createTextNode(merged);
        if (before === null) this.appendChild(text);
        else this.insertBefore(text, before);
      }
      for (const child of run) {
        this.removeChild(child);
      }
      run = [];
    };
    for (const child of children) {
      if (child.nodeType === 3) {
        run.push(child);
      } else {
        flush(child);
        if (child.nodeType === 1) child.normalize();
      }
    }
    flush(null);
  });

  // `Element.role` — a DOMString reflected attribute (happy-dom reflected
  // attribute surface).
  ctx.defineAccessor(Element.prototype, "role", function role() {
    return handleOf(this).getAttribute("role") ?? "";
  }, function role(value) {
    handleOf(this).setAttribute("role", String(value));
  });

  // CharacterData surface not covered by the T33 `Node.data`/`length` reads:
  // `toString()` mirrors happy-dom (`[object Comment]` / `[object Text]`).
  ctx.defineMethod(CharacterData.prototype, "toString", function toString() {
    return `[object ${this.constructor.name}]`;
  });

  // `Text.wholeText`: the concatenation of this node and every logically
  // adjacent text node (nodeType 3), stopping at element boundaries.
  ctx.defineAccessor(Text.prototype, "wholeText", function wholeText() {
    const handle = handleOf(this);
    const parts = [];
    for (let sibling = handle.previousSibling(); sibling !== null; sibling = sibling.previousSibling()) {
      if (sibling.nodeType() !== 3) break;
      parts.unshift(sibling.textContent() ?? "");
    }
    parts.push(handle.textContent() ?? "");
    for (let sibling = handle.nextSibling(); sibling !== null; sibling = sibling.nextSibling()) {
      if (sibling.nodeType() !== 3) break;
      parts.push(sibling.textContent() ?? "");
    }
    return parts.join("");
  }, undefined);

  // `Text.splitText`: validate like happy-dom (IndexSizeError DOMException on
  // an out-of-range offset) then delegate the split to the native contract.
  // The DOMException keeps the stable machine code in its message so the T33
  // native contract (`ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS`) stays observable.
  ctx.defineMethod(Text.prototype, "splitText", function splitText(offset) {
    const handle = handleOf(this);
    const length = handle.dataLength() ?? 0;
    const index = Number(offset);
    if (Number.isNaN(index) || index < 0 || index > length) {
      const domError = new DOMException(
        `Failed to execute 'splitText' on 'Text': The offset ${index} is larger than the Text node's length. [ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS]`,
        "IndexSizeError",
      );
      Object.defineProperty(domError, "code", {
        value: "ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS",
        writable: true,
        configurable: true,
      });
      throw domError;
    }
    return ctx.wrap(handle.splitText(index));
  });

  // --- per-tag reflected attributes (T06) ----------------------------------

  // HTMLBaseElement: href (URL, defaults to the document location), target.
  ctx.defineAccessor(HTMLBaseElement.prototype, "href", function href() {
    const handle = handleOf(this);
    const raw = handle.getAttribute("href");
    if (raw === null) {
      return windowOf(ctx, this)?.location?.href ?? "";
    }
    return absoluteURL(ctx, this, raw);
  }, function href(value) {
    handleOf(this).setAttribute("href", String(value));
    flushCustomElementReactions(ctx, handleOf(this));
  });
  ctx.defineAccessor(HTMLBaseElement.prototype, "target", function target() {
    return handleOf(this).getAttribute("target") || "";
  }, function target(value) {
    handleOf(this).setAttribute("target", String(value));
  });

  // HTMLAnchorElement / HTMLAreaElement (W6): the plain attribute reflections
  // (download/hreflang/ping/target/referrerPolicy/rel/type for anchor;
  // download/ping/target/referrerPolicy/rel/alt/coords/shape for area), the
  // hyperlink URL parts, relList, the href raw-attribute setter and toString.
  for (const [Class, properties] of [
    [HTMLAnchorElement, ["download", "hreflang", "ping", "target", "referrerPolicy", "rel", "type"]],
    [HTMLAreaElement, ["download", "ping", "target", "referrerPolicy", "rel", "alt", "coords", "shape"]],
  ]) {
    for (const property of properties) {
      ctx.defineAccessor(Class.prototype, property, function stringReflect() {
        return handleOf(this).getAttribute(reflectAttr(property)) || "";
      }, function stringReflect(v) {
        handleOf(this).setAttribute(reflectAttr(property), String(v));
      });
    }
  }

  // href: the happy-dom getter resolves the attribute against the owning window
  // location (falling back to the raw attribute), the setter writes the raw
  // value; toString mirrors href.
  for (const Class of [HTMLAnchorElement, HTMLAreaElement]) {
    ctx.defineAccessor(Class.prototype, "href", function href() {
      const raw = handleOf(this).getAttribute("href");
      if (raw === null) return "";
      const base = windowOf(ctx, this)?.location?.href;
      try {
        return base ? new URL(raw, base).href : raw;
      } catch {
        return raw;
      }
    }, function href(value) {
      handleOf(this).setAttribute("href", String(value));
    });
    installHyperlinkSurface(ctx, Class);
  }
  for (const Class of [HTMLAnchorElement, HTMLAreaElement]) {
    ctx.defineMethod(Class.prototype, "toString", function toString() {
      return this.href;
    });
  }
  ctx.defineAccessor(HTMLAreaElement.prototype, "relList", function relList() {
    const handle = handleOf(this);
    return new DOMTokenList(handle, "rel");
  }, function relList(value) {
    handleOf(this).setAttribute("rel", String(value));
  });

  // anchor / area tabIndex: happy-dom defaults these to "0" (the generic
  // HTMLElement default is "-1") and writes "0" for an invalid number.
  for (const Class of [HTMLAnchorElement, HTMLAreaElement]) {
    ctx.defineAccessor(Class.prototype, "tabIndex", function tabIndex() {
      const raw = handleOf(this).getAttribute("tabindex");
      if (raw !== null) {
        const parsed = Number(raw);
        return Number.isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    }, function tabIndex(value) {
      const parsed = Number(value);
      handleOf(this).setAttribute("tabindex", Number.isNaN(parsed) ? "0" : String(parsed));
    });
  }

  // HTMLLinkElement (W6): the attribute reflections (as/crossOrigin/href/
  // hreflang/media/referrerPolicy/rel/type) and the URL-resolved href getter
  // (relList already lives in attribute-nodes.js). The external stylesheet
  // load/error tests are dropped (ResourceFetch network dependency).
  for (const property of ["as", "crossOrigin", "hreflang", "media", "referrerPolicy", "rel", "type"]) {
    ctx.defineAccessor(HTMLLinkElement.prototype, property, function linkReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function linkReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }
  ctx.defineAccessor(HTMLLinkElement.prototype, "href", function href() {
    const raw = handleOf(this).getAttribute("href");
    if (raw === null) return "";
    const base = windowOf(ctx, this)?.location?.href;
    try {
      return base ? new URL(raw, base).href : raw;
    } catch {
      return raw;
    }
  }, function href(value) {
    handleOf(this).setAttribute("href", String(value));
  });

  // HTMLButtonElement / HTMLInputElement (W6): the form-action family and the
  // popover target reflections happy-dom exposes on both controls. `formAction`
  // is a URL-reflected attribute (defaulting to the document location when the
  // attribute is absent, empty when a relative value cannot resolve against an
  // `about:blank` base), `formEnctype` / `formMethod` / `formTarget` are plain
  // reflections, `popoverTargetAction` validates the token against
  // hide/show/toggle and `popoverTargetElement` stores the element reference
  // (throwing the WebIDL TypeError on a non-element value).
  for (const Class of [HTMLButtonElement, HTMLInputElement]) {
    ctx.defineAccessor(Class.prototype, "formAction", function formAction() {
      const handle = handleOf(this);
      const raw = handle.getAttribute("formaction");
      const base = windowOf(ctx, this)?.location?.href ?? "";
      if (raw === null) return base;
      try {
        return base ? new URL(raw, base).href : "";
      } catch {
        return "";
      }
    }, function formAction(value) {
      handleOf(this).setAttribute("formaction", String(value));
    });
    ctx.defineAccessor(Class.prototype, "formEnctype", function formEnctype() {
      return handleOf(this).getAttribute("formenctype") || "";
    }, function formEnctype(v) {
      handleOf(this).setAttribute("formenctype", String(v));
    });
    ctx.defineAccessor(Class.prototype, "formMethod", function formMethod() {
      return handleOf(this).getAttribute("formmethod") || "";
    }, function formMethod(v) {
      handleOf(this).setAttribute("formmethod", String(v));
    });
    ctx.defineAccessor(Class.prototype, "formTarget", function formTarget() {
      return handleOf(this).getAttribute("formtarget") || "";
    }, function formTarget(v) {
      handleOf(this).setAttribute("formtarget", String(v));
    });
    ctx.defineAccessor(Class.prototype, "popoverTargetAction", function popoverTargetAction() {
      const value = handleOf(this).getAttribute("popovertargetaction");
      if (value === null || (value !== "hide" && value !== "show" && value !== "toggle")) {
        return "toggle";
      }
      return value;
    }, function popoverTargetAction(value) {
      handleOf(this).setAttribute("popovertargetaction", String(value));
    });
  }

  const POPOVER_TARGETS = new WeakMap();
  ctx.defineAccessor(HTMLButtonElement.prototype, "popoverTargetElement", function popoverTargetElement() {
    return POPOVER_TARGETS.get(this) ?? null;
  }, function popoverTargetElement(value) {
    if (value !== null && !(value instanceof HTMLElement)) {
      throw new TypeError(
        `Failed to set the 'popoverTargetElement' property on 'HTMLInputElement': Failed to convert value to 'Element'.`,
      );
    }
    POPOVER_TARGETS.set(this, value);
  });
  ctx.defineAccessor(HTMLInputElement.prototype, "popoverTargetElement", function popoverTargetElement() {
    return POPOVER_TARGETS.get(this) ?? null;
  }, function popoverTargetElement(value) {
    if (value !== null && !(value instanceof HTMLElement)) {
      throw new TypeError(
        `Failed to set the 'popoverTargetElement' property on 'HTMLInputElement': Failed to convert value to 'Element'.`,
      );
    }
    POPOVER_TARGETS.set(this, value);
  });

  // HTMLInputElement (W6): the remaining public reflections happy-dom exposes —
  // the height/width property slots (default 0, NOT attribute-reflected), the
  // size / indeterminate / list / autofocus members and the plain string
  // reflections (alt/accept/allowdirs/autocomplete/placeholder/inputMode/src).
  const INPUT_HEIGHT_WIDTH = new WeakMap();
  ctx.defineAccessor(HTMLInputElement.prototype, "height", function height() {
    return INPUT_HEIGHT_WIDTH.get(this)?.height ?? 0;
  }, function height(v) {
    const slot = INPUT_HEIGHT_WIDTH.get(this) ?? {};
    slot.height = Number(v);
    INPUT_HEIGHT_WIDTH.set(this, slot);
    handleOf(this).setAttribute("height", String(v));
  });
  ctx.defineAccessor(HTMLInputElement.prototype, "width", function width() {
    return INPUT_HEIGHT_WIDTH.get(this)?.width ?? 0;
  }, function width(v) {
    const slot = INPUT_HEIGHT_WIDTH.get(this) ?? {};
    slot.width = Number(v);
    INPUT_HEIGHT_WIDTH.set(this, slot);
    handleOf(this).setAttribute("width", String(v));
  });
  ctx.defineAccessor(HTMLInputElement.prototype, "size", function size() {
    const raw = handleOf(this).getAttribute("size");
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      return Number.isNaN(parsed) ? 20 : parsed;
    }
    return 20;
  }, function size(v) {
    handleOf(this).setAttribute("size", String(v));
  });
  const INPUT_INDETERMINATE = new WeakMap();
  ctx.defineAccessor(HTMLInputElement.prototype, "indeterminate", function indeterminate() {
    return INPUT_INDETERMINATE.get(this) ?? false;
  }, function indeterminate(v) {
    INPUT_INDETERMINATE.set(this, Boolean(v));
  });
  ctx.defineAccessor(HTMLInputElement.prototype, "list", function list() {
    const id = handleOf(this).getAttribute("list");
    if (!id) return null;
    const elements = documentOf(ctx, this).querySelectorAll(`datalist#${id}`);
    return elements.length > 0 ? elements[0] : null;
  }, undefined);
  ctx.defineAccessor(HTMLInputElement.prototype, "autofocus", function autofocus() {
    return handleOf(this).getAttribute("autofocus") !== null;
  }, function autofocus(v) {
    const handle = handleOf(this);
    if (v) handle.setAttribute("autofocus", "");
    else handle.removeAttribute("autofocus");
  });
  for (const property of ["alt", "accept", "allowdirs", "autocomplete", "placeholder", "inputMode", "src"]) {
    ctx.defineAccessor(HTMLInputElement.prototype, property, function inputStringReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function inputStringReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }

  // HTMLTextAreaElement (W6): the plain string reflections
  // (name/autocomplete/cols/rows/placeholder/inputMode), the autofocus
  // boolean reflection and the tabIndex "0" default. The selection surface
  // (selectionStart/End/Direction, select/setSelectionRange/setRangeText) is
  // dropped — not implemented.
  for (const property of ["autocomplete", "cols", "rows", "placeholder", "inputMode"]) {
    ctx.defineAccessor(HTMLTextAreaElement.prototype, property, function textareaStringReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function textareaStringReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }
  ctx.defineAccessor(HTMLTextAreaElement.prototype, "autofocus", function autofocus() {
    return handleOf(this).getAttribute("autofocus") !== null;
  }, function autofocus(v) {
    const handle = handleOf(this);
    if (v) handle.setAttribute("autofocus", "");
    else handle.removeAttribute("autofocus");
  });
  ctx.defineAccessor(HTMLTextAreaElement.prototype, "tabIndex", function tabIndex() {
    const raw = handleOf(this).getAttribute("tabindex");
    if (raw !== null) {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, function tabIndex(value) {
    const parsed = Number(value);
    handleOf(this).setAttribute("tabindex", Number.isNaN(parsed) ? "0" : String(parsed));
  });

  // select autofocus reflection and the tabIndex "0" default (happy-dom
  // HTMLSelectElement).
  ctx.defineAccessor(HTMLSelectElement.prototype, "autofocus", function autofocus() {
    return handleOf(this).getAttribute("autofocus") !== null;
  }, function autofocus(v) {
    const handle = handleOf(this);
    if (v) handle.setAttribute("autofocus", "");
    else handle.removeAttribute("autofocus");
  });
  ctx.defineAccessor(HTMLSelectElement.prototype, "tabIndex", function tabIndex() {
    const raw = handleOf(this).getAttribute("tabindex");
    if (raw !== null) {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, function tabIndex(value) {
    const parsed = Number(value);
    handleOf(this).setAttribute("tabindex", Number.isNaN(parsed) ? "0" : String(parsed));
  });

  // input tabIndex: happy-dom defaults it to "0" (like anchor/area/button).
  ctx.defineAccessor(HTMLInputElement.prototype, "tabIndex", function tabIndex() {
    const raw = handleOf(this).getAttribute("tabindex");
    if (raw !== null) {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, function tabIndex(value) {
    const parsed = Number(value);
    handleOf(this).setAttribute("tabindex", Number.isNaN(parsed) ? "0" : String(parsed));
  });

  // button tabIndex: happy-dom defaults it to "0" (like anchor/area).
  ctx.defineAccessor(HTMLButtonElement.prototype, "tabIndex", function tabIndex() {
    const raw = handleOf(this).getAttribute("tabindex");
    if (raw !== null) {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, function tabIndex(value) {
    const parsed = Number(value);
    handleOf(this).setAttribute("tabindex", Number.isNaN(parsed) ? "0" : String(parsed));
  });

  // HTMLIFrameElement (W6): the attribute reflections (allow/height/width/
  // name/referrerPolicy/srcdoc), the URL-resolved src getter with the
  // raw-attribute setter, the sandbox DOMTokenList and the tabIndex "0"
  // default. The iframe page-loading / contentWindow / contentDocument tests
  // are dropped (browser-frame + Fetch network dependency).
  for (const property of ["allow", "height", "width", "name", "referrerPolicy", "srcdoc"]) {
    ctx.defineAccessor(HTMLIFrameElement.prototype, property, function iframeReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function iframeReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }
  ctx.defineAccessor(HTMLIFrameElement.prototype, "src", function src() {
    const raw = handleOf(this).getAttribute("src");
    if (raw === null) return "";
    const base = windowOf(ctx, this)?.location?.href;
    try {
      return base ? new URL(raw, base).href : raw;
    } catch {
      return raw;
    }
  }, function src(value) {
    handleOf(this).setAttribute("src", String(value));
  });
  ctx.defineAccessor(HTMLIFrameElement.prototype, "sandbox", function sandbox() {
    const handle = handleOf(this);
    return new DOMTokenList(handle, "sandbox");
  }, function sandbox(value) {
    handleOf(this).setAttribute("sandbox", String(value));
  });
  ctx.defineAccessor(HTMLIFrameElement.prototype, "tabIndex", function tabIndex() {
    const raw = handleOf(this).getAttribute("tabindex");
    if (raw !== null) {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, function tabIndex(value) {
    const parsed = Number(value);
    handleOf(this).setAttribute("tabindex", Number.isNaN(parsed) ? "0" : String(parsed));
  });

  // HTMLObjectElement (W6): the URL-resolved data getter with the raw setter,
  // the name/height/width/type attribute reflections and the tabIndex "0"
  // default. The contentDocument/contentWindow reads are dropped (subframe
  // surface not implemented — happy-dom returns null unconditionally here, but
  // mad-dom would read `undefined`).
  ctx.defineAccessor(HTMLObjectElement.prototype, "data", function data() {
    const raw = handleOf(this).getAttribute("data");
    if (raw === null) return "";
    const base = windowOf(ctx, this)?.location?.href;
    try {
      return base ? new URL(raw, base).href : raw;
    } catch {
      return raw;
    }
  }, function data(value) {
    handleOf(this).setAttribute("data", String(value));
  });
  for (const property of ["name", "height", "width", "type"]) {
    ctx.defineAccessor(HTMLObjectElement.prototype, property, function objectReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function objectReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }
  ctx.defineAccessor(HTMLObjectElement.prototype, "tabIndex", function tabIndex() {
    const raw = handleOf(this).getAttribute("tabindex");
    if (raw !== null) {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, function tabIndex(value) {
    const parsed = Number(value);
    handleOf(this).setAttribute("tabindex", Number.isNaN(parsed) ? "0" : String(parsed));
  });

  // HTMLOutputElement (W6): the defaultValue slot, the textContent-backed value
  // getter/setter, the htmlFor/name attribute reflections and the constant
  // "output" type. The labels reads are dropped (label association not
  // implemented).
  const OUTPUT_DEFAULT_VALUE = new WeakMap();
  ctx.defineAccessor(HTMLOutputElement.prototype, "defaultValue", function defaultValue() {
    return OUTPUT_DEFAULT_VALUE.get(this) ?? "";
  }, function defaultValue(v) {
    OUTPUT_DEFAULT_VALUE.set(this, String(v));
  });
  ctx.defineAccessor(HTMLOutputElement.prototype, "value", function value() {
    return this.textContent || "";
  }, function value(v) {
    this.textContent = v;
  });
  ctx.defineAccessor(HTMLOutputElement.prototype, "htmlFor", function htmlFor() {
    return handleOf(this).getAttribute("for") || "";
  }, function htmlFor(v) {
    handleOf(this).setAttribute("for", String(v));
  });
  ctx.defineAccessor(HTMLOutputElement.prototype, "name", function name() {
    return handleOf(this).getAttribute("name") || "";
  }, function name(v) {
    handleOf(this).setAttribute("name", String(v));
  });
  ctx.defineAccessor(HTMLOutputElement.prototype, "type", function type() {
    return "output";
  }, undefined);

  // HTMLTableCellElement (W6): the abbr/headers/scope string reflections, the
  // colSpan/rowSpan unsigned-long reflections (min 1) and the cellIndex read
  // (the cell's position among its <tr> td/th siblings, -1 outside a row).
  for (const property of ["abbr", "headers", "scope"]) {
    ctx.defineAccessor(HTMLTableCellElement.prototype, property, function cellStringReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function cellStringReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }
  for (const [property, attribute] of [
    ["colSpan", "colspan"],
    ["rowSpan", "rowspan"],
  ]) {
    ctx.defineAccessor(HTMLTableCellElement.prototype, property, function cellSpanGet() {
      const value = Number(handleOf(this).getAttribute(attribute));
      return Number.isNaN(value) || value < 1 ? 1 : value;
    }, function cellSpanSet(value) {
      const parsed = Number(value);
      handleOf(this).setAttribute(attribute, Number.isNaN(parsed) || parsed < 1 ? "1" : String(parsed));
    });
  }
  ctx.defineAccessor(HTMLTableCellElement.prototype, "cellIndex", function cellIndex() {
    let parent = handleOf(this).parentNode();
    while (parent !== null) {
      if (parent.nodeName() === "tr") {
        let index = 0;
        for (const child of parent.childNodes()) {
          if (child.nodeType() === 1 && (child.nodeName() === "td" || child.nodeName() === "th")) {
            if (child === handleOf(this)) return index;
            index++;
          }
        }
        return -1;
      }
      parent = parent.parentNode();
    }
    return -1;
  }, undefined);

  // HTMLTrackElement (W6): the kind enum reflection (default "subtitles",
  // invalid → "metadata", the TextTrackKindEnum token set), the URL-resolved
  // src getter with the raw setter, the srclang/label string reflections, the
  // default boolean reflection and the constant readyState "0". The `track`
  // getter (a TextTrack) is dropped — the TextTrack class surface is not
  // implemented.
  const TRACK_KINDS = ["captions", "chapters", "descriptions", "metadata", "subtitles"];
  ctx.defineAccessor(HTMLTrackElement.prototype, "kind", function kind() {
    const value = handleOf(this).getAttribute("kind");
    if (value === null) return "subtitles";
    if (!TRACK_KINDS.includes(value)) return "metadata";
    return value;
  }, function kind(value) {
    handleOf(this).setAttribute("kind", TRACK_KINDS.includes(value) ? value : "metadata");
  });
  ctx.defineAccessor(HTMLTrackElement.prototype, "src", function src() {
    const raw = handleOf(this).getAttribute("src");
    if (raw === null) return "";
    const base = windowOf(ctx, this)?.location?.href;
    try {
      return base ? new URL(raw, base).href : raw;
    } catch {
      return raw;
    }
  }, function src(value) {
    handleOf(this).setAttribute("src", String(value));
  });
  for (const property of ["srclang", "label"]) {
    ctx.defineAccessor(HTMLTrackElement.prototype, property, function trackStringReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function trackStringReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }
  ctx.defineAccessor(HTMLTrackElement.prototype, "default", function trackDefault() {
    return handleOf(this).getAttribute("default") !== null;
  }, function trackDefault(v) {
    const handle = handleOf(this);
    if (v) handle.setAttribute("default", "");
    else handle.removeAttribute("default");
  });
  ctx.defineAccessor(HTMLTrackElement.prototype, "readyState", function readyState() {
    return 0;
  }, undefined);

  // HTMLScriptElement (W6): the attribute reflections (type/charset/lang/
  // integrity, the crossorigin read, the async/defer/noModule booleans), the
  // blocking DOMTokenList, the fetchPriority / referrerPolicy enum
  // reflections, the URL-resolved src getter with the raw setter and the
  // textContent-backed text accessor. The script-execution behavior
  // (evaluation on connect / document.write / DOMParser) is dropped — the
  // script evaluation engine is not surfaced.
  for (const property of ["type", "charset", "lang", "integrity"]) {
    ctx.defineAccessor(HTMLScriptElement.prototype, property, function scriptStringReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function scriptStringReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }
  ctx.defineAccessor(HTMLScriptElement.prototype, "crossOrigin", function crossOrigin() {
    return handleOf(this).getAttribute("crossorigin") || "";
  }, function crossOrigin(v) {
    handleOf(this).setAttribute("crossorigin", String(v));
  });
  for (const property of ["async", "defer", "noModule"]) {
    ctx.defineAccessor(HTMLScriptElement.prototype, property, function scriptBoolReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) !== null;
    }, function scriptBoolReflect(v) {
      const handle = handleOf(this);
      if (v) handle.setAttribute(reflectAttr(property), "");
      else handle.removeAttribute(reflectAttr(property));
    });
  }
  ctx.defineAccessor(HTMLScriptElement.prototype, "blocking", function blocking() {
    const handle = handleOf(this);
    return new DOMTokenList(handle, "blocking");
  }, function blocking(value) {
    handleOf(this).setAttribute("blocking", String(value));
  });
  ctx.defineAccessor(HTMLScriptElement.prototype, "fetchPriority", function fetchPriority() {
    const value = handleOf(this).getAttribute("fetchpriority");
    if (value === "high" || value === "low" || value === "normal") return value;
    return "auto";
  }, function fetchPriority(value) {
    handleOf(this).setAttribute("fetchpriority", String(value));
  });
  const REFERRER_POLICIES = [
    "no-referrer",
    "no-referrer-when-downgrade",
    "same-origin",
    "origin",
    "strict-origin",
    "origin-when-cross-origin",
    "strict-origin-when-cross-origin",
    "unsafe-url",
  ];
  ctx.defineAccessor(HTMLScriptElement.prototype, "referrerPolicy", function referrerPolicy() {
    const value = handleOf(this).getAttribute("referrerpolicy");
    return REFERRER_POLICIES.includes(value) ? value : "";
  }, function referrerPolicy(value) {
    handleOf(this).setAttribute("referrerpolicy", String(value));
  });
  ctx.defineAccessor(HTMLScriptElement.prototype, "src", function src() {
    const raw = handleOf(this).getAttribute("src");
    if (raw === null) return "";
    const base = windowOf(ctx, this)?.location?.href;
    try {
      return base ? new URL(raw, base).href : raw;
    } catch {
      return raw;
    }
  }, function src(value) {
    handleOf(this).setAttribute("src", String(value));
  });
  ctx.defineAccessor(HTMLScriptElement.prototype, "text", function text() {
    return this.textContent;
  }, function text(value) {
    this.textContent = value;
  });

  // HTMLImageElement (W6): the attribute-reflected width/height (parseInt with
  // a natural-size "0" fallback) and the `window.Image` constructor that mints
  // an img element through the window's document with optional width/height.
  ctx.defineAccessor(HTMLImageElement.prototype, "width", function width() {
    const raw = handleOf(this).getAttribute("width");
    if (raw === null) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  }, function width(v) {
    handleOf(this).setAttribute("width", String(v));
  });
  ctx.defineAccessor(HTMLImageElement.prototype, "height", function height() {
    const raw = handleOf(this).getAttribute("height");
    if (raw === null) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  }, function height(v) {
    handleOf(this).setAttribute("height", String(v));
  });

  const WINDOW_IMAGE = new WeakMap();
  ctx.defineAccessor(Window.prototype, "Image", function getImage() {
    let imageClass = WINDOW_IMAGE.get(this);
    if (imageClass === undefined) {
      const windowFacade = this;
      const docHandle = ctx.documentContext.handleOf(this.document);
      imageClass = class Image extends HTMLImageElement {
        constructor(width, height) {
          const handle = docHandle.createElement("img");
          super(handle);
          ctx.registerWrap?.(handle, this);
          if (width !== undefined) this.setAttribute("width", String(width));
          if (height !== undefined) this.setAttribute("height", String(height));
        }
      };
      Object.defineProperty(imageClass, "name", { value: "Image" });
      WINDOW_IMAGE.set(windowFacade, imageClass);
    }
    return imageClass;
  }, undefined);

  // HTMLDataElement: value (DOMString).
  ctx.defineAccessor(HTMLDataElement.prototype, "value", function value() {
    return handleOf(this).getAttribute("value") || "";
  }, function value(v) {
    handleOf(this).setAttribute("value", String(v));
  });

  // HTMLTimeElement: dateTime.
  ctx.defineAccessor(HTMLTimeElement.prototype, "dateTime", function dateTime() {
    return handleOf(this).getAttribute("datetime") || "";
  }, function dateTime(v) {
    handleOf(this).setAttribute("datetime", String(v));
  });

  // HTMLDataListElement: options — a live HTMLCollection of descendant <option>
  // elements.
  ctx.defineAccessor(HTMLDataListElement.prototype, "options", function options() {
    const handle = handleOf(this);
    return new HTMLCollection(handle, "tag", "option");
  }, undefined);

  // HTMLModElement (ins/del): cite (URL), dateTime.
  ctx.defineAccessor(HTMLModElement.prototype, "cite", function cite() {
    const raw = handleOf(this).getAttribute("cite");
    if (raw === null) return "";
    return absoluteURL(ctx, this, raw);
  }, function cite(v) {
    handleOf(this).setAttribute("cite", String(v));
  });
  ctx.defineAccessor(HTMLModElement.prototype, "dateTime", function dateTime() {
    return handleOf(this).getAttribute("datetime") || "";
  }, function dateTime(v) {
    handleOf(this).setAttribute("datetime", String(v));
  });

  // HTMLQuoteElement (blockquote/q): cite (URL).
  ctx.defineAccessor(HTMLQuoteElement.prototype, "cite", function cite() {
    const raw = handleOf(this).getAttribute("cite");
    if (raw === null) return "";
    return absoluteURL(ctx, this, raw);
  }, function cite(v) {
    handleOf(this).setAttribute("cite", String(v));
  });

  // HTMLMetaElement: content / httpEquiv / name / scheme (DOMString).
  ctx.defineAccessor(HTMLMetaElement.prototype, "content", function content() {
    return handleOf(this).getAttribute("content") || "";
  }, function content(v) {
    handleOf(this).setAttribute("content", String(v));
  });
  ctx.defineAccessor(HTMLMetaElement.prototype, "httpEquiv", function httpEquiv() {
    return handleOf(this).getAttribute("http-equiv") || "";
  }, function httpEquiv(v) {
    handleOf(this).setAttribute("http-equiv", String(v));
  });
  ctx.defineAccessor(HTMLMetaElement.prototype, "name", function name() {
    return handleOf(this).getAttribute("name") || "";
  }, function name(v) {
    handleOf(this).setAttribute("name", String(v));
  });
  ctx.defineAccessor(HTMLMetaElement.prototype, "scheme", function scheme() {
    return handleOf(this).getAttribute("scheme") || "";
  }, function scheme(v) {
    handleOf(this).setAttribute("scheme", String(v));
  });

  // HTMLLIElement: value (long, default 0).
  ctx.defineAccessor(HTMLLIElement.prototype, "value", function value() {
    return longReflect("value", 0).get(handleOf(this));
  }, function value(v) {
    longReflect("value", 0).set(handleOf(this), v);
  });

  // HTMLOListElement: reversed (bool), start (long, default 1), type.
  ctx.defineAccessor(HTMLOListElement.prototype, "reversed", function reversed() {
    return boolReflect("reversed").get(handleOf(this));
  }, function reversed(v) {
    boolReflect("reversed").set(handleOf(this), v);
  });
  ctx.defineAccessor(HTMLOListElement.prototype, "start", function start() {
    return longReflect("start", 1).get(handleOf(this));
  }, function start(v) {
    longReflect("start", 1).set(handleOf(this), v);
  });
  ctx.defineAccessor(HTMLOListElement.prototype, "type", function type() {
    return handleOf(this).getAttribute("type") || "";
  }, function type(v) {
    handleOf(this).setAttribute("type", String(v));
  });

  // HTMLEmbedElement: height / width / type / src (URL).
  ctx.defineAccessor(HTMLEmbedElement.prototype, "height", function height() {
    return handleOf(this).getAttribute("height") || "";
  }, function height(v) {
    handleOf(this).setAttribute("height", String(v));
  });
  ctx.defineAccessor(HTMLEmbedElement.prototype, "width", function width() {
    return handleOf(this).getAttribute("width") || "";
  }, function width(v) {
    handleOf(this).setAttribute("width", String(v));
  });
  ctx.defineAccessor(HTMLEmbedElement.prototype, "type", function type() {
    return handleOf(this).getAttribute("type") || "";
  }, function type(v) {
    handleOf(this).setAttribute("type", String(v));
  });
  ctx.defineAccessor(HTMLEmbedElement.prototype, "src", function src() {
    const raw = handleOf(this).getAttribute("src");
    if (raw === null) return "";
    return absoluteURL(ctx, this, raw);
  }, function src(v) {
    handleOf(this).setAttribute("src", String(v));
  });

  // HTMLMapElement: name, areas (live HTMLCollection of <area> descendants).
  ctx.defineAccessor(HTMLMapElement.prototype, "name", function name() {
    return handleOf(this).getAttribute("name") || "";
  }, function name(v) {
    handleOf(this).setAttribute("name", String(v));
  });
  ctx.defineAccessor(HTMLMapElement.prototype, "areas", function areas() {
    const handle = handleOf(this);
    return new HTMLCollection(handle, "tag", "area");
  }, undefined);

  // HTMLLegendElement: form (the parent fieldset's form, else null).
  ctx.defineAccessor(HTMLLegendElement.prototype, "form", function form() {
    for (let parent = handleOf(this).parentNode(); parent !== null; parent = parent.parentNode()) {
      if (parent.nodeType() === 1 && parent.nodeName() === "fieldset") {
        return ctx.wrap(parent.ownerForm());
      }
    }
    return null;
  }, undefined);

  // HTMLTableColElement: span (unsigned long, default 1).
  ctx.defineAccessor(HTMLTableColElement.prototype, "span", function span() {
    const raw = handleOf(this).getAttribute("span");
    if (raw === null) return 1;
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? 1 : parsed;
  }, function span(v) {
    const parsed = Number(v);
    handleOf(this).setAttribute("span", String(Number.isNaN(parsed) ? 1 : parsed));
  });

  // HTMLTableSectionElement: insertRow / deleteRow (facade-level tr
  // management over the native mutation surface, happy-dom error shapes).
  ctx.defineMethod(HTMLTableSectionElement.prototype, "insertRow", function insertRow(index) {
    const rows = tableRowsOf(ctx, this);
    const row = ctx.wrap(handleOf(this).ownerDocument().createElement("tr"));
    let n = index === undefined ? rows.length : Number(index);
    if (Number.isNaN(n)) n = rows.length;
    if (n < -1) {
      throw new Error(
        `Failed to execute 'insertRow' on 'HTMLTableSectionElement': The index provided (${n}) is less than -1.`,
      );
    }
    if (n > rows.length) {
      throw new Error(
        `Failed to execute 'insertRow' on 'HTMLTableSectionElement': The index provided (${n}) is greater than the number of rows (${rows.length}).`,
      );
    }
    if (n === -1 || n === rows.length) this.appendChild(row);
    else this.insertBefore(row, rows[n]);
    return row;
  });
  ctx.defineMethod(HTMLTableSectionElement.prototype, "deleteRow", function deleteRow(index) {
    if (arguments.length === 0) {
      throw new Error(
        "Failed to execute 'deleteRow' on 'HTMLTableSectionElement': 1 argument required, but only 0 present.",
      );
    }
    const rows = tableRowsOf(ctx, this);
    let n = Number(index);
    if (Number.isNaN(n)) n = rows.length - 1;
    if (n < -1) {
      throw new Error(
        `Failed to execute 'deleteRow' on 'HTMLTableSectionElement': The index provided (${n}) is less than -1.`,
      );
    }
    if (n >= rows.length) {
      throw new Error(
        `Failed to execute 'deleteRow' on 'HTMLTableSectionElement': The index provided (${n}) is greater than the number of rows in the table (${rows.length}).`,
      );
    }
    const target = n === -1 ? rows[rows.length - 1] : rows[n];
    if (target !== undefined) target.remove();
  });

  // HTMLTitleElement: text (concat of descendant Text data; write sets
  // textContent) and the title-specific innerHTML behavior.
  ctx.defineAccessor(HTMLTitleElement.prototype, "text", function text() {
    const parts = [];
    for (const node of this.childNodes) {
      if (node.nodeType === 3) parts.push(node.data);
    }
    return parts.join("");
  }, function text(v) {
    handleOf(this).setTextContent(String(v));
  });

  // HTMLOptionElement: value (attribute ?? text), disabled (bool).
  ctx.defineAccessor(HTMLOptionElement.prototype, "value", function value() {
    return handleOf(this).optionValue();
  }, function value(v) {
    handleOf(this).setAttribute("value", String(v));
  });
  ctx.defineAccessor(HTMLOptionElement.prototype, "disabled", function disabled() {
    return handleOf(this).getAttribute("disabled") !== null;
  }, function disabled(v) {
    const handle = handleOf(this);
    if (v) handle.setAttribute("disabled", "");
    else handle.removeAttribute("disabled");
  });

  // HTMLOptGroupElement: disabled (bool), label (DOMString).
  ctx.defineAccessor(HTMLOptGroupElement.prototype, "disabled", function disabled() {
    return handleOf(this).getAttribute("disabled") !== null;
  }, function disabled(v) {
    const handle = handleOf(this);
    if (v) handle.setAttribute("disabled", "");
    else handle.removeAttribute("disabled");
  });
  ctx.defineAccessor(HTMLOptGroupElement.prototype, "label", function label() {
    return handleOf(this).getAttribute("label") || "";
  }, function label(v) {
    handleOf(this).setAttribute("label", String(v));
  });

  // HTMLSourceElement: height / width (unsigned long), media / sizes / srcset
  // / type (DOMString), src (URL).
  for (const [property, attr] of [
    ["height", "height"],
    ["width", "width"],
  ]) {
    ctx.defineAccessor(HTMLSourceElement.prototype, property, function unsignedLong() {
      const raw = handleOf(this).getAttribute(attr);
      const parsed = Number(raw);
      return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
    }, function unsignedLong(v) {
      const parsed = Number(v);
      handleOf(this).setAttribute(attr, Number.isNaN(parsed) || parsed < 0 ? "0" : String(parsed));
    });
  }
  for (const property of ["media", "sizes", "srcset", "type"]) {
    ctx.defineAccessor(HTMLSourceElement.prototype, property, function stringReflect() {
      return handleOf(this).getAttribute(reflectAttr(property)) || "";
    }, function stringReflect(v) {
      handleOf(this).setAttribute(reflectAttr(property), String(v));
    });
  }
  ctx.defineAccessor(HTMLSourceElement.prototype, "src", function src() {
    const raw = handleOf(this).getAttribute("src");
    if (raw === null) return "";
    return absoluteURL(ctx, this, raw);
  }, function src(v) {
    handleOf(this).setAttribute("src", String(v));
  });

  // HTMLProgressElement: max (double, default 1), value (double, default 0),
  // position (value/max when the value attribute is set, else -1), labels.
  ctx.defineAccessor(HTMLProgressElement.prototype, "max", function max() {
    const handle = handleOf(this);
    const raw = handle.getAttribute("max");
    if (raw === null) return 1;
    const parsed = Number(raw);
    return Number.isNaN(parsed) || parsed < 0 ? 1 : parsed;
  }, function max(v) {
    const handle = handleOf(this);
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) {
      throw new TypeError(
        "Failed to set the 'max' property on 'HTMLProgressElement': The provided double value is non-finite.",
      );
    }
    handle.setAttribute("max", parsed < 0 ? "1" : String(parsed));
  });
  ctx.defineAccessor(HTMLProgressElement.prototype, "value", function value() {
    const handle = handleOf(this);
    const raw = handle.getAttribute("value");
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }, function value(v) {
    const handle = handleOf(this);
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) {
      throw new TypeError(
        "Failed to set the 'value' property on 'HTMLProgressElement': The provided double value is non-finite.",
      );
    }
    handle.setAttribute("value", parsed < 0 ? "0" : String(parsed));
  });
  ctx.defineAccessor(HTMLProgressElement.prototype, "position", function position() {
    const handle = handleOf(this);
    if (handle.getAttribute("value") === null) return -1;
    return this.value / this.max;
  }, undefined);
  ctx.defineAccessor(HTMLProgressElement.prototype, "labels", function labels() {
    return labelsOf(ctx, this);
  }, undefined);

  // HTMLMeterElement: value / min / max / low / high / optimum (double, all
  // read-clamped to [0, 1] like happy-dom; non-finite writes throw).
  for (const [property, defaultValue] of [
    ["value", 0],
    ["min", 0],
    ["max", 1],
    ["low", 0],
    ["high", 1],
    ["optimum", 0.5],
  ]) {
    ctx.defineAccessor(HTMLMeterElement.prototype, property, function meterDouble() {
      const handle = handleOf(this);
      const raw = handle.getAttribute(property);
      if (raw === null) return defaultValue;
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) return defaultValue;
      if (parsed < 0) return 0;
      if (parsed > 1) return 1;
      return parsed;
    }, function meterDouble(v) {
      const handle = handleOf(this);
      const parsed = Number(v);
      if (!Number.isFinite(parsed)) {
        throw new TypeError(
          `Failed to set the '${property}' property on 'HTMLMeterElement': The provided double value is non-finite.`,
        );
      }
      handle.setAttribute(property, String(parsed));
    });
  }
  ctx.defineAccessor(HTMLMeterElement.prototype, "labels", function labels() {
    return labelsOf(ctx, this);
  }, undefined);

  // HTMLDialogElement: open (bool), returnValue, show / showModal / close.
  ctx.defineAccessor(HTMLDialogElement.prototype, "open", function open() {
    return handleOf(this).getAttribute("open") !== null;
  }, function open(v) {
    const handle = handleOf(this);
    if (v) handle.setAttribute("open", "");
    else handle.removeAttribute("open");
  });
  ctx.defineAccessor(HTMLDialogElement.prototype, "returnValue", function returnValue() {
    return returnValueOf(this);
  }, function returnValue(v) {
    setReturnValue(this, v);
  });
  ctx.defineMethod(HTMLDialogElement.prototype, "show", function show() {
    handleOf(this).setAttribute("open", "");
  });
  ctx.defineMethod(HTMLDialogElement.prototype, "showModal", function showModal() {
    handleOf(this).setAttribute("open", "");
  });
  ctx.defineMethod(HTMLDialogElement.prototype, "close", function close(returnValue) {
    closeDialog(this, returnValue);
  });

  // HTMLDetailsElement: open (bool), toggle dispatch on change, and the
  // summary-click toggle wired through dispatchEvent (happy-dom parity).
  ctx.defineAccessor(HTMLDetailsElement.prototype, "open", function open() {
    return handleOf(this).getAttribute("open") !== null;
  }, function open(v) {
    const handle = handleOf(this);
    const wasOpen = handle.getAttribute("open") !== null;
    if (v) handle.setAttribute("open", "");
    else handle.removeAttribute("open");
    if (v !== wasOpen) {
      this.dispatchEvent(new Event("toggle"));
    }
  });
  ctx.defineMethod(HTMLElement.prototype, "click", function click() {
    this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true, composed: true }));
    // HTMLDetailsElement default action: a click whose target is a summary
    // (or a descendant of the direct-child summary) toggles the `open`
    // attribute and dispatches `toggle` (happy-dom parity). The check walks
    // up from the clicked element to the nearest details ancestor.
    const details = detailsAncestorOf(ctx, this);
    if (details === null) return;
    const detailsHandle = handleOf(details);
    const summary = directChildSummaryOf(ctx, details);
    if (summary === null) return;
    if (this !== summary && !summary.contains(this)) return;
    const isOpen = detailsHandle.getAttribute("open") !== null;
    if (isOpen) detailsHandle.removeAttribute("open");
    else detailsHandle.setAttribute("open", "");
    details.dispatchEvent(new Event("toggle"));
  });

  // HTMLBodyElement + window: global event-handler attribute accessors.
  for (const eventName of GLOBAL_EVENT_NAMES) {
    const property = `on${eventName}`;
    ctx.defineAccessor(HTMLBodyElement.prototype, property, function globalHandler() {
      return eventHandlerGetter(ctx, this, eventName);
    }, function globalHandler(v) {
      eventHandlerSetter(ctx, this, eventName, v);
    });
  }

  // details / dialog event-handler attribute accessors (toggle / cancel / close).
  for (const [Class, eventNames] of [
    [HTMLDetailsElement, ["toggle"]],
    [HTMLDialogElement, ["cancel", "close"]],
  ]) {
    for (const eventName of eventNames) {
      const property = `on${eventName}`;
      ctx.defineAccessor(Class.prototype, property, function localHandler() {
        return eventHandlerGetter(ctx, this, eventName);
      }, function localHandler(v) {
        eventHandlerSetter(ctx, this, eventName, v);
      });
    }
  }

  // input.files — a FileList-like live collection backed by the element.
  ctx.defineAccessor(Node.prototype, "files", function files() {
    const handle = handleOf(this);
    if (handle.nodeName() !== "input") return undefined;
    return fileListOf(this);
  }, undefined);

  // `getAttributeNS` / `setAttributeNS` with a null namespace delegate to the
  // plain attribute surface (happy-dom parity); a non-null namespace is out of
  // scope and throws the WebIDL TypeError like the native surface would.
  ctx.defineMethod(Element.prototype, "getAttributeNS", function getAttributeNS(namespace, name) {
    if (namespace !== null) {
      throw new TypeError("getAttributeNS with a non-null namespace is not implemented");
    }
    return handleOf(this).getAttribute(String(name));
  });
  ctx.defineMethod(Element.prototype, "setAttributeNS", function setAttributeNS(namespace, name, value) {
    if (namespace !== null) {
      throw new TypeError("setAttributeNS with a non-null namespace is not implemented");
    }
    handleOf(this).setAttribute(String(name), String(value));
  });
}

// --- dialog state -----------------------------------------------------------

const DIALOG_RETURN_VALUE = new WeakMap();

function returnValueOf(dialog) {
  return DIALOG_RETURN_VALUE.get(dialog) ?? "";
}

function setReturnValue(dialog, value) {
  DIALOG_RETURN_VALUE.set(dialog, String(value));
}

function closeDialog(dialog, returnValue) {
  const handle = handleOf(dialog);
  const wasOpen = handle.getAttribute("open") !== null;
  handle.removeAttribute("open");
  setReturnValue(dialog, returnValue !== undefined ? String(returnValue) : "");
  if (wasOpen) {
    dialog.dispatchEvent(new Event("close"));
  }
}

// --- labels -----------------------------------------------------------------

// `labels`: the NodeList of `<label>` elements associated with a control — the
// `for`-referencing labels (document-root query) plus the first ancestor label,
// mirroring happy-dom's HTMLLabelElementUtility.
function labelsOf(ctx, control) {
  const handle = handleOf(control);
  const id = handle.getAttribute("id");
  const result = [];
  if (id) {
    const refs = documentOf(ctx, control).querySelectorAll(`label[for="${id}"]`);
    for (const label of refs) result.push(label);
  }
  for (let parent = handle.parentNode(); parent !== null; parent = parent.parentNode()) {
    if (parent.nodeType() === 1 && parent.nodeName() === "label") {
      result.push(ctx.wrap(parent));
      break;
    }
  }
  return result;
}

// --- FileList ---------------------------------------------------------------

const FILE_LISTS = new WeakMap();

function fileListOf(input) {
  let list = FILE_LISTS.get(input);
  if (list === undefined) {
    const items = [];
    const proxy = new Proxy(items, {
      get(target, property) {
        if (property === "item") {
          return (index) => (index >= 0 && index < target.length ? target[index] : null);
        }
        if (property === "length") return target.length;
        const index = Number(property);
        if (!Number.isNaN(index)) return target[index];
        return Reflect.get(target, property);
      },
    });
    FILE_LISTS.set(input, proxy);
    list = proxy;
  }
  return list;
}

// --- details toggle helpers -------------------------------------------------

// The direct-child `<tr>` elements of a table section (live read).
function tableRowsOf(ctx, section) {
  const items = [];
  for (const child of handleOf(section).childNodes()) {
    if (child.nodeType() === 1 && child.nodeName() === "tr") items.push(ctx.wrap(child));
  }
  return items;
}

// The nearest `details` ancestor of `node`, or null.
function detailsAncestorOf(ctx, node) {
  for (let parent = handleOf(node).parentNode(); parent !== null; parent = parent.parentNode()) {
    if (parent.nodeType() === 1 && parent.nodeName() === "details") {
      return ctx.wrap(parent);
    }
  }
  return null;
}

// The first direct-child `summary` element of `details`, or null.
function directChildSummaryOf(ctx, details) {
  const handle = handleOf(details);
  for (const child of handle.childNodes()) {
    if (child.nodeType() === 1 && child.nodeName() === "summary") {
      return ctx.wrap(child);
    }
  }
  return null;
}

// --- children ---------------------------------------------------------------

// Live element-children collection: re-reads the native child nodes and
// filters to elements on every access, keeping the WHATWG live semantics.
const CHILDREN_LISTS = new WeakMap();

function childrenOf(ctx, element) {
  let list = CHILDREN_LISTS.get(element);
  if (list === undefined) {
    const handle = handleOf(element);
    const read = () => {
      const items = [];
      for (const child of handle.childNodes()) {
        if (child.nodeType() === 1) items.push(ctx.wrap(child));
      }
      return items;
    };
    list = new Proxy([], {
      get(target, property) {
        if (property === "length") return read().length;
        if (property === Symbol.iterator) return read()[Symbol.iterator].bind(read());
        const index = Number(property);
        if (!Number.isNaN(index)) return read()[index];
        return Reflect.get(target, property);
      },
    });
    CHILDREN_LISTS.set(element, list);
  }
  return list;
}

// First / last direct element child and the element-child count (ParentNode
// element getters). These are stable reads over the same native child list.
function firstElementChildOf(ctx, node) {
  for (const child of handleOf(node).childNodes()) {
    if (child.nodeType() === 1) return ctx.wrap(child);
  }
  return null;
}

function lastElementChildOf(ctx, node) {
  let last = null;
  for (const child of handleOf(node).childNodes()) {
    if (child.nodeType() === 1) last = ctx.wrap(child);
  }
  return last;
}

function childElementCountOf(ctx, node) {
  let count = 0;
  for (const child of handleOf(node).childNodes()) {
    if (child.nodeType() === 1) count += 1;
  }
  return count;
}

// Mints a text node through the receiver's owning document (ChildNode /
// ParentNode string arguments become Text nodes, happy-dom parity).
function textNodeOf(ctx, node, value) {
  return ctx.wrap(handleOf(node).ownerDocument().createText(String(value)));
}
