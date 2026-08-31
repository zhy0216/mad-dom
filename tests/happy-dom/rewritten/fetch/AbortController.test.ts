// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/fetch/AbortController.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import type Event from '../../shim/src/event/Event.js';
import AbortController from '../../shim/src/fetch/AbortController.js';
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type BrowserWindow from '../../shim/src/window/BrowserWindow.js';
import Window from '../../shim/src/window/Window.js';

describe('AbortController', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('abort()', () => {
		it('Aborts the signal.', () => {
			const controller = new window.AbortController();
			const signal = controller.signal;
			const reason = new Error('abort reason');
			let triggeredEvent: Event | null = null;

			signal.addEventListener('abort', (event: Event) => (triggeredEvent = event));

			controller.abort(reason);

			expect(signal.aborted).toBe(true);
			expect(signal.reason).toBe(reason);
			expect((<Event>(<unknown>triggeredEvent)).type).toBe('abort');
		});

		it('Does not trigger abort event listener if the listener signal is aborted', () => {
			const controller = new window.AbortController();
			const callbackCtrl = new window.AbortController();
			const signal = controller.signal;
			const callbackMock = mock();

			signal.addEventListener('abort', (event: Event) => callbackMock(), {
				signal: callbackCtrl.signal
			});

			callbackCtrl.abort();
			controller.abort();

			expect(signal.aborted).toBe(true);
			expect(callbackMock).toBeCalledTimes(0);
		});
	});
});
