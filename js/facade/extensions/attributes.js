// Attribute read/write facade extension (T25E).
//
// Installs the WHATWG element attribute surface — `getAttribute`,
// `setAttribute`, `removeAttribute`, `hasAttribute` — as prototype methods on
// `Element.prototype` (T48A) that delegate every read and every write to the
// native `NodeHandle` attribute contract (T25E, crates/mad-dom-bun/src/
// extensions/attributes_api.rs). Like the rest of the facade, this module
// keeps **no second attribute state**: the ordered `(name, value)` list lives
// in the Core arena and every call routes through the native handle, so a
// write through any entry point is immediately visible to every reader.
//
// # WebIDL argument shaping
//
// The four methods accept any value and coerce the attribute name and value to
// strings exactly like the WebIDL `DOMString` parameters they mirror:
// `setAttribute("a", 1)` stores `"1"`, `setAttribute("b", null)` stores
// `"null"` and `setAttribute("c", undefined)` stores `"undefined"`; the read
// entries coerce their name argument the same way. This is pure argument
// shaping — no DOM state is produced here — so the native handle still receives
// plain strings and Core stays the single source of attribute truth.
//
// # Return values
//
// The WHATWG shapes are kept: `getAttribute` → `string | null`,
// `hasAttribute` → `boolean`, `removeAttribute` → `undefined`,
// `setAttribute` → `undefined`.
//
// # Errors
//
// The native contract owns the DOM rules (Core rejects a non-Element node with
// `ERR_MAD_DOM_HIERARCHY` and an invalid attribute name on `setAttribute` with
// `ERR_MAD_DOM_INVALID_CHARACTER`, leaving the list unchanged; a destroyed
// document fails per T21); the facade only forwards the frozen error. T48B
// re-raises the DOMException-classed violations as real `DOMException` objects
// with the happy-dom WebIDL message while preserving the stable `code` (see
// `dom-error.js`); lifecycle/argument errors pass through unchanged.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes. The `seam`
// metadata was flipped from `"placeholder"` to `"implemented"` by the T25 gate
// (tests/bun/seam.test.js pins that shape).

import { Element } from "./node.js";
import { flushCustomElementReactions } from "./custom-elements.js";
import { domErrorName, rethrowDomError, webidlMessage } from "./dom-error.js";

export const seam = Object.freeze({
  id: "facade/extensions/attributes",
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
    typeof handle.getAttribute === "function" &&
    typeof handle.setAttribute === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    // A manually constructed Node around a native handle is intentionally not
    // part of the reverse conversion cache. Attribute calls accept only
    // wrappers for which the facade can recover the owning native handle, so
    // native affinity and ownership checks remain authoritative.
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

/**
 * Installs the T25E attribute surface on `Element.prototype` (T48A: moved off
 * `Node.prototype` so Text / Comment never hold the attribute members —
 * `text.getAttribute` reads `undefined` and calling it throws
 * `TypeError: ... is not a function`, matching happy-dom).
 *
 * `ctx.defineMethod` is the only property-definition path used here; its
 * default descriptor is fixed, non-enumerable and non-configurable, matching
 * the rest of the facade surface.
 *
 * Every native read/write is wrapped so a degraded DOMException-classed
 * violation is re-raised as a real `DOMException` with the happy-dom WebIDL
 * message and the stable `code` (T48B).
 */
export function install(ctx) {
  ctx.defineMethod(Element.prototype, "getAttribute", function getAttribute(name) {
    const handle = facadeNodeHandle(ctx, this, "getAttribute");
    try {
      return handle.getAttribute(String(name));
    } catch (error) {
      rethrowDomError(error, webidlMessage(error, "getAttribute", "Element"));
    }
  });

  ctx.defineMethod(Element.prototype, "setAttribute", function setAttribute(name, value) {
    const handle = facadeNodeHandle(ctx, this, "setAttribute");
    try {
      handle.setAttribute(String(name), String(value));
    } catch (error) {
      // The happy-dom verbatim message for an invalid attribute name; the
      // `Uncaught InvalidCharacterError: ` prefix is happy-dom's own literal
      // message text, compared byte-for-byte by the differential runner.
      const message =
        domErrorName(error) === "InvalidCharacterError"
          ? `Uncaught InvalidCharacterError: Failed to execute 'setAttribute' on 'Element': '${String(name)}' is not a valid attribute name.`
          : webidlMessage(error, "setAttribute", "Element");
      rethrowDomError(error, message);
    }
    // T42: the write queued the `attributeChangedCallback` reaction for a
    // custom element observing the attribute; flush it synchronously.
    flushCustomElementReactions(ctx, handle);
  });

  ctx.defineMethod(Element.prototype, "removeAttribute", function removeAttribute(name) {
    const handle = facadeNodeHandle(ctx, this, "removeAttribute");
    try {
      handle.removeAttribute(String(name));
    } catch (error) {
      rethrowDomError(error, webidlMessage(error, "removeAttribute", "Element"));
    }
    flushCustomElementReactions(ctx, handle);
  });

  ctx.defineMethod(Element.prototype, "hasAttribute", function hasAttribute(name) {
    const handle = facadeNodeHandle(ctx, this, "hasAttribute");
    try {
      return handle.hasAttribute(String(name));
    } catch (error) {
      rethrowDomError(error, webidlMessage(error, "hasAttribute", "Element"));
    }
  });
}
