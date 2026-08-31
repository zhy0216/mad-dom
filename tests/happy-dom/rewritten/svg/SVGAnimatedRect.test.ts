// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedRect.test.ts
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
import SVGAnimatedRect from '../../src/svg/SVGAnimatedRect.js';
import SVGRect from '../../src/svg/SVGRect.js';

describe('SVGAnimatedRect', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Returns a new instance', () => {
			const animated = new window.SVGAnimatedRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '',
				setAttribute: () => {}
			});
			expect(animated).toBeInstanceOf(SVGAnimatedRect);
		});

		it('Throws an error if constructed without "illegalConstructor" symbol', () => {
			expect(
				() =>
					new window.SVGAnimatedRect(Symbol(''), window, {
						getAttribute: () => '',
						setAttribute: () => {}
					})
			).toThrow(new TypeError('Illegal constructor'));
		});
	});

	describe('get animVal()', () => {
		it('Returns an instance of SVGRect', () => {
			const animated = new window.SVGAnimatedRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '10 20 100 200',
				setAttribute: () => {}
			});

			expect(animated.animVal).toBeInstanceOf(SVGRect);
			expect(animated.animVal.x).toBe(10);
			expect(animated.animVal.y).toBe(20);
			expect(animated.animVal.width).toBe(100);
			expect(animated.animVal.height).toBe(200);
		});
	});

	describe('set animVal()', () => {
		it('Do nothing', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			expect(attributeValue).toBe('');
			const rect = animated.animVal;
			animated.animVal = new SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '10 20 100 200',
				setAttribute: () => {}
			});
			expect(animated.animVal).toBe(rect);
			animated.animVal = <SVGRect>(<unknown>'10 20 100 200');
			expect(attributeValue).toBe('');
		});
	});

	describe('get baseVal()', () => {
		it('Returns an instance of SVGRect', () => {
			const animated = new window.SVGAnimatedRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '10 20 100 200',
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBeInstanceOf(SVGRect);
			expect(animated.baseVal.x).toBe(10);
			expect(animated.baseVal.y).toBe(20);
			expect(animated.baseVal.width).toBe(100);
			expect(animated.baseVal.height).toBe(200);
		});
	});

	describe('set baseVal()', () => {
		it('Do nothing', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			expect(attributeValue).toBe('');
			const rect = animated.baseVal;
			animated.baseVal = new SVGRect(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '10 20 100 200',
				setAttribute: () => {}
			});
			expect(animated.baseVal).toBe(rect);
			animated.baseVal = <SVGRect>(<unknown>'10 20 100 200');
			expect(attributeValue).toBe('');
		});
	});
});
