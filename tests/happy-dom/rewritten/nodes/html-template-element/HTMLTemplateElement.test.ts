// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-template-element/HTMLTemplateElement.test.ts
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
import type HTMLTemplateElement from '../../../shim/src/nodes/html-template-element/HTMLTemplateElement.js';
import HTMLSerializer from '../../../shim/src/html-serializer/HTMLSerializer.js';
import { beforeEach, afterEach, describe, it, expect } from 'bun:test';
import { restoreAllMocks } from '../../../adapter/index.js';
import CustomElement from '../../CustomElement.js';

describe('HTMLTemplateElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLTemplateElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = <HTMLTemplateElement>document.createElement('template');
	});

	afterEach(() => {
		CustomElement.serializable = false;
		restoreAllMocks();
	});

	describe('Object.prototype.toString', () => {
		it('Returns `[object HTMLTemplateElement]`', () => {
			expect(Object.prototype.toString.call(element)).toBe('[object HTMLTemplateElement]');
		});
	});

	describe('get innerHTML()', () => {
		it('Returns inner HTML of the "content" node.', () => {
			const div = document.createElement('div');

			div.innerHTML = 'Test';

			expect(element.content.childNodes.length).toBe(0);
			expect(element.innerHTML).toBe('');

			element.appendChild(div);

			expect(element.childNodes.length).toBe(0);
			expect(element.innerHTML).toBe('<div>Test</div>');
			expect(new HTMLSerializer().serializeToString(element.content)).toBe('<div>Test</div>');

			element.removeChild(div);

			expect(element.content.childNodes.length).toBe(0);
			expect(element.innerHTML).toBe('');
		});
	});

	describe('set innerHTML()', () => {
		it('Serializes the HTML into nodes and appends them to the "content" node.', () => {
			expect(element.content.childNodes.length).toBe(0);
			expect(element.innerHTML).toBe('');

			element.innerHTML = '<div>Test</div>';

			expect(element.childNodes.length).toBe(0);
			expect(element.innerHTML).toBe('<div>Test</div>');
			expect(new HTMLSerializer().serializeToString(element.content)).toBe('<div>Test</div>');

			element.innerHTML = '';

			expect(element.content.childNodes.length).toBe(0);
			expect(element.innerHTML).toBe('');
		});
	});

	describe('get outerHTML()', () => {
		it('Serializes the HTML into nodes and appends them to the "content" node.', () => {
			expect(element.content.childNodes.length).toBe(0);
			expect(element.innerHTML).toBe('');

			element.innerHTML = '<div>Test</div>';

			expect(element.childNodes.length).toBe(0);
			expect(element.outerHTML).toBe('<template><div>Test</div></template>');

			element.innerHTML = '';

			expect(element.outerHTML).toBe('<template></template>');
		});
	});

	describe('set outerHTML()', () => {
		it('Replaces the template with a span.', () => {
			element.innerHTML = '<div>Test</div>';

			document.body.appendChild(element);

			expect(document.body.innerHTML).toBe('<template><div>Test</div></template>');

			element.outerHTML = '<span>Test</span>';

			expect(document.body.innerHTML).toBe('<span>Test</span>');
		});
	});

	describe('get firstChild()', () => {
		it('Returns first child.', () => {
			const div = document.createElement('div');
			const span = document.createElement('span');
			element.appendChild(div);
			element.appendChild(span);
			expect(element.firstChild).toBe(div);
		});
	});

	describe('get lastChild()', () => {
		it('Returns last child.', () => {
			const div = document.createElement('div');
			const span = document.createElement('span');
			element.appendChild(div);
			element.appendChild(span);
			expect(element.lastChild).toBe(span);
		});
	});

	describe('getInnerHTML()', () => {
		it('Returns inner HTML of the "content" node.', () => {
			const div = document.createElement('div');

			div.innerHTML = 'Test';

			expect(element.content.childNodes.length).toBe(0);
			expect(element.getInnerHTML()).toBe('');

			element.appendChild(div);

			expect(element.childNodes.length).toBe(0);
			expect(element.getInnerHTML()).toBe('<div>Test</div>');
			expect(new HTMLSerializer().serializeToString(element.content)).toBe('<div>Test</div>');

			element.removeChild(div);

			expect(element.content.childNodes.length).toBe(0);
			expect(element.getInnerHTML()).toBe('');
		});

		it('Should ignore shadow roots, as they should not be included in HTMLTemplateElement.', () => {
			window.customElements.define('custom-element', CustomElement);

			element.innerHTML = '<div><custom-element></custom-element></div>';

			expect(element.getInnerHTML({ includeShadowRoots: true })).toBe(
				'<div><custom-element></custom-element></div>'
			);
		});
	});

	describe('getHTML()', () => {
		it('Returns HTML of children as a concatenated string.', () => {
			const div = document.createElement('div');

			div.innerHTML = 'Test';

			expect(element.content.childNodes.length).toBe(0);
			expect(element.getHTML()).toBe('');

			element.appendChild(div);

			expect(element.childNodes.length).toBe(0);
			expect(element.getHTML()).toBe('<div>Test</div>');
			expect(new HTMLSerializer().serializeToString(element.content)).toBe('<div>Test</div>');

			element.removeChild(div);

			expect(element.content.childNodes.length).toBe(0);
			expect(element.getHTML()).toBe('');
		});

		it('Should ignore shadow roots, as they should not be included in HTMLTemplateElement.', () => {
			CustomElement.serializable = true;

			window.customElements.define('custom-element', CustomElement);

			element.innerHTML = '<div><custom-element></custom-element></div>';

			document.body.appendChild(element);

			expect(element.getHTML({ serializableShadowRoots: true })).toBe(
				'<div><custom-element></custom-element></div>'
			);
		});
	});

	describe('appendChild()', () => {
		it('Appends a node to the "content" node.', () => {
			const div = document.createElement('div');

			expect(element.childNodes.length).toBe(0);
			expect(element.content.childNodes.length).toBe(0);

			element.appendChild(div);

			expect(element.childNodes.length).toBe(0);
			expect(element.content.childNodes.length).toBe(1);
			expect(element.content.childNodes[0] === div).toBe(true);

			element.removeChild(div);

			expect(element.childNodes.length).toBe(0);
			expect(element.content.childNodes.length).toBe(0);
		});
	});

	describe('removeChild()', () => {
		it('Removes a node from the "content" node.', () => {
			const div = document.createElement('div');

			element.appendChild(div);

			expect(element.childNodes.length).toBe(0);
			expect(element.content.childNodes.length).toBe(1);

			element.removeChild(div);

			expect(element.childNodes.length).toBe(0);
			expect(element.content.childNodes.length).toBe(0);
		});
	});

	describe('insertBefore()', () => {
		it('Inserts a node before another node in the "content" node.', () => {
			const div = document.createElement('div');
			const span = document.createElement('span');
			const underline = document.createElement('u');
			element.appendChild(div);
			element.appendChild(span);
			element.insertBefore(underline, span);
			expect(element.innerHTML).toBe('<div></div><u></u><span></span>');
		});
	});

	describe('replaceChild()', () => {
		it('Removes a node from the "content" node.', () => {
			const div = document.createElement('div');
			const span = document.createElement('span');
			const underline = document.createElement('u');
			const bold = document.createElement('b');
			element.appendChild(div);
			element.appendChild(underline);
			element.appendChild(span);
			element.replaceChild(bold, underline);
			expect(element.innerHTML).toBe('<div></div><b></b><span></span>');
		});
	});

	describe('cloneNode()', () => {
		it('Clones the nodes of the "content" node.', () => {
			element.innerHTML = '<div></div><b></b><span></span>';
			const clone = element.cloneNode(true);
			expect(clone.innerHTML).toBe('<div></div><b></b><span></span>');
		});
	});
});
