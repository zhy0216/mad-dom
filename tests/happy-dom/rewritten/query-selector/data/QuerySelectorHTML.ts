// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/query-selector/data/QuerySelectorHTML.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export default `
	<div class="class1 class2">
		<!-- Comment 1 !-->
		<h1>Heading1</h1>
		<!-- Comment 2 !-->
		<div class="class1 class2">
			<span class="class1 class2" attr1="value1" attr2="word1 word2" attr3="bracket[]bracket" type="hidden">Span1</span>
			<span class="class1 class2" attr1="value1">Span2</span>
			<span class="class1 class2" attr1="word1.word2">Span3</span>
		</div>
	</div>
	<div>
		<!-- Comment 1 !-->
		<h1>Heading1</h1>
		<!-- Comment 2 !-->
	</div>
`.trim();
