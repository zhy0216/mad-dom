// ─────────────────────────────────────────────────────────────────────────────
// VENDORED SOURCE — happy-dom (MIT)
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/src/nodes/node/NodeDocumentPositionEnum.ts
// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)
//
// Pure enum/constant module vendored from the locked happy-dom test-suite
// baseline. It is runtime-independent (literal exports only, no DOM or
// runtime module dependencies) and is provided to the shim layer (T04) as-is.
// Do not edit by hand; regenerate with the vendor script.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
enum NodeDocumentPositionEnum {
	disconnect = 0x01,
	preceding = 0x02,
	following = 0x04,
	contains = 0x08,
	containedBy = 0x10,
	implementationSpecific = 0x20
}

export default NodeDocumentPositionEnum;
