// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/canvas/ImageBitmap.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type BrowserWindow from '../../shim/src/window/BrowserWindow.js';
import Window from '../../shim/src/window/Window.js';
import * as PropertySymbol from '../../shim/src/PropertySymbol.js';
import type Document from '../../shim/src/nodes/document/Document.js';
import type ICanvasAdapter from '../../shim/src/canvas/ICanvasAdapter.js';
import type { TCanvasImage } from '../../shim/src/canvas/TCanvasImage.js';
import type IImageBitmapOptions from '../../src/canvas/IImageBitmapOptions.js';
import DOMExceptionNameEnum from '../../src/exception/DOMExceptionNameEnum.js';
import OffscreenCanvas from '../../shim/src/canvas/OffscreenCanvas.js';

const IMAGE_DATA_URL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAn8B9UjLhXQAAAAASUVORK5CYII=';

describe('ImageBitmap', () => {
	let window: BrowserWindow;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;
	});

	describe('constructor()', () => {
		it('Throws error if constructor is called directly.', () => {
			expect(() => new (<any>window).ImageBitmap()).toThrow('Illegal constructor');
		});

		it('Throws error if source is not valid.', async () => {
			await expect(() => window.createImageBitmap(<any>{})).rejects.toThrow(
				new TypeError(
					`Failed to execute 'createImageBitmap' on 'Window': The provided value is not of type '(Blob or HTMLCanvasElement or HTMLImageElement or HTMLVideoElement or ImageBitmap or ImageData or OffscreenCanvas or SVGImageElement or VideoFrame)'.`
				)
			);
		});

		it('Throws error if source is an HTMLVideoElement.', async () => {
			const video = document.createElement('video');
			await expect(() => window.createImageBitmap(video)).rejects.toThrow(
				new window.DOMException(
					"Failed to execute 'createImageBitmap' on 'Window': HTMLVideoElement is not supported as an image source yet in Happy DOM.",
					DOMExceptionNameEnum.invalidStateError
				)
			);
		});

		it('Supports options as argument.', async () => {
			const options: IImageBitmapOptions = { premultiplyAlpha: 'none' };
			const image = document.createElement('img');
			image.src = IMAGE_DATA_URL;

			const imageBitmap = await window.createImageBitmap(image, 800, 600, options);
			expect(imageBitmap[PropertySymbol.options]).toBe(options);

			const imageBitmap2 = await window.createImageBitmap(image, 0, 0, 400, 300, options);
			expect(imageBitmap2[PropertySymbol.options]).toBe(options);

			const imageBitmap3 = await window.createImageBitmap(image, options);
			expect(imageBitmap3[PropertySymbol.options]).toBe(options);
		});

		it('Supports ImageBitmap as source.', async () => {
			const drawnImages: Array<{
				image: TCanvasImage;
				dx: number;
				dy: number;
				dw: number;
				dh: number;
			}> = [];
			const mockContext = {
				drawImage: (image: TCanvasImage, dx: number, dy: number, dw: number, dh: number) =>
					drawnImages.push({ image, dx, dy, dw, dh })
			};
			const mockAdapter: ICanvasAdapter = {
				getContext: mock().mockReturnValue(mockContext),
				toDataURL: mock(),
				toBlob: mock()
			};
			const window = new Window({ settings: { canvasAdapter: mockAdapter } });
			const offscreenCanvas = new window.OffscreenCanvas(800, 600);
			const sourceImageBitmap = await window.createImageBitmap(offscreenCanvas);

			const imageBitmap = await window.createImageBitmap(sourceImageBitmap);

			expect(drawnImages).toEqual([
				{
					image: offscreenCanvas,
					dx: -0,
					dy: -0,
					dw: 800,
					dh: 600
				},
				{
					image: imageBitmap,
					dx: -0,
					dy: -0,
					dw: 800,
					dh: 600
				}
			]);
			expect(imageBitmap[PropertySymbol.canvas]).toBeInstanceOf(OffscreenCanvas);
		});

		it('Supports HTMLImageElement as source.', async () => {
			const drawnImages: Array<{
				image: TCanvasImage;
				dx: number;
				dy: number;
				dw: number;
				dh: number;
			}> = [];
			const mockContext = {
				drawImage: (image: TCanvasImage, dx: number, dy: number, dw: number, dh: number) =>
					drawnImages.push({ image, dx, dy, dw, dh })
			};
			const mockAdapter: ICanvasAdapter = {
				getContext: mock().mockReturnValue(mockContext),
				toDataURL: mock(),
				toBlob: mock()
			};
			const window = new Window({ settings: { canvasAdapter: mockAdapter } });
			const image = document.createElement('img');
			image.src = IMAGE_DATA_URL;

			const imageBitmap = await window.createImageBitmap(image);

			expect(drawnImages).toEqual([
				{
					image,
					dx: -0,
					dy: -0,
					dw: 1,
					dh: 1
				}
			]);
			expect(imageBitmap[PropertySymbol.canvas]).toBeInstanceOf(OffscreenCanvas);
		});

		it('Supports HTMLCanvasElement as source.', async () => {
			const drawnImages: Array<{
				image: TCanvasImage;
				dx: number;
				dy: number;
				dw: number;
				dh: number;
			}> = [];
			const mockContext = {
				drawImage: (image: TCanvasImage, dx: number, dy: number, dw: number, dh: number) =>
					drawnImages.push({ image, dx, dy, dw, dh })
			};
			const mockAdapter: ICanvasAdapter = {
				getContext: mock().mockReturnValue(mockContext),
				toDataURL: mock(),
				toBlob: mock()
			};
			const window = new Window({ settings: { canvasAdapter: mockAdapter } });
			const canvas = document.createElement('canvas');
			canvas.width = 800;
			canvas.height = 600;

			const imageBitmap = await window.createImageBitmap(canvas);

			expect(drawnImages).toEqual([
				{
					image: canvas,
					dx: -0,
					dy: -0,
					dw: 800,
					dh: 600
				}
			]);
			expect(imageBitmap[PropertySymbol.canvas]).toBeInstanceOf(OffscreenCanvas);
		});

		it('Supports OffscreenCanvas as source.', async () => {
			const drawnImages: Array<{
				image: TCanvasImage;
				dx: number;
				dy: number;
				dw: number;
				dh: number;
			}> = [];
			const mockContext = {
				drawImage: (image: TCanvasImage, dx: number, dy: number, dw: number, dh: number) =>
					drawnImages.push({ image, dx, dy, dw, dh })
			};
			const mockAdapter: ICanvasAdapter = {
				getContext: mock().mockReturnValue(mockContext),
				toDataURL: mock(),
				toBlob: mock()
			};
			const window = new Window({ settings: { canvasAdapter: mockAdapter } });
			const offscreenCanvas = new window.OffscreenCanvas(800, 600);

			const imageBitmap = await window.createImageBitmap(offscreenCanvas);

			expect(drawnImages).toEqual([
				{
					image: offscreenCanvas,
					dx: -0,
					dy: -0,
					dw: 800,
					dh: 600
				}
			]);
			expect(imageBitmap[PropertySymbol.canvas]).toBeInstanceOf(OffscreenCanvas);
		});
	});

	describe('get width()', () => {
		it('Returns width.', async () => {
			const image = document.createElement('img');
			image.src = IMAGE_DATA_URL;

			const imageBitmap = await window.createImageBitmap(image, 800, 600);
			expect(imageBitmap.width).toBe(800);

			const imageBitmap2 = await window.createImageBitmap(image, 0, 0, 400, 300);
			expect(imageBitmap2.width).toBe(400);

			image.width = 400;
			image.height = 300;
			const imageBitmap3 = await window.createImageBitmap(image);
			expect(imageBitmap3.width).toBe(400);
		});
	});

	describe('get height()', () => {
		it('Returns height.', async () => {
			const image = document.createElement('img');
			image.src = IMAGE_DATA_URL;

			const imageBitmap = await window.createImageBitmap(image, 800, 600);
			expect(imageBitmap.height).toBe(600);

			const imageBitmap2 = await window.createImageBitmap(image, 400, 300);
			expect(imageBitmap2.height).toBe(300);

			image.width = 400;
			image.height = 300;
			const imageBitmap3 = await window.createImageBitmap(image);
			expect(imageBitmap3.height).toBe(300);
		});
	});

	describe('close()', () => {
		it('Clears internal data.', async () => {
			const image = document.createElement('img');
			image.src = IMAGE_DATA_URL;

			const imageBitmap = await window.createImageBitmap(image, 800, 600);
			imageBitmap[PropertySymbol.canvas] = <any>{};

			imageBitmap.close();

			expect(imageBitmap[PropertySymbol.canvas]).toBeNull();
			expect(imageBitmap[PropertySymbol.options]).toBeNull();
			expect(imageBitmap.width).toBe(0);
			expect(imageBitmap.height).toBe(0);
		});
	});
});
