// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/attr/Attr.test.ts
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
import * as PropertySymbol from '../../../shim/src/PropertySymbol.js';
import NodeTypeEnum from '../../../src/nodes/node/NodeTypeEnum.js';

describe('Attr', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;
	});

	describe('get nodeType()', () => {
		it('Returns attribute node type.', () => {
			const attr = document.createAttribute('test');
			expect(attr.nodeType).toBe(NodeTypeEnum.attributeNode);
		});
	});

	describe('get namespaceURI()', () => {
		it('Returns namespace URI.', () => {
			const attr = document.createAttribute('test');
			attr[PropertySymbol.namespaceURI] = 'namespaceURI';
			expect(attr.namespaceURI).toBe('namespaceURI');
		});
	});

	describe('get name()', () => {
		it('Returns name.', () => {
			const attr = document.createAttribute('test');
			attr[PropertySymbol.name] = 'name';
			expect(attr.name).toBe('name');
		});
	});

	describe('get localName()', () => {
		it('Returns local name.', () => {
			const attr = document.createAttribute('test');
			attr[PropertySymbol.localName] = 'localName';
			expect(attr.localName).toBe('localName');
		});
	});

	describe('get prefix()', () => {
		it('Returns prefix.', () => {
			const attr = document.createAttribute('test');
			attr[PropertySymbol.prefix] = 'prefix';
			expect(attr.prefix).toBe('prefix');
		});
	});

	describe('get value()', () => {
		it('Returns value.', () => {
			const attr = document.createAttribute('test');
			attr[PropertySymbol.value] = 'value';
			expect(attr.value).toBe('value');
		});
	});

	describe('get specified()', () => {
		it('Returns specified.', () => {
			const attr = document.createAttribute('test');
			attr[PropertySymbol.specified] = true;
			expect(attr.specified).toBe(true);
		});
	});

	describe('get ownerElement()', () => {
		it('Returns owner element.', () => {
			const attr = document.createAttribute('test');
			const ownerElement = document.createElement('div');
			attr[PropertySymbol.ownerElement] = ownerElement;
			expect(attr.ownerElement === ownerElement).toBe(true);
		});
	});

	describe('cloneNode()', () => {
		it('Clones the node.', () => {
			const attr = document.createAttribute('test');

			attr[PropertySymbol.namespaceURI] = 'namespaceURI';
			attr[PropertySymbol.name] = 'name';
			attr[PropertySymbol.localName] = 'localName';
			attr[PropertySymbol.prefix] = 'prefix';
			attr[PropertySymbol.value] = 'value';
			attr[PropertySymbol.specified] = false;
			attr[PropertySymbol.ownerElement] = document.createElement('div');

			const clone = attr.cloneNode();

			expect(clone.namespaceURI).toBe(attr.namespaceURI);
			expect(clone.name).toBe(attr.name);
			expect(clone.localName).toBe(attr.localName);
			expect(clone.prefix).toBe(attr.prefix);
			expect(clone.value).toBe(attr.value);
			expect(clone.specified).toBe(attr.specified);
			expect(clone.ownerElement).toBe(null);
		});
	});
});
