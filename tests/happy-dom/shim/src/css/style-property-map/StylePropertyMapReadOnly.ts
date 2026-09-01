// ─────────────────────────────────────────────────────────────────────────────
// HDUNIT SHIM — generated file, do not edit by hand.
// Generator: scripts/generate-happy-dom-shim.mjs (mad-dom hdunit T04)
// Upstream:  happy-dom v20.11.11 @ 64e2c774cadbb8eda5416c1e2bcca5006d1b5df9 (MIT), src/css/style-property-map/StylePropertyMapReadOnly.js
// Kind:      facade — facade internal class
// Rule:      re-export + constructor adaptation ONLY. No DOM behavior is
//            implemented in this shim (see tests/happy-dom/shim/README.md).
// T12 constructor-signature adaptation: the shim default is the hand-written
// wrapper (a facade subclass) that interprets the upstream
// `PropertySymbol.illegalConstructor` marker and forwards to the facade's
// genuine internal construction path — name/signature alignment only, no
// DOM behavior (see adapters/property-symbol-classes.ts).
// ─────────────────────────────────────────────────────────────────────────────
export { StylePropertyMapReadOnly as default } from "../../../adapters/property-symbol-classes.ts";
