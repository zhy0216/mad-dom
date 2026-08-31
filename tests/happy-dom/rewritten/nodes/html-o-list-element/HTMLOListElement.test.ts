// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-o-list-element/HTMLOListElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLOListElement from '../../../shim/src/nodes/html-o-list-element/HTMLOListElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLOListElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLOListElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('ol');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLOListElement', () => {
			expect(element instanceof HTMLOListElement).toBe(true);
		});
	});

	describe('get reversed()', () => {
		it('Should return false by default.', () => {
			expect(element.reversed).toBe(false);
		});

		it('Should return true if "reversed" attribute is set.', () => {
			element.setAttribute('reversed', '');
			expect(element.reversed).toBe(true);
		});
	});

	describe('set reversed()', () => {
		it('Should set "reversed" attribute.', () => {
			element.reversed = true;
			expect(element.getAttribute('reversed')).toBe('');
		});

		it('Should remove "reversed" attribute.', () => {
			element.reversed = true;
			element.reversed = false;
			expect(element.hasAttribute('reversed')).toBe(false);
		});
	});

	describe('get start()', () => {
		it('Should return 1 by default.', () => {
			expect(element.start).toBe(1);
		});

		it('Should return the value of the "start" attribute.', () => {
			element.setAttribute('start', '5');
			expect(element.start).toBe(5);
		});

		it('Should return 1 if the "start" attribute is not a number.', () => {
			element.setAttribute('start', 'invalid');
			expect(element.start).toBe(1);
		});
	});

	describe('set start()', () => {
		it('Should set the "start" attribute if the value is a valid number.', () => {
			element.start = 5;
			expect(element.getAttribute('start')).toBe('5');
		});

		it('Should set the "start" attribute to "0" if value is invalid.', () => {
			element.start = <number>(<unknown>'invalid');
			expect(element.getAttribute('start')).toBe('0');
		});

		it('Should parse a string to a number.', () => {
			element.start = <number>(<unknown>'5');
			expect(element.getAttribute('start')).toBe('5');
		});
	});

	describe('get type()', () => {
		it('Should return an empty string by default.', () => {
			expect(element.type).toBe('');
		});

		it('Should return the value of the "type" attribute.', () => {
			element.setAttribute('type', 'a');
			expect(element.type).toBe('a');
		});
	});

	describe('set type()', () => {
		it('Should set the "type" attribute.', () => {
			element.type = 'a';
			expect(element.getAttribute('type')).toBe('a');
		});
	});
});
