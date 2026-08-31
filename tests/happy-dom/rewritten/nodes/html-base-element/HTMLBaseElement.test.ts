// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-base-element/HTMLBaseElement.test.ts
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
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLBaseElement', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window({ url: 'https://www.somesite.com/test.html' });
		document = window.document;
	});

	describe('get target()', () => {
		it('Returns the "target" attribute.', () => {
			const element = document.createElement('base');
			element.setAttribute('target', 'test');
			expect(element.target).toBe('test');
		});
	});

	describe('set target()', () => {
		it('Sets the attribute "target".', () => {
			const element = document.createElement('base');
			element.target = 'test';
			expect(element.getAttribute('target')).toBe('test');
		});
	});

	describe('get href()', () => {
		it('Returns the "href" attribute.', () => {
			const element = document.createElement('base');
			element.setAttribute('href', 'test');
			expect(element.href).toBe('https://www.somesite.com/test');
		});

		it('Returns the "href" attribute when scheme is http.', () => {
			const element = document.createElement('base');
			element.setAttribute('href', 'http://www.example.com');
			expect(element.href).toBe('http://www.example.com/');
		});

		it('Returns the "href" attribute when scheme is tel.', () => {
			const element = document.createElement('base');
			element.setAttribute('href', 'tel:+123456789');
			expect(element.href).toBe('tel:+123456789');
		});

		it('Returns the "href" attribute when scheme-relative', () => {
			const element = document.createElement('base');
			element.setAttribute('href', '//example.com');
			expect(element.href).toBe('https://example.com/');
		});

		it('Returns window location if "href" attribute is empty.', () => {
			const element = document.createElement('base');
			expect(element.href).toBe('https://www.somesite.com/test.html');
		});
	});

	describe('set href()', () => {
		it('Sets the attribute "href".', () => {
			const element = document.createElement('base');
			element.href = 'test';
			expect(element.getAttribute('href')).toBe('test');
		});
	});
});
