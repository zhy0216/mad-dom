// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/fetch/cache/response/ResponseCache.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import CachedResponseStateEnum from '../../../../src/fetch/cache/response/CachedResponseStateEnum';
import ResponseCache from '../../../../src/fetch/cache/response/ResponseCache';
import Headers from '../../../../shim/src/fetch/Headers.js';
import { beforeEach, describe, it, expect, afterEach, spyOn } from 'bun:test';
import { restoreAllMocks } from '../../../../adapter/index.js';

// Rounds it to seconds, so that UTC parsing will match.
const DATE_NOW = Math.floor(Date.now() / 1000) * 1000;
const LAST_MODIFIED_DATE = new Date(DATE_NOW - 60000).toUTCString();
const LAST_MODIFIED_MILLISECONDS = DATE_NOW - 60000;

describe('ResponseCache', () => {
	let responseCache: ResponseCache;
	let dateNow: number;

	beforeEach(() => {
		responseCache = new ResponseCache();
		dateNow = DATE_NOW;
		spyOn(Date, 'now').mockImplementation(() => dateNow);
	});

	afterEach(() => {
		restoreAllMocks();
	});

	describe('get()', () => {
		it('Returns null if no cached response is found.', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			expect(responseCache.get(request)).toBeNull();
		});

		it('Returns cached response.', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=60',
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toEqual({
				response: {
					status: 200,
					statusText: 'OK',
					url: 'http://localhost:8080',
					headers: new Headers({
						'Content-Type': 'text/html',
						'Cache-Control': 'max-age=60',
						'Last-Modified': LAST_MODIFIED_DATE
					}),
					waitingForBody: false,
					body: Buffer.from('test')
				},
				request: {
					headers: new Headers(),
					method: 'GET'
				},
				cacheUpdateTime: dateNow,
				lastModified: LAST_MODIFIED_MILLISECONDS,
				vary: {},
				expires: dateNow + 60000,
				etag: null,
				mustRevalidate: false,
				staleWhileRevalidate: false,
				state: CachedResponseStateEnum.fresh,
				virtual: false
			});
		});

		it('Removes expired response that doesn\'t have a "Last-Modified" header as it can\'t be refreshed.', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=0.001'
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			dateNow += 100;
			expect(responseCache.get(request)).toBeNull();
		});
	});

	describe('add()', () => {
		it('Adds response to cache with "Cache-Control" header set to "max-age=60, must-revalidate, stale-while-revalidate".', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=60, must-revalidate, stale-while-revalidate',
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toEqual({
				response: {
					status: 200,
					statusText: 'OK',
					url: 'http://localhost:8080',
					headers: new Headers({
						'Content-Type': 'text/html',
						'Cache-Control': 'max-age=60, must-revalidate, stale-while-revalidate',
						'Last-Modified': LAST_MODIFIED_DATE
					}),
					waitingForBody: false,
					body: Buffer.from('test')
				},
				request: {
					headers: new Headers(),
					method: 'GET'
				},
				cacheUpdateTime: dateNow,
				lastModified: LAST_MODIFIED_MILLISECONDS,
				vary: {},
				expires: dateNow + 60000,
				etag: null,
				mustRevalidate: true,
				staleWhileRevalidate: true,
				state: CachedResponseStateEnum.fresh,
				virtual: false
			});
		});

		it('Doesn\'t add response to cache with "Cache-Control" header set to "max-age=60, no-cache".', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=60, no-cache'
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toBeNull();
		});

		it('Doesn\'t add response to cache with "Cache-Control" header set to "max-age=60, no-store".', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=60, no-store'
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toBeNull();
		});

		it('Doesn\'t add response to cache request with "Cache-Control" set to "no-cache.', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers({
					'Cache-Control': 'no-cache'
				})
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=60'
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toBeNull();
		});

		it("Doesn't add response to cache if response doesn't have any valid Cache-Control, ETag or Expires headers.", () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html'
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toBeNull();
		});

		it(`Adds response to cache with "Expires" header set to "${new Date(
			DATE_NOW + 60000
		).toUTCString()}".`, () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					Expires: new Date(DATE_NOW + 60000).toUTCString(),
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toEqual({
				response: {
					status: 200,
					statusText: 'OK',
					url: 'http://localhost:8080',
					headers: new Headers({
						'Content-Type': 'text/html',
						Expires: new Date(DATE_NOW + 60000).toUTCString(),
						'Last-Modified': LAST_MODIFIED_DATE
					}),
					waitingForBody: false,
					body: Buffer.from('test')
				},
				request: {
					headers: new Headers(),
					method: 'GET'
				},
				cacheUpdateTime: dateNow,
				lastModified: LAST_MODIFIED_MILLISECONDS,
				vary: {},
				expires: dateNow + 60000,
				etag: null,
				mustRevalidate: false,
				staleWhileRevalidate: false,
				state: CachedResponseStateEnum.fresh,
				virtual: false
			});
		});

		it(`Adds response to cache with "ETag" header set to "test".`, () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					ETag: 'test',
					'Content-Type': 'text/html',
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toEqual({
				response: {
					status: 200,
					statusText: 'OK',
					url: 'http://localhost:8080',
					headers: new Headers({
						ETag: 'test',
						'Content-Type': 'text/html',
						'Last-Modified': LAST_MODIFIED_DATE
					}),
					waitingForBody: false,
					body: Buffer.from('test')
				},
				request: {
					headers: new Headers(),
					method: 'GET'
				},
				cacheUpdateTime: dateNow,
				lastModified: LAST_MODIFIED_MILLISECONDS,
				vary: {},
				expires: null,
				etag: 'test',
				mustRevalidate: false,
				staleWhileRevalidate: false,
				state: CachedResponseStateEnum.fresh,
				virtual: false
			});
		});

		it(`Adds response to cache for response with "Vary" header.`, () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers({
					'vary-header': 'test'
				})
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					Vary: 'vary-header',
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=60',
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};
			responseCache.add(request, response);
			expect(responseCache.get(request)).toEqual({
				response: {
					status: 200,
					statusText: 'OK',
					url: 'http://localhost:8080',
					headers: new Headers({
						Vary: 'vary-header',
						'Content-Type': 'text/html',
						'Cache-Control': 'max-age=60',
						'Last-Modified': LAST_MODIFIED_DATE
					}),
					waitingForBody: false,
					body: Buffer.from('test')
				},
				request: {
					headers: new Headers({
						'vary-header': 'test'
					}),
					method: 'GET'
				},
				cacheUpdateTime: dateNow,
				lastModified: LAST_MODIFIED_MILLISECONDS,
				vary: {
					'vary-header': 'test'
				},
				expires: dateNow + 60000,
				etag: null,
				mustRevalidate: false,
				staleWhileRevalidate: false,
				state: CachedResponseStateEnum.fresh,
				virtual: false
			});
		});
	});

	describe('clear', () => {
		it('Clears the cache.', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=60',
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};

			responseCache.add(request, response);

			expect(responseCache.get(request)).not.toBeNull();
			responseCache.clear();
			expect(responseCache.get(request)).toBeNull();
		});

		it('Clears the cache for a specific URL.', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=60',
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};

			responseCache.add(request, response);

			expect(responseCache.get(request)).not.toBeNull();
			responseCache.clear({ url: 'http://localhost:8080' });
			expect(responseCache.get(request)).toBeNull();
		});

		it('Clears the cache for a specific time.', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=1',
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};

			responseCache.add(request, response);

			expect(responseCache.get(request)).not.toBeNull();
			responseCache.clear({ toTime: dateNow - 60000 });
			expect(responseCache.get(request)).not.toBeNull();
			responseCache.clear({ toTime: dateNow + 60000 });
			expect(responseCache.get(request)).toBeNull();
		});

		it('Clears the cache for a specific URL and time.', () => {
			const request = {
				url: 'http://localhost:8080',
				method: 'GET',
				headers: new Headers()
			};
			const response = {
				status: 200,
				statusText: 'OK',
				url: 'http://localhost:8080',
				headers: new Headers({
					'Content-Type': 'text/html',
					'Cache-Control': 'max-age=1',
					'Last-Modified': LAST_MODIFIED_DATE
				}),
				body: Buffer.from('test'),
				waitingForBody: false
			};

			responseCache.add(request, response);

			expect(responseCache.get(request)).not.toBeNull();
			responseCache.clear({ url: 'http://wrong.url', toTime: dateNow + 60000 });
			expect(responseCache.get(request)).not.toBeNull();
			responseCache.clear({ url: 'http://localhost:8080', toTime: dateNow - 60000 });
			expect(responseCache.get(request)).not.toBeNull();
			responseCache.clear({ url: 'http://localhost:8080', toTime: dateNow + 60000 });
			expect(responseCache.get(request)).toBeNull();
		});
	});
});
