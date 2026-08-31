// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/dom/DOMRectList.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'bun:test';
import DOMRectList from '../../src/dom/DOMRectList.js';
import * as PropertySymbol from '../../shim/src/PropertySymbol.js';
import DOMRect from '../../shim/src/dom/DOMRect.js';

describe('DOMRectList', () => {
	describe('constructor()', () => {
		it('Returns an instance of DOMRectList.', () => {
			const list = new DOMRectList(PropertySymbol.illegalConstructor);
			expect(list).toBeInstanceOf(DOMRectList);
		});

		it('Returns an instance of Array.', () => {
			const list = new DOMRectList(PropertySymbol.illegalConstructor);
			expect(list).toBeInstanceOf(Array);
		});

		it('Throws an error if the constructor is called without the illegalConstructorSymbol.', () => {
			expect(() => {
				new DOMRectList();
			}).toThrow(new TypeError('Illegal constructor'));
		});
	});

	describe('item()', () => {
		it('Returns item by index.', () => {
			const list = new DOMRectList(PropertySymbol.illegalConstructor);
			const rect1 = new DOMRect();
			const rect2 = new DOMRect();
			list.push(rect1);
			list.push(rect2);
			expect(list.item(0)).toBe(rect1);
			expect(list.item(1)).toBe(rect2);
		});

		it('Returns null if the index is out of bounds.', () => {
			const list = new DOMRectList(PropertySymbol.illegalConstructor);
			expect(list.item(0)).toBe(null);
		});
	});
});
