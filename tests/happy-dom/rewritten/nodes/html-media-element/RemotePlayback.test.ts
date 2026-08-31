// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-media-element/RemotePlayback.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'bun:test';
import type BrowserWindow from '../../../shim/src/window/BrowserWindow.js';
import Window from '../../../shim/src/window/Window.js';

describe('RemotePlayback', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('get state()', () => {
		it('Should return "disconnected" by default', () => {
			const remotePlayback = new window.RemotePlayback();
			expect(remotePlayback.state).toBe('disconnected');
		});
	});

	describe('watchAvailability()', () => {
		it('Should return a Promise that resolves to undefined', async () => {
			const remotePlayback = new window.RemotePlayback();
			await expect(remotePlayback.watchAvailability()).resolves.toBeUndefined();
		});
	});

	describe('cancelWatchAvailability()', () => {
		it('Should not throw an error', () => {
			const remotePlayback = new window.RemotePlayback();
			expect(() => remotePlayback.cancelWatchAvailability()).not.toThrow();
		});
	});

	describe('prompt()', () => {
		it('Should not throw an error', () => {
			const remotePlayback = new window.RemotePlayback();
			expect(() => remotePlayback.prompt()).not.toThrow();
		});
	});
});
