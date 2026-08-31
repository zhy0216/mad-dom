// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/cookie/urilities/CookieURLUtility.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import CookieURLUtility from '../../../src/cookie/urilities/CookieURLUtility.js';
import CookieSameSiteEnum from '../../../shim/src/cookie/enums/CookieSameSiteEnum.js';
import type ICookie from '../../../shim/src/cookie/ICookie.js';
import URL from '../../../shim/src/url/URL.js';
import { describe, it, expect } from 'bun:test';

describe('CookieURLUtility', () => {
	describe('cookieMatchesURL()', () => {
		it('Returns true for matching cookie and URL.', () => {
			const originURL = new URL('https://example.com/path/');
			const cookie: ICookie = {
				key: 'test',
				value: 'value',
				originURL,
				domain: 'example.com',
				path: '/path/',
				expires: null,
				httpOnly: false,
				secure: false,
				sameSite: CookieSameSiteEnum.lax
			};

			expect(CookieURLUtility.cookieMatchesURL(cookie, originURL)).toBe(true);
		});

		it('Returns false when domain does not match.', () => {
			const originURL = new URL('https://example.com/path/');
			const targetURL = new URL('https://other.com/path/');
			const cookie: ICookie = {
				key: 'test',
				value: 'value',
				originURL,
				domain: 'example.com',
				path: '/path/',
				expires: null,
				httpOnly: false,
				secure: false,
				sameSite: CookieSameSiteEnum.lax
			};

			expect(CookieURLUtility.cookieMatchesURL(cookie, targetURL)).toBe(false);
		});

		it('Returns false when path does not match.', () => {
			const originURL = new URL('https://example.com/path/');
			const targetURL = new URL('https://example.com/other/');
			const cookie: ICookie = {
				key: 'test',
				value: 'value',
				originURL,
				domain: 'example.com',
				path: '/path/',
				expires: null,
				httpOnly: false,
				secure: false,
				sameSite: CookieSameSiteEnum.lax
			};

			expect(CookieURLUtility.cookieMatchesURL(cookie, targetURL)).toBe(false);
		});

		it('Handles URL with undefined hostname without throwing.', () => {
			const originURL = new URL('https://example.com/path/');
			const cookie: ICookie = {
				key: 'test',
				value: 'value',
				originURL,
				domain: 'example.com',
				path: '/path/',
				expires: null,
				httpOnly: false,
				secure: false,
				sameSite: CookieSameSiteEnum.lax
			};

			// Create a URL-like object with undefined hostname
			const urlWithUndefinedHostname = <URL>(<unknown>{
				protocol: 'https:',
				hostname: undefined,
				pathname: '/path/'
			});

			expect(() =>
				CookieURLUtility.cookieMatchesURL(cookie, urlWithUndefinedHostname)
			).not.toThrow();
			// Returns falsy (undefined) when hostname is undefined
			expect(CookieURLUtility.cookieMatchesURL(cookie, urlWithUndefinedHostname)).toBeFalsy();
		});

		it('Handles URL with undefined pathname without throwing.', () => {
			const originURL = new URL('https://example.com/path/');
			const cookie: ICookie = {
				key: 'test',
				value: 'value',
				originURL,
				domain: 'example.com',
				path: '/path/',
				expires: null,
				httpOnly: false,
				secure: false,
				sameSite: CookieSameSiteEnum.lax
			};

			// Create a URL-like object with undefined pathname
			const urlWithUndefinedPathname = <URL>(<unknown>{
				protocol: 'https:',
				hostname: 'example.com',
				pathname: undefined
			});

			expect(() =>
				CookieURLUtility.cookieMatchesURL(cookie, urlWithUndefinedPathname)
			).not.toThrow();
			// Returns falsy (undefined) when pathname is undefined
			expect(CookieURLUtility.cookieMatchesURL(cookie, urlWithUndefinedPathname)).toBeFalsy();
		});

		it('Handles cookie with undefined originURL without throwing.', () => {
			const targetURL = new URL('https://example.com/path/');
			const cookie: ICookie = {
				key: 'test',
				value: 'value',
				originURL: <URL>(<unknown>undefined),
				domain: 'example.com',
				path: '/path/',
				expires: null,
				httpOnly: false,
				secure: false,
				sameSite: CookieSameSiteEnum.lax
			};

			expect(() => CookieURLUtility.cookieMatchesURL(cookie, targetURL)).not.toThrow();
			expect(CookieURLUtility.cookieMatchesURL(cookie, targetURL)).toBe(false);
		});

		it('Returns true for secure cookie on localhost.', () => {
			const originURL = new URL('http://localhost/path/');
			const cookie: ICookie = {
				key: 'test',
				value: 'value',
				originURL,
				domain: '',
				path: '',
				expires: null,
				httpOnly: false,
				secure: true,
				sameSite: CookieSameSiteEnum.lax
			};

			expect(CookieURLUtility.cookieMatchesURL(cookie, originURL)).toBe(true);
		});

		it('Returns true for secure cookie on subdomain of localhost.', () => {
			const originURL = new URL('http://sub.localhost/path/');
			const cookie: ICookie = {
				key: 'test',
				value: 'value',
				originURL,
				domain: '',
				path: '',
				expires: null,
				httpOnly: false,
				secure: true,
				sameSite: CookieSameSiteEnum.lax
			};

			expect(CookieURLUtility.cookieMatchesURL(cookie, originURL)).toBe(true);
		});
	});
});
