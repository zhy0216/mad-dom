// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-g-element/SVGGElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import SVGGElement from '../../../src/nodes/svg-g-element/SVGGElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import SVGGraphicsElement from '../../../shim/src/nodes/svg-graphics-element/SVGGraphicsElement.js';
import type BrowserWindow from '../../../shim/src/window/BrowserWindow.js';

describe('SVGGElement', () => {
	let window: BrowserWindow;
	let document: Document;
	let element: SVGGElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElementNS('http://www.w3.org/2000/svg', 'g');
	});

	describe('constructor()', () => {
		it('Should be an instanceof SVGGElement', () => {
			expect(element instanceof SVGGElement).toBe(true);
		});

		it('Should be an instanceof SVGGraphicsElement', () => {
			expect(element instanceof SVGGraphicsElement).toBe(true);
		});
	});
});
