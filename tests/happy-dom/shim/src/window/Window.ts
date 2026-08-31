// ─────────────────────────────────────────────────────────────────────────────
// HDUNIT SHIM — generated file, do not edit by hand.
// Generator: scripts/generate-happy-dom-shim.mjs (mad-dom hdunit T04)
// Upstream:  happy-dom v20.11.11 @ 64e2c774cadbb8eda5416c1e2bcca5006d1b5df9 (MIT), src/window/Window.js
// Kind:      package — facade public export
// Rule:      re-export + constructor adaptation ONLY. No DOM behavior is
//            implemented in this shim (see tests/happy-dom/shim/README.md).
// Constructor-signature adaptation: the shim class is the facade `Window`
// (reference-equal). happy-dom `{ settings: { enableJavaScriptEvaluation, … } }`
// is accepted by the facade constructor (settings are recorded, not silently
// dropped). `adaptWindowSettings` maps the settings surface and reports the
// unmappable toggles as warnings.
// ─────────────────────────────────────────────────────────────────────────────
export { Window as default } from "mad-dom";
export { adaptWindowSettings } from "../../adapters/window-settings.ts";
