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
// forwarded to the audited T24A/T24B `DocumentHandle` methods. Since the
// native methods return the exact input node, the facade returns that already-
// canonical wrapper directly instead of looking it up again through `ctx.wrap`.

import { Document } from "../document.js";
import { nodeInternalsOf } from "./classes.js";
import { Node } from "./node.js";
import { flushCustomElementReactions } from "./custom-elements.js";
import { loadNative } from "../../native-loader.js";

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
// not require a locally built `.node` artifact; the resolution chain is owned
// by js/native-loader.js (ADR-0005 §3/§6/§8/§9).

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

// Resolves and authenticates the token island in one pass. `appendChild`
// needs both the token and owning document for each operand; calling the
// token/document helpers separately repeats the same private-state and
// canonical-token-map probes twice per node on the hottest mutation path.
function facadeTokenState(value) {
  const internals = nodeInternalsOf(value);
  if (internals === undefined) return undefined;
  const state = internals.documentState;
  const token = internals.token;
  return token !== undefined &&
      (state?.destroyed === true || state?.getWrapperByToken(token) === value)
    ? internals
    : undefined;
}

const NATIVE_MUTATION_METHODS = new Map();

function nativeMutation(ctx, methodName, parentHandle, firstHandle, secondHandle) {
  let method = NATIVE_MUTATION_METHODS.get(methodName);
  if (method === undefined) {
    const documentHandle = loadNative().DocumentHandle;
    method = documentHandle?.prototype?.[methodName];
    if (typeof method === "function") NATIVE_MUTATION_METHODS.set(methodName, method);
  }
  if (typeof method !== "function") {
    throw new Error(`mad-dom native binding is missing DocumentHandle.${methodName}`);
  }

  // The audited native contract documents this receiver convention: the
  // facade binds `this` to the parent NodeHandle and also passes that same
  // handle as the first (Core-order) argument. Native code then performs all
  // document-affinity and hierarchy checks before touching the tree.
  if (secondHandle === undefined) {
    method.call(parentHandle, parentHandle, firstHandle);
  } else {
    method.call(parentHandle, parentHandle, firstHandle, secondHandle);
  }
  // T42: the mutation queued the connected/disconnected custom element
  // reactions; flush them synchronously, in enqueue order (happy-dom fires the
  // lifecycle callbacks at the mutation point).
  flushCustomElementReactions(ctx, parentHandle);
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
    const parentInternals = facadeTokenState(this);
    const childInternals = facadeTokenState(child);
    const parentState = parentInternals?.documentState;
    const parentDocument = parentState?.documentHandle;
    const appendChildToken = parentState?.nativeMethods.appendChildToken;
    if (
      parentDocument !== undefined &&
      parentDocument === childInternals?.documentState?.documentHandle &&
      appendChildToken !== undefined
    ) {
      const parentToken = parentInternals.token;
      const childToken = childInternals.token;
      const appendChildTokenLocal = parentState.nativeMethods.appendChildTokenLocal;
      if (
        parentState.epoch !== null &&
        appendChildTokenLocal !== undefined
      ) {
        parentState.epoch[0] = appendChildTokenLocal(parentToken, childToken);
      } else {
        appendChildToken(parentToken, childToken);
      }
      flushCustomElementReactions(ctx, this, true);
      return child;
    }
    const parentHandle = facadeNodeHandle(ctx, this, "appendChild");
    const childHandle = facadeNodeHandle(ctx, child, "appendChild");
    nativeMutation(ctx, "appendChild", parentHandle, childHandle);
    return child;
  });

  ctx.defineMethod(Node.prototype, "insertBefore", function insertBefore(child, reference) {
    const parentHandle = facadeNodeHandle(ctx, this, "insertBefore");
    const childHandle = facadeNodeHandle(ctx, child, "insertBefore");
    // A null / undefined reference appends at the end (WHATWG insertBefore
    // semantics, matching happy-dom); the native contract has no null slot, so
    // the facade routes the null case through appendChild.
    if (reference === null || reference === undefined) {
      nativeMutation(ctx, "appendChild", parentHandle, childHandle);
      return child;
    }
    const referenceHandle = facadeNodeHandle(ctx, reference, "insertBefore");
    nativeMutation(ctx, "insertBefore", parentHandle, childHandle, referenceHandle);
    return child;
  });

  ctx.defineMethod(Node.prototype, "removeChild", function removeChild(child) {
    const parentHandle = facadeNodeHandle(ctx, this, "removeChild");
    const childHandle = facadeNodeHandle(ctx, child, "removeChild");
    nativeMutation(ctx, "removeChild", parentHandle, childHandle);
    return child;
  });

  ctx.defineMethod(Node.prototype, "replaceChild", function replaceChild(newChild, oldChild) {
    const parentHandle = facadeNodeHandle(ctx, this, "replaceChild");
    const newChildHandle = facadeNodeHandle(ctx, newChild, "replaceChild");
    const oldChildHandle = facadeNodeHandle(ctx, oldChild, "replaceChild");
    // Native/Core order is (parent, old child, replacement); WHATWG order is
    // (new child, old child).
    nativeMutation(ctx, "replaceChild", parentHandle, oldChildHandle, newChildHandle);
    return oldChild;
  });
}
