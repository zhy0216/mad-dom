// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/browser/BrowserContext.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Browser from '../../shim/src/browser/Browser.js';
import BrowserPage from '../../shim/src/browser/BrowserPage.js';
import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import { restoreAllMocks } from '../../adapter/index.js';

describe('BrowserContext', () => {
	afterEach(() => {
		restoreAllMocks();
	});

	describe('get pages()', () => {
		it('Returns the pages.', () => {
			const browser = new Browser();
			expect(browser.defaultContext.pages.length).toBe(0);
			const page = browser.defaultContext.newPage();
			expect(browser.defaultContext.pages.length).toBe(1);
			expect(browser.defaultContext.pages[0]).toBe(page);
		});
	});

	describe('get browser()', () => {
		it('Returns the browser.', () => {
			const browser = new Browser();
			expect(browser.defaultContext.browser).toBe(browser);
		});
	});

	describe('get closed()', () => {
		it('Returns "false" if the context is not closed.', () => {
			const browser = new Browser();
			expect(browser.defaultContext.closed).toBe(false);
		});

		it('Returns "true" if the default context is closed.', async () => {
			const browser = new Browser();
			const defaultContext = browser.defaultContext;
			await browser.close();
			expect(defaultContext.closed).toBe(true);
		});

		it('Returns "true" if the inkognito context is closed.', async () => {
			const browser = new Browser();
			const incognitoContext = browser.newIncognitoContext();
			await incognitoContext.close();
			expect(incognitoContext.closed).toBe(true);
		});
	});

	describe('close()', () => {
		it('Closes the context.', async () => {
			const browser = new Browser();
			const context = browser.defaultContext;
			const incognitoContext = browser.newIncognitoContext();
			const page1 = context.newPage();
			const page2 = context.newPage();
			const incognitoPage1 = incognitoContext.newPage();
			const incognitoPage2 = incognitoContext.newPage();
			const originalClose1 = page1.close;
			const originalClose2 = page2.close;
			const originalIncognitoClose1 = incognitoPage1.close;
			const originalIncognitoClose2 = incognitoPage2.close;
			let pagesClosed = 0;

			spyOn(page1, 'close').mockImplementation(() => {
				pagesClosed++;
				return originalClose1.call(page1);
			});
			spyOn(page2, 'close').mockImplementation(() => {
				pagesClosed++;
				return originalClose2.call(page2);
			});
			spyOn(incognitoPage1, 'close').mockImplementation(() => {
				pagesClosed++;
				return originalIncognitoClose1.call(incognitoPage1);
			});
			spyOn(incognitoPage2, 'close').mockImplementation(() => {
				pagesClosed++;
				return originalIncognitoClose2.call(incognitoPage2);
			});

			incognitoPage1.console.log('Incognito Page 1');
			incognitoPage1.mainFrame.document.cookie = 'test=1';

			expect(incognitoContext.cookieContainer.getCookies().length).toBe(1);

			expect(browser.contexts.length).toBe(2);

			await incognitoContext.close();

			expect(browser.contexts.length).toBe(1);
			expect(pagesClosed).toBe(2);
			expect(incognitoContext.cookieContainer.getCookies().length).toBe(0);
			expect(incognitoPage1.virtualConsolePrinter.readAsString()).toBe('');
			expect(incognitoPage1.virtualConsolePrinter.closed).toBe(true);

			let error: Error | null = null;
			try {
				await context.close();
			} catch (e) {
				error = <Error>e;
			}
			expect(browser.contexts.length).toBe(1);
			expect(pagesClosed).toBe(2);
			expect(error).toEqual(
				new Error(
					'Cannot close the default context. Use `browser.close()` to close the browser instead.'
				)
			);

			await browser.close();

			expect(browser.contexts.length).toBe(0);
			expect(pagesClosed).toBe(4);
		});
	});

	describe('waitUntilComplete()', () => {
		it('Waits for all pages to complete.', async () => {
			const browser = new Browser();
			const page1 = browser.newPage();
			const page2 = browser.newPage();
			page1.evaluate('setTimeout(() => { globalThis.test = 1; }, 10);');
			page2.evaluate('setTimeout(() => { globalThis.test = 2; }, 10);');
			await browser.defaultContext.waitUntilComplete();
			expect(page1.mainFrame.window['test']).toBe(1);
			expect(page2.mainFrame.window['test']).toBe(2);
		});
	});

	describe('abort()', () => {
		it('Aborts all ongoing operations.', async () => {
			const browser = new Browser();
			const page1 = browser.newPage();
			const page2 = browser.newPage();
			page1.evaluate('setTimeout(() => { globalThis.test = 1; }, 10);');
			page2.evaluate('setTimeout(() => { globalThis.test = 2; }, 10);');
			browser.defaultContext.abort();
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(page1.mainFrame.window['test']).toBeUndefined();
			expect(page2.mainFrame.window['test']).toBeUndefined();
		});
	});

	describe('newPage()', () => {
		it('Creates a new page.', () => {
			const browser = new Browser();
			const page = browser.defaultContext.newPage();
			expect(page instanceof BrowserPage).toBe(true);
			expect(browser.defaultContext.pages.length).toBe(1);
			expect(browser.defaultContext.pages[0]).toBe(page);
		});
	});
});
