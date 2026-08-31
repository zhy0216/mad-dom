// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/character-data/CharacterDataUtility.test.ts
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
import CharacterDataUtility from '../../../src/nodes/character-data/CharacterDataUtility.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('CharacterDataTest', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;
	});

	describe('appendData()', () => {
		it('Appends data.', () => {
			const node = document.createComment('test');
			CharacterDataUtility.appendData(node, 'appended');
			expect(node.data).toBe('testappended');
		});
	});

	describe('deleteData()', () => {
		it('Deletes data.', () => {
			const node = document.createComment('longstring');
			CharacterDataUtility.deleteData(node, 1, 3);
			expect(node.data).toBe('lstring');
		});
	});

	describe('insertData()', () => {
		it('Inserts data.', () => {
			const node = document.createComment('longstring');
			CharacterDataUtility.insertData(node, 1, 'test');
			expect(node.data).toBe('ltestongstring');
		});
	});

	describe('replaceData()', () => {
		it('Replaces data.', () => {
			const node = document.createComment('longstring');
			CharacterDataUtility.replaceData(node, 1, 3, 'test');
			expect(node.data).toBe('lteststring');
		});
	});

	describe('substringData()', () => {
		it('Returns a sub-string.', () => {
			const node = document.createComment('longstring');
			expect(CharacterDataUtility.substringData(node, 1, 3)).toBe('ong');
		});
	});
});
