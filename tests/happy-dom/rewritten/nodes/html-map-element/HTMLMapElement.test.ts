// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-map-element/HTMLMapElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLMapElement from '../../../shim/src/nodes/html-map-element/HTMLMapElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLMapElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLMapElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('map');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLMapElement', () => {
			expect(element instanceof HTMLMapElement).toBe(true);
		});
	});

	describe('get areas()', () => {
		it('Should return areas', () => {
			const div = document.createElement('div');

			div.innerHTML =
				'<area shape="circle" coords="15,15,5" /><area shape="circle" coords="15,15,5" />';
			element.appendChild(div);

			expect(element.areas.length).toBe(2);
			expect(element.areas[0]).toBe(div.children[0]);
			expect(element.areas[1]).toBe(div.children[1]);

			div.children[0].remove();

			expect(element.areas.length).toBe(1);
			expect(element.areas[0]).toBe(div.children[0]);
		});

		it('Should return an empty collection', () => {
			expect(element.areas.length).toBe(0);
		});
	});

	describe('get name()', () => {
		it('Should return name', () => {
			element.setAttribute('name', 'test');
			expect(element.name).toBe('test');
		});

		it('Should return an empty string', () => {
			expect(element.name).toBe('');
		});
	});

	describe('set name()', () => {
		it('Should set name', () => {
			element.name = 'test';
			expect(element.getAttribute('name')).toBe('test');
		});
	});
});
