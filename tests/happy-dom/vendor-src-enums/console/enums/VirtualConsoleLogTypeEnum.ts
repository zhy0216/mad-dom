// ─────────────────────────────────────────────────────────────────────────────
// VENDORED SOURCE — happy-dom (MIT)
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/src/console/enums/VirtualConsoleLogTypeEnum.ts
// Source:            scripts/vendor-happy-dom-tests.mjs (hdunit T01)
//
// Pure enum/constant module vendored from the locked happy-dom test-suite
// baseline. It is runtime-independent (literal exports only, no DOM or
// runtime module dependencies) and is provided to the shim layer (T04) as-is.
// Do not edit by hand; regenerate with the vendor script.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Virtual console log type.
 */
enum VirtualConsoleLogTypeEnum {
	// Log
	log = 'log',
	table = 'table',
	trace = 'trace',
	dir = 'dir',
	dirxml = 'dirxml',
	group = 'group',
	groupCollapsed = 'groupCollapsed',
	debug = 'debug',
	timeLog = 'timeLog',

	// Info
	info = 'info',
	count = 'count',
	timeEnd = 'timeEnd',

	// Warning
	warn = 'warn',
	countReset = 'countReset',

	// Error
	error = 'error',
	assert = 'assert'
}
export default VirtualConsoleLogTypeEnum;
