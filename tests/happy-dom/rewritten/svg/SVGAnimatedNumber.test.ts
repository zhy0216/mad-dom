// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedNumber.test.ts
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
import SVGAnimatedNumber from '../../src/svg/SVGAnimatedNumber.js';

describe('SVGAnimatedNumber', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Returns a new instance', () => {
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '',
				setAttribute: () => {}
			});
			expect(animated).toBeInstanceOf(SVGAnimatedNumber);
		});

		it('Throws an error if constructed without "illegalConstructor" symbol', () => {
			expect(
				() =>
					new window.SVGAnimatedNumber(Symbol(''), window, {
						getAttribute: () => '',
						setAttribute: () => {}
					})
			).toThrow(new TypeError('Illegal constructor'));
		});
	});

	describe('get animVal()', () => {
		it('Returns 0 by default', () => {
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => null,
				setAttribute: () => {}
			});

			expect(animated.animVal).toBe(0);
		});

		it('Returns attribute value as number', () => {
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '100.5',
				setAttribute: () => {}
			});

			expect(animated.animVal).toBe(100.5);
		});

		it('Returns 0 if attribute value is not a number', () => {
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'abc',
				setAttribute: () => {}
			});

			expect(animated.animVal).toBe(0);
		});
	});

	describe('set animVal()', () => {
		it('Do nothing', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			animated.animVal = 100;
			expect(attributeValue).toBe('');
		});
	});

	describe('get baseVal()', () => {
		it('Returns 0 by default', () => {
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => null,
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBe(0);
		});

		it('Returns attribute value as number', () => {
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '100.5',
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBe(100.5);
		});

		it('Returns 0 if attribute value is not a number', () => {
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'abc',
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBe(0);
		});
	});

	describe('set baseVal()', () => {
		it('Sets attribute', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			animated.baseVal = 100.5;

			expect(attributeValue).toBe('100.5');
		});

		it('Throws an error if value is not a number', () => {
			const animated = new window.SVGAnimatedNumber(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '100',
				setAttribute: () => {}
			});

			expect(() => {
				animated.baseVal = <number>(<unknown>'abc');
			}).toThrow(
				new TypeError(
					`TypeError: Failed to set the 'baseVal' property on 'SVGAnimatedNumber': The provided float value is non-finite.`
				)
			);
		});
	});
});
