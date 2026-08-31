// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/comment/Comment.test.ts
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
import Comment from '../../../shim/src/nodes/comment/Comment.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('Comment', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;
	});

	describe('constructor()', () => {
		it('Creates a new Comment node.', () => {
			const node = new window.Comment('test');
			expect(node).toBeInstanceOf(Comment);
			expect(node.data).toBe('test');
		});
	});

	describe('get nodeName()', () => {
		it('Returns "#comment".', () => {
			const node = document.createComment('test');
			expect(node.nodeName).toBe('#comment');
		});
	});

	describe('toString()', () => {
		it('Returns "[object Comment]".', () => {
			const node = document.createComment('test');
			expect(node.toString()).toBe('[object Comment]');
		});
	});

	describe('cloneNode()', () => {
		it('Clones the node.', () => {
			const node = document.createComment('test');
			const clone = node.cloneNode();
			expect(clone.data).toBe(node.data);
		});
	});
});
