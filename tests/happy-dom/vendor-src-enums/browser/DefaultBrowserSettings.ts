// ─────────────────────────────────────────────────────────────────────────────
// VENDORED SOURCE — happy-dom (MIT)
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/src/browser/DefaultBrowserSettings.ts
// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)
//
// Pure enum/constant module vendored from the locked happy-dom test-suite
// baseline. It is runtime-independent (literal exports only, no DOM or
// runtime module dependencies) and is provided to the shim layer (T04) as-is.
// Do not edit by hand; regenerate with the vendor script.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import PackageVersion from '../version.js';
import BrowserErrorCaptureEnum from './enums/BrowserErrorCaptureEnum.js';
import BrowserNavigationCrossOriginPolicyEnum from './enums/BrowserNavigationCrossOriginPolicyEnum.js';
import type IBrowserSettings from './types/IBrowserSettings.js';

export default <IBrowserSettings>{
	disableJavaScriptEvaluation: false,
	enableJavaScriptEvaluation: false,
	disableJavaScriptFileLoading: false,
	disableCSSFileLoading: false,
	enableImageFileLoading: false,
	disableIframePageLoading: false,
	disableComputedStyleRendering: false,
	handleDisabledFileLoadingAsSuccess: false,
	disableErrorCapturing: false,
	errorCapture: BrowserErrorCaptureEnum.tryAndCatch,
	enableFileSystemHttpRequests: false,
	suppressCodeGenerationFromStringsWarning: false,
	suppressInsecureJavaScriptEnvironmentWarning: false,
	timer: {
		maxTimeout: -1,
		maxIntervalTime: -1,
		maxIntervalIterations: -1,
		preventTimerLoops: false
	},
	fetch: {
		disableSameOriginPolicy: false,
		disableStrictSSL: false,
		interceptor: null,
		requestHeaders: null,
		virtualServers: null
	},
	module: {
		resolveNodeModules: null,
		urlResolver: null,
		disableCache: false
	},
	navigation: {
		disableMainFrameNavigation: false,
		disableChildFrameNavigation: false,
		disableChildPageNavigation: false,
		disableFallbackToSetURL: false,
		crossOriginPolicy: BrowserNavigationCrossOriginPolicyEnum.anyOrigin,
		beforeContentCallback: null
	},
	navigator: {
		userAgent: `Mozilla/5.0 (X11; ${
			process.platform.charAt(0).toUpperCase() + process.platform.slice(1) + ' ' + process.arch
		}) AppleWebKit/537.36 (KHTML, like Gecko) HappyDOM/${PackageVersion.version}`,
		maxTouchPoints: 0
	},
	device: {
		prefersColorScheme: 'light',
		prefersReducedMotion: 'no-preference',
		mediaType: 'screen',
		forcedColors: 'none'
	},
	debug: {
		traceWaitUntilComplete: -1
	},
	viewport: {
		width: 1024,
		height: 768,
		devicePixelRatio: 1
	},
	canvasAdapter: null
};
