// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/url/URL.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import URL from '../../shim/src/url/URL.js';
import Blob from '../../shim/src/file/Blob.js';
import type BrowserWindow from '../../shim/src/window/BrowserWindow.js';
import Window from '../../shim/src/window/Window.js';
import { Blob as NodeJSBlob } from 'buffer';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('URL', () => {
	let window: BrowserWindow;
	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Throws an error from the Window context if the URL is invalid.', () => {
			let error: Error | null = null;
			try {
				new window.URL('invalid-url');
			} catch (e) {
				error = <Error>e;
			}
			expect(error).toEqual(new TypeError('Invalid URL'));
			expect(error!.constructor).toBe(window.TypeError);
		});
	});

	describe('createObjectURL()', () => {
		it('Creates a string containing a URL representing the object given in the parameter.', () => {
			const blob = new Blob(['TEST']);
			expect(window.URL.createObjectURL(blob).startsWith('blob:nodedata:')).toBe(true);
		});

		it('Supports Node.js Blob objects.', () => {
			const blob = new NodeJSBlob(['TEST']);
			expect(window.URL.createObjectURL(blob).startsWith('blob:nodedata:')).toBe(true);
		});
	});
});
