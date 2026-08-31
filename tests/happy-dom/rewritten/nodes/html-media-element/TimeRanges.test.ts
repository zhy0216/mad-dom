// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-media-element/TimeRanges.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'bun:test';
import TimeRanges from '../../../src/nodes/html-media-element/TimeRanges.js';
import * as PropertySymbol from '../../../shim/src/PropertySymbol.js';

describe('TimeRanges', () => {
	describe('constructor()', () => {
		it('Should throw an error if the "illegalConstructor" symbol is not sent to the constructor', () => {
			expect(() => new TimeRanges()).toThrow(new TypeError('Illegal constructor'));
		});

		it('Should not throw an error if the "illegalConstructor" symbol is provided', () => {
			expect(() => new TimeRanges(PropertySymbol.illegalConstructor)).not.toThrow();
		});
	});

	describe('get length()', () => {
		it('Should return 0 by default', () => {
			const timeRanges = new TimeRanges(PropertySymbol.illegalConstructor);
			expect(timeRanges.length).toBe(0);
		});
	});

	describe('get [Symbol.toStringTag]()', () => {
		it('Should return "TimeRanges"', () => {
			const timeRanges = new TimeRanges(PropertySymbol.illegalConstructor);
			expect(timeRanges[Symbol.toStringTag]).toBe('TimeRanges');
		});
	});

	describe('toLocaleString()', () => {
		it('Should return "[object TimeRanges]"', () => {
			const timeRanges = new TimeRanges(PropertySymbol.illegalConstructor);
			expect(timeRanges.toLocaleString()).toBe('[object TimeRanges]');
		});
	});

	describe('toString()', () => {
		it('Should return "[object TimeRanges]"', () => {
			const timeRanges = new TimeRanges(PropertySymbol.illegalConstructor);
			expect(timeRanges.toString()).toBe('[object TimeRanges]');
		});
	});

	describe('start()', () => {
		it('Should return "0" by default', () => {
			const timeRanges = new TimeRanges(PropertySymbol.illegalConstructor);
			expect(timeRanges.start(0)).toBe(0);
		});
	});

	describe('end()', () => {
		it('Should return "0" by default', () => {
			const timeRanges = new TimeRanges(PropertySymbol.illegalConstructor);
			expect(timeRanges.end(0)).toBe(0);
		});
	});
});
