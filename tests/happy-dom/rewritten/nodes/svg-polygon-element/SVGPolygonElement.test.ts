// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/svg-polygon-element/SVGPolygonElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import SVGPolygonElement from '../../../src/nodes/svg-polygon-element/SVGPolygonElement.js';
import * as PropertySymbol from '../../../shim/src/PropertySymbol.js';
import SVGGeometryElement from '../../../src/nodes/svg-geometry-element/SVGGeometryElement.js';

describe('SVGPolygonElement', () => {
	let window: Window;
	let document: Document;
	let element: SVGPolygonElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
	});

	describe('constructor()', () => {
		it('Should be an instanceof SVGPolygonElement', () => {
			expect(element instanceof SVGPolygonElement).toBe(true);
		});

		it('Should be an instanceof SVGGeometryElement', () => {
			expect(element instanceof SVGGeometryElement).toBe(true);
		});
	});

	describe('get animatedPoints()', () => {
		it('Should return an instance of SVGPointList', () => {
			const animatedPoints = element.animatedPoints;
			expect(animatedPoints).toBeInstanceOf(window.SVGPointList);
			expect(element.animatedPoints).toBe(animatedPoints);
		});

		it('Should reflect the "points" attribute', () => {
			element.setAttribute('points', '10,10 20,20 30,30');

			expect(element.animatedPoints.length).toBe(3);
			expect(element.animatedPoints[0].x).toBe(10);
			expect(element.animatedPoints[0].y).toBe(10);
			expect(element.animatedPoints[1].x).toBe(20);
			expect(element.animatedPoints[1].y).toBe(20);
			expect(element.animatedPoints[2].x).toBe(30);
			expect(element.animatedPoints[2].y).toBe(30);

			element.setAttribute('points', '10 20 30 40 50 60');

			expect(element.animatedPoints.length).toBe(3);
			expect(element.animatedPoints[0].x).toBe(10);
			expect(element.animatedPoints[0].y).toBe(20);
			expect(element.animatedPoints[1].x).toBe(30);
			expect(element.animatedPoints[1].y).toBe(40);
			expect(element.animatedPoints[2].x).toBe(50);
			expect(element.animatedPoints[2].y).toBe(60);
		});

		it('Should throw an error when trying to set a value', () => {
			element.setAttribute('points', '10,10 20,20 30,30');

			expect(element.animatedPoints.length).toBe(3);
			expect(element.animatedPoints[0].x).toBe(10);
			expect(element.animatedPoints[0].y).toBe(10);
			expect(element.animatedPoints[1].x).toBe(20);
			expect(element.animatedPoints[1].y).toBe(20);
			expect(element.animatedPoints[2].x).toBe(30);
			expect(element.animatedPoints[2].y).toBe(30);

			expect(() => {
				element.animatedPoints[0].x = 100;
			}).toThrow(
				new TypeError(`Failed to set the 'x' property on 'SVGPoint': The object is read-only.`)
			);

			const point = new window.SVGPoint(PropertySymbol.illegalConstructor, window);
			point.x = 300;
			point.y = 400;

			expect(() => {
				element.animatedPoints.appendItem(point);
			}).toThrow(
				new TypeError(`Failed to execute 'appendItem' on 'SVGPointList': The object is read-only.`)
			);
		});
	});

	describe('get points()', () => {
		it('Should return an instance of SVGPointList', () => {
			const points = element.points;
			expect(points).toBeInstanceOf(window.SVGPointList);
			expect(element.points).toBe(points);
		});

		it('Should reflect the "points" attribute', () => {
			element.setAttribute('points', '10,10 20,20 30,30');

			expect(element.points.length).toBe(3);
			expect(element.points[0].x).toBe(10);
			expect(element.points[0].y).toBe(10);
			expect(element.points[1].x).toBe(20);
			expect(element.points[1].y).toBe(20);
			expect(element.points[2].x).toBe(30);
			expect(element.points[2].y).toBe(30);

			element.setAttribute('points', '10 20 30 40 50 60');

			expect(element.points.length).toBe(3);
			expect(element.points[0].x).toBe(10);
			expect(element.points[0].y).toBe(20);
			expect(element.points[1].x).toBe(30);
			expect(element.points[1].y).toBe(40);
			expect(element.points[2].x).toBe(50);
			expect(element.points[2].y).toBe(60);

			element.points[0].x = 100;
			element.points[0].y = 200;

			expect(element.getAttribute('points')).toBe('100 200 30 40 50 60');

			element.points.removeItem(1);

			expect(element.getAttribute('points')).toBe('100 200 50 60');

			const point = new window.SVGPoint(PropertySymbol.illegalConstructor, window);
			point.x = 300;
			point.y = 400;
			element.points.appendItem(point);

			expect(element.getAttribute('points')).toBe('100 200 50 60 300 400');

			element.points.clear();

			expect(element.getAttribute('points')).toBe('');
		});
	});
});
