// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/child-node/NonDocumentChildNodeUtility.test.ts
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
import NonDocumentChildNodeUtility from '../../../src/nodes/child-node/NonDocumentChildNodeUtility.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('NonDocumentChildNodeUtility', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;
	});

	describe('previousElementSibling()', () => {
		it('Returns the previous element sibling.', () => {
			const parent = document.createElement('div');
			const comment = document.createComment('test');
			const element1 = document.createElement('div');
			const element2 = document.createElement('div');

			parent.appendChild(element1);
			parent.appendChild(comment);
			parent.appendChild(element2);

			expect(NonDocumentChildNodeUtility.previousElementSibling(comment)).toBe(element1);
		});
	});

	describe('nextElementSibling()', () => {
		it('Returns the next element sibling.', () => {
			const parent = document.createElement('div');
			const comment = document.createComment('test');
			const element1 = document.createElement('div');
			const element2 = document.createElement('div');

			parent.appendChild(element1);
			parent.appendChild(comment);
			parent.appendChild(element2);

			expect(NonDocumentChildNodeUtility.nextElementSibling(comment)).toBe(element2);
		});
	});
});
