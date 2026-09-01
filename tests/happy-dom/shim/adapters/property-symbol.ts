// PropertySymbol constructor-signature adaptation (mad-dom hdunit T12).
//
// The vendored suite constructs facade classes in the upstream internal form
// `new X(PropertySymbol.illegalConstructor, owner, options)`. Per the T12
// boundary these constructions are adapted in the shim layer only — the facade
// body is never modified. This module is the single helper the hand-written
// wrapper shims (tests/happy-dom/shim/src/**) use to:
//
//   - recognize the `PropertySymbol.illegalConstructor` marker;
//   - convert a facade element wrapper back to the opaque native node handle the
//     facade constructors require (the reverse of `ctx.wrap`);
//   - throw the upstream "Illegal constructor" TypeError for classes upstream
//     only allows to be constructed internally.
//
// It implements **no DOM behavior** (T12 boundary): the keys are symbol values
// and this module only performs name/signature alignment. Symbol-keyed state
// access on a facade instance is a per-file triage decision, never implemented
// here.
import * as PropertySymbol from "../src/PropertySymbol.js";
import { nodeHandleOf } from "../../../../js/facade/extensions/classes.js";

export { PropertySymbol };

/**
 * The upstream marker for "construct me through the internal path".
 * Reference-equal to `(await import('…/src/PropertySymbol.js')).illegalConstructor`.
 */
export const illegalConstructor = PropertySymbol.illegalConstructor;

/**
 * The opaque native node handle behind a facade node wrapper, or `null` when
 * the value is not a genuine facade node. Facade constructors (e.g.
 * `CSSStyleDeclaration`) require the native handle, never the wrapper.
 */
export function nativeHandleOf(wrapper) {
  return nodeHandleOf(wrapper) ?? null;
}

/**
 * Throws the upstream "Illegal constructor" TypeError for a class that happy-dom
 * only allows to be constructed internally.
 */
export function throwIllegalConstructor() {
  throw new TypeError("Illegal constructor");
}

/**
 * Interprets `new X(PropertySymbol.illegalConstructor, owner, options)` against
 * the upstream internal constructor shape. When the first argument is not the
 * marker, returns `{ adapted: false, options: null }` so the wrapper can apply
 * its own legal-construction logic (or throw "Illegal constructor").
 */
export function adaptIllegalConstructor(args) {
  if (args[0] !== illegalConstructor) {
    return { adapted: false, options: null };
  }
  const options = args[2];
  return {
    adapted: true,
    options: options !== null && typeof options === "object" ? options : {},
  };
}
