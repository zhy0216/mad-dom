// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-title-element/HTMLTitleElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLTitleElement from '../../../shim/src/nodes/html-title-element/HTMLTitleElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import type Text from '../../../shim/src/nodes/text/Text.js';

describe('HTMLTitleElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLTitleElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('title');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLTitleElement', () => {
			expect(element instanceof HTMLTitleElement).toBe(true);
		});
	});

	describe('get text()', () => {
		it('Should only return the data of Text nodes', () => {
			const div = document.createElement('div');

			div.textContent = 'Invalid';

			element.appendChild(document.createTextNode('  Hello'));
			element.appendChild(div);
			element.appendChild(document.createTextNode(' World!  '));

			expect(element.text).toBe('  Hello World!  ');
		});
	});

	describe('set text()', () => {
		it('Should set "textContent"', () => {
			element.text = 'Hello';
			expect(element.childNodes.length).toBe(1);
			expect((<Text>element.childNodes[0]).data).toBe('Hello');
		});
	});

	describe('get innerHTML()', () => {
		it('Should HTML', () => {
			const div = document.createElement('div');
			div.textContent = 'Hello';
			element.appendChild(div);
			expect(element.innerHTML).toBe('<div>Hello</div>');
		});
	});

	describe('set innerHTML()', () => {
		it('Should set "textContent"', () => {
			element.innerHTML = '<div>Hello</div>';
			expect(element.childNodes.length).toBe(1);
			expect((<Text>element.childNodes[0]).data).toBe('<div>Hello</div>');
			expect(element.innerHTML).toBe('&lt;div&gt;Hello&lt;/div&gt;');
		});
	});
});
