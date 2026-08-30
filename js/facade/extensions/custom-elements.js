// `CustomElementRegistry` / custom element lifecycle facade extension (T42).
//
// Implements the M8 Custom Elements surface: the per-window
// `window.customElements` `CustomElementRegistry` (define / get / getName /
// whenDefined / upgrade) and the synchronous lifecycle reaction dispatch
// (`connectedCallback` / `disconnectedCallback` / `attributeChangedCallback`).
//
// # Class hierarchy (T48A) and the upgrade identity (T48D)
//
// The facade owns the WHATWG class chain — `Node → Element → HTMLElement →
// per-tag` — so an upgraded custom element is the *same wrapper* whose
// prototype has been re-parented onto the user class:
// `Object.setPrototypeOf(wrapper, ElementClass.prototype)`. The user class
// extends `window.HTMLElement`, so `instanceof ElementClass` and
// `instanceof window.HTMLElement` both hold and every `Node` / `Element` /
// `HTMLElement` method stays reachable. `new DefinedClass()` casts a real
// detached element through the mint slot `define` stashes on the class
// prototype (T48A), so `localName` reads the registered name like happy-dom.
// `define`-after-connect is the one path that *does not* upgrade in place:
// happy-dom physically replaces each connected candidate with a fresh custom
// element (the pre-created reference stays a plain `HTMLElement`), and MAD DOM
// does the same (T48D) — Core mints a replacement element, moves the
// candidate's attributes and children onto it, and the old wrapper keeps its
// plain prototype. Every other upgrade entry point (createElement, the apply
// path) is the in-place single-class upgrade.
//
// # Definitions live here; reactions are decided and queued in Core
//
// The name → constructor mapping and the lifecycle callbacks live in this
// module (the registry), exactly like happy-dom. Core owns the reaction
// *pipeline*: the observed-attribute snapshot pushed at define, the per-element
// custom state and the synchronous reaction queue (crates/mad-dom-core/src/
// dom/custom_elements.rs). The binding drains the queue on demand
// (`takeCustomElementReactions`); this module dispatches each reaction through
// the definition whose name matches the element's `nodeName`, guarded by the
// wrapper actually being upgraded.
//
// # Synchronous flush (facade-driven, like happy-dom)
//
// happy-dom fires the lifecycle callbacks synchronously at the mutation point.
// The binding's mutating entries are shared files no subtask may edit, so the
// facade performs the drain: every mutating facade path (append/insert/
// remove/replace in mutation.js, setAttribute / removeAttribute and the
// reflected setters, the apply path in html.js, adopt in extended-nodes.js)
// calls `flushCustomElementReactions` right after its native call, and the
// flush invokes the callbacks in enqueue order outside the document lock. A
// callback that re-enters the API runs its own nested flush, so nested
// reactions fire after their trigger exactly like happy-dom.
//
// # Two-phase upgrade on define and the apply path
//
// `define` and the innerHTML/outerHTML/load_html apply path both mark new
// elements custom *and* queue their reactions inside one native call. The
// wrapper prototypes must be set before the callbacks fire, so:
//
// * `defineCustomElement` returns the replacement handles (the fresh elements
//   Core swapped in for the connected candidates); this module sets each
//   replacement wrapper's prototype and only then flushes the `Connected`
//   reactions;
// * the apply path marks the parsed elements during the native call and the
//   facade walks them afterwards with `listCustomElementCandidates` (the
//   elements Core upgraded during the parse), sets the prototypes and flushes.
//
// # Per-window registry, keyed by the document root node
//
// Each window gets its own registry (happy-dom parity). The facade cannot
// derive a document handle from a node handle without crossing the sealed
// native handle seam, so registries are also keyed by the document's
// `Document`-kind root node (a stable per-document native handle); the
// `documentRootNode` binding entry mints it on demand.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing else in the registry changes beyond the
// import and array entry.

import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Window } from "../window.js";
import { Node, Element, ELEMENT_MINT_SYMBOL } from "./node.js";

export const seam = Object.freeze({
  id: "facade/extensions/custom-elements",
  owner: "T42",
  gate: "T42",
  status: "implemented",
});

// --- Native loader (mirrors the other facade modules) ------------------------

let native = null;
let nativeLoadError = null;

function resolveNativePath() {
  const explicit = process.env.MAD_DOM_NATIVE_PATH;
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
  return fileURLToPath(new URL("../../../build/mad-dom.node", import.meta.url));
}

function loadNative() {
  if (native !== null) return native;
  if (nativeLoadError !== null) throw nativeLoadError;
  const path = resolveNativePath();
  const require = createRequire(import.meta.url);
  try {
    native = require(path);
    return native;
  } catch (error) {
    nativeLoadError = new Error(
      `mad-dom native binding could not be loaded from ${path}. ` +
        "Build it with `npm run dev:build` in a source checkout, or point " +
        "MAD_DOM_NATIVE_PATH at a built artifact. " +
        `Original error: ${error?.message ?? error}`,
      { cause: error },
    );
    nativeLoadError.code = "MAD_DOM_NATIVE_NOT_FOUND";
    throw nativeLoadError;
  }
}

// --- valid custom element name (happy-dom parity) ----------------------------

// The WHATWG "potential custom element name" production, built exactly like
// happy-dom's `CustomElementUtility` (PCEN_CHAR ∪ the mandatory hyphen), plus
// the reserved built-in names.
const PCEN_CHAR =
  "[-_.]|[0-9]|[a-z]|\\u{B7}|[\\u{C0}-\\u{D6}]|[\\u{D8}-\\u{F6}]" +
  "|[\\u{F8}-\\u{37D}]|[\\u{37F}-\\u{1FFF}]" +
  "|[\\u{200C}-\\u{200D}]|[\\u{203F}-\\u{2040}]|[\\u{2070}-\\u{218F}]" +
  "|[\\u{2C00}-\\u{2FEF}]|[\\u{3001}-\\u{D7FF}]" +
  "|[\\u{F900}-\\u{FDCF}]|[\\u{FDF0}-\\u{FFFD}]|[\\u{10000}-\\u{EFFFF}]";
const PCEN_REGEXP = new RegExp(`^[a-z](${PCEN_CHAR})*-(${PCEN_CHAR})*$`, "u");
const RESERVED_NAMES = new Set([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-src",
  "font-face-uri",
  "font-face-format",
  "font-face-name",
  "missing-glyph",
]);

function isValidCustomElementName(name) {
  return PCEN_REGEXP.test(name) && !RESERVED_NAMES.has(name);
}

// --- registry bookkeeping ----------------------------------------------------

// Native document handle → registry (used by the window.customElements accessor
// and the createElement / adopt / import upgrades, which hold a document
// handle). Weak: the window strongly owns the registry through the facade, so
// an entry never pins a document.
const REGISTRIES_BY_DOC = new WeakMap();

// Document root node wrapper → registry (used by the flush / apply-path /
// clone upgrades, which only hold a node handle).
const REGISTRIES_BY_ROOT = new WeakMap();

// Whether any registry exists anywhere in the process. The flush helpers check
// it first so documents that never use custom elements pay no native call.
let ANY_REGISTRY = false;

function registryForDocument(ctx, docHandle) {
  let registry = REGISTRIES_BY_DOC.get(docHandle);
  if (registry === undefined) {
    registry = new CustomElementRegistry(docHandle);
    REGISTRIES_BY_DOC.set(docHandle, registry);
    const root = ctx.wrap(loadNative().documentRootNode(docHandle.documentElement()));
    registry.rootKey = root;
    REGISTRIES_BY_ROOT.set(root, registry);
    ANY_REGISTRY = true;
  }
  return registry;
}

function registryForNode(ctx, nodeHandle) {
  if (nodeHandle === null || nodeHandle === undefined) return null;
  const root = ctx.wrap(loadNative().documentRootNode(nodeHandle));
  return REGISTRIES_BY_ROOT.get(root) ?? null;
}

/**
 * Flushes the queued custom element reactions of `nodeHandle`'s document,
 * dispatching each callback synchronously in enqueue order.
 *
 * Called by every mutating facade path right after its native call. The
 * reactions were drained by Core under the document lock and handed back as
 * opaque handles; the callbacks run here, outside any lock, so a callback may
 * re-enter the API (its own nested flush fires the reactions it triggers).
 */
export function flushCustomElementReactions(ctx, nodeHandle) {
  if (!ANY_REGISTRY) return;
  const reactions = loadNative().takeCustomElementReactions(nodeHandle);
  if (reactions.length === 0) return;
  const registry = registryForNode(ctx, nodeHandle);
  if (registry !== null) {
    registry.dispatchReactions(reactions, ctx);
  }
}

/**
 * Sets `element`'s prototype onto its definition's class when the registry
 * defines its name (used by createElement, which holds the document handle, and
 * the clone/import/adopt paths, which resolve the registry from the node).
 */
export function upgradeElementPrototype(ctx, element, docHandle) {
  if (element === null || element === undefined) return;
  const registry =
    docHandle !== undefined
      ? REGISTRIES_BY_DOC.get(docHandle)
      : registryForNode(ctx, ctx.documentContext.handleOf(element));
  if (registry !== undefined && registry !== null) {
    registry.upgradePrototype(element);
  }
}

/**
 * Sets the wrapper prototypes of every element the apply path (innerHTML /
 * outerHTML / load_html) just upgraded during its parse.
 *
 * Runs after the native apply call (which queued the elements' reactions) and
 * before the flush, so the callbacks never see a wrapper whose prototype is
 * not yet the custom class.
 */
export function upgradeParsedCandidates(ctx, nodeHandle) {
  const registry = registryForNode(ctx, nodeHandle);
  if (registry === null) return;
  const candidates = loadNative().listCustomElementCandidates(nodeHandle);
  for (const handle of candidates) {
    registry.upgradePrototype(ctx.wrap(handle));
  }
}

/**
 * Marks every defined-name element of the subtree rooted at `nodeHandle` as
 * custom (no reactions) and sets the wrapper prototypes — the clone / import /
 * adopt happy-dom parity (the copied / adopted element keeps its class without
 * firing a lifecycle callback).
 */
export function markSubtreeCustomAndUpgrade(ctx, nodeHandle) {
  const registry = registryForNode(ctx, nodeHandle);
  if (registry === null) return;
  const marked = loadNative().markCustomElementsInSubtree(nodeHandle);
  for (const handle of marked) {
    registry.upgradePrototype(ctx.wrap(handle));
  }
}

// --- CustomElementRegistry ----------------------------------------------------

/**
 * One registered definition: the constructor and the lifecycle callbacks,
 * snapshotted at `define` time (the happy-dom baseline reads the prototype
 * methods once, so later reassignments are not picked up).
 */
class CustomElementDefinition {
  constructor(elementClass) {
    this.elementClass = elementClass;
    this.connectedCallback = elementClass.prototype.connectedCallback;
    this.disconnectedCallback = elementClass.prototype.disconnectedCallback;
    this.attributeChangedCallback = elementClass.prototype.attributeChangedCallback;
  }
}

/**
 * WHATWG `CustomElementRegistry` facade (T42).
 *
 * One registry per window, keyed internally by the window's native document
 * handle (and the document root node for node-based lookups). Construction is
 * internal — the `window.customElements` accessor mints it.
 */
export class CustomElementRegistry {
  constructor(nativeDocHandle) {
    this.docHandle = nativeDocHandle;
    this.native = loadNative();
    this.definitions = new Map();
    this.classToName = new Map();
    this.pendingWhenDefined = new Map();
    this.rootKey = null;
  }

  /**
   * Sets `element`'s prototype onto its definition's class when defined (the
   * in-place single-class upgrade). No-op when the name is not defined or the
   * prototype is already set.
   */
  upgradePrototype(element) {
    if (element === null || element === undefined) return;
    // Definitions are keyed by the lowercased local name; `nodeName` is the
    // uppercased tag since T48, so the lookup uses `localName`.
    const definition = this.definitions.get(element.localName ?? element.nodeName.toLowerCase());
    if (
      definition !== undefined &&
      Object.getPrototypeOf(element) !== definition.elementClass.prototype
    ) {
      Object.setPrototypeOf(element, definition.elementClass.prototype);
    }
  }

  /**
   * Dispatches drained reactions in enqueue order, through the definition of
   * the target element's name, guarded by the wrapper actually being upgraded.
   */
  dispatchReactions(reactions, ctx) {
    for (const reaction of reactions) {
      const element = ctx.wrap(reaction.element());
      if (element === null || element === undefined) continue;
      // Definitions are keyed by the lowercased local name; `nodeName` is the
      // uppercased tag since T48, so the lookup uses `localName`.
      const definition = this.definitions.get(element.localName ?? element.nodeName.toLowerCase());
      if (definition === undefined) continue;
      if (Object.getPrototypeOf(element) !== definition.elementClass.prototype) continue;
      const kind = reaction.kind();
      if (kind === "attributeChanged") {
        definition.attributeChangedCallback?.call(
          element,
          reaction.attributeName(),
          reaction.oldValue(),
          reaction.newValue(),
        );
      } else if (kind === "connected") {
        definition.connectedCallback?.call(element);
      } else {
        definition.disconnectedCallback?.call(element);
      }
    }
  }
}

// --- install -----------------------------------------------------------------

/**
 * Installs the T42 Custom Elements surface.
 *
 * `window.customElements` is a live per-window accessor; the registry methods
 * and the reaction dispatch are installed on `CustomElementRegistry.prototype`
 * and the module-level flush helpers, which the other facade modules import.
 */
export function install(ctx) {
  ctx.defineAccessor(Window.prototype, "customElements", function getCustomElements() {
    const documentHandle = ctx.documentContext.handleOf(this.document);
    return registryForDocument(ctx, documentHandle);
  }, undefined);

  ctx.defineMethod(CustomElementRegistry.prototype, "define", function define(name, elementClass, options) {
    if (typeof elementClass !== "function") {
      throw new TypeError(
        "Failed to execute 'define' on 'CustomElementRegistry': parameter 2 is not of type 'Function'.",
      );
    }
    if (!isValidCustomElementName(name)) {
      throw new DOMException(
        `Failed to execute 'define' on 'CustomElementRegistry': "${name}" is not a valid custom element name`,
        "DOMException",
      );
    }
    if (this.definitions.has(name)) {
      throw new DOMException(
        `Failed to execute 'define' on 'CustomElementRegistry': the name "${name}" has already been used with this registry`,
        "DOMException",
      );
    }
    if (this.classToName.has(elementClass)) {
      throw new DOMException(
        "Failed to execute 'define' on 'CustomElementRegistry': this constructor has already been used with this registry",
        "DOMException",
      );
    }

    // Observed attributes are read once at define (happy-dom #117): a
    // non-array value is treated as empty, each entry is stringified and
    // lowercased (the snapshot Core filters attribute reactions against).
    let observed = [];
    const staticObserved = elementClass.observedAttributes;
    if (Array.isArray(staticObserved)) {
      for (const attribute of staticObserved) {
        observed.push(String(attribute).toLowerCase());
      }
    }

    // Wire the user class into the T48A class hierarchy: a class written as
    // `class X extends window.HTMLElement` already chains through `HTMLElement
    // → Element → Node`, so nothing needs re-parenting; a class that does not
    // descend from `Node` is re-parented onto `Element.prototype` so an
    // upgraded wrapper keeps every Node / Element method and stays
    // `instanceof window.HTMLElement`. happy-dom likewise mutates the
    // constructor's prototype at define (it stashes the window/document
    // symbols on it).
    if (!Node.prototype.isPrototypeOf(elementClass.prototype)) {
      Object.setPrototypeOf(elementClass.prototype, Element.prototype);
    }

    // T48A `new DefinedClass()`: stash the native document handle and the
    // registered name on the class prototype so the `Element` constructor can
    // cast a real detached element (happy-dom stashes window/document/localName
    // symbols the same way).
    elementClass.prototype[ELEMENT_MINT_SYMBOL] = {
      docHandle: this.docHandle,
      localName: name,
    };

    // Core registers the definition, physically replaces the connected
    // matching elements with fresh custom elements and queues their
    // `Connected` reaction; the replacement wrapper prototypes are set before
    // the flush so the callbacks run on the upgraded (replacement) elements.
    const upgraded = this.native.defineCustomElement(this.docHandle, name, observed);
    this.definitions.set(name, new CustomElementDefinition(elementClass));
    this.classToName.set(elementClass, name);
    for (const handle of upgraded) {
      const element = ctx.wrap(handle);
      if (Object.getPrototypeOf(element) !== elementClass.prototype) {
        Object.setPrototypeOf(element, elementClass.prototype);
      }
    }
    if (upgraded.length > 0) {
      flushCustomElementReactions(ctx, upgraded[0]);
    }

    // happy-dom fires the connected-upgrade callbacks before the whenDefined
    // resolvers; the resolvers here only schedule the promise microtasks.
    const resolvers = this.pendingWhenDefined.get(name);
    if (resolvers !== undefined) {
      this.pendingWhenDefined.delete(name);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  });

  ctx.defineMethod(CustomElementRegistry.prototype, "get", function get(name) {
    return this.definitions.get(name)?.elementClass;
  });

  ctx.defineMethod(CustomElementRegistry.prototype, "getName", function getName(elementClass) {
    return this.classToName.get(elementClass) ?? null;
  });

  ctx.defineMethod(CustomElementRegistry.prototype, "whenDefined", function whenDefined(name) {
    if (!isValidCustomElementName(name)) {
      return Promise.reject(
        new DOMException(
          `Failed to execute 'whenDefined' on 'CustomElementRegistry': Invalid custom element name: "${name}"`,
          "DOMException",
        ),
      );
    }
    if (this.definitions.has(name)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const resolvers = this.pendingWhenDefined.get(name);
      if (resolvers !== undefined) {
        resolvers.push(resolve);
      } else {
        this.pendingWhenDefined.set(name, [resolve]);
      }
    });
  });

  ctx.defineMethod(CustomElementRegistry.prototype, "upgrade", function upgrade() {
    // happy-dom parity (T48D): happy-dom documents `registry.upgrade(root)`
    // as "Not implemented yet" — a no-op. It performs no genuine upgrade and
    // fires no lifecycle reaction.
  });
}
