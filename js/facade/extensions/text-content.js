// `textContent` facade extension (T25E).
//
// Installs the WHATWG `Node.textContent` accessor — getter and setter — on the
// node prototype, delegating every read and every write to the native
// `NodeHandle` textContent contract (T25E, crates/mad-dom-bun/src/extensions/
// text_api.rs). Like the rest of the facade, this module keeps **no second DOM
// state**: reads are produced on demand from Core and writes route through
// Core, so a change through this accessor is immediately visible to the
// existing navigation and `childNodes` reads (T23/T24), and a change through
// mutation is immediately visible to the next `textContent` read.
//
// # WebIDL argument shaping
//
// The getter returns `string | null` (a `Document` node reads as `null`).
// The setter accepts any value and applies the WHATWG `DOMString?` conversion:
// `null` becomes the empty string (removing every child, inserting no text
// node) and every other value is coerced with `String`, so `textContent = 42`
// stores `"42"`. This is pure argument shaping — no DOM state is produced
// here — so the native handle receives a plain string and Core stays the single
// source of text truth.
//
// # Errors
//
// The native contract owns the DOM rules; since T48B the setter value is stored
// verbatim (including NUL bytes, matching happy-dom), and a destroyed document
// fails per T21. A degraded DOMException-classed violation (e.g. a wrong-
// document handle) is re-raised by the facade as a real `DOMException` with a
// WebIDL message while preserving the stable `code` (see `dom-error.js`).
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes. The `seam`
// metadata was flipped from `"placeholder"` to `"implemented"` by the T25 gate
// (tests/bun/seam.test.js pins that shape).

import { Node } from "./node.js";
import { rethrowDomError, webidlMessage } from "./dom-error.js";

export const seam = Object.freeze({
  id: "facade/extensions/text-content",
  owner: "T25E",
  gate: "T25",
  // The seam status was flipped from "placeholder" to "implemented" by the T25
  // gate (tests/bun/seam.test.js pins that shape).
  status: "implemented",
});

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.textContent === "function" &&
    typeof handle.setTextContent === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    // A manually constructed Node around a native handle is intentionally not
    // part of the reverse conversion cache. textContent accepts only wrappers
    // for which the facade can recover the owning native handle, so native
    // affinity and ownership checks remain authoritative.
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

/**
 * Installs the T25E `textContent` accessor.
 *
 * `ctx.defineAccessor` is the only property-definition path used here; its
 * default descriptor is fixed, non-enumerable and non-configurable, matching
 * the rest of the facade surface.
 */
export function install(ctx) {
  ctx.defineAccessor(
    Node.prototype,
    "textContent",
    function textContent() {
      const handle = facadeNodeHandle(ctx, this, "textContent");
      try {
        return handle.textContent();
      } catch (error) {
        rethrowDomError(error, webidlMessage(error, "textContent", "Node"));
      }
    },
    function textContent(value) {
      const handle = facadeNodeHandle(ctx, this, "textContent");
      try {
        handle.setTextContent(value === null ? "" : String(value));
      } catch (error) {
        rethrowDomError(error, webidlMessage(error, "textContent", "Node"));
      }
    },
  );
}
