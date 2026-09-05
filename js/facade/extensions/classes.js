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
// `new DefinedClass()` path), reads the mint record the T42 registry associated
// with the class prototype in a private WeakMap and casts a real detached
// element through the owning document, then registers the wrapper in the
// per-document weak cache (via `setRegisterMintedWrapper`, wired by node.js to
// `ctx.registerWrap`) so later `ctx.wrap` re-entries keep identity.

// All facade-derived node state lives in one non-reflectable record. Ordinary
// Symbol properties are discoverable through `Object.getOwnPropertySymbols`;
// keeping a mutable epoch, navigation memo or classification there would let
// user code forge a cache hit and make the facade disagree with Core. One
// WeakMap lookup yields the document state, opaque token, optional materialized
// handle, immutable metadata, validity proof, navigation memo and reflected-
// attribute cache used by the hot paths.
const NODE_INTERNALS = new WeakMap();
const getNodeInternals = NODE_INTERNALS.get.bind(NODE_INTERNALS);
const setNodeInternals = NODE_INTERNALS.set.bind(NODE_INTERNALS);
const objectCreate = Object.create;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;

function ownNativeStamp(handle, name) {
  const descriptor = objectGetOwnPropertyDescriptor(handle, name);
  return descriptor !== undefined && objectHasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function ensureNodeInternals(wrapper) {
  let internals = getNodeInternals(wrapper);
  if (internals === undefined) {
    internals = objectCreate(null);
    setNodeInternals(wrapper, internals);
  }
  return internals;
}

export function nodeInternalsOf(wrapper) {
  if (wrapper === null || wrapper === undefined || typeof wrapper !== "object") {
    return undefined;
  }
  return getNodeInternals(wrapper);
}

export function setNodeDocumentState(wrapper, state) {
  ensureNodeInternals(wrapper).documentState = state;
}

export function nodeDocumentStateOf(wrapper) {
  return nodeInternalsOf(wrapper)?.documentState;
}

export function releaseNodeDocumentState(state) {
  if (state === undefined) return;
  state.destroyed = true;
  state.clearElementTokenPools?.();
  state.clearWrappersByToken?.();
  state.clearPinned?.();
  state.snapshotAttemptEpoch = null;
  state.snapshotPartitionRoots = null;
}

export function setNodeHandle(wrapper, handle) {
  ensureNodeInternals(wrapper).handle = handle;
}

export function hasMaterializedNodeHandle(wrapper) {
  return nodeInternalsOf(wrapper)?.handle !== undefined;
}

export function nodeTokenOf(wrapper) {
  return nodeInternalsOf(wrapper)?.token;
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
    const internals = objectCreate(null);
    internals.handle = nativeHandle;
    const nodeType = ownNativeStamp(nativeHandle, "madDomType");
    if (nodeType !== undefined) {
      internals.nodeType = nodeType;
      if (nodeType === 1) {
        internals.nodeName = ownNativeStamp(nativeHandle, "madDomName");
        internals.nodeNamespace = ownNativeStamp(nativeHandle, "madDomNamespace");
      }
    }
    setNodeInternals(this, internals);
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

// Retained as an inert compatibility export because node.js's frozen module
// contract predates the private state boundary. No wrapper or prototype stores
// this Symbol; exposing it therefore cannot reveal or forge a document handle.
export const ELEMENT_MINT_SYMBOL = Symbol("mad-dom custom element mint");

// A prototype may inherit from a registered custom element, so lookup walks
// the prototype chain just as the old inherited Symbol property did. Capture
// the intrinsics before application code can patch them: the mint record holds
// an owning native document handle and must never be observable or forgeable.
const ELEMENT_MINTS = new WeakMap();
const getElementMint = ELEMENT_MINTS.get.bind(ELEMENT_MINTS);
const putElementMint = ELEMENT_MINTS.set.bind(ELEMENT_MINTS);
const getPrototypeOf = Object.getPrototypeOf;

export function setElementMint(prototype, docHandle, localName) {
  putElementMint(prototype, { docHandle, localName });
}

function elementMintFor(prototype) {
  while (prototype !== null && typeof prototype === "object") {
    const mint = getElementMint(prototype);
    if (mint !== undefined) return mint;
    prototype = getPrototypeOf(prototype);
  }
  return undefined;
}

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
const mapGet = Function.prototype.call.bind(Map.prototype.get);
const mapHas = Function.prototype.call.bind(Map.prototype.has);
const mapSet = Function.prototype.call.bind(Map.prototype.set);
let hyphenFallbackClass = null; // HTMLElement (an undefined hyphenated name)
let unknownFallbackClass = null; // HTMLUnknownElement (an undefined plain name)
let fallbackSvgElementClass = null; // SVGElement (an unknown SVG tag)

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export function registerElementClass(tag, elementClass) {
  mapSet(ELEMENT_CLASSES, tag, elementClass);
}

/** Whether `tag` is a built-in HTML element with a registered direct class. */
export function isRegisteredElementName(tag) {
  return mapHas(ELEMENT_CLASSES, tag);
}

export function registerSvgElementClass(tag, elementClass) {
  mapSet(SVG_ELEMENT_CLASSES, tag, elementClass);
  // The HTML5 parser lowercases SVG local names; happy-dom's SVGElementConfig
  // keys are lowercased too, so a parsed `<feBlend>` also resolves.
  mapSet(SVG_ELEMENT_CLASSES, tag.toLowerCase(), elementClass);
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
 * `new DefinedClass()` path — the constructor looks up the private mint record
 * associated with the class prototype and casts a real detached element
 * (`localName` reads the registered name). Without that record the constructor
 * is illegal exactly like happy-dom (`TypeError: Illegal constructor`).
 */
export class Element extends Node {
  constructor(nativeHandle) {
    if (nativeHandle === undefined) {
      const mint = elementMintFor(new.target?.prototype);
      if (mint === undefined) {
        throw new TypeError("Illegal constructor");
      }
      nativeHandle = mint.docHandle.createElement(mint.localName);
      super(nativeHandle);
      // Register the minted wrapper in the per-document weak cache so a later
      // `ctx.wrap` of the same native handle (e.g. a query or append re-entry)
      // hands back this exact object — identity parity with `createElement`.
      // The private mint record's document handle lets the registry pin the
      // wrapper in the right per-document state without an extra FFI read.
      registerMintedWrapper?.(nativeHandle, this, mint.docHandle);
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
  const internals = nodeInternalsOf(wrapper);
  if (internals === undefined) return undefined;
  let handle = internals.handle;
  if (handle === undefined) {
    const state = internals.documentState;
    const documentHandle = state?.documentHandle;
    const token = internals.token;
    const materializeNodeToken = state?.nativeMethods?.materializeNodeToken;
    if (
      documentHandle !== undefined &&
      token !== undefined &&
      materializeNodeToken !== undefined
    ) {
      handle = materializeNodeToken(token);
      internals.handle = handle;
    }
  }
  return handle;
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
    const svgClass = mapGet(SVG_ELEMENT_CLASSES, tag);
    return svgClass ?? (fallbackSvgElementClass ?? Element);
  }
  // A non-HTML, non-SVG namespace yields a plain Element (happy-dom
  // `createElementNS` default branch); only HTML-namespace tags resolve the
  // per-tag HTML classes and their fallbacks.
  if (namespace !== HTML_NAMESPACE) {
    return Element;
  }
  const known = mapGet(ELEMENT_CLASSES, tag);
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
 * Classification comes from the `madDomType` / `madDomName` /
 * `madDomNamespace` stamps the binding mints onto every wrapper object at
 * creation (crates/mad-dom-bun `stamp_wrapper_kind`) — plain property reads,
 * no FFI. All three values are immutable per node, so the stamp can never
 * drift. A handle without stamps (a mixed-version native binding) falls back
 * to the single `wrapperKind()` crossing that used to be the only route.
 */
export function createNodeWrapper(handle) {
  if (!isNodeHandle(handle)) {
    throw new TypeError(
      "Node can only be constructed from a genuine native Node handle",
    );
  }
  return createTrustedNodeWrapper(handle);
}

/**
 * Internal wrapper factory for handles already classified by `ctx.wrap` as a
 * native `NodeHandle`.  Allocating directly from the selected prototype avoids
 * re-running the public constructor's three-method authenticity probe for
 * every node returned by parsing, traversal, queries and creation.
 */
export function createTrustedNodeWrapper(handle) {
  const nodeType = ownNativeStamp(handle, "madDomType");
  if (nodeType === undefined) {
    const [kind, name, namespace] = handle.wrapperKind();
    return createNodeWrapperOfKind(handle, kind, name, namespace, true);
  }
  return createNodeWrapperOfKind(
    handle,
    nodeType,
    ownNativeStamp(handle, "madDomName"),
    ownNativeStamp(handle, "madDomNamespace"),
    true,
  );
}

/**
 * Creates a facade wrapper from native-known immutable metadata without first
 * allocating a native `NodeHandle`. `window.js` registers the document/token
 * ownership and pins the result immediately after this factory returns.
 */
export function createLazyNodeWrapper(
  nodeType,
  name,
  namespace,
  documentState,
  token,
  validEpoch,
  initialMemo,
  snapshotDescriptor,
) {
  return createNodeWrapperOfKind(
    undefined,
    nodeType,
    name,
    namespace,
    true,
    documentState,
    token,
    validEpoch,
    initialMemo,
    snapshotDescriptor,
  );
}

/**
 * Exact creation-only specialization for a freshly minted lazy Text node.
 * The caller still owns canonical token registration; this only avoids the
 * generic node-kind/prototype dispatch after native already proved the kind.
 */
export function createFreshLazyTextWrapper(
  documentState,
  token,
  validEpoch,
) {
  const wrapper = objectCreate(Text.prototype);
  const internals = objectCreate(null);
  internals.nodeType = 3;
  internals.documentState = documentState;
  internals.token = token;
  internals.validEpoch = validEpoch;
  setNodeInternals(wrapper, internals);
  return wrapper;
}

// Compact snapshot descriptors are fixed by the native protocol. Cache the
// already-selected direct prototype by descriptor so hydration does not pay a
// string-keyed class-registry lookup for every parsed HTML element.
const SNAPSHOT_HTML_PROTOTYPES = objectCreate(null);

function createNodeWrapperOfKind(
  handle,
  nodeType,
  name,
  namespace,
  facadeStamped = false,
  documentState,
  token,
  validEpoch,
  initialMemo,
  snapshotDescriptor,
) {
  let prototype;
  if (nodeType === 1) {
    if (snapshotDescriptor !== undefined) {
      prototype = SNAPSHOT_HTML_PROTOTYPES[snapshotDescriptor];
      if (prototype === undefined) {
        prototype = elementClassForName(name, namespace).prototype;
        SNAPSHOT_HTML_PROTOTYPES[snapshotDescriptor] = prototype;
      }
    } else {
      prototype = elementClassForName(name, namespace).prototype;
    }
  } else if (nodeType === 11) {
    prototype = DocumentFragment.prototype;
  } else if (nodeType === 3) {
    prototype = Text.prototype;
  } else if (nodeType === 8) {
    prototype = Comment.prototype;
  } else if (nodeType === 4) {
    prototype = CharacterData.prototype;
  } else {
    prototype = Node.prototype;
  }
  const wrapper = objectCreate(prototype);
  // A null prototype keeps missing private fields from consulting mutable
  // Object.prototype accessors during delayed hydration or materialization.
  const internals = objectCreate(null);
  if (handle !== undefined) internals.handle = handle;
  if (facadeStamped) {
    internals.nodeType = nodeType;
    if (nodeType === 1) {
      internals.nodeName = name;
      internals.nodeNamespace = namespace;
    }
    // Snapshot hydration already owns every value in the private record. Seed
    // it before NODE_INTERNALS.set so a fresh wrapper needs no follow-up
    // WeakMap reads merely to attach its state, token, proof and memo.
    if (documentState !== undefined) {
      internals.documentState = documentState;
      internals.token = token;
      internals.validEpoch = validEpoch;
      if (initialMemo !== undefined) internals.memo = initialMemo;
    }
  }
  setNodeInternals(wrapper, internals);
  return wrapper;
}
