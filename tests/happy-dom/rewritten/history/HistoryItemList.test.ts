// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/history/HistoryItemList.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import IBrowserFrame from '../../shim/src/browser/types/IBrowserFrame.js';
import Browser from '../../shim/src/browser/Browser.js';
import HistoryScrollRestorationEnum from '../../src/history/HistoryScrollRestorationEnum.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import * as PropertySymbol from '../../shim/src/PropertySymbol.js';
import HistoryItemList from '../../src/history/HistoryItemList.js';

describe('HistoryItemList', () => {
	describe('get currentItem()', () => {
		it('Returns the current history item.', () => {
			const history = new HistoryItemList();
			expect(history.currentItem).toEqual({
				title: '',
				href: 'about:blank',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
			history.push({
				title: 'Example',
				href: 'https://example.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
			expect(history.currentItem).toEqual({
				title: 'Example',
				href: 'https://example.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
		});
	});

	describe('get items()', () => {
		it('Returns the history items.', () => {
			const history = new HistoryItemList();
			expect(history.items).toEqual([
				{
					title: '',
					href: 'about:blank',
					state: null,
					popState: false,
					scrollRestoration: HistoryScrollRestorationEnum.auto,
					method: 'GET',
					formData: null
				}
			]);
			history.push({
				title: 'Example',
				href: 'https://example.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
			expect(history.items).toEqual([
				{
					title: '',
					href: 'about:blank',
					state: null,
					popState: false,
					scrollRestoration: HistoryScrollRestorationEnum.auto,
					method: 'GET',
					formData: null
				},
				{
					title: 'Example',
					href: 'https://example.com',
					state: null,
					popState: false,
					scrollRestoration: HistoryScrollRestorationEnum.auto,
					method: 'GET',
					formData: null
				}
			]);
		});
	});

	describe('push()', () => {
		it('Adds an history item to the list and sets currentItem to the new item', () => {
			const history = new HistoryItemList();
			history.push({
				title: 'Example',
				href: 'https://example.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
			expect(history.items).toEqual([
				{
					title: '',
					href: 'about:blank',
					state: null,
					popState: false,
					scrollRestoration: HistoryScrollRestorationEnum.auto,
					method: 'GET',
					formData: null
				},
				{
					title: 'Example',
					href: 'https://example.com',
					state: null,
					popState: false,
					scrollRestoration: HistoryScrollRestorationEnum.auto,
					method: 'GET',
					formData: null
				}
			]);
			expect(history.currentItem).toEqual({
				title: 'Example',
				href: 'https://example.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
			history.push({
				title: 'Example 2',
				href: 'https://example2.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.manual,
				method: 'POST',
				formData: null
			});
			expect(history.currentItem).toEqual({
				title: 'Example 2',
				href: 'https://example2.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.manual,
				method: 'POST',
				formData: null
			});
		});
	});

	describe('replace()', () => {
		it('Replaces the current history item with a new one', () => {
			const history = new HistoryItemList();
			history.push({
				title: 'Example',
				href: 'https://example.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
			history.replace({
				title: 'Example 2',
				href: 'https://example2.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.manual,
				method: 'POST',
				formData: null
			});
			expect(history.items).toEqual([
				{
					title: '',
					href: 'about:blank',
					state: null,
					popState: false,
					scrollRestoration: HistoryScrollRestorationEnum.auto,
					method: 'GET',
					formData: null
				},
				{
					title: 'Example 2',
					href: 'https://example2.com',
					state: null,
					popState: false,
					scrollRestoration: HistoryScrollRestorationEnum.manual,
					method: 'POST',
					formData: null
				}
			]);
			expect(history.currentItem).toEqual({
				title: 'Example 2',
				href: 'https://example2.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.manual,
				method: 'POST',
				formData: null
			});
		});
	});

	describe('clear()', () => {
		it('Clears the history items and resets currentItem', () => {
			const history = new HistoryItemList();
			history.push({
				title: 'Example',
				href: 'https://example.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
			history.push({
				title: 'Example 2',
				href: 'https://example2.com',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.manual,
				method: 'POST',
				formData: null
			});
			history.clear();
			expect(history.items).toEqual([
				{
					title: '',
					href: 'about:blank',
					state: null,
					popState: false,
					scrollRestoration: HistoryScrollRestorationEnum.auto,
					method: 'GET',
					formData: null
				}
			]);
			expect(history.currentItem).toEqual({
				title: '',
				href: 'about:blank',
				state: null,
				popState: false,
				scrollRestoration: HistoryScrollRestorationEnum.auto,
				method: 'GET',
				formData: null
			});
		});
	});
});
