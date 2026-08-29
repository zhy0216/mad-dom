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
// or the live `childNodes` facade — those belong to T24C / T25E / T25D and are
// explicitly out of scope (js/facade/CONTRACT.md). The facade keeps no second
// DOM state: a `Node` wrapper holds exactly the opaque native `NodeHandle`
// behind it, a Core `NodeId` never crosses this seam as a primitive.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes. The `seam`
// metadata was flipped from `"placeholder"` to `"implemented"` by the T23 gate
// (tests/bun/seam.test.js pins that shape).

import { Document } from "../document.js";

export const seam = Object.freeze({
  id: "facade/extensions/node",
  owner: "T23B",
  gate: "T23",
  status: "implemented",
});

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
  ctx.registerHandleType("NodeHandle", (handle) => new Node(handle));

  // `document.createElement` / `document.createTextNode` (WHATWG names).
  //
  // The native `DocumentHandle` carries the `createElement` / `createText`
  // symbols (frozen by T23A); the WHATWG `createTextNode` name is adapted
  // here, so no native duplicate exists. Each call mints a fresh detached
  // node through `ctx.wrap`.
  ctx.defineMethod(Document.prototype, "createElement", function createElement(name) {
    const documentHandle = ctx.documentContext.handleOf(this);
    return ctx.wrap(documentHandle.createElement(name));
  });

  ctx.defineMethod(Document.prototype, "createTextNode", function createTextNode(data) {
    const documentHandle = ctx.documentContext.handleOf(this);
    return ctx.wrap(documentHandle.createText(data));
  });

  // `Node` navigation properties (WHATWG read-only attributes).
  //
  // Every read delegates to the native handle; node-producing reads route the
  // result through `ctx.wrap`, so repeated reads of the same node hand back
  // one and the same facade object (strict equality), mirroring the native
  // per-document weak wrapper cache. `null` results pass through unchanged.
  ctx.defineAccessor(Node.prototype, "nodeType", function nodeType() {
    return NODE_HANDLES.get(this).nodeType();
  }, undefined);

  ctx.defineAccessor(Node.prototype, "nodeName", function nodeName() {
    return NODE_HANDLES.get(this).nodeName();
  }, undefined);

  ctx.defineAccessor(Node.prototype, "parentNode", function parentNode() {
    return ctx.wrap(NODE_HANDLES.get(this).parentNode());
  }, undefined);

  ctx.defineAccessor(Node.prototype, "firstChild", function firstChild() {
    return ctx.wrap(NODE_HANDLES.get(this).firstChild());
  }, undefined);

  ctx.defineAccessor(Node.prototype, "lastChild", function lastChild() {
    return ctx.wrap(NODE_HANDLES.get(this).lastChild());
  }, undefined);

  ctx.defineAccessor(Node.prototype, "previousSibling", function previousSibling() {
    return ctx.wrap(NODE_HANDLES.get(this).previousSibling());
  }, undefined);

  ctx.defineAccessor(Node.prototype, "nextSibling", function nextSibling() {
    return ctx.wrap(NODE_HANDLES.get(this).nextSibling());
  }, undefined);

  // Ordered children as a plain array of wrapped nodes; an empty array for a
  // leaf node. The *live* `childNodes` facade is T25D's — this is the frozen
  // T23B snapshot form.
  ctx.defineAccessor(Node.prototype, "childNodes", function childNodes() {
    return NODE_HANDLES.get(this)
      .childNodes()
      .map((handle) => ctx.wrap(handle));
  }, undefined);
}
