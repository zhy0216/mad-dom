// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/event/DataTransferItemList.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import DataTransferItemList from '../../shim/src/event/DataTransferItemList.js';
import File from '../../shim/src/file/File.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('DataTransferItemList', () => {
	let dataTransferItemList: DataTransferItemList;

	beforeEach(() => {
		dataTransferItemList = new DataTransferItemList();
	});

	describe('get length()', () => {
		it('Returns length.', () => {
			dataTransferItemList.add('test1', 'text/plain');
			dataTransferItemList.add('test2', 'text/plain');

			expect(dataTransferItemList.length).toBe(2);
		});
	});

	describe('add()', () => {
		it('Adds an item.', () => {
			const file = new File(['test3'], 'test3.txt', { type: 'text/html' });
			dataTransferItemList.add('test1', 'text/plain');
			dataTransferItemList.add('test2', 'text/plain');
			dataTransferItemList.add(file);

			expect(dataTransferItemList.length).toBe(3);

			let data1;
			let data2;

			dataTransferItemList[0].getAsString((s) => (data1 = s));
			dataTransferItemList[1].getAsString((s) => (data2 = s));

			expect(data1).toBe('test1');
			expect(data2).toBe('test2');
			expect(dataTransferItemList[0].type).toBe('text/plain');
			expect(dataTransferItemList[0].kind).toBe('string');
			expect(dataTransferItemList[1].type).toBe('text/plain');
			expect(dataTransferItemList[1].kind).toBe('string');
			expect(dataTransferItemList[2].type).toBe('text/html');
			expect(dataTransferItemList[2].kind).toBe('file');
			expect(dataTransferItemList[2].getAsFile()).toBe(file);
		});

		it('Throws an error if the first parameter is not a File and the second parameter is not a string.', () => {
			expect(() => dataTransferItemList.add('test1')).toThrow(
				"Failed to execute 'add' on 'DataTransferItemList': parameter 1 is not of type 'File'."
			);
		});
	});

	describe('remove()', () => {
		it('Removes an item.', () => {
			dataTransferItemList.add('test1', 'text/plain');
			dataTransferItemList.add('test2', 'text/plain');

			expect(dataTransferItemList.length).toBe(2);

			dataTransferItemList.remove(0);

			let data;
			dataTransferItemList[0].getAsString((s) => (data = s));
			expect(dataTransferItemList.length).toBe(1);
			expect(data).toBe('test2');
			expect(dataTransferItemList[0].type).toBe('text/plain');
			expect(dataTransferItemList[0].kind).toBe('string');
		});
	});

	describe('clear()', () => {
		it('Clears the list.', () => {
			dataTransferItemList.add('test1', 'text/plain');
			dataTransferItemList.add('test2', 'text/plain');

			expect(dataTransferItemList.length).toBe(2);

			dataTransferItemList.clear();

			expect(dataTransferItemList.length).toBe(0);
		});
	});
});
