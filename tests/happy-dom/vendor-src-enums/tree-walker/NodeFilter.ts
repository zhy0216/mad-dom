// ─────────────────────────────────────────────────────────────────────────────
// VENDORED SOURCE — happy-dom (MIT)
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/src/tree-walker/NodeFilter.ts
// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)
//
// Pure enum/constant module vendored from the locked happy-dom test-suite
// baseline. It is runtime-independent (literal exports only, no DOM or
// runtime module dependencies) and is provided to the shim layer (T04) as-is.
// Do not edit by hand; regenerate with the vendor script.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export default {
	FILTER_ACCEPT: 1,
	FILTER_REJECT: 2,
	FILTER_SKIP: 3,
	SHOW_ALL: -1,
	SHOW_ELEMENT: 1,
	SHOW_ATTRIBUTE: 2,
	SHOW_TEXT: 4,
	SHOW_CDATA_SECTION: 8,
	SHOW_ENTITY_REFERENCE: 16,
	SHOW_ENTITY: 32,
	SHOW_PROCESSING_INSTRUCTION: 64,
	SHOW_COMMENT: 128,
	SHOW_DOCUMENT: 256,
	SHOW_DOCUMENT_TYPE: 512,
	SHOW_DOCUMENT_FRAGMENT: 1024,
	SHOW_NOTATION: 2048
};
