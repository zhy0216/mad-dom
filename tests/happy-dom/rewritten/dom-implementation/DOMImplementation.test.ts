// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/dom-implementation/DOMImplementation.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLDocument from '../../shim/src/nodes/html-document/HTMLDocument.js';
import Window from '../../shim/src/window/Window.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('DOMImplementation', () => {
	let window: Window;

	beforeEach(() => {
		window = new Window();
	});

	describe('createDocument()', () => {
		it('Returns a new HTMLDocument for "html".', () => {
			const document = window.document.implementation.createDocument(
				'http://www.w3.org/1999/xhtml',
				'html'
			);
			expect(document instanceof window.HTMLDocument).toBe(true);
			expect(document.defaultView).toBe(null);
		});

		it('Returns a new XMLDocument for "svg".', () => {
			const document = window.document.implementation.createDocument(
				'http://www.w3.org/2000/svg',
				'svg'
			);
			expect(document instanceof window.XMLDocument).toBe(true);
			expect(document.defaultView).toBe(null);
		});

		it('Returns a new XMLDocument for "xml".', () => {
			const document = window.document.implementation.createDocument(
				'http://www.w3.org/2000/svg',
				'xml'
			);
			expect(document instanceof window.XMLDocument).toBe(true);
			expect(document.defaultView).toBe(null);
		});

		it('Returns a new HTMLDocument when "qualifiedName" is null.', () => {
			const document = window.document.implementation.createDocument(null, null, null);
			expect(document instanceof window.HTMLDocument).toBe(true);
			expect(document.defaultView).toBe(null);
		});

		it('Throws error if arguments length is less than 2', () => {
			// @ts-expect-error
			expect(() => window.document.implementation.createDocument()).toThrow(
				new TypeError(
					`Failed to execute 'createDocument' on 'DOMImplementation': 2 arguments required, but only 0 present.`
				)
			);
			expect(() =>
				// @ts-expect-error
				window.document.implementation.createDocument('http://www.w3.org/1999/xhtml')
			).toThrow(
				new TypeError(
					`Failed to execute 'createDocument' on 'DOMImplementation': 2 arguments required, but only 1 present.`
				)
			);
		});
	});

	describe('createHTMLDocument()', () => {
		it('Returns a new Document.', () => {
			const document = window.document.implementation.createHTMLDocument();
			expect(document instanceof HTMLDocument).toBe(true);
			expect(document.defaultView).toBe(null);
		});
	});

	describe('createDocumentType()', () => {
		it('Returns a new Document Type.', () => {
			const documentType = window.document.implementation.createDocumentType(
				'qualifiedName',
				'publicId',
				'systemId'
			);
			expect(documentType.name).toBe('qualifiedName');
			expect(documentType.publicId).toBe('publicId');
			expect(documentType.systemId).toBe('systemId');
			expect(documentType.ownerDocument).toBe(window.document);
		});
	});
});
