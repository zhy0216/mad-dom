// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGAnimatedBoolean.test.ts
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
import SVGAnimatedBoolean from '../../src/svg/SVGAnimatedBoolean.js';

describe('SVGAnimatedBoolean', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Returns a new instance', () => {
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '',
				setAttribute: () => {}
			});
			expect(animated).toBeInstanceOf(SVGAnimatedBoolean);
		});

		it('Throws an error if constructed without "illegalConstructor" symbol', () => {
			expect(
				() =>
					new window.SVGAnimatedBoolean(Symbol(''), window, {
						getAttribute: () => '',
						setAttribute: () => {}
					})
			).toThrow(new TypeError('Illegal constructor'));
		});
	});

	describe('get animVal()', () => {
		it('Returns true if attribute is set to "true', () => {
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'true',
				setAttribute: () => {}
			});

			expect(animated.animVal).toBe(true);
		});

		it('Returns false if attribute is set to "false"', () => {
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'false',
				setAttribute: () => {}
			});

			expect(animated.animVal).toBe(false);
		});

		it('Returns false if attribute is set to null', () => {
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => null,
				setAttribute: () => {}
			});

			expect(animated.animVal).toBe(false);
		});
	});

	describe('set animVal()', () => {
		it('Do nothing', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			animated.animVal = false;
			expect(attributeValue).toBe('');
		});
	});

	describe('get baseVal()', () => {
		it('Returns true if attribute is set to "true', () => {
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'true',
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBe(true);
		});

		it('Returns false if attribute is set to "false"', () => {
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'false',
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBe(false);
		});

		it('Returns false if attribute is set to null', () => {
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => null,
				setAttribute: () => {}
			});

			expect(animated.baseVal).toBe(false);
		});
	});

	describe('set baseVal()', () => {
		it('Sets attribute to empty string if true', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			animated.baseVal = true;
			expect(attributeValue).toBe('true');
		});

		it('Sets attribute to null if false', () => {
			let attributeValue = '';
			const animated = new window.SVGAnimatedBoolean(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attributeValue,
				setAttribute: (value) => (attributeValue = value)
			});

			animated.baseVal = false;
			expect(attributeValue).toBe('false');
		});
	});
});
