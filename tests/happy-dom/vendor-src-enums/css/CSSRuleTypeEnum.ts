// ─────────────────────────────────────────────────────────────────────────────
// VENDORED SOURCE — happy-dom (MIT)
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/src/css/CSSRuleTypeEnum.ts
// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)
//
// Pure enum/constant module vendored from the locked happy-dom test-suite
// baseline. It is runtime-independent (literal exports only, no DOM or
// runtime module dependencies) and is provided to the shim layer (T04) as-is.
// Do not edit by hand; regenerate with the vendor script.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
enum CSSRuleTypeEnum {
	containerRule = 0,
	styleRule = 1,
	importRule = 3,
	mediaRule = 4,
	fontFaceRule = 5,
	pageRule = 6,
	keyframesRule = 7,
	keyframeRule = 8,
	namespaceRule = 10,
	counterStyleRule = 11,
	supportsRule = 12,
	documentRule = 13,
	fontFeatureValuesRule = 14,
	regionStyleRule = 16
}

export default CSSRuleTypeEnum;
