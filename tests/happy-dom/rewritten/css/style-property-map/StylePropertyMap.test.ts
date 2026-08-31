// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/style-property-map/StylePropertyMap.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'bun:test';
import * as PropertySymbol from '../../../shim/src/PropertySymbol.js';
import type BrowserWindow from '../../../shim/src/window/BrowserWindow.js';
import Window from '../../../shim/src/window/Window.js';
import StylePropertyMap from '../../../shim/src/css/style-property-map/StylePropertyMap.js';
import CSSStyleDeclaration from '../../../shim/src/css/declaration/CSSStyleDeclaration.js';

describe('StylePropertyMap', () => {
	let window: BrowserWindow;
	let styleDeclaration: CSSStyleDeclaration;

	beforeEach(() => {
		window = new Window();
		styleDeclaration = new CSSStyleDeclaration(PropertySymbol.illegalConstructor, window);
	});

	describe('constructor()', () => {
		it('Throws error for illegal constructor', () => {
			expect(() => {
				// @ts-expect-error
				new StylePropertyMap();
			}).toThrow('Illegal constructor');
		});
	});

	describe('append()', () => {
		it('Sets value', () => {
			const stylePropertyMap = new StylePropertyMap(
				PropertySymbol.illegalConstructor,
				styleDeclaration
			);

			stylePropertyMap.append('color', 'red');
			stylePropertyMap.append('z-index', '2');
			stylePropertyMap.append('width', '100px');
			stylePropertyMap.append('width', '100px');

			expect(stylePropertyMap.get('color').toString()).toBe('red');
			expect(stylePropertyMap.get('z-index').toString()).toBe('2');
			expect(stylePropertyMap.get('width') + '').toBe('100px');
		});
	});

	describe('delete()', () => {
		it('Deletes value', () => {
			const stylePropertyMap = new StylePropertyMap(
				PropertySymbol.illegalConstructor,
				styleDeclaration
			);

			stylePropertyMap.append('color', 'red');
			stylePropertyMap.append('z-index', '2');
			stylePropertyMap.append('width', '100px');
			stylePropertyMap.append('width', '100px');

			stylePropertyMap.delete('color');
			stylePropertyMap.delete('z-index');
			stylePropertyMap.delete('width');

			expect(stylePropertyMap.size).toBe(0);
		});
	});

	describe('set()', () => {
		it('Sets value', () => {
			const stylePropertyMap = new StylePropertyMap(
				PropertySymbol.illegalConstructor,
				styleDeclaration
			);

			stylePropertyMap.set('color', 'red');
			stylePropertyMap.set('z-index', '2');
			stylePropertyMap.set('width', '100px');
			stylePropertyMap.set('width', '100px');

			expect(stylePropertyMap.get('color').toString()).toBe('red');
			expect(stylePropertyMap.get('z-index').toString()).toBe('2');
			expect(stylePropertyMap.get('width') + '').toBe('100px');
		});
	});
});
