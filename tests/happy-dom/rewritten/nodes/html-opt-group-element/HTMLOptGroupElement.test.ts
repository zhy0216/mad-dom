// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-opt-group-element/HTMLOptGroupElement.test.ts
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
import type HTMLOptGroupElement from '../../../shim/src/nodes/html-opt-group-element/HTMLOptGroupElement.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLOptGroupElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLOptGroupElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = <HTMLOptGroupElement>document.createElement('optgroup');
	});

	describe('Object.prototype.toString', () => {
		it('Returns `[object HTMLOptGroupElement]`', () => {
			expect(Object.prototype.toString.call(element)).toBe('[object HTMLOptGroupElement]');
		});
	});

	describe(`get disabled()`, () => {
		it('Returns attribute value.', () => {
			expect(element.disabled).toBe(false);
			element.setAttribute('disabled', '');
			expect(element.disabled).toBe(true);
		});
	});

	describe(`set disabled()`, () => {
		it('Sets attribute value.', () => {
			element.disabled = true;
			expect(element.getAttribute('disabled')).toBe('');
		});
	});

	describe(`get label()`, () => {
		it('Returns attribute value.', () => {
			expect(element.label).toBe('');
			element.setAttribute('label', 'value');
			expect(element.label).toBe('value');
		});
	});

	describe(`set label()`, () => {
		it('Sets attribute value.', () => {
			element.label = 'value';
			expect(element.getAttribute('label')).toBe('value');
		});
	});
});
