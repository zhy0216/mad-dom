// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/CSS.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import CSS from '../../src/css/CSS.js';
import CSSUnits from '../../src/css/CSSUnits.js';
import type CSSUnitValue from '../../src/css/CSSUnitValue.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('CSS', () => {
	let css: CSS;

	beforeEach(() => {
		css = new CSS();
	});

	for (const property of CSSUnits) {
		describe(`${property}()`, () => {
			it('Returns an instance of CSSUnitValue.', () => {
				const cssUnitValue: CSSUnitValue = css[property](100);
				expect(cssUnitValue.unit).toBe(property);
				expect(cssUnitValue.value).toBe(100);
			});
		});
	}

	describe('supports()', () => {
		it('Always returns "true".', () => {
			expect(css.supports('condition')).toBe(true);
			expect(css.supports('property', 'value')).toBe(true);
		});
	});

	describe('escape()', () => {
		it('Escapes a value.', () => {
			expect(css.escape('.foo#bar')).toBe('\\.foo\\#bar');
			expect(css.escape('()[]{}')).toBe('\\(\\)\\[\\]\\{\\}');
			expect(css.escape('--a')).toBe('--a');
			expect(css.escape('0')).toBe('\\30 ');
			expect(css.escape('\0')).toBe('\ufffd');
		});
	});
});
