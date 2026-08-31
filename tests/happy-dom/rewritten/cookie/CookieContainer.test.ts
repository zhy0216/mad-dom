// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/cookie/CookieContainer.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import CookieContainer from '../../src/cookie/CookieContainer.js';
import CookieSameSiteEnum from '../../shim/src/cookie/enums/CookieSameSiteEnum.js';
import type ICookie from '../../shim/src/cookie/ICookie.js';
import type ICookieContainer from '../../src/cookie/ICookieContainer.js';
import CookieStringUtility from '../../src/cookie/urilities/CookieStringUtility.js';
import URL from '../../shim/src/url/URL.js';
import { beforeEach, afterEach, describe, it, expect, spyOn } from 'bun:test';
import { restoreAllMocks } from '../../adapter/index.js';

describe('CookieContainer', () => {
	let cookieContainer: ICookieContainer;

	beforeEach(() => {
		cookieContainer = new CookieContainer();
	});

	afterEach(() => {
		restoreAllMocks();
	});

	describe('addCookies()', () => {
		it('Adds cookie string.', () => {
			const expires = 60 * 1000 + Date.now();
			const originURL = new URL('https://example.com/path/to/page/');
			const maxAge = 60;

			cookieContainer.addCookies([
				<ICookie>(
					CookieStringUtility.stringToCookie(
						originURL,
						`key1=value1; Expires=${new Date(expires).toString()};`
					)
				),
				<ICookie>(
					CookieStringUtility.stringToCookie(originURL, `key2   =    value2   ; Max-Age=${maxAge};`)
				),
				<ICookie>CookieStringUtility.stringToCookie(originURL, `key3=value3; Domain=example.com;`),
				<ICookie>CookieStringUtility.stringToCookie(originURL, `key4=value4; Domain=other.com;`),
				<ICookie>(
					CookieStringUtility.stringToCookie(
						originURL,
						`key5=value5; Domain=other.com; SameSite=None;`
					)
				),
				<ICookie>(
					CookieStringUtility.stringToCookie(
						originURL,
						`key6=value6; Domain=other.com; SameSite=None; Secure;`
					)
				),
				<ICookie>CookieStringUtility.stringToCookie(originURL, `key7=value7; Path=path/to/page/;`),
				<ICookie>CookieStringUtility.stringToCookie(originURL, `key8=value8; HttpOnly;`),
				<ICookie>CookieStringUtility.stringToCookie(originURL, `key9=value9; Secure;`),
				<ICookie>(
					CookieStringUtility.stringToCookie(originURL, `key10=value10; SameSite=None; Secure;`)
				),
				<ICookie>CookieStringUtility.stringToCookie(originURL, `key10;`),
				<ICookie>CookieStringUtility.stringToCookie(originURL, `key11=hello=world;`)
			]);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('https://example.com/path/to/page/'), false)
				)
			).toBe(
				'key1=value1; key2=value2; key3=value3; key7=value7; key8=value8; key9=value9; key10=value10; key10; key11=hello=world'
			);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('https://example.com/path/to/page/'), true)
				)
			).toBe(
				'key1=value1; key2=value2; key3=value3; key7=value7; key9=value9; key10=value10; key10; key11=hello=world'
			);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('http://example.com/path/to/page/'), false)
				)
			).toBe(
				'key1=value1; key2=value2; key3=value3; key7=value7; key8=value8; key10; key11=hello=world'
			);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('https://other.com/path/to/page/'), false)
				)
			).toBe('key6=value6; key10=value10');

			cookieContainer.addCookies([
				<ICookie>CookieStringUtility.stringToCookie(originURL, `key10=newValue10`)
			]);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('https://example.com/path/to/page/'), false)
				)
			).toBe(
				'key1=value1; key2=value2; key3=value3; key7=value7; key8=value8; key9=value9; key10; key11=hello=world; key10=newValue10'
			);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('https://other.com/path/to/page/'), false)
				)
			).toBe('key6=value6');

			spyOn(Date, 'now').mockImplementation(() => expires + 1000);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('https://example.com/path/to/page/'), false)
				)
			).toBe(
				'key3=value3; key7=value7; key8=value8; key9=value9; key10; key11=hello=world; key10=newValue10'
			);

			cookieContainer.addCookies([
				<ICookie>(
					CookieStringUtility.stringToCookie(
						originURL,
						`key10; Expires=${new Date(expires).toString()};`
					)
				)
			]);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('https://example.com/path/to/page/'), false)
				)
			).toBe(
				'key3=value3; key7=value7; key8=value8; key9=value9; key11=hello=world; key10=newValue10'
			);

			cookieContainer.addCookies([
				<ICookie>(
					CookieStringUtility.stringToCookie(
						originURL,
						`key10=; Expires=${new Date(expires).toString()};`
					)
				)
			]);

			expect(
				CookieStringUtility.cookiesToString(
					cookieContainer.getCookies(new URL('https://example.com/path/to/page/'), false)
				)
			).toBe('key3=value3; key7=value7; key8=value8; key9=value9; key11=hello=world');
		});

		it('Validates secure cookie keys.', () => {
			const originURL = new URL('https://example.com/path/to/page/');
			const targetURL = new URL('https://example.com/path/to/page/');

			expect(CookieStringUtility.stringToCookie(originURL, `__secure-key=value`)).toBe(null);

			cookieContainer.addCookies([
				<ICookie>CookieStringUtility.stringToCookie(originURL, `__secure-key=value; Secure;`)
			]);

			expect(
				CookieStringUtility.cookiesToString(cookieContainer.getCookies(targetURL, false))
			).toBe('__secure-key=value');
		});

		it('Validates secure cookie keys for localhost', () => {
			const originURL = new URL('http://localhost');
			const targetURL = new URL('http://localhost');

			expect(CookieStringUtility.stringToCookie(originURL, `__secure-key=value`)).toBe(null);

			cookieContainer.addCookies([
				<ICookie>CookieStringUtility.stringToCookie(originURL, `__secure-key=value; Secure;`)
			]);

			expect(
				CookieStringUtility.cookiesToString(cookieContainer.getCookies(targetURL, false))
			).toBe('__secure-key=value');
		});

		it('Validates host cookie keys.', () => {
			const originURL = new URL('https://example.com/path/to/page/');
			const targetURL = new URL('https://example.com/path/to/page/');

			expect(CookieStringUtility.stringToCookie(originURL, `__host-key=value`)).toBe(null);

			expect(CookieStringUtility.stringToCookie(originURL, `__host-key=value; Secure;`)).toBe(null);

			expect(
				CookieStringUtility.stringToCookie(
					originURL,
					`__host-key=value; Secure; Path=/path/to/page/;`
				)
			).toBe(null);

			expect(
				CookieStringUtility.stringToCookie(
					originURL,
					`__host-key=value; Secure; Domain=example.com; Path=/;`
				)
			).toBe(null);

			cookieContainer.addCookies([
				<ICookie>CookieStringUtility.stringToCookie(originURL, `__host-key=value; Secure; Path=/;`)
			]);

			expect(
				CookieStringUtility.cookiesToString(cookieContainer.getCookies(targetURL, false))
			).toBe('__host-key=value');
		});

		it('Ignores invalid cookies.', () => {
			const originURL = new URL('https://example.com/path/to/page/');
			cookieContainer.addCookies([
				<ICookie>{ originURL },
				<ICookie>{ key: 'key' },
				<ICookie>(<unknown>null)
			]);

			expect(cookieContainer.getCookies(originURL)).toEqual([]);
		});
	});

	describe('getCookies()', () => {
		it('Returns cookies.', () => {
			const originURL = new URL('https://example.com/path/to/page/');
			const expires = new Date(60 * 1000 + Date.now());

			cookieContainer.addCookies([
				{
					key: 'key1',
					originURL
				},
				{
					key: 'key2',
					originURL,
					value: 'value2',
					domain: 'example.com',
					path: '/path/to/page/',
					expires,
					httpOnly: true,
					secure: true,
					sameSite: CookieSameSiteEnum.strict
				}
			]);

			expect(cookieContainer.getCookies(originURL)).toEqual([
				{
					key: 'key1',
					originURL,
					value: null,
					domain: '',
					path: '',
					expires: null,
					httpOnly: false,
					secure: false,
					sameSite: CookieSameSiteEnum.lax
				},
				{
					key: 'key2',
					originURL,
					value: 'value2',
					domain: 'example.com',
					path: '/path/to/page/',
					expires,
					httpOnly: true,
					secure: true,
					sameSite: CookieSameSiteEnum.strict
				}
			]);
		});
	});

	describe('clearCookies()', () => {
		it('Clears cookies.', () => {
			const originURL = new URL('https://example.com/path/to/page/');
			const expires = new Date(60 * 1000 + Date.now());

			cookieContainer.addCookies([
				{
					key: 'key1',
					originURL
				},
				{
					key: 'key2',
					originURL,
					value: 'value2',
					domain: 'example.com',
					path: '/path/to/page/',
					expires,
					httpOnly: true,
					secure: true,
					sameSite: CookieSameSiteEnum.strict
				}
			]);

			cookieContainer.clearCookies();

			expect(cookieContainer.getCookies(originURL)).toEqual([]);
		});
	});
});
