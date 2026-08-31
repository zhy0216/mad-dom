// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/text/Text.test.ts
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
import DOMException from '../../../shim/src/exception/DOMException.js';
import Text from '../../../shim/src/nodes/text/Text.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('Text', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;
	});

	describe('constructor()', () => {
		it('Creates a new Text node.', () => {
			const node = new window.Text('test');
			expect(node).toBeInstanceOf(Text);
			expect(node.data).toBe('test');
		});
	});

	describe('get nodeName()', () => {
		it('Returns "#text".', () => {
			const node = document.createTextNode('test');
			expect(node).toBeInstanceOf(Text);
			expect(node.nodeName).toBe('#text');
		});
	});

	describe('toString()', () => {
		it('Returns "[object Text]".', () => {
			const node = document.createTextNode('test');
			expect(node.toString()).toBe('[object Text]');
		});
	});

	describe('cloneNode()', () => {
		it('Clones the node.', () => {
			const node = document.createTextNode('test');
			const clone = node.cloneNode();
			expect(clone.data).toBe(node.data);
		});
	});

	describe('splitText()', () => {
		it('Splits the text node.', () => {
			const node = document.createTextNode('test');
			document.body.append(node);
			const result = node.splitText(2);
			expect(node.textContent).toBe('te');
			expect(result).toBeInstanceOf(Text);
			expect(result.textContent).toBe('st');
			expect(node.nextSibling).toBe(result);
			expect(result.previousSibling).toBe(node);
		});
		it('Throws on invalid index.', () => {
			const node = document.createTextNode('test');
			expect(() => node.splitText(-1)).toThrow(DOMException);
			expect(() => node.splitText(5)).toThrow(DOMException);
		});
	});

	describe('get wholeText()', () => {
		it('Returns the text content when the node has no parent.', () => {
			const node = document.createTextNode('test');
			expect(node.wholeText).toBe('test');
		});

		it('Returns the text content when the node is the only child.', () => {
			const node = document.createTextNode('test');
			document.body.appendChild(node);
			expect(node.wholeText).toBe('test');
		});

		it('Returns combined text of adjacent text nodes.', () => {
			const node1 = document.createTextNode('Hello');
			const node2 = document.createTextNode(' ');
			const node3 = document.createTextNode('World');
			document.body.appendChild(node1);
			document.body.appendChild(node2);
			document.body.appendChild(node3);

			expect(node1.wholeText).toBe('Hello World');
			expect(node2.wholeText).toBe('Hello World');
			expect(node3.wholeText).toBe('Hello World');
		});

		it('Stops at element boundaries.', () => {
			const node1 = document.createTextNode('Before');
			const span = document.createElement('span');
			const node2 = document.createTextNode('After');
			document.body.appendChild(node1);
			document.body.appendChild(span);
			document.body.appendChild(node2);

			expect(node1.wholeText).toBe('Before');
			expect(node2.wholeText).toBe('After');
		});
	});
});
