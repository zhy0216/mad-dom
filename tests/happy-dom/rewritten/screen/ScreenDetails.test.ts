// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/screen/ScreenDetails.test.ts
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
import ScreenDetails from '../../shim/src/screen/ScreenDetails.js';
import ScreenDetailed from '../../shim/src/screen/ScreenDetailed.js';
import Screen from '../../shim/src/screen/Screen.js';

describe('ScreenDetails', () => {
	let window: Window;

	beforeEach(() => {
		window = new Window();
	});

	it('Exposes ScreenDetails and ScreenDetailed classes on window.', () => {
		expect(window.ScreenDetails).toBe(ScreenDetails);
		expect(window.ScreenDetailed).toBe(ScreenDetailed);
	});

	it('Returns ScreenDetails with currentScreen and screens from getScreenDetails().', async () => {
		const screenDetails = await window.getScreenDetails();

		expect(screenDetails).toBeInstanceOf(ScreenDetails);
		expect(screenDetails.currentScreen).toBeInstanceOf(ScreenDetailed);
		expect(screenDetails.currentScreen).toBeInstanceOf(Screen);
		expect(screenDetails.screens).toHaveLength(1);
		expect(screenDetails.screens[0]).toBeInstanceOf(ScreenDetailed);

		// ScreenDetailed inherits Screen properties
		const screen = screenDetails.currentScreen;
		expect(screen.width).toBe(1024);
		expect(screen.height).toBe(768);
		expect(screen.colorDepth).toBe(24);

		// ScreenDetailed-specific properties
		expect(screen.availLeft).toBe(0);
		expect(screen.availTop).toBe(0);
		expect(screen.isPrimary).toBe(true);
		expect(screen.isInternal).toBe(true);
		expect(screen.devicePixelRatio).toBe(1);
		expect(screen.label).toBe('');
	});
});
