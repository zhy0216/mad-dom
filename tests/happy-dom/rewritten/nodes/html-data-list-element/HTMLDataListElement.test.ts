// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-data-list-element/HTMLDataListElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLDataListElement from '../../../shim/src/nodes/html-data-list-element/HTMLDataListElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import HTMLCollection from '../../../shim/src/nodes/element/HTMLCollection.js';

describe('HTMLDataListElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLDataListElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('datalist');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLDataListElement', () => {
			expect(element instanceof HTMLDataListElement).toBe(true);
		});
	});

	describe('get options()', () => {
		it('Should return options', () => {
			expect(element.options).toBeInstanceOf(HTMLCollection);
			expect(element.options.length).toBe(0);

			const option1 = document.createElement('option');
			const option2 = document.createElement('option');
			const option3 = document.createElement('option');

			option3.setAttribute('id', 'option3_id');
			option3.setAttribute('name', 'option3_name');

			element.appendChild(option1);
			element.appendChild(option2);
			element.appendChild(option3);

			expect(element.options.length).toBe(3);

			expect(element.options[0]).toBe(option1);
			expect(element.options[1]).toBe(option2);
			expect(element.options[2]).toBe(option3);

			expect(element.options['option3_id']).toBe(option3);
			expect(element.options['option3_name']).toBe(option3);

			element.removeChild(option2);

			expect(element.options.length).toBe(2);

			expect(element.options[0]).toBe(option1);
			expect(element.options[1]).toBe(option3);

			expect(element.options['option3_id']).toBe(option3);
			expect(element.options['option3_name']).toBe(option3);

			element.removeChild(option3);

			expect(element.options.length).toBe(1);

			expect(element.options[0]).toBe(option1);

			expect(element.options['option3_id']).toBe(undefined);
			expect(element.options['option3_name']).toBe(undefined);

			element.appendChild(option3);

			expect(element.options.length).toBe(2);

			expect(element.options[0]).toBe(option1);
			expect(element.options[1]).toBe(option3);

			expect(element.options['option3_id']).toBe(option3);
			expect(element.options['option3_name']).toBe(option3);
		});
	});
});
