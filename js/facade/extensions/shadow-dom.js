// `ShadowRoot` / `attachShadow` / `shadowRoot` / slot-assignment facade
// extension (T43).
//
// Installs the WHATWG Shadow DOM surface on the single `Node` facade class:
// `Element.attachShadow({ mode, serializable })`, `Element.shadowRoot` (the
// open root, or `null` for a closed root or a host without one), the
// `ShadowRoot` facade class (`host` / `mode` / `serializable` /
// `innerHTML`), the `slot` attribute reflection and the basic
// `HTMLSlotElement.assignedNodes` / `assignedElements` reads.
// Everything delegates verbatim to the native T43 contract
// (crates/mad-dom-bun/src/extensions/shadow_dom_api.rs) and through it to the
// Core ownership / mode / slot model (`mad_dom_core::dom::shadow_root`).
//
// # The `ShadowRoot` wrapper (T43 re-parenting on the T48A hierarchy)
//
// A shadow root is the `Node` wrapper produced by `ctx.wrap` (which since
// T48A mints fragments as the `DocumentFragment` class) whose prototype has
// been re-parented onto the `ShadowRoot` class:
// `Object.setPrototypeOf(wrapper, ShadowRoot.prototype)`, exactly like the T42
// custom-element upgrade. The two minting points — `attachShadow` and the
// `shadowRoot` getter — route the native handle through `ctx.wrap` (the unique
// conversion entry, so identity is stable) and then re-parent it, and every
// later `ctx.wrap` of the same native handle returns the already-re-parented
// object. `ShadowRoot.prototype` chains to `DocumentFragment.prototype`
// (happy-dom's `ShadowRoot extends DocumentFragment`) and through it to
// `Node.prototype`, so the whole Node surface (navigation, mutation, events,
// `textContent`) plus the fragment `innerHTML` / `querySelector` /
// `querySelectorAll` surface is inherited and works against the same native
// handle. A closed root is minted once by `attachShadow` and never reaches
// `host.shadowRoot` again (the native read reports `null`), so closed trees
// never leak through the public surface.
//
// # The `assignedNodes` / `assignedElements` reads
//
// They are installed on `Node.prototype` (the single-class "element" slot) and
// kind-guarded by Core: a `<slot>` element inside a shadow tree returns its
// assigned host children under the default named assignment; any other node
// returns the empty list. `flatten` recurses through slotted `<slot>`
// elements.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing in the registry changes beyond the
// import and array entry.

import { Node, DocumentFragment } from "./node.js";
import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/shadow-dom",
  owner: "T43",
  gate: "T43",
  status: "implemented",
});

/**
 * `ShadowRoot` facade class (T43).
 *
 * Instances are never constructed directly: every shadow-root wrapper is the
 * `Node`/`DocumentFragment` wrapper whose prototype has been re-parented onto
 * `ShadowRoot.prototype` (the T43 re-parenting, like the T42 custom-element
 * upgrade), so `root instanceof window.ShadowRoot` and `root instanceof
 * window.Node` both hold and every Node / DocumentFragment method stays
 * reachable. The class body is empty; `install` wires the surface.
 */
export class ShadowRoot {}

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

/**
 * Wraps a native shadow-root handle into the `ShadowRoot` facade class.
 *
 * Routes through `ctx.wrap` (the unique conversion entry, so the wrapper
 * identity stays the per-document weak cache) and then re-parents the wrapper
 * onto `ShadowRoot.prototype`; `null` passes through unchanged.
 */
// The `serializable` flag `attachShadow({ serializable })` sets (happy-dom
// keeps it on the shadow root itself): native only stores the open/closed
// mode, so the facade tracks the flag per native shadow-root handle. Weak on
// the handle, so a collected shadow root drops its entry with the tree — the
// same lifetime the facade wrapper identity itself is keyed on (T20 weak
// wrapper cache). `wrapShadowRoot` additionally stamps the current flag onto
// every wrapper it re-parents, so a re-wrapped shadow root keeps reading the
// value it was minted with.
const SHADOW_ROOT_SERIALIZABLE = new WeakMap();
const SERIALIZABLE_STAMP = Symbol("mad-dom shadow root serializable");

function wrapShadowRoot(ctx, handle) {
  if (handle === null || handle === undefined) return handle;
  const wrapped = ctx.wrap(handle);
  Object.setPrototypeOf(wrapped, ShadowRoot.prototype);
  const serializable = SHADOW_ROOT_SERIALIZABLE.get(handle);
  if (serializable !== undefined) wrapped[SERIALIZABLE_STAMP] = serializable;
  return wrapped;
}

/**
 * Installs the T43 Shadow DOM surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  // The T48A prototype hierarchy: a `ShadowRoot` wrapper is a `Node` whose
  // prototype chain passes through `DocumentFragment` (matching happy-dom's
  // `ShadowRoot extends DocumentFragment`), so a shadow root reaches the
  // ParentNode query surface and `innerHTML` plus every Node method.
  Object.setPrototypeOf(ShadowRoot.prototype, DocumentFragment.prototype);

  // `window.ShadowRoot` — the WHATWG constructor accessor on every window.
  ctx.defineAccessor(Window.prototype, "ShadowRoot", function getShadowRoot() {
    return ShadowRoot;
  }, undefined);

  // `Element.attachShadow({ mode })` — WebIDL argument shaping with the
  // happy-dom validation errors; the mode enum maps to the native 0/1 codes.
  ctx.defineMethod(Node.prototype, "attachShadow", function attachShadow(init) {
    const handle = facadeNodeHandle(ctx, this, "attachShadow");
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'attachShadow' on 'Element': 1 argument required, but only 0 present.",
      );
    }
    const mode = init && init.mode;
    if (!mode) {
      throw new TypeError(
        "Failed to execute 'attachShadow' on 'Element': " +
          "Failed to read the 'mode' property from 'ShadowRootInit': " +
          "Required member is undefined.",
      );
    }
    if (mode !== "open" && mode !== "closed") {
      throw new TypeError(
        `Failed to execute 'attachShadow' on 'Element': ` +
          `Failed to read the 'mode' property from 'ShadowRootInit': ` +
          `The provided value '${mode}' is not a valid enum value of type ShadowRootMode.`,
      );
    }
    const shadowHandle = handle.attachShadow(mode === "closed" ? 1 : 0);
    // happy-dom parity: `attachShadow({ serializable })` stamps the coerced
    // flag on the minted root (`getHTML({ serializableShadowRoots })` reads
    // it back to decide declarative-shadow-root serialization).
    SHADOW_ROOT_SERIALIZABLE.set(shadowHandle, Boolean(init && init.serializable));
    return wrapShadowRoot(ctx, shadowHandle);
  });

  // `Element.shadowRoot` — the open shadow root, or `null` (a closed root and
  // a host without a root both read as `null`).
  ctx.defineAccessor(Node.prototype, "shadowRoot", function shadowRoot() {
    return wrapShadowRoot(ctx, facadeNodeHandle(ctx, this, "shadowRoot").shadowRoot());
  }, undefined);

  // `ShadowRoot.host` / `ShadowRoot.mode`.
  ctx.defineAccessor(ShadowRoot.prototype, "host", function host() {
    return wrapShadowRoot(ctx, facadeNodeHandle(ctx, this, "host").shadowHost());
  }, undefined);

  ctx.defineAccessor(ShadowRoot.prototype, "mode", function mode() {
    const mode = facadeNodeHandle(ctx, this, "mode").shadowRootMode();
    if (mode === 0) return "open";
    if (mode === 1) return "closed";
    return undefined;
  }, undefined);

  // `ShadowRoot.serializable` — the coerced `serializable` init flag the
  // `attachShadow` mint recorded (happy-dom parity: `false` by default;
  // `getHTML({ serializableShadowRoots })` only emits declarative shadow
  // roots for roots marked serializable).
  ctx.defineAccessor(ShadowRoot.prototype, "serializable", function serializable() {
    if (this[SERIALIZABLE_STAMP] !== undefined) return this[SERIALIZABLE_STAMP];
    return SHADOW_ROOT_SERIALIZABLE.get(facadeNodeHandle(ctx, this, "serializable")) ?? false;
  }, undefined);

  // `Element.slot` — the `slot` attribute, two-way reflected (`""` when
  // absent), the light-DOM side of the named slot assignment.
  ctx.defineAccessor(Node.prototype, "slot", function slot() {
    return facadeNodeHandle(ctx, this, "slot").getAttribute("slot") || "";
  }, function slot(value) {
    facadeNodeHandle(ctx, this, "slot").setAttribute("slot", String(value));
  });

  // `HTMLSlotElement.assignedNodes` / `assignedElements` — the basic named
  // slot assignment, kind-guarded by Core (a non-slot node reads `[]`).
  ctx.defineMethod(Node.prototype, "assignedNodes", function assignedNodes(options) {
    const flatten = Boolean(options && options.flatten);
    return facadeNodeHandle(ctx, this, "assignedNodes")
      .slotAssignedNodes(flatten)
      .map((handle) => ctx.wrap(handle));
  });

  ctx.defineMethod(Node.prototype, "assignedElements", function assignedElements(options) {
    const flatten = Boolean(options && options.flatten);
    return facadeNodeHandle(ctx, this, "assignedElements")
      .slotAssignedElements(flatten)
      .map((handle) => ctx.wrap(handle));
  });
}
