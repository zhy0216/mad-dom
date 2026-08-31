// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/dom/DOMPointReadOnly.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { beforeEach, describe, it, expect } from 'bun:test';
import DOMPointReadOnly from '../../src/dom/DOMPointReadOnly.js';
import type BrowserWindow from '../../shim/src/window/BrowserWindow.js';
import Window from '../../shim/src/window/Window.js';

describe('DOMPointReadOnly', () => {
	let window: BrowserWindow;

	beforeEach(() => {
		window = new Window();
	});

	describe('constructor()', () => {
		it('Sets properties.', () => {
			const point = new window.DOMPointReadOnly(1, 2, 3, 4);
			expect(point.x).toBe(1);
			expect(point.y).toBe(2);
			expect(point.z).toBe(3);
			expect(point.w).toBe(4);

			const point2 = new window.DOMPointReadOnly(null, null, null, 4);
			expect(point2.x).toBe(0);
			expect(point2.y).toBe(0);
			expect(point2.z).toBe(0);
			expect(point2.w).toBe(4);

			const point3 = new window.DOMPointReadOnly();
			expect(point3.x).toBe(0);
			expect(point3.y).toBe(0);
			expect(point3.z).toBe(0);
			expect(point3.w).toBe(1);

			const point4 = new window.DOMPointReadOnly(
				<number>(<unknown>'nan'),
				<number>(<unknown>'nan'),
				<number>(<unknown>'nan'),
				<number>(<unknown>'nan')
			);
			expect(isNaN(point4.x)).toBe(true);
			expect(isNaN(point4.y)).toBe(true);
			expect(isNaN(point4.z)).toBe(true);
			expect(isNaN(point4.w)).toBe(true);
		});
	});

	describe('get x()', () => {
		it('Returns x property.', () => {
			const point = new window.DOMPointReadOnly(1, 2, 3, 4);
			expect(point.x).toBe(1);
		});
	});

	describe('get y()', () => {
		it('Returns y property.', () => {
			const point = new window.DOMPointReadOnly(1, 2, 3, 4);
			expect(point.y).toBe(2);
		});
	});

	describe('get z()', () => {
		it('Returns z property.', () => {
			const point = new window.DOMPointReadOnly(1, 2, 3, 4);
			expect(point.z).toBe(3);
		});
	});

	describe('get w()', () => {
		it('Returns w property.', () => {
			const point = new window.DOMPointReadOnly(1, 2, 3, 4);
			expect(point.w).toBe(4);
		});
	});

	describe('toJSON()', () => {
		it('Returns rect as JSON.', () => {
			const point = new window.DOMPointReadOnly(1, 2, 3, 4);
			expect(point.toJSON()).toEqual({
				x: 1,
				y: 2,
				z: 3,
				w: 4
			});
		});
	});

	describe('fromPoint()', () => {
		it('Creates a new DOMPointReadOnly object.', () => {
			const point = window.DOMPointReadOnly.fromPoint({ x: 1, y: 2, z: 3, w: 4 });
			expect(point.toJSON()).toEqual({
				x: 1,
				y: 2,
				z: 3,
				w: 4
			});

			const point2 = window.DOMPointReadOnly.fromPoint();
			expect(point2.toJSON()).toEqual({
				x: 0,
				y: 0,
				z: 0,
				w: 1
			});

			const point3 = window.DOMPointReadOnly.fromPoint({ x: 1, y: 2 });
			expect(point3.toJSON()).toEqual({
				x: 1,
				y: 2,
				z: 0,
				w: 1
			});
		});
	});

	describe('matrixTransform()', () => {
		it('Returns a new DOMPointReadOnly object.', () => {
			const point = new window.DOMPointReadOnly(1, 2, 3, 4);
			const transformedPoint = point.matrixTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
			expect(transformedPoint).toBeInstanceOf(window.DOMPointReadOnly);
			expect(transformedPoint.toJSON()).toEqual({ x: 41, y: 82, z: 3, w: 4 });
		});
	});
});
