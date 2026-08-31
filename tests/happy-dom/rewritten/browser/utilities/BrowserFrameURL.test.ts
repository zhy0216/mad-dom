// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/browser/utilities/BrowserFrameURL.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach, mock } from 'bun:test';
import { restoreAllMocks } from '../../../adapter/index.js';
import Browser from '../../../shim/src/browser/Browser.js';
import BrowserFrameURL from '../../../src/browser/utilities/BrowserFrameURL';
import * as PropertySymbol from '../../../shim/src/PropertySymbol.js';

describe('BrowserFrameURL', () => {
	afterEach(() => {
		restoreAllMocks();
	});

	describe('getRelativeURL()', () => {
		it('Returns URL resolved against frame location.', () => {
			const browser = new Browser();
			const page = browser.defaultContext.newPage();
			page.mainFrame.url = 'http://localhost:3000/path/';

			const result = BrowserFrameURL.getRelativeURL(page.mainFrame, '/test');

			expect(result.href).toBe('http://localhost:3000/test');
			expect(result.origin).toBe('http://localhost:3000');

			browser.close();
		});

		it('Returns about:blank URL for about: protocol.', () => {
			const browser = new Browser();
			const page = browser.defaultContext.newPage();

			const result = BrowserFrameURL.getRelativeURL(page.mainFrame, 'about:blank');

			expect(result.href).toBe('about:blank');

			browser.close();
		});

		it('Returns about:blank URL for javascript: protocol.', () => {
			const browser = new Browser();
			const page = browser.defaultContext.newPage();

			const result = BrowserFrameURL.getRelativeURL(page.mainFrame, 'javascript:void(0)');

			expect(result.href).toBe('javascript:void(0)');

			browser.close();
		});

		it('Returns about:blank when url is null or undefined.', () => {
			const browser = new Browser();
			const page = browser.defaultContext.newPage();

			expect(BrowserFrameURL.getRelativeURL(page.mainFrame, null).href).toBe('about:blank');
			expect(BrowserFrameURL.getRelativeURL(page.mainFrame, undefined).href).toBe('about:blank');

			browser.close();
		});

		it('Returns correct URL when window.location getter is mocked with partial mock.', () => {
			const browser = new Browser();
			const page = browser.defaultContext.newPage();
			page.mainFrame.url = 'http://localhost:3000/path/';

			// Mock window.location getter with a partial mock (missing href, origin, etc.)
			// This simulates what testing frameworks like Jest do when mocking window.location
			const mockLocation = {
				reload: mock()
			};

			Object.defineProperty(page.mainFrame.window, 'location', {
				get: () => mockLocation,
				configurable: true
			});

			// Verify the mock is in place - window.location should return our mock
			expect(page.mainFrame.window.location).toBe(mockLocation);
			expect(page.mainFrame.window.location.href).toBeUndefined();

			// But internal PropertySymbol.location should still return the real location
			expect(page.mainFrame.window[PropertySymbol.location].href).toBe(
				'http://localhost:3000/path/'
			);

			// getRelativeURL should still work correctly using internal location
			const result = BrowserFrameURL.getRelativeURL(page.mainFrame, '/test');

			expect(result.href).toBe('http://localhost:3000/test');
			expect(result.origin).toBe('http://localhost:3000');

			browser.close();
		});
	});
});
