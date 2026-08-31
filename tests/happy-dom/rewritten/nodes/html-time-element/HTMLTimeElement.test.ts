// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-time-element/HTMLTimeElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { beforeEach, describe, expect, it } from 'bun:test';
import type Document from '../../../shim/src/nodes/document/Document.js';
import HTMLTimeElement from '../../../shim/src/nodes/html-time-element/HTMLTimeElement.js';
import Window from '../../../shim/src/window/Window.js';

describe('HTMLTimeElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLTimeElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('time');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLTimeElement', () => {
			expect(element instanceof HTMLTimeElement).toBe(true);
		});
	});

	describe('get dateTime()', () => {
		it('Gets the attribute value "datetime".', () => {
			element.setAttribute('datetime', '1969-07-20');
			expect(element.dateTime).toBe('1969-07-20');
		});

		it('Returns "" if the "datetime" attribute is not set.', () => {
			expect(element.dateTime).toBe('');
		});
	});

	describe('set dateTime()', () => {
		it('Sets the attribute value "datetime".', () => {
			element.dateTime = '1969-07-20';
			expect(element.getAttribute('datetime')).toBe('1969-07-20');
		});
	});
});
