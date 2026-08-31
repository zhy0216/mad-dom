// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/navigator/Navigator.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Window from '../../shim/src/window/Window.js';
import Navigator from '../../src/navigator/Navigator.js';
import { beforeEach, afterEach, describe, it, expect, spyOn } from 'bun:test';
import { restoreAllMocks } from '../../adapter/index.js';
import Permissions from '../../shim/src/permissions/Permissions.js';
import Clipboard from '../../shim/src/clipboard/Clipboard.js';
import PackageVersion from '../../src/version.js';
import type Response from '../../shim/src/fetch/Response.js';
import type Request from '../../shim/src/fetch/Request.js';
import Fetch from '../../src/fetch/Fetch.js';
import type Stream from 'stream';

const PLATFORM =
	'X11; ' +
	process.platform.charAt(0).toUpperCase() +
	process.platform.slice(1) +
	' ' +
	process.arch;

const PROPERTIES = {
	appCodeName: 'Mozilla',
	appName: 'Netscape',
	appVersion: `5.0 (${PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) HappyDOM/${PackageVersion.version}`,
	cookieEnabled: true,
	credentials: null,
	doNotTrack: 'unspecified',
	geolocation: null,
	hardwareConcurrency: 8,
	language: 'en-US',
	languages: ['en-US', 'en'],
	locks: null,
	maxTouchPoints: 0,
	mimeTypes: {
		length: 0
	},
	onLine: true,
	permissions: new Permissions(),
	platform: PLATFORM,
	plugins: {
		length: 0
	},
	product: 'Gecko',
	productSub: '20100101',
	userAgent: `Mozilla/5.0 (${PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) HappyDOM/${PackageVersion.version}`,
	vendor: '',
	vendorSub: '',
	webdriver: true
};

describe('Window', () => {
	let window: Window;

	beforeEach(() => {
		window = new Window();
	});

	afterEach(() => {
		resetMockedModules();
		restoreAllMocks();
	});

	describe('constructor()', () => {
		it('Is instanceof Navigator.', () => {
			expect(window.navigator instanceof Navigator).toBe(true);
		});
	});

	Object.keys(PROPERTIES).forEach((property) => {
		describe(`get ${property}()`, () => {
			it('Returns an instance of Navigator with browser data.', () => {
				expect(window.navigator[property]).toEqual(PROPERTIES[property]);
			});
		});
	});

	describe('get clipboard()', () => {
		it('Returns an instance of Clipboard.', () => {
			expect(window.navigator.clipboard).toEqual(new Clipboard(window));
		});
	});

	describe('sendBeacon()', () => {
		it('Sends a beacon request.', async () => {
			const expectedURL = 'https://localhost:8080/path/';
			let request: Request | null = null;

			spyOn(Fetch.prototype, 'send').mockImplementation(function (): Promise<Response> {
				request = <Request>this.request;
				return Promise.resolve(<Response>{});
			});

			window.navigator.sendBeacon(expectedURL, 'test-data');

			const chunks: Buffer[] = [];

			for await (const chunk of <Stream.Readable>(<Request>(<unknown>request)).body) {
				chunks.push(Buffer.from(chunk));
			}

			expect(Buffer.concat(chunks).toString()).toBe('test-data');
			expect((<Request>(<unknown>request)).url).toBe(expectedURL);
		});
	});
});
