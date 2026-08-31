// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/file/File.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import File from '../../shim/src/file/File.js';
import { afterEach, describe, it, expect, spyOn } from 'bun:test';
import { restoreAllMocks } from '../../adapter/index.js';

const NOW = 1;

describe('File', () => {
	afterEach(() => {
		restoreAllMocks();
	});

	describe('get name()', () => {
		it('Returns the name of the File.', () => {
			const file = new File(['TEST'], 'filename.jpg');
			expect(file.name).toBe('filename.jpg');
		});
	});

	describe('get lastModified()', () => {
		it('Returns the current time if not provided to the constructor.', () => {
			spyOn(Date, 'now').mockImplementation(() => NOW);
			const file = new File(['TEST'], 'filename.jpg');
			expect(file.lastModified).toBe(NOW);
		});

		it('Returns the current time if not provided to the constructor.', () => {
			const file = new File(['TEST'], 'filename.jpg', { lastModified: NOW });
			expect(file.lastModified).toBe(NOW);
		});
	});
});
