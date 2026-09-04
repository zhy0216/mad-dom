// Facade node base classes and the T48A per-tag class machinery (T23B/T48A).
//
// This module owns the WHATWG class hierarchy base with **zero facade
// imports**, so `Node` / `Element` / `DocumentFragment` are fully defined as
// soon as the module evaluates and every other facade module can extend them
// without a module-init cycle (window.js → extensions/index.js → … → this
// module is a leaf). The node extension (node.js) imports and re-exports these
// classes and registers the `NodeHandle` wrapper factory; the html-element
// extension registers the per-tag direct prototypes.
//
// # Class hierarchy (T48A)
//
// `Node` is the base for every wrapper (Text / Comment / ProcessingInstruction
// are plain `Node`s), `Element extends Node`, `DocumentFragment extends Node`,
// `HTMLElement extends Element`, and the per-tag classes (`HTMLDivElement` …)
// extend `HTMLElement`. Because Text / Comment never reach `Element.prototype`,
// they hold no element members — `text.getAttribute` reads `undefined` and
// calling it throws `TypeError: ... is not a function`, matching happy-dom.
//
// # `new DefinedClass()` minting (T48A)
//
// The `Element` constructor, when invoked without a native handle (the
// `new DefinedClass()` path), reads the mint slot the T42 registry stashed on
// the class prototype (`ELEMENT_MINT_SYMBOL`) and casts a real detached
// element through the owning document, then registers the wrapper in the
// per-document weak cache (via `setRegisterMintedWrapper`, wired by node.js to
// `ctx.registerWrap`) so later `ctx.wrap` re-entries keep identity.

// Native NodeHandle behind each Node facade. Weak so a facade never pins its
// node; the native handle keeps its document's arena alive (T20 ownership
// chain), and wrapper identity is produced by `ctx.wrap`, never by a facade
// constructor.
const NODE_HANDLES = new WeakMap();

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

/**
 * Facade wrapper for a native `NodeHandle` (minted by the native binding for
 * every Core node — Element, Text, Comment, DocumentFragment, …).
 *
 * Construction is restricted: it requires a genuine native node handle; every
 * other argument throws a `TypeError`, so no facade surface can fabricate a
 * node. Instances are normally minted through the unique conversion entry
 * `ctx.wrap`, never by calling this constructor directly from facade code.
 */
export class Node {
  constructor(nativeHandle) {
    if (!isNodeHandle(nativeHandle)) {
      throw new TypeError(
        "Node can only be constructed from a genuine native Node handle",
      );
    }
    NODE_HANDLES.set(this, nativeHandle);
  }

  // happy-dom Node returns `[object <ConstructorName>]` from
  // `Object.prototype.toString` (upstream: `get [Symbol.toStringTag]() { return
  // this.constructor.name; }`). Element / Text / Comment / DocumentFragment all
  // inherit this through their own direct classes, so the string tag always
  // names the concrete WHATWG class.
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
}

// The mint slot the T42 registry stashes on a defined custom-element class
// prototype (`{ docHandle, localName }`), so `new DefinedClass()` can cast a
// real detached element (happy-dom stashes window/document symbols the same
// way). Kept here (not in custom-elements.js) so the `Element` constructor
// below can read it without an import cycle.
export const ELEMENT_MINT_SYMBOL = Symbol("mad-dom custom element mint");

// Per-tag element class selection (T48A). The html-element extension registers
// the common classes through `registerElementClass` and the two fallbacks
// through `setElementFallbackClasses`; the node creation/parse/import wrap
// path (createNodeWrapper) picks the direct prototype per tag so
// `Object.getPrototypeOf(el)` matches happy-dom's class chain. The svg
// extension registers the SVG element classes through
// `registerSvgElementClass`; the selection below is namespace-aware, so an SVG
// element (whatever its tag) resolves against the SVG registry while HTML
// elements keep the existing HTML behaviour.
const ELEMENT_CLASSES = new Map();
const SVG_ELEMENT_CLASSES = new Map();
let hyphenFallbackClass = null; // HTMLElement (an undefined hyphenated name)
let unknownFallbackClass = null; // HTMLUnknownElement (an undefined plain name)
let fallbackSvgElementClass = null; // SVGElement (an unknown SVG tag)

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export function registerElementClass(tag, elementClass) {
  ELEMENT_CLASSES.set(tag, elementClass);
}

export function registerSvgElementClass(tag, elementClass) {
  SVG_ELEMENT_CLASSES.set(tag, elementClass);
  // The HTML5 parser lowercases SVG local names; happy-dom's SVGElementConfig
  // keys are lowercased too, so a parsed `<feBlend>` also resolves.
  SVG_ELEMENT_CLASSES.set(tag.toLowerCase(), elementClass);
}

export function setSvgElementFallbackClass(elementClass) {
  fallbackSvgElementClass = elementClass;
}

export function setElementFallbackClasses(hyphenClass, unknownClass) {
  hyphenFallbackClass = hyphenClass;
  unknownFallbackClass = unknownClass;
}

// Set by the node extension's install (js/facade/extensions/node.js) to the
// facade context's `registerWrap`, so a minted wrapper registers itself in the
// per-document weak wrapper cache.
let registerMintedWrapper = null;

export function setRegisterMintedWrapper(register) {
  registerMintedWrapper = register;
}

/**
 * `Element` facade base class (T48A).
 *
 * Instances are normally minted through `ctx.wrap` (per-tag direct prototypes)
 * or constructed with a native handle. Constructed without a handle — the
 * `new DefinedClass()` path — the constructor looks up the mint slot the T42
 * registry stashed on the class prototype and casts a real detached element
 * (`localName` reads the registered name). Without that slot the constructor
 * is illegal exactly like happy-dom (`TypeError: Illegal constructor`).
 */
export class Element extends Node {
  constructor(nativeHandle) {
    if (nativeHandle === undefined) {
      const mint = new.target?.prototype?.[ELEMENT_MINT_SYMBOL];
      if (mint === undefined) {
        throw new TypeError("Illegal constructor");
      }
      nativeHandle = mint.docHandle.createElement(mint.localName);
      super(nativeHandle);
      // Register the minted wrapper in the per-document weak cache so a later
      // `ctx.wrap` of the same native handle (e.g. a query or append re-entry)
      // hands back this exact object — identity parity with `createElement`.
      registerMintedWrapper?.(nativeHandle, this);
      return;
    }
    super(nativeHandle);
  }
}

/**
 * `DocumentFragment` facade base class (T48A).
 *
 * Like `Element`, a genuine facade class below `Node` so fragments (and,
 * through the T43 re-parenting, shadow roots) reach the ParentNode query
 * surface and `innerHTML` without Text/Comment inheriting them.
 */
export class DocumentFragment extends Node {}

/**
 * `CharacterData` facade base class (hdunit nodes wave).
 *
 * The WHATWG base for `Text` / `Comment` / `ProcessingInstruction`. Text and
 * Comment are genuine classes below `Node` (matching happy-dom), so the
 * per-node `data` surface and `nodeName` are defined once here and the wrapper
 * factory below selects them per native node type.
 */
export class CharacterData extends Node {}

/**
 * `Text` facade class (hdunit nodes wave).
 *
 * Created natively by `createText` and the HTML parser; `new window.Text(data)`
 * mints a detached text node through the window's document (per-window
 * subclass installed by the hdunit-nodes extension).
 */
export class Text extends CharacterData {}

/**
 * `Comment` facade class (hdunit nodes wave).
 *
 * Created natively by `createComment` and the HTML parser; `new
 * window.Comment(data)` mints a detached comment node through the window's
 * document (per-window subclass installed by the hdunit-nodes extension).
 */
export class Comment extends CharacterData {}

/** The native handle behind a wrapper (the reverse of `ctx.wrap`). */
export function nodeHandleOf(wrapper) {
  return NODE_HANDLES.get(wrapper);
}

/**
 * Returns the per-tag element class for a tag name and namespace, following
 * the happy-dom selection: an SVG-namespace element resolves against the SVG
 * registry (falling back to `SVGElement` for an unknown SVG tag), a registered
 * HTML common tag uses its class, an undefined hyphenated HTML name uses
 * `HTMLElement` and any other undefined HTML name uses `HTMLUnknownElement`.
 */
export function elementClassForName(tag, namespace) {
  if (namespace === SVG_NAMESPACE) {
    const svgClass = SVG_ELEMENT_CLASSES.get(tag);
    return svgClass ?? (fallbackSvgElementClass ?? Element);
  }
  // A non-HTML, non-SVG namespace yields a plain Element (happy-dom
  // `createElementNS` default branch); only HTML-namespace tags resolve the
  // per-tag HTML classes and their fallbacks.
  if (namespace !== HTML_NAMESPACE) {
    return Element;
  }
  const known = ELEMENT_CLASSES.get(tag);
  if (known !== undefined) return known;
  const fallback = tag.includes("-") ? hyphenFallbackClass : unknownFallbackClass;
  return fallback ?? Element;
}

/** The `elementClassForName` convenience for a live native element handle. */
export function elementClassFor(handle) {
  return elementClassForName(String(handle.nodeName()), handle.namespaceUri());
}

/**
 * The `NodeHandle` wrapper factory: selects the direct prototype per node kind
 * — per-tag classes for elements (T48A), the `DocumentFragment` class for
 * fragments, `Text` / `Comment` / `CharacterData` for character-data nodes and
 * the base `Node` for everything else.
 *
 * Classification is read with the single native `wrapperKind()` crossing
 * (`[nodeType, nodeName, namespaceUri]`) — three separate reads here would
 * triple the per-wrapper FFI cost, which dominates DOM-churn workloads.
 */
export function createNodeWrapper(handle) {
  const [nodeType, name, namespace] = handle.wrapperKind();
  if (nodeType === 1) {
    return new (elementClassForName(name, namespace))(handle);
  }
  if (nodeType === 11) {
    return new DocumentFragment(handle);
  }
  if (nodeType === 3) {
    return new Text(handle);
  }
  if (nodeType === 8) {
    return new Comment(handle);
  }
  if (nodeType === 4) {
    return new CharacterData(handle);
  }
  return new Node(handle);
}
