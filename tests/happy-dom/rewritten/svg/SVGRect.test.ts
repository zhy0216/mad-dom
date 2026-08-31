// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGRect.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { beforeEach, describe, it, expect } from 'bun:test';
import type BrowserWindow from '../../shim/src/window/BrowserWindow.js';
import Window from '../../shim/src/window/Window.js';
import * as PropertySymbol from '../../shim/src/PropertySymbol.js';
import SVGRect from '../../src/svg/SVGRect.js';

describe('SVGRect', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Returns a new instance', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			expect(number).toBeInstanceOf(SVGRect);
		});

		it('Throws an error if constructed without "illegalConstructor" symbol', () => {
			expect(() => new window.SVGRect(Symbol(''), window)).toThrow(
				new TypeError('Illegal constructor')
			);
		});
	});

	describe('get x()', () => {
		it('Returns 0 by default', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			expect(number.x).toBe(0);
		});

		it('Returns value from attribute', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '1.1 2.2 10.1 20.2'
			});
			expect(number.x).toBe(1.1);
		});

		it('Returns defined value', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			number.x = 100;
			expect(number.x).toBe(100);
			expect(number[PropertySymbol.attributeValue]).toBe('100 0 0 0');
		});
	});

	describe('set x()', () => {
		it('Sets value to attribute', () => {
			let attribute = '1.1 2.2 10.1 20.2';
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});
			number.x = 100;
			expect(attribute).toBe('100 2.2 10.1 20.2');
		});
	});

	describe('get y()', () => {
		it('Returns 0 by default', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			expect(number.y).toBe(0);
		});

		it('Returns value from attribute', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '1.1 2.2 10.1 20.2'
			});
			expect(number.y).toBe(2.2);
		});

		it('Returns defined value', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			number.y = 100;
			expect(number.y).toBe(100);
			expect(number[PropertySymbol.attributeValue]).toBe('0 100 0 0');
		});
	});

	describe('set y()', () => {
		it('Sets value to attribute', () => {
			let attribute = '1.1 2.2 10.1 20.2';
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});
			number.y = 100;
			expect(attribute).toBe('1.1 100 10.1 20.2');
		});
	});

	describe('get width()', () => {
		it('Returns 0 by default', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			expect(number.width).toBe(0);
		});

		it('Returns value from attribute', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '1.1 2.2 10.1 20.2'
			});
			expect(number.width).toBe(10.1);
		});

		it('Returns defined value', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			number.width = 100;
			expect(number.width).toBe(100);
			expect(number[PropertySymbol.attributeValue]).toBe('0 0 100 0');
		});
	});

	describe('set width()', () => {
		it('Sets value to attribute', () => {
			let attribute = '1.1 2.2 10.1 20.2';
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});
			number.width = 100;
			expect(attribute).toBe('1.1 2.2 100 20.2');
		});
	});

	describe('get height()', () => {
		it('Returns 0 by default', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			expect(number.height).toBe(0);
		});

		it('Returns value from attribute', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '1.1 2.2 10.1 20.2'
			});
			expect(number.height).toBe(20.2);
		});

		it('Returns defined value', () => {
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window);
			number.height = 100;
			expect(number.height).toBe(100);
			expect(number[PropertySymbol.attributeValue]).toBe('0 0 0 100');
		});
	});

	describe('set height()', () => {
		it('Sets value to attribute', () => {
			let attribute = '1.1 2.2 10.1 20.2';
			const number = new window.SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});
			number.height = 100;
			expect(attribute).toBe('1.1 2.2 10.1 100');
		});
	});
});
