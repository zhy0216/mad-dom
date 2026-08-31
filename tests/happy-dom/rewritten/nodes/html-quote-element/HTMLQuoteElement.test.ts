// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-quote-element/HTMLQuoteElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLQuoteElement from '../../../shim/src/nodes/html-quote-element/HTMLQuoteElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLQuoteElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLQuoteElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('q');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLQuoteElement for the "q" tag.', () => {
			expect(document.createElement('q') instanceof HTMLQuoteElement).toBe(true);
		});

		it('Should be an instanceof HTMLQuoteElement for the "blockquote" tag.', () => {
			expect(document.createElement('blockquote') instanceof HTMLQuoteElement).toBe(true);
		});
	});

	describe('get cite()', () => {
		it('Returns the "cite" attribute.', () => {
			element.setAttribute('cite', 'test');
			expect(element.cite).toBe('test');
		});

		it('Returns URL relative to window location.', () => {
			window.happyDOM.setURL('https://localhost:8080/test/path/');
			element.setAttribute('cite', 'test');
			expect(element.cite).toBe('https://localhost:8080/test/path/test');
		});
	});

	describe('set cite()', () => {
		it('Sets the attribute "cite".', () => {
			element.cite = 'test';
			expect(element.getAttribute('cite')).toBe('test');
		});
	});
});
