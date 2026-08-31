// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/CSSStyleSheet.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import DOMException from '../../shim/src/exception/DOMException.js';
import DOMExceptionNameEnum from '../../src/exception/DOMExceptionNameEnum.js';
import type CSSStyleSheet from '../../shim/src/css/CSSStyleSheet.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import type BrowserWindow from '../../shim/src/window/BrowserWindow.js';
import Window from '../../shim/src/window/Window.js';

describe('CSSStyleSheet', () => {
	let window: BrowserWindow;
	let cssStyleSheet: CSSStyleSheet;

	beforeEach(() => {
		window = new Window();
		cssStyleSheet = new window.CSSStyleSheet();
	});

	describe('insertRule()', () => {
		it('Inserts a rule at an index.', () => {
			cssStyleSheet.insertRule('div { background-color: green }');
			cssStyleSheet.insertRule('span { background-color: green }');
			expect(cssStyleSheet.insertRule('button { background-color: green }', 1)).toBe(1);
			expect(cssStyleSheet.cssRules[0].cssText).toBe('div { background-color: green; }');
			expect(cssStyleSheet.cssRules[1].cssText).toBe('button { background-color: green; }');
			expect(cssStyleSheet.cssRules[2].cssText).toBe('span { background-color: green; }');
		});

		it('Inserts a rule.', () => {
			cssStyleSheet.insertRule('div { background-color: green }');
			expect(cssStyleSheet.insertRule('span { background-color: green }')).toBe(1);
		});

		it('Throws an error when there are 0 arguments.', () => {
			expect(() => {
				// @ts-expect-error
				cssStyleSheet.insertRule();
			}).toThrow(
				new TypeError(
					`Failed to execute 'insertRule' on 'CSSStyleSheet': 1 argument required, but only 0 present.`
				)
			);
		});

		it('Throws error when a rule with invalid CSS is inserted.', () => {
			expect(() => {
				cssStyleSheet.insertRule('background-color: green');
			}).toThrow(
				new window.DOMException(
					`Failed to execute 'insertRule' on 'CSSStyleSheet': Failed to parse the rule 'background-color: green'.`,
					DOMExceptionNameEnum.syntaxError
				)
			);
		});

		it('Throws error when attempting to add more than one rule.', () => {
			expect(() => {
				cssStyleSheet.insertRule(
					'div { background-color: green } span { background-color: green }'
				);
			}).toThrow(
				new window.DOMException(
					`Failed to execute 'insertRule' on 'CSSStyleSheet': Failed to parse the rule 'div { background-color: green } span { background-color: green }'.`,
					DOMExceptionNameEnum.syntaxError
				)
			);
		});

		it('Throws error if index is more than the length of the CSS rule list.', () => {
			cssStyleSheet.insertRule('div { background-color: green }');

			expect(() => {
				cssStyleSheet.insertRule('button { background-color: green }', 2);
			}).toThrow(
				new window.DOMException(
					`Failed to execute 'insertRule' on 'CSSStyleSheet': The index provided (2) is larger than the maximum index (0).`,
					DOMExceptionNameEnum.indexSizeError
				)
			);
		});
	});

	describe('deleteRule()', () => {
		it('Deletes a rule.', () => {
			cssStyleSheet.insertRule('div { background-color: green }');
			cssStyleSheet.insertRule('span { background-color: green }');
			cssStyleSheet.insertRule('button { background-color: green }');
			cssStyleSheet.deleteRule(1);
			expect(cssStyleSheet.cssRules.length).toBe(2);
			expect(cssStyleSheet.cssRules[0].cssText).toBe('div { background-color: green; }');
			expect(cssStyleSheet.cssRules[1].cssText).toBe('button { background-color: green; }');
		});

		it('Throws an error when there are 0 arguments.', () => {
			expect(() => {
				// @ts-expect-error
				cssStyleSheet.deleteRule();
			}).toThrow(
				new TypeError(
					`Failed to execute 'deleteRule' on 'CSSStyleSheet': 1 argument required, but only 0 present.`
				)
			);
		});
	});

	describe('replace()', () => {
		it('Replaces all CSS rules.', () => {
			cssStyleSheet.insertRule('div { background-color: green }');
			cssStyleSheet.insertRule('span { background-color: green }');

			expect(cssStyleSheet.replace('button { background-color: green }')).toBeInstanceOf(Promise);

			expect(cssStyleSheet.cssRules.length).toBe(1);
			expect(cssStyleSheet.cssRules[0].cssText).toBe('button { background-color: green; }');
		});

		it('Throws an error when there are 0 arguments.', async () => {
			let error: Error;

			try {
				// @ts-expect-error
				await cssStyleSheet.replace();
			} catch (e) {
				error = e;
			}

			expect(error!).toBeInstanceOf(window.TypeError);
			expect(error!.message).toBe(
				`Failed to execute 'replace' on 'CSSStyleSheet': 1 argument required, but only 0 present.`
			);
		});
	});

	describe('replaceSync()', () => {
		it('Replaces all CSS rules.', () => {
			cssStyleSheet.insertRule('div { background-color: green }');
			cssStyleSheet.insertRule('span { background-color: green }');

			cssStyleSheet.replaceSync('button { background-color: green }');

			expect(cssStyleSheet.cssRules.length).toBe(1);
			expect(cssStyleSheet.cssRules[0].cssText).toBe('button { background-color: green; }');
		});

		it('Throws an error when there are 0 arguments.', () => {
			expect(() => {
				// @ts-expect-error
				cssStyleSheet.replaceSync();
			}).toThrow(
				new TypeError(
					`Failed to execute 'replaceSync' on 'CSSStyleSheet': 1 argument required, but only 0 present.`
				)
			);
		});
	});
});
