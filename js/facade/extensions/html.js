// `innerHTML` / `outerHTML` and document-structure facade extension (T29).
//
// Installs the WHATWG `innerHTML` / `outerHTML` accessors on `Node.prototype`
// and the `documentElement` / `head` / `body` accessors plus the `parseHtml`
// full-document loader on `Document.prototype`, delegating every read and every
// write to the native T29 contract (crates/mad-dom-bun/src/extensions/
// html_api.rs) and through it to the Core parser/serializer (T26/T27/T28) and
// the Core apply contract. Like the rest of the facade, this module keeps **no
// second DOM state**: reads are produced on demand from Core and writes route
// through Core, so a change through `innerHTML` / `outerHTML` / `parseHtml` is
// immediately visible to the navigation, `childNodes`, attribute and
// `textContent` reads (T23/T24/T25), and a mutation through those surfaces is
// immediately visible to the next `innerHTML` / `outerHTML` read.
//
// # WebIDL argument shaping
//
// The setters accept any value and coerce it with `String` exactly like a
// WebIDL `DOMString` attribute: `el.innerHTML = 42` stores `"42"` and
// `el.innerHTML = null` stores `"null"` (unlike the `textContent` setter,
// which maps `null` to the empty string). The `parseHtml` method coerces its
// argument the same way. This is pure argument shaping — no DOM state is
// produced here — so the native handle still receives a plain string and Core
// stays the single source of tree truth.
//
// # Node-kind eligibility
//
// `innerHTML` is defined on `Element` and `DocumentFragment` (WHATWG);
// `outerHTML` on `Element` alone. In MAD DOM's single-`Node`-class model the
// accessors live on `Node.prototype`, so calling them on an ineligible node
// (a `Text`, `Comment` or `Document`) reaches Core, which rejects it with the
// frozen `ERR_MAD_DOM_HIERARCHY` taxonomy — the same pattern as the T25E
// attribute methods. happy-dom instead has no such property on those node
// types (reads as `undefined`); that divergence is recorded as a known gap.
//
// # Errors
//
// The native contract owns the DOM rules (a non-eligible node kind fails with
// `ERR_MAD_DOM_HIERARCHY`; the setters parse and adopt before mutating, so a
// failed setter leaves the target unchanged — failure atomicity; a destroyed
// document fails per T21); the facade only forwards the frozen error.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes.

import { Document } from "../document.js";
import { Node } from "./node.js";
import {
  flushCustomElementReactions,
  upgradeParsedCandidates,
} from "./custom-elements.js";

export const seam = Object.freeze({
  id: "facade/extensions/html",
  owner: "T29",
  gate: "T29",
  status: "implemented",
});

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.innerHTML === "function" &&
    typeof handle.setInnerHTML === "function" &&
    typeof handle.outerHTML === "function" &&
    typeof handle.setOuterHTML === "function"
  );
}

function isDocumentHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.documentElement === "function" &&
    typeof handle.head === "function" &&
    typeof handle.body === "function" &&
    typeof handle.parseHtml === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    // A manually constructed Node around a native handle is intentionally not
    // part of the reverse conversion cache. innerHTML/outerHTML accept only
    // wrappers for which the facade can recover the owning native handle, so
    // native affinity and ownership checks remain authoritative.
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

/**
 * Installs the T29 HTML surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  // Document structure accessors and the full-document loader.
  ctx.defineAccessor(
    Document.prototype,
    "documentElement",
    function documentElement() {
      return ctx.wrap(facadeDocumentHandle(ctx, this, "documentElement").documentElement());
    },
    undefined,
  );

  ctx.defineAccessor(
    Document.prototype,
    "head",
    function head() {
      return ctx.wrap(facadeDocumentHandle(ctx, this, "head").head());
    },
    undefined,
  );

  ctx.defineAccessor(
    Document.prototype,
    "body",
    function body() {
      return ctx.wrap(facadeDocumentHandle(ctx, this, "body").body());
    },
    undefined,
  );

  ctx.defineMethod(Document.prototype, "parseHtml", function parseHtml(html) {
    const documentHandle = facadeDocumentHandle(ctx, this, "parseHtml");
    documentHandle.parseHtml(String(html));
    // T42: the parsed custom elements were upgraded during the load; set their
    // wrapper prototypes before the queued reactions are dispatched.
    upgradeParsedCandidates(ctx, documentHandle.documentElement());
    flushCustomElementReactions(ctx, documentHandle.documentElement());
  });

  // Node innerHTML / outerHTML accessors.
  ctx.defineAccessor(
    Node.prototype,
    "innerHTML",
    function innerHTML() {
      return facadeNodeHandle(ctx, this, "innerHTML").innerHTML();
    },
    function innerHTML(value) {
      const handle = facadeNodeHandle(ctx, this, "innerHTML");
      handle.setInnerHTML(String(value));
      // T42: the parse upgraded the custom elements and queued their
      // reactions; set the wrapper prototypes, then flush the callbacks
      // synchronously in enqueue order (happy-dom parse order).
      upgradeParsedCandidates(ctx, handle);
      flushCustomElementReactions(ctx, handle);
    },
  );

  ctx.defineAccessor(
    Node.prototype,
    "outerHTML",
    function outerHTML() {
      return facadeNodeHandle(ctx, this, "outerHTML").outerHTML();
    },
    function outerHTML(value) {
      const handle = facadeNodeHandle(ctx, this, "outerHTML");
      handle.setOuterHTML(String(value));
      upgradeParsedCandidates(ctx, handle);
      flushCustomElementReactions(ctx, handle);
    },
  );
}
