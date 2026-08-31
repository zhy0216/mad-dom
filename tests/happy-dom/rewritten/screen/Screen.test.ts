// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/screen/Screen.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { beforeEach, describe, it, expect } from 'bun:test';
import Window from '../../shim/src/window/Window.js';
import Screen from '../../shim/src/screen/Screen.js';
import EventTarget from '../../shim/src/event/EventTarget.js';

describe('Screen', () => {
	let window: Window;

	beforeEach(() => {
		window = new Window();
	});

	it('Exposes Screen classes on window.', () => {
		expect(window.Screen).toBe(Screen);
	});

	it('Returns Screen instance from the "window.screen" property.', async () => {
		const screen = window.screen;

		expect(screen).toBeInstanceOf(Screen);
		expect(screen).toBeInstanceOf(EventTarget);

		expect(screen.width).toBe(1024);
		expect(screen.height).toBe(768);
		expect(screen.availWidth).toBe(1024);
		expect(screen.availHeight).toBe(768);
		expect(screen.colorDepth).toBe(24);
		expect(screen.pixelDepth).toBe(24);

		expect(screen.onchange).toBeNull();
	});
});
