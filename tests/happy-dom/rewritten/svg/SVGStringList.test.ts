// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGStringList.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { beforeEach, describe, it, expect } from 'bun:test';
import type BrowserWindow from '../../shim/src/window/BrowserWindow.js';
import Window from '../../shim/src/window/Window.js';
import * as PropertySymbol from '../../shim/src/PropertySymbol.js';
import SVGStringList from '../../src/svg/SVGStringList.js';

describe('SVGStringList', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Returns a new instance', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => '',
				setAttribute: () => {}
			});
			expect(list).toBeInstanceOf(SVGStringList);
		});

		it('Throws an error if constructed without "illegalConstructor" symbol', () => {
			expect(
				() =>
					new window.SVGStringList(Symbol(''), window, {
						getAttribute: () => '',
						setAttribute: () => {}
					})
			).toThrow(new TypeError('Illegal constructor'));
		});
	});

	describe('get [index]()', () => {
		it('Returns item at index', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {}
			});

			expect(list[0]).toBe('key1');
			expect(list[1]).toBe('key2');
			expect(list[2]).toBe('key3');
			expect(list[3]).toBeUndefined();
		});
	});

	describe('get length()', () => {
		it('Returns length', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {}
			});

			expect(list.length).toBe(3);
		});
	});

	describe('numberOfItems', () => {
		it('Returns length', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {}
			});

			expect(list.numberOfItems).toBe(3);
		});
	});

	describe('[Symbol.iterator]()', () => {
		it('Returns iterator', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {}
			});

			const items: string[] = [];

			for (const item of list) {
				items.push(item);
			}

			expect(items.length).toBe(3);

			expect(items[0]).toBe('key1');
			expect(items[1]).toBe('key2');
			expect(items[2]).toBe('key3');
		});
	});

	describe('clear()', () => {
		it('Clears all items', () => {
			let attribute = 'key1 key2 key3';
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});

			list.clear();

			expect(list.length).toBe(0);
			expect(attribute).toBe('');
		});
	});

	describe('initialize()', () => {
		it('Initializes item', () => {
			let attribute = 'key1 key2 key3';
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});

			expect(list.initialize('test')).toBe('test');

			expect(list.length).toBe(1);
			expect(list[0]).toBe('test');

			expect(attribute).toBe('test');
		});

		it('Throws an error if the object is read-only', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {},
				readOnly: true
			});

			expect(() => list.initialize('test')).toThrow(
				new TypeError("Failed to execute 'initialize' on 'SVGStringList': The object is read-only.")
			);
		});
	});

	describe('getItem()', () => {
		it('Returns item at index', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {}
			});

			expect(list.getItem(0)).toBe('key1');
			expect(list.getItem(1)).toBe('key2');
			expect(list.getItem('2')).toBe('key3');

			expect(list.getItem(3)).toBeNull();
		});
	});

	describe('insertItemBefore()', () => {
		it('Inserts item before index', () => {
			let attribute = 'key1 key2 key3';
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});

			expect(list.insertItemBefore('test', 1)).toBe('test');

			expect(list.length).toBe(4);

			expect(list[0]).toBe('key1');
			expect(list[1]).toBe('test');
			expect(list[2]).toBe('key2');
			expect(list[3]).toBe('key3');

			expect(attribute).toBe('key1 test key2 key3');
		});

		it('Throws an error if the object is read-only', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {},
				readOnly: true
			});

			expect(() => list.insertItemBefore('test', 1)).toThrow(
				new TypeError(
					"Failed to execute 'insertItemBefore' on 'SVGStringList': The object is read-only."
				)
			);
		});

		it('Handles indices out of bound', () => {
			let attribute = 'key1 key2 key3';
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});

			list.insertItemBefore('test1', -1);
			list.insertItemBefore('test2', 10);

			expect(list.length).toBe(5);
			expect(list[0]).toBe('test1');
			expect(list[4]).toBe('test2');
		});
	});

	describe('replaceItem()', () => {
		it('Replaces item at index', () => {
			let attribute = 'key1 key2 key3';
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});

			expect(list.replaceItem('test', 1)).toBe('key2');

			expect(list.length).toBe(3);

			expect(list[0]).toBe('key1');
			expect(list[1]).toBe('test');
			expect(list[2]).toBe('key3');

			expect(attribute).toBe('key1 test key3');
		});

		it('Throws an error if the object is read-only', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {},
				readOnly: true
			});

			expect(() => list.replaceItem('test', 1)).toThrow(
				new TypeError(
					"Failed to execute 'replaceItem' on 'SVGStringList': The object is read-only."
				)
			);
		});
	});

	describe('removeItem()', () => {
		it('Removes item at index', () => {
			let attribute = 'key1 key2 key3';
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});

			const item = list.removeItem(1);

			expect(item).toBe('key2');

			expect(list.length).toBe(2);

			expect(list[0]).toBe('key1');
			expect(list[1]).toBe('key3');

			expect(attribute).toBe('key1 key3');

			const item2 = list.removeItem(1);

			expect(item2).toBe('key3');

			expect(list.length).toBe(1);

			expect(list[0]).toBe('key1');
		});

		it('Throws an error if the object is read-only', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {},
				readOnly: true
			});

			expect(() => list.removeItem(1)).toThrow(
				new TypeError("Failed to execute 'removeItem' on 'SVGStringList': The object is read-only.")
			);
		});
	});

	describe('appendItem()', () => {
		it('Appends item', () => {
			let attribute = 'key1 key2 key3';
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => attribute,
				setAttribute: (value) => (attribute = value)
			});

			expect(list.appendItem('test')).toBe('test');

			expect(list.length).toBe(4);

			expect(list[0]).toBe('key1');
			expect(list[1]).toBe('key2');
			expect(list[2]).toBe('key3');
			expect(list[3]).toBe('test');

			expect(attribute).toBe('key1 key2 key3 test');
		});

		it('Throws an error if the object is read-only', () => {
			const list = new window.SVGStringList(PropertySymbol.illegalConstructor, window, {
				getAttribute: () => 'key1 key2 key3',
				setAttribute: () => {},
				readOnly: true
			});

			expect(() => list.appendItem('test')).toThrow(
				new TypeError("Failed to execute 'appendItem' on 'SVGStringList': The object is read-only.")
			);
		});
	});
});
