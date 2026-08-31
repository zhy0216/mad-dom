// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-canvas-element/CanvasCaptureMediaStreamTrack.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import type HTMLCanvasElement from '../../../shim/src/nodes/html-canvas-element/HTMLCanvasElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import * as PropertySymbol from '../../../shim/src/PropertySymbol.js';
import MediaStreamTrack from '../../../shim/src/nodes/html-media-element/MediaStreamTrack.js';

describe('CanvasCaptureMediaStreamTrack', () => {
	let window: Window;
	let document: Document;
	let canvas: HTMLCanvasElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		canvas = document.createElement('canvas');
	});

	describe('constructor()', () => {
		it('Should throw an error if the "illegalConstructor" symbol is not sent to the constructor', () => {
			expect(() => new window.CanvasCaptureMediaStreamTrack()).toThrow(
				new TypeError('Illegal constructor')
			);
		});

		it('Should not throw an error if the "illegalConstructor" symbol is provided', () => {
			expect(
				() => new window.CanvasCaptureMediaStreamTrack(PropertySymbol.illegalConstructor)
			).not.toThrow();
		});

		it('Is an instance of MediaStreamTrack', () => {
			expect(
				new window.CanvasCaptureMediaStreamTrack(PropertySymbol.illegalConstructor)
			).toBeInstanceOf(MediaStreamTrack);
		});
	});

	describe('get canvas()', () => {
		it('Returns the canvas.', () => {
			const track = new window.CanvasCaptureMediaStreamTrack(
				PropertySymbol.illegalConstructor,
				canvas
			);
			track[PropertySymbol.kind] = 'video';
			expect(track.canvas).toBe(canvas);
		});
	});

	describe('requestFrame()', () => {
		it('Does nothing.', () => {
			const track = new window.CanvasCaptureMediaStreamTrack(
				PropertySymbol.illegalConstructor,
				canvas
			);
			track[PropertySymbol.kind] = 'video';
			expect(() => track.requestFrame()).not.toThrow();
		});
	});

	describe('clone()', () => {
		it('Clones the track.', () => {
			const track = new window.CanvasCaptureMediaStreamTrack(
				PropertySymbol.illegalConstructor,
				canvas
			);
			track[PropertySymbol.kind] = 'video';
			const clone = track.clone();

			// MediaStreamTrack
			expect(clone).not.toBe(track);
			expect(clone.id).not.toBe(track.id);
			expect(clone.label).toBe(track.label);
			expect(clone.kind).toBe(track.kind);
			expect(clone.muted).toBe(track.muted);
			expect(clone.readyState).toBe(track.readyState);
			expect(clone.getCapabilities()).toEqual(track.getCapabilities());
			expect(clone.getSettings()).toEqual(track.getSettings());

			// CanvasCaptureMediaStreamTrack
			expect(clone.canvas).toBe(track.canvas);
		});
	});
});
