// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/browser/Browser.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Browser from '../../shim/src/browser/Browser.js';
import BrowserContext from '../../shim/src/browser/BrowserContext.js';
import BrowserPage from '../../shim/src/browser/BrowserPage.js';
import DefaultBrowserSettings from '../../src/browser/DefaultBrowserSettings';
import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import { restoreAllMocks } from '../../adapter/index.js';

describe('Browser', () => {
	afterEach(() => {
		restoreAllMocks();
	});

	describe('get contexts()', () => {
		it('Returns the contexts.', async () => {
			const browser = new Browser();
			expect(browser.contexts.length).toBe(1);
			expect(browser.contexts[0]).toBe(browser.defaultContext);

			const incognitoContext = browser.newIncognitoContext();
			expect(browser.contexts.length).toBe(2);
			expect(browser.contexts[0]).toBe(browser.defaultContext);
			expect(browser.contexts[1]).toBe(incognitoContext);

			await incognitoContext.close();

			expect(browser.contexts.length).toBe(1);
			expect(browser.contexts[0]).toBe(browser.defaultContext);

			let error: Error | null = null;

			try {
				await browser.defaultContext.close();
			} catch (e) {
				error = <Error>e;
			}

			expect(error).toEqual(
				new Error(
					'Cannot close the default context. Use `browser.close()` to close the browser instead.'
				)
			);
			expect(browser.contexts.length).toBe(1);

			await browser.close();

			expect(browser.contexts.length).toBe(0);
		});
	});

	describe('get closed()', () => {
		it('Returns "false" if the browser is not closed.', () => {
			expect(new Browser().closed).toBe(false);
		});

		it('Returns "true" if the browser is closed.', async () => {
			const browser = new Browser();
			await browser.close();
			expect(browser.closed).toBe(true);
		});
	});

	describe('get settings()', () => {
		it('Returns the settings.', () => {
			expect(new Browser().settings).toEqual(DefaultBrowserSettings);
		});

		it('Returns the settings with custom settings.', () => {
			const settings = {
				enableJavaScriptEvaluation: true,
				navigator: {
					userAgent: 'test'
				}
			};
			expect(new Browser({ settings }).settings).toEqual({
				...DefaultBrowserSettings,
				...settings,
				navigator: {
					...DefaultBrowserSettings.navigator,
					...settings.navigator
				}
			});
		});
	});

	describe('get console()', () => {
		it('Returns "null" if no console is provided.', () => {
			expect(new Browser().console).toBe(null);
		});

		it('Returns console sent into the constructor.', () => {
			expect(new Browser({ console }).console).toBe(console);
		});
	});

	describe('get defaultContext()', () => {
		it('Returns the default context.', () => {
			const browser = new Browser();
			expect(browser.defaultContext instanceof BrowserContext).toBe(true);
			expect(browser.contexts[0]).toBe(browser.defaultContext);
		});

		it('Throws an error if the browser has been closed.', async () => {
			const browser = new Browser();
			await browser.close();
			expect(() => browser.defaultContext).toThrow(
				'No default context. The browser has been closed.'
			);
		});
	});

	describe('close()', () => {
		it('Closes the browser.', async () => {
			const browser = new Browser();
			const defaultContext = browser.defaultContext;
			const originalClose = defaultContext.close;
			let isContextClosed = false;

			spyOn(defaultContext, 'close').mockImplementation(() => {
				isContextClosed = true;
				return originalClose.call(defaultContext);
			});

			await browser.close();
			expect(browser.contexts.length).toBe(0);
			expect(isContextClosed).toBe(true);
		});
	});

	describe('waitUntilComplete()', () => {
		it('Returns a promise that is resolved when all resources has been loaded, fetch has completed, and all async tasks such as timers are complete.', async () => {
			const browser = new Browser();
			const page1 = browser.newPage();
			const page2 = browser.newPage();
			const page3 = browser.newIncognitoContext().newPage();
			page1.evaluate('setTimeout(() => { globalThis.test = 1; }, 10);');
			page2.evaluate('setTimeout(() => { globalThis.test = 2; }, 10);');
			page3.evaluate('setTimeout(() => { globalThis.test = 3; }, 10);');
			await browser.waitUntilComplete();
			expect((<any>page1.mainFrame.window)['test']).toBe(1);
			expect((<any>page2.mainFrame.window)['test']).toBe(2);
			expect((<any>page3.mainFrame.window)['test']).toBe(3);
		});
	});

	describe('abort()', () => {
		it('Aborts all ongoing operations.', async () => {
			const browser = new Browser();
			const page1 = browser.newPage();
			const page2 = browser.newPage();
			const page3 = browser.newIncognitoContext().newPage();
			page1.evaluate('setTimeout(() => { globalThis.test = 1; }, 10);');
			page2.evaluate('setTimeout(() => { globalThis.test = 2; }, 10);');
			page3.evaluate('setTimeout(() => { globalThis.test = 3; }, 10);');
			browser.abort();
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect((<any>page1.mainFrame.window)['test']).toBeUndefined();
			expect((<any>page2.mainFrame.window)['test']).toBeUndefined();
			expect((<any>page3.mainFrame.window)['test']).toBeUndefined();
		});
	});

	describe('newIncognitoContext()', () => {
		it('Creates a new incognito context.', () => {
			const browser = new Browser();
			const context = browser.newIncognitoContext();
			expect(context instanceof BrowserContext).toBe(true);
			expect(browser.contexts.length).toBe(2);
			expect(browser.contexts[1]).toBe(context);
		});

		it('Throws an error if the browser has been closed.', async () => {
			const browser = new Browser();
			await browser.close();
			expect(() => browser.newIncognitoContext()).toThrow(
				'No default context. The browser has been closed.'
			);
		});
	});

	describe('newPage()', () => {
		it('Creates a new page.', () => {
			const browser = new Browser();
			const page = browser.newPage();
			expect(page instanceof BrowserPage).toBe(true);
			expect(browser.contexts.length).toBe(1);
			expect(browser.contexts[0].pages.length).toBe(1);
			expect(browser.contexts[0].pages[0]).toBe(page);
		});

		it('Throws an error if the browser has been closed.', async () => {
			const browser = new Browser();
			await browser.close();
			expect(() => browser.newPage()).toThrow('No default context. The browser has been closed.');
		});
	});
});
