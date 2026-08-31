// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/file/FileReader.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Blob from '../../shim/src/file/Blob.js';
import type FileReader from '../../shim/src/file/FileReader.js';
import Window from '../../shim/src/window/Window.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('FileReader', () => {
	let window: Window;
	let fileReader: FileReader;

	beforeEach(() => {
		window = new Window();
		fileReader = new window.FileReader();
	});

	describe('readAsDataURL()', () => {
		it('Reads Blob as data URL.', async () => {
			const blob = new Blob(['TEST'], {
				type: 'text/plain;charset=utf-8'
			});
			let result: string | null = null;
			fileReader.addEventListener('load', () => {
				result = <string>fileReader.result;
			});
			fileReader.readAsDataURL(blob);
			await window.happyDOM?.waitUntilComplete();
			expect(result).toBe('data:text/plain;charset=utf-8;base64,VEVTVA==');
		});

		it('Reads Blob as data URL passing invalid parameter.', () => {
			expect(() => {
				fileReader.readAsDataURL(<any>'invalid');
			}).toThrow(
				`Failed to execute 'readAsDataURL' on 'FileReader': parameter 1 is not of type 'Blob'.`
			);
		});
	});

	describe('readAsText()', () => {
		it('Reads Blob as text.', async () => {
			const blob = new Blob(['TEST'], {
				type: 'text/plain;charset=utf-8'
			});
			let result: string | null = null;
			fileReader.addEventListener('load', () => {
				result = <string>fileReader.result;
			});
			fileReader.readAsText(blob);
			await window.happyDOM?.waitUntilComplete();
			expect(result).toBe('TEST');
		});

		it('Reads Blob as text passing invalid parameter.', () => {
			expect(() => {
				fileReader.readAsText(<any>'invalid');
			}).toThrow(
				`Failed to execute 'readAsText' on 'FileReader': parameter 1 is not of type 'Blob'.`
			);
		});
	});

	describe('readAsArrayBuffer()', () => {
		it('Reads Blob as array buffer.', async () => {
			const blob = new Blob(['TEST'], {
				type: 'text/plain;charset=utf-8'
			});
			let result: ArrayBuffer | null = null;
			fileReader.addEventListener('load', () => {
				result = <ArrayBuffer>fileReader.result;
			});
			fileReader.readAsArrayBuffer(blob);
			await window.happyDOM?.waitUntilComplete();
			expect(result).toBeInstanceOf(ArrayBuffer);
		});

		it('Reads Blob as array buffer passing invalid parameter.', () => {
			expect(() => {
				fileReader.readAsArrayBuffer(<any>'invalid');
			}).toThrow(
				`Failed to execute 'readAsArrayBuffer' on 'FileReader': parameter 1 is not of type 'Blob'.`
			);
		});
	});

	describe('readAsBinaryString()', () => {
		it('Reads Blob as binary string.', async () => {
			const blob = new Blob(['TEST'], {
				type: 'text/plain;charset=utf-8'
			});
			let result: string | null = null;
			fileReader.addEventListener('load', () => {
				result = <string>fileReader.result;
			});
			fileReader.readAsBinaryString(blob);
			await window.happyDOM?.waitUntilComplete();
			expect(result).toBe('TEST');
		});

		it('Reads Blob as binary string passing invalid parameter.', () => {
			expect(() => {
				fileReader.readAsBinaryString(<any>'invalid');
			}).toThrow(
				`Failed to execute 'readAsBinaryString' on 'FileReader': parameter 1 is not of type 'Blob'.`
			);
		});
	});
});
