// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-input-element/FileList.test.ts
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
import File from '../../../shim/src/file/File.js';
import type HTMLInputElement from '../../../shim/src/nodes/html-input-element/HTMLInputElement.js';
import { beforeEach, afterEach, describe, it, expect } from 'bun:test';

describe('FileList', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;
	});

	describe('item()', () => {
		it('Returns file at index.', () => {
			const element = <HTMLInputElement>document.createElement('input');
			const file1 = new File([''], 'file.txt');
			const file2 = new File([''], 'file2.txt');

			element.files.push(file1);
			element.files.push(file2);

			expect(element.files.item(0)).toBe(file1);
			expect(element.files.item(1)).toBe(file2);
		});
	});
});
