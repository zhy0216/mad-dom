// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-li-element/HTMLLIElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLLIElement from '../../../shim/src/nodes/html-li-element/HTMLLIElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLLIElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLLIElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('li');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLLIElement', () => {
			expect(element instanceof HTMLLIElement).toBe(true);
		});
	});

	describe('get value()', () => {
		it('Should return "0" by default', () => {
			expect(element.value).toBe(0);
		});

		it('Should return the value', () => {
			element.setAttribute('value', '1');
			expect(element.value).toBe(1);
			element.setAttribute('value', '-1');
			expect(element.value).toBe(-1);
		});

		it('Should return 0 if the value is not a number', () => {
			element.setAttribute('value', 'test');
			expect(element.value).toBe(0);
		});
	});

	describe('set value()', () => {
		it('Should set the value', () => {
			element.value = 1;
			expect(element.getAttribute('value')).toBe('1');
			element.value = -1;
			expect(element.getAttribute('value')).toBe('-1');
		});

		it('Should set the value to 0 if the value is not a number', () => {
			element.value = <number>(<unknown>'test');
			expect(element.getAttribute('value')).toBe('0');
		});
	});
});
