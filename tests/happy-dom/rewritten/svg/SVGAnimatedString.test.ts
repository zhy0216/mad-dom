// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedString.test.ts
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
import SVGAnimatedString from '../../src/svg/SVGAnimatedString.js';

describe('SVGAnimatedString', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Returns a new instance', () => {
			const animated = new window.SVGAnimatedString(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '',
				setAttribute: () => {}
			});
			expect(animated).toBeInstanceOf(SVGAnimatedString);
		});

		it('Throws an error if constructed without "illegalConstructor" symbol', () => {
			expect(
				() =>
					new window.SVGAnimatedString(Symbol(''), window, {
						getAttribute: () => '',
						setAttribute: () => {}
					})
			).toThrow(new TypeError('Illegal constructor'));
		});
	});

	describe('get animVal()', () => {
		it('Returns empty string by default', () => {
			const animated = new window.SVGAnimatedString(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => null,
				setAttribute: () => {}
			});

			expect(animated.animVal).toBe('');
		});

		it('Returns string value', () => {
			const animated = new window.SVGAnimatedString(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'test',
				setAttribute: () => {}
			});

			expect(animated.animVal).toBe('test');
		});
	});

	describe('set animVal()', () => {
		it('Do nothing', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedString(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			animated.animVal = 'test';
			expect(attributeValue).toBe('');
		});
	});

	describe('get baseVal()', () => {
		it('Returns empty string by default', () => {
			const animated = new window.SVGAnimatedString(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => null,
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBe('');
		});

		it('Returns string value', () => {
			const animated = new window.SVGAnimatedString(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'test',
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBe('test');
		});
	});

	describe('set baseVal()', () => {
		it('Sets attribute', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedString(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			animated.baseVal = 'test';

			expect(attributeValue).toBe('test');
		});

		it('Converts value to string', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedString(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			animated.baseVal = <string>(<unknown>null);

			expect(attributeValue).toBe('null');
		});
	});
});
