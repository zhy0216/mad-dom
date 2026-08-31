// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/declaration/computed-style/CSSStyleDeclarationComputedStyle.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Window from '../../../../shim/src/window/Window.js';
import type Document from '../../../../shim/src/nodes/document/Document.js';
import type HTMLElement from '../../../../shim/src/nodes/html-element/HTMLElement.js';
import CSSStyleDeclarationElementStyle from '../../../../src/css/declaration/computed-style/CSSStyleDeclarationComputedStyle.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('CSSStyleDeclarationElementStyle', () => {
	let window: Window;
	let document: Document;
	let element: HTMLElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('div');
	});

	describe('getComputedStyle()', () => {
		it('Is using a cache.', () => {
			document.body.appendChild(element);
			element.setAttribute('style', `border: 2px solid green;border-radius: 2px;font-size: 12px;`);

			const computedElementStyleDeclaration = new CSSStyleDeclarationElementStyle(element);
			const computedElementStyle = computedElementStyleDeclaration.getComputedStyle();
			expect(computedElementStyle).toBe(computedElementStyleDeclaration.getComputedStyle());

			element.setAttribute('style', `border: 2px solid green;`);

			expect(computedElementStyleDeclaration.getComputedStyle()).not.toBe(computedElementStyle);
		});
		it('parses variables correctly.', () => {
			document.body.appendChild(element);
			element.setAttribute(
				'style',
				`--bg-color: rgb(0 128 0 / 1); background-color: var(--bg-color);`
			);

			const computedElementStyleDeclaration = new CSSStyleDeclarationElementStyle(element);
			const computedElementStyle = computedElementStyleDeclaration.getComputedStyle();
			expect(computedElementStyle.get('background-color').value).toBe('rgb(0 128 0 / 1)');
		});
		it('parses nested variables correctly.', () => {
			document.body.appendChild(element);
			element.setAttribute(
				'style',
				`--bg-color-alpha: 1; background-color: rgb(0 128 0 / var(--bg-color-alpha, 1));`
			);

			const computedElementStyleDeclaration = new CSSStyleDeclarationElementStyle(element);
			const computedElementStyle = computedElementStyleDeclaration.getComputedStyle();
			expect(computedElementStyle.get('background-color').value).toBe('rgb(0 128 0 / 1)');
		});
	});
});
