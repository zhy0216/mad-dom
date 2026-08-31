// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/utilities/StringUtility.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'bun:test';
import StringUtility from '../../src/utilities/StringUtility';

describe('StringUtility', () => {
	describe('asciiLowerCase()', () => {
		it('converts uppercase ASCII characters to lowercase.', () => {
			expect(StringUtility.asciiLowerCase('HELLO')).toBe('hello');
		});

		it('returns the same string if it is already lowercase.', () => {
			expect(StringUtility.asciiLowerCase('hello')).toBe('hello');
		});

		it('converts mixed case ASCII characters to lowercase.', () => {
			expect(StringUtility.asciiLowerCase('HeLlO')).toBe('hello');
		});

		it('leaves non-ASCII characters unchanged.', () => {
			expect(StringUtility.asciiLowerCase('HéLLÖ')).toBe('héllÖ');
		});

		it('handles empty strings.', () => {
			expect(StringUtility.asciiLowerCase('')).toBe('');
		});

		it('leaves numbers and symbols unchanged.', () => {
			expect(StringUtility.asciiLowerCase('H3LL0!@#')).toBe('h3ll0!@#');
		});
	});

	describe('asciiUpperCase()', () => {
		it('converts lowercase ASCII characters to uppercase.', () => {
			expect(StringUtility.asciiUpperCase('hello')).toBe('HELLO');
		});

		it('returns the same string if it is already uppercase.', () => {
			expect(StringUtility.asciiUpperCase('HELLO')).toBe('HELLO');
		});

		it('converts mixed case ASCII characters to uppercase.', () => {
			expect(StringUtility.asciiUpperCase('HeLlO')).toBe('HELLO');
		});

		it('leaves non-ASCII characters unchanged.', () => {
			expect(StringUtility.asciiUpperCase('hélLö')).toBe('HéLLö');
		});

		it('handles empty strings.', () => {
			expect(StringUtility.asciiUpperCase('')).toBe('');
		});

		it('leaves numbers and symbols unchanged.', () => {
			expect(StringUtility.asciiUpperCase('h3ll0!@#')).toBe('H3LL0!@#');
		});
	});
});
