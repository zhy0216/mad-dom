// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-style-element/SVGStyleElement.test.ts
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
import SVGStyleElement from '../../../src/nodes/svg-style-element/SVGStyleElement.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import SVGElement from '../../../shim/src/nodes/svg-element/SVGElement.js';

describe('SVGStyleElement', () => {
	let window: Window;
	let document: Document;
	let element: SVGStyleElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElementNS('http://www.w3.org/2000/svg', 'style');
	});

	describe('constructor()', () => {
		it('Should be an instanceof SVGStyleElement', () => {
			expect(element instanceof SVGStyleElement).toBe(true);
		});

		it('Should be an instanceof SVGElement', () => {
			expect(element instanceof SVGElement).toBe(true);
		});
	});

	describe('Object.prototype.toString', () => {
		it('Returns `[object SVGStyleElement]`', () => {
			expect(Object.prototype.toString.call(element)).toBe('[object SVGStyleElement]');
		});
	});

	describe('get media()', () => {
		it('Returns "all" by default.', () => {
			expect(element.media).toBe('all');
		});

		it('Returns the "media" attribute.', () => {
			element.setAttribute('media', 'test');
			expect(element.media).toBe('test');
		});
	});

	describe('set media()', () => {
		it('Sets the "media" attribute.', () => {
			element.media = 'test';
			expect(element.getAttribute('media')).toBe('test');
		});
	});

	describe('get type()', () => {
		it('Returns "text/css" by default.', () => {
			expect(element.type).toBe('text/css');
		});

		it('Returns the "type" attribute.', () => {
			element.setAttribute('type', 'test');
			expect(element.type).toBe('test');
		});
	});

	describe('set type()', () => {
		it('Sets the "type" attribute.', () => {
			element.type = 'test';
			expect(element.getAttribute('type')).toBe('test');
		});
	});

	describe('get title()', () => {
		it('Returns empty string by default', () => {
			expect(element.title).toBe('');
		});

		it('Returns the "title" attribute.', () => {
			element.setAttribute('title', 'test');
			expect(element.title).toBe('test');
		});
	});

	describe('set title()', () => {
		it('Sets the "title" attribute.', () => {
			element.title = 'test';
			expect(element.getAttribute('title')).toBe('test');
		});
	});

	describe(`get disabled()`, () => {
		it('Returns disabled state.', () => {
			expect(element.disabled).toBe(false);
			element.disabled = true;
			expect(element.disabled).toBe(true);
		});
	});

	describe(`set disabled()`, () => {
		it('Sets disabled state.', () => {
			element.disabled = true;
			// Should not set an attribute
			expect(element.getAttribute('disabled')).toBe(null);
		});
	});

	describe(`get sheet()`, () => {
		it('Returns "null" if not connected to DOM.', () => {
			expect(element.sheet).toBe(null);
		});

		it('Returns an CSSStyleSheet instance with its text content as style rules.', () => {
			const textNode = document.createTextNode(
				'body { background-color: red }\ndiv { background-color: green }'
			);

			element.appendChild(textNode);
			document.head.appendChild(element);

			expect(element.sheet.cssRules.length).toBe(2);
			expect(element.sheet.cssRules[0].cssText).toBe('body { background-color: red; }');
			expect(element.sheet.cssRules[1].cssText).toBe('div { background-color: green; }');

			element.sheet.insertRule('html { background-color: blue }', 0);

			expect(element.sheet.cssRules.length).toBe(3);
			expect(element.sheet.cssRules[0].cssText).toBe('html { background-color: blue; }');
			expect(element.sheet.cssRules[1].cssText).toBe('body { background-color: red; }');
			expect(element.sheet.cssRules[2].cssText).toBe('div { background-color: green; }');
		});

		it('Updates rules when appending a text node.', () => {
			document.head.appendChild(element);

			expect(element.sheet.cssRules.length).toBe(0);

			const textNode = document.createTextNode(
				'body { background-color: red }\ndiv { background-color: green }'
			);

			element.appendChild(textNode);

			expect(element.sheet.cssRules[0].cssText).toBe('body { background-color: red; }');
			expect(element.sheet.cssRules[1].cssText).toBe('div { background-color: green; }');
		});

		it('Updates rules when removing a text node.', () => {
			document.head.appendChild(element);

			const textNode = document.createTextNode(
				'body { background-color: red }\ndiv { background-color: green }'
			);

			element.appendChild(textNode);

			expect(element.sheet.cssRules.length).toBe(2);

			expect(element.sheet.cssRules[0].cssText).toBe('body { background-color: red; }');
			expect(element.sheet.cssRules[1].cssText).toBe('div { background-color: green; }');

			element.removeChild(textNode);

			expect(element.sheet.cssRules.length).toBe(0);
		});

		it('Updates rules when inserting a text node.', () => {
			document.head.appendChild(element);

			const textNode = document.createTextNode(
				'body { background-color: red }\ndiv { background-color: green }'
			);

			element.appendChild(textNode);

			expect(element.sheet.cssRules.length).toBe(2);

			expect(element.sheet.cssRules[0].cssText).toBe('body { background-color: red; }');
			expect(element.sheet.cssRules[1].cssText).toBe('div { background-color: green; }');

			const textNode2 = document.createTextNode('html { background-color: blue }');

			element.insertBefore(textNode2, textNode);

			expect(element.sheet.cssRules.length).toBe(3);

			expect(element.sheet.cssRules[0].cssText).toBe('html { background-color: blue; }');
			expect(element.sheet.cssRules[1].cssText).toBe('body { background-color: red; }');
			expect(element.sheet.cssRules[2].cssText).toBe('div { background-color: green; }');
		});

		it('Updates rules editing data of a child Text node.', () => {
			document.head.appendChild(element);

			expect(element.sheet.cssRules.length).toBe(0);

			const textNode = document.createTextNode(
				'body { background-color: red }\ndiv { background-color: green }'
			);

			const documentElementComputedStyle = window.getComputedStyle(document.documentElement);

			element.appendChild(textNode);

			expect(element.sheet.cssRules.length).toBe(2);
			expect(element.sheet.cssRules[0].cssText).toBe('body { background-color: red; }');
			expect(element.sheet.cssRules[1].cssText).toBe('div { background-color: green; }');

			expect(documentElementComputedStyle.backgroundColor).toBe('');

			textNode.data = 'html { background-color: blue }';

			expect(element.sheet.cssRules.length).toBe(1);
			expect(element.sheet.cssRules[0].cssText).toBe('html { background-color: blue; }');

			expect(documentElementComputedStyle.backgroundColor).toBe('blue');
		});
	});
});
