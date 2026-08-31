// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/event/events/CustomEvent.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import CustomEvent from '../../../shim/src/event/events/CustomEvent.js';
import { describe, it, expect } from 'bun:test';

describe('CustomEvent', () => {
	describe('constructor()', () => {
		it('Creates a CustomEvent', () => {
			const eventType = 'click';
			const event = new CustomEvent(eventType);
			expect(event.type).toBe(eventType);
			expect(event.detail).toBeNull();
		});

		it('Creates a CustomEvent with detail', () => {
			const eventType = 'click';
			const eventDetail = { someInformation: true };
			const event = new CustomEvent(eventType, { detail: eventDetail });
			expect(event.type).toBe(eventType);
			expect(event.detail).toEqual(eventDetail);
		});

		it('Creates a CustomEvent with empty detail', () => {
			const eventType = 'click';
			let event = new CustomEvent(eventType, {});
			expect(event.type).toBe(eventType);
			expect(event.detail).toBeNull();

			event = new CustomEvent(eventType, { detail: undefined });
			expect(event.type).toBe(eventType);
			expect(event.detail).toBeNull();

			event = new CustomEvent(eventType, { detail: null });
			expect(event.type).toBe(eventType);
			expect(event.detail).toBeNull();
		});
	});
});
