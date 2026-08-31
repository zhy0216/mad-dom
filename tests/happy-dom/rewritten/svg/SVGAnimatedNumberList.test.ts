// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedNumberList.test.ts
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
import SVGAnimatedNumberList from '../../src/svg/SVGAnimatedNumberList.js';
import SVGNumberList from '../../src/svg/SVGNumberList.js';

describe('SVGAnimatedNumberList', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Returns a new instance', () => {
			const animated = new window.SVGAnimatedNumberList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '',
				setAttribute: () => {}
			});
			expect(animated).toBeInstanceOf(SVGAnimatedNumberList);
		});

		it('Throws an error if constructed without "illegalConstructor" symbol', () => {
			expect(
				() =>
					new window.SVGAnimatedNumberList(Symbol(''), window, {
						getAttribute: () => '',
						setAttribute: () => {}
					})
			).toThrow(new TypeError('Illegal constructor'));
		});
	});

	describe('get animVal()', () => {
		it('Returns an instance of SVGNumberList', () => {
			const animated = new window.SVGAnimatedNumberList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '100.5 200.5',
				setAttribute: () => {}
			});

			expect(animated.animVal).toBeInstanceOf(SVGNumberList);
			expect(animated.animVal[0].value).toBe(100.5);
			expect(animated.animVal[1].value).toBe(200.5);
		});
	});

	describe('set animVal()', () => {
		it('Do nothing', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedNumberList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			expect(attributeValue).toBe('');
			const list = animated.animVal;
			animated.animVal = new SVGNumberList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '100.5 200.5',
				setAttribute: () => {}
			});
			expect(animated.animVal).toBe(list);
			animated.animVal = <SVGNumberList>(<unknown>'100.5 200.5');
			expect(attributeValue).toBe('');
		});
	});

	describe('get baseVal()', () => {
		it('Returns an instance of SVGNumberList', () => {
			const animated = new window.SVGAnimatedNumberList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '100.5 200.5',
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBeInstanceOf(SVGNumberList);
			expect(animated.baseVal[0].value).toBe(100.5);
			expect(animated.baseVal[1].value).toBe(200.5);
		});
	});

	describe('set baseVal()', () => {
		it('Do nothing', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedNumberList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			expect(attributeValue).toBe('');
			const list = animated.baseVal;
			animated.baseVal = new SVGNumberList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '100.5 200.5',
				setAttribute: () => {}
			});
			expect(animated.baseVal).toBe(list);
			animated.baseVal = <SVGNumberList>(<unknown>'100.5 200.5');
			expect(attributeValue).toBe('');
		});
	});
});
