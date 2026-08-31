// ─────────────────────────────────────────────────────────────────────────────
// VENDORED SOURCE — happy-dom (MIT)
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/src/browser/enums/BrowserErrorCaptureEnum.ts
// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)
//
// Pure enum/constant module vendored from the locked happy-dom test-suite
// baseline. It is runtime-independent (literal exports only, no DOM or
// runtime module dependencies) and is provided to the shim layer (T04) as-is.
// Do not edit by hand; regenerate with the vendor script.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
enum BrowserErrorCaptureEnum {
	/** Happy DOM use try and catch when evaluating code, but will not be able to catch all errors and Promise rejections. This will decrease performance as using try and catch makes the execution significally slower. This is the default setting. */
	tryAndCatch = 'tryAndCatch',
	/** Happy DOM will add an event listener to the Node.js process to catch all errors and Promise rejections. This will not work in Jest and Vitest as it conflicts with their error listeners. */
	processLevel = 'processLevel',
	/** Error capturing is disabled. Errors and Promise rejections will be thrown. */
	disabled = 'disabled'
}

export default BrowserErrorCaptureEnum;
