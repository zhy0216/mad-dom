// Tree-mutation facade extension (T24C).
//
// The native mutation contract deliberately lives on `DocumentHandle` and
// takes the parent node as its first argument. The WHATWG surface, however,
// lives on `Node.prototype` and binds the receiver as the parent. This
// extension is the small adapter between those two shapes:
//
//   Node.appendChild(child)                  -> void native call, returns child
//   Node.insertBefore(child, reference)      -> void native call, returns child
//   Node.removeChild(child)                  -> void native call, returns child
//   Node.replaceChild(newChild, oldChild)    -> void native call, returns oldChild
//
// No relation, ownership or hierarchy state is kept here. Every operation is
// forwarded to the audited T24A/T24B `DocumentHandle` methods, and return
// values are canonicalized through the same `ctx.wrap` conversion entry.

import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Document } from "../document.js";
import { Node } from "./node.js";

export const seam = Object.freeze({
  id: "facade/extensions/mutation",
  owner: "T24C",
  gate: "T24",
  // The seam status was flipped from "placeholder" to "implemented" by the T24
  // gate (tests/bun/seam.test.js pins that shape).
  status: "implemented",
});

// Mutation methods are already exported by the audited native binding. Keep
// their lookup lazy so importing the facade (and running structural tests) does
// not require a locally built `.node` artifact.
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

function isNativeNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function isNativeDocumentHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.appendChild === "function" &&
    typeof handle.createDocumentFragment === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNativeNodeHandle(handle)) {
    // A manually constructed Node around a native handle is intentionally not
    // part of the reverse conversion cache. Mutation accepts only wrappers
    // for which the facade can recover the owning native handle, so native
    // affinity and ownership checks remain authoritative.
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

function facadeDocumentHandle(ctx, value) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNativeDocumentHandle(handle)) {
    throw new TypeError("Document.createDocumentFragment requires a genuine Document facade wrapper");
  }
  return handle;
}

function nativeMutation(methodName, parentHandle, argumentHandles) {
  const documentHandle = loadNative().DocumentHandle;
  const method = documentHandle?.prototype?.[methodName];
  if (typeof method !== "function") {
    throw new Error(`mad-dom native binding is missing DocumentHandle.${methodName}`);
  }

  // The audited native contract documents this receiver convention: the
  // facade binds `this` to the parent NodeHandle and also passes that same
  // handle as the first (Core-order) argument. Native code then performs all
  // document-affinity and hierarchy checks before touching the tree.
  method.call(parentHandle, parentHandle, ...argumentHandles);
}

/**
 * Installs the T24C mutation surface and DocumentFragment creation adapter.
 *
 * `ctx.defineMethod` is the only property-definition path used here; its
 * default descriptor is fixed, non-enumerable and non-configurable, matching
 * the rest of the facade surface.
 */
export function install(ctx) {
  ctx.defineMethod(Document.prototype, "createDocumentFragment", function createDocumentFragment() {
    const documentHandle = facadeDocumentHandle(ctx, this);
    return ctx.wrap(documentHandle.createDocumentFragment());
  });

  ctx.defineMethod(Node.prototype, "appendChild", function appendChild(child) {
    const parentHandle = facadeNodeHandle(ctx, this, "appendChild");
    const childHandle = facadeNodeHandle(ctx, child, "appendChild");
    nativeMutation("appendChild", parentHandle, [childHandle]);
    return ctx.wrap(childHandle);
  });

  ctx.defineMethod(Node.prototype, "insertBefore", function insertBefore(child, reference) {
    const parentHandle = facadeNodeHandle(ctx, this, "insertBefore");
    const childHandle = facadeNodeHandle(ctx, child, "insertBefore");
    const referenceHandle = facadeNodeHandle(ctx, reference, "insertBefore");
    nativeMutation("insertBefore", parentHandle, [childHandle, referenceHandle]);
    return ctx.wrap(childHandle);
  });

  ctx.defineMethod(Node.prototype, "removeChild", function removeChild(child) {
    const parentHandle = facadeNodeHandle(ctx, this, "removeChild");
    const childHandle = facadeNodeHandle(ctx, child, "removeChild");
    nativeMutation("removeChild", parentHandle, [childHandle]);
    return ctx.wrap(childHandle);
  });

  ctx.defineMethod(Node.prototype, "replaceChild", function replaceChild(newChild, oldChild) {
    const parentHandle = facadeNodeHandle(ctx, this, "replaceChild");
    const newChildHandle = facadeNodeHandle(ctx, newChild, "replaceChild");
    const oldChildHandle = facadeNodeHandle(ctx, oldChild, "replaceChild");
    // Native/Core order is (parent, old child, replacement); WHATWG order is
    // (new child, old child).
    nativeMutation("replaceChild", parentHandle, [oldChildHandle, newChildHandle]);
    return ctx.wrap(oldChildHandle);
  });
}
