// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/file/Blob.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Blob from '../../shim/src/file/Blob.js';
import { describe, it, expect } from 'bun:test';
import * as PropertySymbol from '../../shim/src/PropertySymbol.js';

describe('Blob', () => {
	describe('get size()', () => {
		it('Returns the correct size when bits is an Array of strings.', () => {
			const blob = new Blob(['TEST']);
			expect(blob.size).toBe(4);
		});
	});

	describe('get type()', () => {
		it('Returns the type sent into the constructor.', () => {
			const blob = new Blob(['TEST'], { type: 'TYPE' });
			expect(blob.type).toBe('type');
		});
	});

	describe('slice()', () => {
		it('Returns a slice of the data when bits is an Array of strings.', () => {
			const blob = new Blob(['TEST']);
			expect(blob.slice(1, 2)[PropertySymbol.buffer].toString()).toBe('E');
		});
	});

	// Reference:
	// https://github.com/web-std/io/blob/c88170bf24f064adfbb3586a21fb76650ca5a9ab/packages/blob/test/blob.spec.js#L35-L44
	describe('arrayBuffer()', () => {
		it('Returns "Promise<ArrayBuffer>".', async () => {
			const str = 'TEST';
			const blob = new Blob([str]);
			const buffer = await blob.arrayBuffer();
			const result = new Uint8Array(buffer);
			for (let i = 0; i < result.length; ++i) {
				expect(result[i]).toBe(str[i].charCodeAt(0));
			}
		});
	});

	describe('stream()', () => {
		it('Returns all data in a ReadableStream.', async () => {
			const data = 'Test1Test2';
			const blob = new Blob(['Test1', 'Test2']);
			const stream = blob.stream();

			let i = 0;
			for await (const chunk of stream.values()) {
				for (const value of chunk) {
					expect(i).toBeLessThan(data.length);
					expect(value).toBe(data[i].charCodeAt(0));
					++i;
				}
			}
			expect(i).toBe(data.length);
		});
	});

	describe('toString()', () => {
		it('Returns "[object Blob]".', () => {
			const blob = new Blob(['TEST']);
			expect(blob.toString()).toBe('[object Blob]');
		});
	});
});
