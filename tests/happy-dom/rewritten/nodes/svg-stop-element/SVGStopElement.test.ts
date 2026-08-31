// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-stop-element/SVGStopElement.test.ts
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
import SVGStopElement from '../../../src/nodes/svg-stop-element/SVGStopElement.js';
import SVGElement from '../../../shim/src/nodes/svg-element/SVGElement.js';

describe('SVGStopElement', () => {
	let window: Window;
	let document: Document;
	let element: SVGStopElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
	});

	describe('constructor()', () => {
		it('Should be an instanceof SVGStopElement', () => {
			expect(element instanceof SVGStopElement).toBe(true);
		});

		it('Should be an instanceof SVGElement', () => {
			expect(element instanceof SVGElement).toBe(true);
		});
	});

	describe('get offset()', () => {
		it('Should return an instance of SVGAnimatedNumber', () => {
			const offset = element.offset;
			expect(offset).toBeInstanceOf(window.SVGAnimatedNumber);
			expect(element.offset).toBe(offset);
		});

		it('Returns 0 by default', () => {
			expect(element.offset.baseVal).toBe(0);
			expect(element.offset.animVal).toBe(0);
		});

		it('Reflects the "offset" attribute', () => {
			element.setAttribute('offset', '2.2');

			expect(element.offset.baseVal).toBe(2.2);
			expect(element.offset.animVal).toBe(2.2);

			element.offset.baseVal = 3.3;

			expect(element.getAttribute('offset')).toBe('3.3');

			// Should do nothing
			element.offset.animVal = 4;

			expect(element.getAttribute('offset')).toBe('3.3');
		});

		it('Should return default value if attribute value is not a number', () => {
			element.setAttribute('offset', 'test');
			expect(element.offset.baseVal).toBe(0);
			expect(element.offset.animVal).toBe(0);
		});

		it('Should throw an error if setting a value that is not a number', () => {
			expect(() => {
				element.offset.baseVal = <number>(<unknown>'test');
			}).toThrow(
				new TypeError(
					`TypeError: Failed to set the 'baseVal' property on 'SVGAnimatedNumber': The provided float value is non-finite.`
				)
			);
		});
	});
});
