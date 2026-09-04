// `Node` facade plus node creation and navigation extension (T23B).
//
// The first capability extension to take over its T20A placeholder seam. It
// implements the frozen native node contract
// (tests/bun/fixtures/native-node-contract.json, T23A) as JavaScript surface:
//
//   - `document.createElement` / `document.createTextNode` adapt the native
//     `DocumentHandle.createElement` / `createText` creation surface (the
//     WHATWG name `createTextNode` is a facade adaptation — no native symbol
//     of that name exists);
//   - the `Node` navigation properties (`nodeType`, `nodeName`, `parentNode`,
//     `firstChild`, `lastChild`, `previousSibling`, `nextSibling`,
//     `childNodes`) delegate every read verbatim to the native `NodeHandle`
//     and funnel every produced node through `ctx.wrap`, the unique conversion
//     entry, so wrapper identity mirrors the native per-document weak cache
//     (T20).
//
// It deliberately does **not** implement mutation, attributes, `textContent`
// or the live `childNodes` collection — those belong to T24C / T25E / T25D and
// are explicitly out of scope here (js/facade/CONTRACT.md). The facade keeps no
// second DOM state: a `Node` wrapper holds exactly the opaque native `NodeHandle`
// behind it, a Core `NodeId` never crosses this seam as a primitive.
//
// Since the T25 gate, `childNodes` hands back the T25D live `NodeList`
// (`liveChildNodes`) instead of the T23B snapshot array: the collection re-reads
// the same frozen native `childNodes()` read on every access, so an existing
// `childNodes` object reflects later append/insert/move/remove/replace and
// `textContent` writes immediately. The wiring is the single place the snapshot
// facade form of `childNodes` disappears.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes. The `seam`
// metadata was flipped from `"placeholder"` to `"implemented"` by the T23 gate
// (tests/bun/seam.test.js pins that shape).

import {
  Node,
  Element,
  DocumentFragment,
  ELEMENT_MINT_SYMBOL,
  DOC_STATE_SLOT,
  MEMO_SLOT,
  VALID_EPOCH_SLOT,
  nodeHandleOf,
  registerElementClass,
  setElementFallbackClasses,
  setRegisterMintedWrapper,
  createNodeWrapper,
} from "./classes.js";
import { Document } from "../document.js";
import { Window } from "../window.js";
import { liveChildNodes } from "./child-nodelist.js";
import { upgradeElementPrototype } from "./custom-elements.js";
import { domErrorName, rethrowDomError, webidlMessage } from "./dom-error.js";

export {
  Node,
  Element,
  DocumentFragment,
  ELEMENT_MINT_SYMBOL,
  registerElementClass,
  setElementFallbackClasses,
};

export const seam = Object.freeze({
  id: "facade/extensions/node",
  owner: "T23B",
  gate: "T23",
  status: "implemented",
});

// The WHATWG HTML namespace URI (mirrors crates/mad-dom-core/src/dom/node.rs):
// `nodeName` / `tagName` report the tag name uppercased only for elements in
// this namespace, matching happy-dom.
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

// Native writes this terminal value into the shared Int32 epoch view before
// releasing a document. Treat it as invalid unconditionally: an ordinary
// wrapping generation can eventually reach the same bit pattern, and cached
// metadata/navigation must still never mask a destroyed-document error.
const DESTROYED_EPOCH = -2147483648;

// Returns the immutable native type stamp when this wrapper was proven live
// at the document's current structural epoch. A structural mutation (including
// cross-document adoption, the only path that stales live NodeIds) or destroy
// changes the epoch first; the miss validates through native `nodeType()` and
// refreshes the proof only after that succeeds. Older bindings without an
// epoch or classification stamp always retain the native path.
function validatedNodeType(wrapper, handle) {
  const state = wrapper[DOC_STATE_SLOT];
  const stamped = handle.madDomType;
  if (state === undefined || state.epoch === null || stamped === undefined) {
    return handle.nodeType();
  }
  const epoch = state.epoch[0];
  if (epoch === DESTROYED_EPOCH) return handle.nodeType();
  if (wrapper[VALID_EPOCH_SLOT] === epoch) return stamped;
  const nodeType = handle.nodeType();
  wrapper[VALID_EPOCH_SLOT] = state.epoch[0];
  return nodeType;
}

/**
 * Installs the node creation and navigation surface onto the facade.
 *
 * Called exactly once by the facade registry with the `ctx` that
 * js/facade/window.js builds: `registerHandleType` and the sanctioned
 * property-definition helpers are the only mechanism used here, and every
 * native node that crosses back to JavaScript goes through `ctx.wrap`.
 */
export function install(ctx) {
  ctx.registerHandleType("NodeHandle", createNodeWrapper);
  setRegisterMintedWrapper(ctx.registerWrap);

  // `window.Node` / `window.Element` / `window.DocumentFragment` — the WHATWG
  // constructor accessors (T48A), matching the happy-dom window surface.
  ctx.defineAccessor(Window.prototype, "Node", function getNode() {
    return Node;
  }, undefined);
  ctx.defineAccessor(Window.prototype, "Element", function getElement() {
    return Element;
  }, undefined);
  ctx.defineAccessor(Window.prototype, "DocumentFragment", function getDocumentFragment() {
    return DocumentFragment;
  }, undefined);

  // `document.createElement` / `document.createTextNode` (WHATWG names).
  //
  // The native `DocumentHandle` carries the `createElement` / `createText`
  // symbols (frozen by T23A); the WHATWG `createTextNode` name is adapted
  // here, so no native duplicate exists. Each call mints a fresh detached
  // node through `ctx.wrap`.
  ctx.defineMethod(Document.prototype, "createElement", function createElement(name) {
    const documentHandle = ctx.documentContext.handleOf(this);
    let element;
    try {
      element = ctx.wrap(documentHandle.createElement(name), ctx.docStateOf(documentHandle));
    } catch (error) {
      // T48B: re-raise the invalid-element-name violation as a real
      // DOMException with the stable `code`, keeping the WHATWG name visible in
      // the WebIDL message (the frozen T21A name embedded in the native message
      // is part of the contract consumers key on).
      const message =
        domErrorName(error) === "InvalidCharacterError"
          ? `Uncaught InvalidCharacterError: Failed to execute 'createElement' on 'Document': '${String(name)}' is not a valid element name.`
          : webidlMessage(error, "createElement", "Document");
      rethrowDomError(error, message);
    }
    // T42: an element created with a defined custom name is an upgraded custom
    // element — Core marked it custom at creation, so the wrapper's prototype
    // is re-parented onto the user class (the in-place single-class upgrade).
    upgradeElementPrototype(ctx, element, documentHandle);
    return element;
  });

  ctx.defineMethod(Document.prototype, "createTextNode", function createTextNode(data) {
    const documentHandle = ctx.documentContext.handleOf(this);
    return ctx.wrap(documentHandle.createText(data), ctx.docStateOf(documentHandle));
  });

  // `Node` navigation properties (WHATWG read-only attributes).
  //
  // Every read delegates to the native handle; node-producing reads route the
  // result through `ctx.wrap`, so repeated reads of the same node hand back
  // one and the same facade object (strict equality), mirroring the native
  // per-document weak wrapper cache. `null` results pass through unchanged.
  ctx.defineAccessor(Node.prototype, "nodeType", function nodeType() {
    const handle = nodeHandleOf(this);
    return validatedNodeType(this, handle);
  }, undefined);

  // WHATWG nodeName: an element in the HTML namespace reports its tag name in
  // uppercase ("DIV"), matching happy-dom; SVG/MathML and every other node kind
  // report the Core value verbatim (`#text`, `#document-fragment`, the SVG
  // lowercased tag, ...). Fresh native wrappers carry immutable name/namespace
  // stamps for the facade's class selection. Reuse them while the wrapper's
  // validity epoch matches; on a miss `validatedNodeType` first proves through
  // native that adoption/destruction did not stale the handle. Older bindings
  // without stamps retain the original native-read path. The serializers and
  // selectors keep using the Core lowercased local name, so this case change
  // is only the observable accessor.
  ctx.defineAccessor(Node.prototype, "nodeName", function nodeName() {
    const handle = nodeHandleOf(this);
    if (handle === undefined) return undefined;
    const nodeType = validatedNodeType(this, handle);
    if (nodeType !== 1) return handle.nodeName();
    const stampedName = handle.madDomName;
    const stampedNamespace = handle.madDomNamespace;
    const name = typeof stampedName === "string" ? stampedName : handle.nodeName();
    const namespace =
      typeof stampedNamespace === "string" ? stampedNamespace : handle.namespaceUri();
    if (namespace === HTML_NAMESPACE) {
      return name.toUpperCase();
    }
    return name;
  }, undefined);

  // WHATWG Element.localName: the lowercased local tag name for an element
  // (the Core `nodeName`), `undefined` on non-element nodes like happy-dom. On
  // `Element.prototype` (T48A): Text / Comment are plain `Node`s and read
  // `undefined`.
  ctx.defineAccessor(Element.prototype, "localName", function localName() {
    const handle = nodeHandleOf(this);
    if (handle === undefined) return undefined;
    if (validatedNodeType(this, handle) !== 1) return undefined;
    const stampedName = handle.madDomName;
    return typeof stampedName === "string" ? stampedName : handle.nodeName();
  }, undefined);

  // WHATWG Element.tagName: equal to `nodeName` for elements (uppercase for
  // HTML namespace elements), `undefined` on non-element nodes like happy-dom.
  ctx.defineAccessor(Element.prototype, "tagName", function tagName() {
    const handle = nodeHandleOf(this);
    if (handle === undefined) return undefined;
    if (validatedNodeType(this, handle) !== 1) return undefined;
    const stampedName = handle.madDomName;
    const stampedNamespace = handle.madDomNamespace;
    const name = typeof stampedName === "string" ? stampedName : handle.nodeName();
    const namespace =
      typeof stampedNamespace === "string" ? stampedNamespace : handle.namespaceUri();
    if (namespace === HTML_NAMESPACE) {
      return name.toUpperCase();
    }
    return name;
  }, undefined);

  // `Node` navigation getters with an epoch-guarded memo.
  //
  // A tree walk over an unchanged document is otherwise 2 FFI crossings per
  // edge (plus a wrapper mint per node after any GC), which leaves a native-
  // backed DOM structurally slower than a pure-JS DOM on the most common DOM
  // workload. The memo caches each read on the wrapper itself and validates
  // it against the document's structural epoch — the 4-byte slot the native
  // binding bumps on every call that changed the tree relations
  // (crates/mad-dom-bun `epoch_api` / `with_document`), readable with a plain
  // typed-array load. While the epoch is unchanged the cached answer is
  // exact: navigation results only change with the relations. The wrappers
  // stay memoizable across garbage collection because `ctx.wrap` pins them in
  // the per-document state while the document's native handle is reachable
  // (js/facade/window.js `DOC_STATES`).
  //
  // Without an epoch (older native binding) the read falls through to the
  // plain native delegation, exactly the pre-memo behaviour.
  const UNSET = {};

  function memoFor(wrapper, epoch) {
    const memo = wrapper[MEMO_SLOT];
    if (memo !== undefined) {
      if (memo.e !== epoch) {
        memo.e = epoch;
        memo.fc = memo.lc = memo.ns = memo.ps = memo.pn = UNSET;
      }
      return memo;
    }
    return (wrapper[MEMO_SLOT] = {
      e: epoch, fc: UNSET, lc: UNSET, ns: UNSET, ps: UNSET, pn: UNSET,
    });
  }

  function navRead(wrapper, field, nativeName, childAxis = false) {
    const state = wrapper[DOC_STATE_SLOT];
    if (state === undefined || state.epoch === null) {
      return ctx.wrap(nodeHandleOf(wrapper)[nativeName]());
    }
    const epoch = state.epoch[0];
    if (epoch === DESTROYED_EPOCH) {
      return ctx.wrap(nodeHandleOf(wrapper)[nativeName](), state);
    }
    const memo = wrapper[MEMO_SLOT];
    if (memo !== undefined && memo.e === epoch) {
      const value = memo[field];
      if (value !== UNSET) return value;
    }
    const handle = nodeHandleOf(wrapper);
    const stampedType =
      childAxis && wrapper[VALID_EPOCH_SLOT] === epoch
        ? handle.madDomType
        : undefined;
    // Character-data, processing-instruction and doctype nodes can never
    // acquire children. A freshly returned wrapper is already proven live at
    // this epoch (`pinWrapper` records that proof), so their cold first/last
    // child miss can be answered without crossing native. If adoption,
    // mutation or destroy changed the epoch, the proof misses and the normal
    // native read preserves the stale/lifecycle error contract.
    const childless =
      childAxis &&
      (stampedType === 3 || stampedType === 4 || stampedType === 7 ||
        stampedType === 8 || stampedType === 10);
    const result = childless ? null : ctx.wrap(handle[nativeName](), state);
    const current = state.epoch[0];
    if (!childless) wrapper[VALID_EPOCH_SLOT] = current;
    const live = memoFor(wrapper, current);
    live[field] = result;
    if (result !== null && result !== undefined) {
      const related = memoFor(result, current);
      if (field === "fc") {
        related.pn = wrapper;
        related.ps = null;
      } else if (field === "lc") {
        related.pn = wrapper;
        related.ns = null;
      } else if (field === "ns") {
        related.ps = wrapper;
        if (live.pn !== UNSET) related.pn = live.pn;
      } else if (field === "ps") {
        related.ns = wrapper;
        if (live.pn !== UNSET) related.pn = live.pn;
      }
    }
    return result;
  }

  function siblingAxisRead(wrapper) {
    const state = wrapper[DOC_STATE_SLOT];
    if (state === undefined || state.epoch === null) {
      return navRead(wrapper, "ns", "nextSibling");
    }
    const epoch = state.epoch[0];
    if (epoch === DESTROYED_EPOCH) {
      return navRead(wrapper, "ns", "nextSibling");
    }
    const memo = wrapper[MEMO_SLOT];
    if (memo !== undefined && memo.e === epoch && memo.ns !== UNSET) {
      return memo.ns;
    }

    // Once a caller has already followed two links in the same sibling chain,
    // it is probably traversing the axis rather than making an isolated
    // `nextSibling` read. Fetch a bounded native window (at most 32 following
    // nodes) and seed its epoch-guarded relation memos. The bound is important:
    // reading four children of an ultra-wide parent must not eagerly wrap and
    // pin the complete sibling axis. Older native bindings have no chunk read
    // and retain the lazy single-node path.
    const previous = memo?.e === epoch ? memo.ps : UNSET;
    const previousMemo = previous?.[MEMO_SLOT];
    const parent = memo?.e === epoch ? memo.pn : UNSET;
    if (
      previous === UNSET || previous === null ||
      previousMemo === undefined || previousMemo.e !== epoch ||
      previousMemo.ps === UNSET || previousMemo.ps === null ||
      parent === UNSET || parent === null
    ) {
      return navRead(wrapper, "ns", "nextSibling");
    }

    const handle = nodeHandleOf(wrapper);
    const readChunk = handle.nextSiblingChunk;
    if (typeof readChunk !== "function") {
      return navRead(wrapper, "ns", "nextSibling");
    }

    const nativeChunk = readChunk.call(handle);
    const reachedEnd = nativeChunk[nativeChunk.length - 1] === null;
    const length = nativeChunk.length - (reachedEnd ? 1 : 0);
    const children = new Array(length);
    for (let i = 0; i < length; i += 1) {
      children[i] = ctx.wrap(nativeChunk[i], state);
    }
    const current = state.epoch[0];
    wrapper[VALID_EPOCH_SLOT] = current;
    const parentMemo = memoFor(parent, current);
    let preceding = wrapper;
    for (let i = 0; i < children.length; i += 1) {
      const childMemo = memoFor(children[i], current);
      childMemo.pn = parent;
      childMemo.ps = preceding;
      children[i][VALID_EPOCH_SLOT] = current;
      memoFor(preceding, current).ns = children[i];
      preceding = children[i];
    }
    // A short final chunk carries an explicit native end marker. Only then is
    // it correct to cache `null`; a full chunk deliberately leaves the last
    // node's next-sibling memo unset so the following read fetches one more
    // bounded window.
    if (reachedEnd) {
      memoFor(preceding, current).ns = null;
      parentMemo.lc = preceding;
    }
    const refreshed = memoFor(wrapper, current);
    if (refreshed.ns !== UNSET) return refreshed.ns;
    return navRead(wrapper, "ns", "nextSibling");
  }

  ctx.defineAccessor(Node.prototype, "parentNode", function parentNode() {
    return navRead(this, "pn", "parentNode");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "firstChild", function firstChild() {
    return navRead(this, "fc", "firstChild", true);
  }, undefined);

  ctx.defineAccessor(Node.prototype, "lastChild", function lastChild() {
    return navRead(this, "lc", "lastChild", true);
  }, undefined);

  ctx.defineAccessor(Node.prototype, "previousSibling", function previousSibling() {
    return navRead(this, "ps", "previousSibling");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "nextSibling", function nextSibling() {
    return siblingAxisRead(this);
  }, undefined);

  // Ordered children as the T25D *live* `NodeList` bound to this parent. Every
  // access re-reads the frozen native `childNodes()` read through
  // `liveChildNodes`, so an existing collection reflects later tree or
  // `textContent` changes immediately and one and the same `NodeList` object is
  // handed back per parent (stable identity), matching happy-dom. The T23B
  // snapshot-array form was replaced by the T25 gate; an empty `NodeList`
  // stands for a leaf node.
  ctx.defineAccessor(Node.prototype, "childNodes", function childNodes() {
    return liveChildNodes(nodeHandleOf(this));
  }, undefined);
}
