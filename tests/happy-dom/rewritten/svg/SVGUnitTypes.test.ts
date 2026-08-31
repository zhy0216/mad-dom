// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGUnitTypes.test.ts
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
import SVGUnitTypes from '../../src/svg/SVGUnitTypes.js';

describe('SVGUnitTypes', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Returns a new instance', () => {
			const unitTypes = new window.SVGUnitTypes(PropertySymbol.illegalConstructor);
			expect(unitTypes).toBeInstanceOf(SVGUnitTypes);
		});

		it('Throws an error if constructed without "illegalConstructor" symbol', () => {
			expect(() => new window.SVGUnitTypes(Symbol(''))).toThrow(
				new TypeError('Illegal constructor')
			);
		});
	});

	describe('get static SVG_UNIT_TYPE_UNKNOWN()', () => {
		it('Should return 0', () => {
			expect(SVGUnitTypes.SVG_UNIT_TYPE_UNKNOWN).toBe(0);
		});
	});

	describe('get static SVG_UNIT_TYPE_USERSPACEONUSE()', () => {
		it('Should return 1', () => {
			expect(SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE).toBe(1);
		});
	});

	describe('get static SVG_UNIT_TYPE_OBJECTBOUNDINGBOX()', () => {
		it('Should return 2', () => {
			expect(SVGUnitTypes.SVG_UNIT_TYPE_OBJECTBOUNDINGBOX).toBe(2);
		});
	});

	describe('get SVG_UNIT_TYPE_UNKNOWN()', () => {
		it('Should return 0', () => {
			const unitTypes = new window.SVGUnitTypes(PropertySymbol.illegalConstructor);
			expect(unitTypes.SVG_UNIT_TYPE_UNKNOWN).toBe(0);
		});
	});

	describe('get SVG_UNIT_TYPE_USERSPACEONUSE()', () => {
		it('Should return 1', () => {
			const unitTypes = new window.SVGUnitTypes(PropertySymbol.illegalConstructor);
			expect(unitTypes.SVG_UNIT_TYPE_USERSPACEONUSE).toBe(1);
		});
	});

	describe('get SVG_UNIT_TYPE_OBJECTBOUNDINGBOX()', () => {
		it('Should return 2', () => {
			const unitTypes = new window.SVGUnitTypes(PropertySymbol.illegalConstructor);
			expect(unitTypes.SVG_UNIT_TYPE_OBJECTBOUNDINGBOX).toBe(2);
		});
	});
});
