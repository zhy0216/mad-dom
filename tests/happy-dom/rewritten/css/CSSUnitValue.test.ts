// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/CSSUnitValue.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import CSSUnitValue from '../../src/css/CSSUnitValue.js';
import { describe, it, expect } from 'bun:test';

describe('CSSUnitValue', () => {
	describe('constructor()', () => {
		it('Creates an instance of CSSUnitValue.', () => {
			const cssUnitValue = new CSSUnitValue(5, 'cm');
			expect(cssUnitValue.unit).toBe('cm');
			expect(cssUnitValue.value).toBe(5);
		});

		it('Throws exception when invalid unit.', () => {
			expect(() => new CSSUnitValue(5, 'invalid')).toThrow(new TypeError('Invalid unit: invalid'));
		});
	});
});
