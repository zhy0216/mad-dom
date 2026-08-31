// ─────────────────────────────────────────────────────────────────────────────
// VENDORED SOURCE — happy-dom (MIT)
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/src/browser/enums/BrowserNavigationCrossOriginPolicyEnum.ts
// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)
//
// Pure enum/constant module vendored from the locked happy-dom test-suite
// baseline. It is runtime-independent (literal exports only, no DOM or
// runtime module dependencies) and is provided to the shim layer (T04) as-is.
// Do not edit by hand; regenerate with the vendor script.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
enum BrowserNavigationCrossOriginPolicyEnum {
	/** The browser can navigate to any origin. */
	anyOrigin = 'anyOrigin',
	/** The browser can only navigate to the same origin as the current page or its parent. */
	sameOrigin = 'sameOrigin',
	/** The browser can never navigate from a secure protocol (https) to an unsecure protocol (http), but it can always navigate to a secure (https). */
	strictOrigin = 'strictOrigin'
}

export default BrowserNavigationCrossOriginPolicyEnum;
