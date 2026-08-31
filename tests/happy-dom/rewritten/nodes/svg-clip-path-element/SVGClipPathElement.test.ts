// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-clip-path-element/SVGClipPathElement.test.ts
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
import SVGClipPathElement from '../../../src/nodes/svg-clip-path-element/SVGClipPathElement.js';
import SVGElement from '../../../shim/src/nodes/svg-element/SVGElement.js';

describe('SVGClipPathElement', () => {
	let window: Window;
	let document: Document;
	let element: SVGClipPathElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
	});

	describe('constructor()', () => {
		it('Should be an instanceof SVGClipPathElement', () => {
			expect(element instanceof SVGClipPathElement).toBe(true);
		});

		it('Should be an instanceof SVGElement', () => {
			expect(element instanceof SVGElement).toBe(true);
		});
	});

	describe('get clipPathUnits()', () => {
		it('Should return an instance of SVGAnimatedEnumeration', () => {
			const clipPathUnits = element.clipPathUnits;
			expect(clipPathUnits).toBeInstanceOf(window.SVGAnimatedEnumeration);
			expect(element.clipPathUnits).toBe(clipPathUnits);
		});

		it('Should return userSpaceOnUse by default', () => {
			expect(element.clipPathUnits.animVal).toBe(window.SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE);
			expect(element.clipPathUnits.baseVal).toBe(window.SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE);
		});

		it('Reflects the "clipPathUnits" attribute', () => {
			element.setAttribute('clipPathUnits', 'userSpaceOnUse');

			expect(element.clipPathUnits.baseVal).toBe(window.SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE);
			expect(element.clipPathUnits.animVal).toBe(window.SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE);

			element.setAttribute('clipPathUnits', 'objectBoundingBox');

			expect(element.clipPathUnits.baseVal).toBe(
				window.SVGUnitTypes.SVG_UNIT_TYPE_OBJECTBOUNDINGBOX
			);
			expect(element.clipPathUnits.animVal).toBe(
				window.SVGUnitTypes.SVG_UNIT_TYPE_OBJECTBOUNDINGBOX
			);

			element.clipPathUnits.baseVal = window.SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE;

			expect(element.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');

			// Should do nothing
			element.clipPathUnits.animVal = window.SVGUnitTypes.SVG_UNIT_TYPE_OBJECTBOUNDINGBOX;

			expect(element.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
		});
	});
});
