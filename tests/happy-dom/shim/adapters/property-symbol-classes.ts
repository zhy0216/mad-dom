// PropertySymbol constructor-adaptation wrapper classes (mad-dom hdunit T12).
//
// The vendored suite constructs facade classes in the upstream internal form
// `new X(PropertySymbol.illegalConstructor, owner, options)`. Upstream resolves
// this against the class's internal state; here the shim wrapper interprets the
// marker and forwards the remaining arguments to the facade class's genuine
// internal construction path. Per the T12 boundary this is **name/signature
// alignment only** — no DOM behavior is implemented in the shim. A class that
// upstream only allows internally is a wrapper whose non-marker construction
// throws `TypeError("Illegal constructor")`.
//
// Each wrapper subclasses the facade class and returns the facade instance, so
// every facade method/accessor works on the result and `instanceof <facade>`
// holds. The generated shim (`shim/src/<path>.ts`) re-exports the wrapper as
// its default export; see scripts/generate-happy-dom-shim.mjs
// (PROPERTY_SYMBOL_WRAPPED).
import { CSSStyleDeclaration as FacadeCSSStyleDeclaration } from "mad-dom";
import { StylePropertyMap as FacadeStylePropertyMap } from "../../../../js/facade/extensions/cssom.js";
import { StylePropertyMapReadOnly as FacadeStylePropertyMapReadOnly } from "../../../../js/facade/extensions/cssom.js";
import { adaptIllegalConstructor, illegalConstructor, nativeHandleOf, throwIllegalConstructor } from "./property-symbol.js";

/**
 * Wrapper for upstream `new CSSStyleDeclaration(PropertySymbol.illegalConstructor,
 * window, { element, computed, cssText })`. The facade's genuine internal
 * constructor takes `(nativeElementHandle, { computed, cssText })`; the wrapper
 * converts the facade `element` wrapper back to its native handle. Any other
 * construction is illegal (upstream throws "Illegal constructor").
 */
export class CSSStyleDeclaration extends FacadeCSSStyleDeclaration {
  constructor(...args) {
    const { adapted, options } = adaptIllegalConstructor(args);
    if (!adapted) throwIllegalConstructor();
    const element = options.element ?? null;
    super(element ? nativeHandleOf(element) : null, {
      computed: options.computed ?? false,
      cssText: typeof options.cssText === "string" ? options.cssText : null,
    });
  }
}

/**
 * Wrapper for upstream `new StylePropertyMapReadOnly(PropertySymbol.illegalConstructor,
 * styleDeclaration)`. The facade's internal constructor takes `(style)`; the
 * marker check lives here (upstream throws "Illegal constructor" otherwise).
 */
export class StylePropertyMapReadOnly extends FacadeStylePropertyMapReadOnly {
  constructor(...args) {
    if (args[0] !== illegalConstructor) throwIllegalConstructor();
    super(args[1]);
  }
}

/**
 * Wrapper for upstream `new StylePropertyMap(PropertySymbol.illegalConstructor,
 * styleDeclaration)`. Same marker adaptation as StylePropertyMapReadOnly.
 */
export class StylePropertyMap extends FacadeStylePropertyMap {
  constructor(...args) {
    if (args[0] !== illegalConstructor) throwIllegalConstructor();
    super(args[1]);
  }
}
