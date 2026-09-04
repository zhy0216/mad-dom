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
    return nodeHandleOf(this).nodeType();
  }, undefined);

  // WHATWG nodeName: an element in the HTML namespace reports its tag name in
  // uppercase ("DIV"), matching happy-dom; SVG/MathML and every other node kind
  // report the Core value verbatim (`#text`, `#document-fragment`, the SVG
  // lowercased tag, ...). The serializers and selectors keep using the Core
  // lowercased local name, so this case change is only the observable accessor.
  ctx.defineAccessor(Node.prototype, "nodeName", function nodeName() {
    const handle = nodeHandleOf(this);
    if (handle === undefined) return undefined;
    const name = handle.nodeName();
    if (handle.nodeType() === 1 && handle.namespaceUri() === HTML_NAMESPACE) {
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
    if (handle.nodeType() !== 1) return undefined;
    return handle.nodeName();
  }, undefined);

  // WHATWG Element.tagName: equal to `nodeName` for elements (uppercase for
  // HTML namespace elements), `undefined` on non-element nodes like happy-dom.
  ctx.defineAccessor(Element.prototype, "tagName", function tagName() {
    const handle = nodeHandleOf(this);
    if (handle === undefined) return undefined;
    if (handle.nodeType() !== 1) return undefined;
    const name = handle.nodeName();
    if (handle.namespaceUri() === HTML_NAMESPACE) {
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

  function navRead(wrapper, field, nativeName) {
    const state = wrapper[DOC_STATE_SLOT];
    if (state === undefined || state.epoch === null) {
      return ctx.wrap(nodeHandleOf(wrapper)[nativeName]());
    }
    const epoch = state.epoch[0];
    const memo = wrapper[MEMO_SLOT];
    if (memo !== undefined && memo.e === epoch) {
      const value = memo[field];
      if (value !== UNSET) return value;
    }
    const result = ctx.wrap(nodeHandleOf(wrapper)[nativeName](), state);
    const current = state.epoch[0];
    const live = memo ?? (wrapper[MEMO_SLOT] = {
      e: current, fc: UNSET, lc: UNSET, ns: UNSET, ps: UNSET, pn: UNSET,
    });
    if (live.e !== current) {
      live.e = current;
      live.fc = live.lc = live.ns = live.ps = live.pn = UNSET;
    }
    live[field] = result;
    return result;
  }

  ctx.defineAccessor(Node.prototype, "parentNode", function parentNode() {
    return navRead(this, "pn", "parentNode");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "firstChild", function firstChild() {
    return navRead(this, "fc", "firstChild");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "lastChild", function lastChild() {
    return navRead(this, "lc", "lastChild");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "previousSibling", function previousSibling() {
    return navRead(this, "ps", "previousSibling");
  }, undefined);

  ctx.defineAccessor(Node.prototype, "nextSibling", function nextSibling() {
    return navRead(this, "ns", "nextSibling");
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
