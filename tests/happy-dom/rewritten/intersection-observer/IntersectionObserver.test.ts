// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/intersection-observer/IntersectionObserver.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Window from '../../shim/src/window/Window.js';
import type Document from '../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('IntersectionObserver', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;
	});

	describe('observe()', () => {
		it('Does nothing.', async () => {
			const div = document.createElement('div');
			const observer = new window.IntersectionObserver(() => {}, {});

			observer.observe(div);
		});
	});

	describe('unobserve()', () => {
		it('Does nothing.', () => {
			const div = document.createElement('div');
			const observer = new window.IntersectionObserver(() => {}, {});

			observer.observe(div);
			observer.unobserve(div);
		});
	});

	describe('disconnect()', () => {
		it('Does nothing.', () => {
			const div = document.createElement('div');
			const observer = new window.IntersectionObserver(() => {}, {});

			observer.observe(div);
			observer.disconnect();
		});
	});

	describe('takeRecords()', () => {
		it('Returns empty array.', () => {
			const observer = new window.IntersectionObserver(() => {});

			expect(observer.takeRecords()).toEqual([]);
		});
	});
});
