// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/fetch/FetchCORSUtility.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'bun:test';
import FetchCORSUtility from '../../src/fetch/utilities/FetchCORSUtility.js';

describe('FetchCORSUtility', () => {
	describe('isCORS()', () => {
		it('Treats requests to a different port as cross-origin.', () => {
			expect(FetchCORSUtility.isCORS('http://localhost:1234', 'http://localhost:9876')).toBe(true);
		});

		it('Treats a parent domain as cross-origin from its subdomain.', () => {
			expect(FetchCORSUtility.isCORS('http://sub.some.host', 'http://some.host')).toBe(true);
		});
	});
});
