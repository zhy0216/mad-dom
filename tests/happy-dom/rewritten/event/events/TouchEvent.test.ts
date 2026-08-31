// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/event/events/TouchEvent.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Touch from '../../../shim/src/event/Touch.js';
import type ITouchEventInit from '../../../shim/src/event/events/ITouchEventInit.js';
import TouchEvent from '../../../shim/src/event/events/TouchEvent.js';
import Window from '../../../shim/src/window/Window.js';
import { describe, it, expect } from 'bun:test';

describe('TouchEvent', () => {
	describe('constructor()', () => {
		it('Creates a TouchEvent', () => {
			const eventType = 'touchstart';
			const event = new TouchEvent(eventType);
			expect(event.type).toBe(eventType);
		});

		it('Initializes properties', () => {
			const touch = new Touch({
				identifier: 0,
				target: new Window().document.createElement('div')
			});

			const eventInit: ITouchEventInit = {
				altKey: true,
				changedTouches: [touch],
				ctrlKey: true,
				metaKey: true,
				shiftKey: true,
				targetTouches: [touch],
				touches: [touch]
			};

			const event = new TouchEvent('touchstart', eventInit);
			expect(event).toMatchObject(eventInit);
		});

		it('Properties have correct defaults', () => {
			const defaults: ITouchEventInit = {
				altKey: false,
				changedTouches: [],
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
				targetTouches: [],
				touches: []
			};

			const event = new TouchEvent('touchstart');
			expect(event).toMatchObject(defaults);
		});
	});
});
