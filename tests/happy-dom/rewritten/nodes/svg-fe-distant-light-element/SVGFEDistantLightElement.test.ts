// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-fe-distant-light-element/SVGFEDistantLightElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import SVGFEDistantLightElement from '../../../src/nodes/svg-fe-distant-light-element/SVGFEDistantLightElement.js';
import SVGLength from '../../../src/svg/SVGLength.js';
import SVGElement from '../../../shim/src/nodes/svg-element/SVGElement.js';

describe('SVGFEDistantLightElement', () => {
	let window: Window;
	let document: Document;
	let element: SVGFEDistantLightElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElementNS('http://www.w3.org/2000/svg', 'feDistantLight');
	});

	describe('constructor()', () => {
		it('Should be an instanceof SVGFEDistantLightElement', () => {
			expect(element instanceof SVGFEDistantLightElement).toBe(true);
		});

		it('Should be an instanceof SVGElement', () => {
			expect(element instanceof SVGElement).toBe(true);
		});
	});

	describe('get azimuth()', () => {
		it('Should return an instance of SVGAnimatedNumber', () => {
			const azimuth = element.azimuth;
			expect(azimuth).toBeInstanceOf(window.SVGAnimatedNumber);
			expect(element.azimuth).toBe(azimuth);
		});

		it('Reflects the "azimuth" attribute', () => {
			element.setAttribute('azimuth', '10');

			expect(element.azimuth.baseVal).toBe(10);
			expect(element.azimuth.animVal).toBe(10);

			element.azimuth.baseVal = 20;

			expect(element.getAttribute('azimuth')).toBe('20');

			// Does nothing
			element.azimuth.animVal = 30;

			expect(element.getAttribute('azimuth')).toBe('20');
		});
	});

	describe('get elevation()', () => {
		it('Should return an instance of SVGAnimatedNumber', () => {
			const elevation = element.elevation;
			expect(elevation).toBeInstanceOf(window.SVGAnimatedNumber);
			expect(element.elevation).toBe(elevation);
		});

		it('Reflects the "elevation" attribute', () => {
			element.setAttribute('elevation', '10');

			expect(element.elevation.baseVal).toBe(10);
			expect(element.elevation.animVal).toBe(10);

			element.elevation.baseVal = 20;

			expect(element.getAttribute('elevation')).toBe('20');

			// Does nothing
			element.elevation.animVal = 30;

			expect(element.getAttribute('elevation')).toBe('20');
		});
	});
});
