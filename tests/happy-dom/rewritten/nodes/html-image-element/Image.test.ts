// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-image-element/Image.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Window from '../../../shim/src/window/Window.js';
import HTMLImageElement from '../../../shim/src/nodes/html-image-element/HTMLImageElement.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import NamespaceURI from '../../../src/config/NamespaceURI.js';

describe('Image', () => {
	let window: Window;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Create img element without width and height.', () => {
			const image = new window.Image();
			expect(image.width).toBe(0);
			expect(image.height).toBe(0);
			expect(image.tagName).toBe('IMG');
			expect(image.localName).toBe('img');
			expect(image.namespaceURI).toBe(NamespaceURI.html);
			expect(image.ownerDocument).toBe(window.document);
			expect(image instanceof HTMLImageElement).toBe(true);
		});

		it('Create img element with width and height defined.', () => {
			// We use window.Image() to have the correct ownerDocument defined
			const image = new window.Image(100, 200);
			expect(image.width).toBe(100);
			expect(image.height).toBe(200);
			expect(image.tagName).toBe('IMG');
			expect(image.localName).toBe('img');
			expect(image.namespaceURI).toBe(NamespaceURI.html);
			expect(image.ownerDocument).toBe(window.document);
		});
	});
});
