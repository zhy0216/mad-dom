// `Document` facade base module (T22B).
//
// The facade wraps an opaque native `DocumentHandle` (T19/T22A) without ever
// holding a second copy of the DOM: every read and every mutation is delegated
// to the native handle, and the facade state is exactly the handle it owns.
//
// This module only owns the Document *base* — construction, the native handle
// it carries and lifecycle forwarding (`destroy`). Node creation, navigation,
// mutation, attributes, `textContent` and the live `childNodes` facade are
// owned by the capability extensions (T23B / T24C / T25D / T25E), which
// install their surface onto `Document.prototype` through `ctx` at facade
// initialization. Extensions reach this facade's native handle through
// `ctx.documentContext.handleOf(wrapper)` (defined by js/facade/window.js), so
// they never touch a private field and never fabricate a `NodeId`.
//
// `Window`/`Document` construction is guarded: a facade wrapper can only be
// built around a *genuine* native handle of the matching type, so there is no
// user-visible constructor that mints a document out of thin air — windows are
// created through `createWindow()` (js/facade/window.js).
//
// The `seam` metadata below is flipped to `"implemented"` by the T22 gate;
// tests/bun/seam.test.js pins that shape.

export const seam = Object.freeze({
  id: "facade/document",
  owner: "T22B",
  gate: "T22",
  status: "implemented",
});

// Native handle behind each Document facade. Weak so a facade never pins its
// document; the native handle itself keeps the Core arena alive (T20).
const DOCUMENT_HANDLES = new WeakMap();

function isDocumentHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.destroy === "function" &&
    typeof handle.appendChild === "function"
  );
}

/**
 * Facade wrapper for a native `DocumentHandle`.
 *
 * Constructing one requires a genuine native document handle (produced by the
 * native binding); passing anything else throws a `TypeError`. Instances are
 * normally minted through the unique conversion entry `ctx.wrap`, never by
 * calling this constructor directly from facade code.
 */
export class Document {
  constructor(nativeHandle) {
    if (!isDocumentHandle(nativeHandle)) {
      throw new TypeError(
        "Document can only be constructed from a genuine native Document handle",
      );
    }
    DOCUMENT_HANDLES.set(this, nativeHandle);
  }
}

// Lifecycle forwarding, defined with the same fixed descriptor shape the
// facade helpers use (non-writable, non-enumerable, non-configurable) so
// Window and Document keep a uniform, pinned surface.
Object.defineProperty(Document.prototype, "destroy", {
  value: function destroy() {
    DOCUMENT_HANDLES.get(this).destroy();
  },
  writable: false,
  enumerable: false,
  configurable: false,
});
