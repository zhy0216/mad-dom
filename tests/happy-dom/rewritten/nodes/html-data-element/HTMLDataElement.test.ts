// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-data-element/HTMLDataElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLDataElement from '../../../shim/src/nodes/html-data-element/HTMLDataElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLDataElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLDataElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('data');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLDataElement', () => {
			expect(element instanceof HTMLDataElement).toBe(true);
		});
	});

	describe('get value()', () => {
		it('Should return value', () => {
			expect(element.value).toBe('');
			element.setAttribute('value', 'test');
			expect(element.value).toBe('test');
		});
	});

	describe('set value()', () => {
		it('Should set value', () => {
			element.value = 'test';
			expect(element.getAttribute('value')).toBe('test');
		});
	});
});
