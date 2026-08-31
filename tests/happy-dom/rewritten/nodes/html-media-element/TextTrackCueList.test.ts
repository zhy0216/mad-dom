// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-media-element/TextTrackCueList.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'bun:test';
import TextTrackCueList from '../../../shim/src/nodes/html-media-element/TextTrackCueList.js';
import type BrowserWindow from '../../../shim/src/window/BrowserWindow.js';
import Window from '../../../shim/src/window/Window.js';
import * as PropertySymbol from '../../../shim/src/PropertySymbol.js';

describe('TextTrackCueList', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Should throw an error if the "illegalConstructor" symbol is not sent to the constructor', () => {
			expect(() => new TextTrackCueList()).toThrow(new TypeError('Illegal constructor'));
		});

		it('Should be an instance of Array', () => {
			const textTrackCueList = new TextTrackCueList(PropertySymbol.illegalConstructor);
			expect(textTrackCueList).toBeInstanceOf(Array);
		});
	});

	describe('getCueById()', () => {
		it('Should return null if no cue is found', () => {
			const textTrackCueList = new TextTrackCueList(PropertySymbol.illegalConstructor);
			expect(textTrackCueList.getCueById('test')).toBeNull();
		});

		it('Should return the cue if found', () => {
			const textTrackCueList = new TextTrackCueList(PropertySymbol.illegalConstructor);
			const cue1 = new window.VTTCue(0, 10, 'test');
			const cue2 = new window.VTTCue(0, 10, 'test');
			cue1.id = 'cue1';
			cue2.id = 'cue2';
			textTrackCueList.push(cue1);
			textTrackCueList.push(cue2);
			expect(textTrackCueList.getCueById('cue1')).toBe(cue1);
			expect(textTrackCueList.getCueById('cue2')).toBe(cue2);
		});
	});
});
