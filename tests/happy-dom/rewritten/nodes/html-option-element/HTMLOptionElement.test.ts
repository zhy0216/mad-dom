// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-option-element/HTMLOptionElement.test.ts
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
import type HTMLOptionElement from '../../../shim/src/nodes/html-option-element/HTMLOptionElement.js';
import type HTMLSelectElement from '../../../shim/src/nodes/html-select-element/HTMLSelectElement.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLOptionElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLOptionElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = <HTMLOptionElement>document.createElement('option');
	});

	describe('Object.prototype.toString', () => {
		it('Returns `[object HTMLOptionElement]`', () => {
			expect(Object.prototype.toString.call(element)).toBe('[object HTMLOptionElement]');
		});
	});

	describe('get value()', () => {
		it('Returns the attribute "value".', () => {
			element.setAttribute('value', 'VALUE');
			expect(element.value).toBe('VALUE');
		});

		it('Returns the attribute "value" even if the value is empty string.', () => {
			element.textContent = 'TEXT VALUE';
			element.setAttribute('value', '');
			expect(element.value).toBe('');
		});

		it('Returns the text IDL value if no attribute is present.', () => {
			element.removeAttribute('value');
			element.textContent = 'TEXT VALUE';
			expect(element.value).toBe('TEXT VALUE');
		});
	});

	describe('set value()', () => {
		it('Sets the attribute "value".', () => {
			element.value = 'VALUE';
			expect(element.getAttribute('value')).toBe('VALUE');
		});
	});

	describe('get disabled()', () => {
		it('Returns the attribute "disabled".', () => {
			element.setAttribute('disabled', '');
			expect(element.disabled).toBe(true);
		});
	});

	describe('set disabled()', () => {
		it('Sets the attribute "disabled".', () => {
			element.disabled = true;
			expect(element.getAttribute('disabled')).toBe('');
		});
	});

	describe('get selected()', () => {
		it('Returns the selected state of the option.', () => {
			const select = <HTMLSelectElement>document.createElement('select');
			const option1 = <HTMLOptionElement>document.createElement('option');
			const option2 = <HTMLOptionElement>document.createElement('option');

			expect(option1.selected).toBe(false);
			expect(option2.selected).toBe(false);

			select.appendChild(option1);
			select.appendChild(option2);

			expect(option1.selected).toBe(true);
			expect(option2.selected).toBe(false);
			expect(option1.getAttribute('selected')).toBe(null);
			expect(option2.getAttribute('selected')).toBe(null);

			select.options.selectedIndex = 1;

			expect(option1.selected).toBe(false);
			expect(option2.selected).toBe(true);
			expect(option1.getAttribute('selected')).toBe(null);
			expect(option2.getAttribute('selected')).toBe(null);

			select.options.selectedIndex = -1;

			expect(option1.selected).toBe(false);
			expect(option2.selected).toBe(false);
		});
	});

	describe('set selected()', () => {
		it('Sets the selected state of the option.', () => {
			const select = <HTMLSelectElement>document.createElement('select');
			const option1 = <HTMLOptionElement>document.createElement('option');
			const option2 = <HTMLOptionElement>document.createElement('option');

			expect(option1.selected).toBe(false);
			expect(option2.selected).toBe(false);

			option1.selected = true;

			expect(select.selectedIndex).toBe(-1);

			select.appendChild(option1);
			select.appendChild(option2);

			option1.selected = true;

			expect(select.selectedIndex).toBe(0);

			option2.selected = true;

			expect(select.selectedIndex).toBe(1);

			option2.selected = false;

			expect(select.selectedIndex).toBe(0);
		});
	});
});
