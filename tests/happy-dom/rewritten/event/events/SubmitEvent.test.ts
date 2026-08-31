// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/event/events/SubmitEvent.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Event from '../../../shim/src/event/Event.js';
import SubmitEvent from '../../../shim/src/event/events/SubmitEvent.js';
import HTMLButtonElement from '../../../shim/src/nodes/html-button-element/HTMLButtonElement.js';
import Window from '../../../shim/src/window/Window.js';
import { describe, it, expect } from 'bun:test';

describe('SubmitEvent', () => {
	describe('constructor', () => {
		it('Creates a submit event.', () => {
			const window = new Window();
			const document = window.document;
			const submitter = document.createElement('button');
			const event = new SubmitEvent('submit', { bubbles: true, submitter });
			expect(event).toBeInstanceOf(Event);
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(false);
			expect(event.submitter).toBe(submitter);
		});
	});
});
