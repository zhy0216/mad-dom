// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/clipboard/Clipboard.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import ClipboardItem from '../../shim/src/clipboard/ClipboardItem.js';
import Blob from '../../shim/src/file/Blob.js';
import Window from '../../shim/src/window/Window.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('Clipboard', () => {
	let window: Window;

	beforeEach(() => {
		window = new Window();
	});

	describe('read()', () => {
		it('Reads from the clipboard.', async () => {
			const items = [
				new ClipboardItem({
					'text/plain': new Blob(['test-a'], { type: 'text/plain' })
				}),
				new ClipboardItem({
					'text/html': new Blob(['<b>test-b</b>'], { type: 'text/html' })
				}),
				new ClipboardItem({
					'text/plain': 'test-c'
				}),
				new ClipboardItem({
					'text/plain': Promise.resolve('test-d')
				}),
				new ClipboardItem({
					'text/plain': Promise.resolve(new Blob(['test-e'], { type: 'text/plain' }))
				})
			];
			await window.navigator.clipboard.write(items);
			const data = await window.navigator.clipboard.read();
			expect(data).toEqual(items);

			let text = '';

			for (const item of data) {
				const data = await item.getType(item.types[0]);
				expect(data).toBeInstanceOf(Blob);

				text += await data.text();
			}

			expect(text).toBe('test-a<b>test-b</b>test-ctest-dtest-e');
		});

		it('Throws an error if the permission is denied.', async () => {
			const permissionStatus = await window.navigator.permissions.query({
				name: 'clipboard-read'
			});
			permissionStatus.state = 'denied';

			let error: Error | null = null;

			try {
				await window.navigator.clipboard.read();
			} catch (e) {
				error = e;
			}

			expect(error?.message).toBe(
				"Failed to execute 'read' on 'Clipboard': The request is not allowed"
			);
		});
	});

	describe('readText()', () => {
		it('Reads text from the clipboard.', async () => {
			const items = [
				new ClipboardItem({
					'text/plain': new Blob(['test-a'], { type: 'text/plain' })
				}),
				new ClipboardItem({
					'text/html': new Blob(['<b>test-b</b>'], { type: 'text/html' })
				}),
				new ClipboardItem({
					'text/plain': 'test-c'
				}),
				new ClipboardItem({
					'text/plain': Promise.resolve('test-d')
				}),
				new ClipboardItem({
					'text/plain': Promise.resolve(new Blob(['test-e'], { type: 'text/plain' }))
				})
			];
			await window.navigator.clipboard.write(items);
			const data = await window.navigator.clipboard.readText();
			expect(data).toBe('test-atest-ctest-dtest-e');
		});

		it('Throws an error if the permission is denied.', async () => {
			const permissionStatus = await window.navigator.permissions.query({
				name: 'clipboard-read'
			});
			permissionStatus.state = 'denied';

			let error: Error | null = null;

			try {
				await window.navigator.clipboard.readText();
			} catch (e) {
				error = e;
			}

			expect(error?.message).toBe(
				"Failed to execute 'readText' on 'Clipboard': The request is not allowed"
			);
		});
	});

	describe('write()', () => {
		it('Writes to the clipboard.', async () => {
			const items = [
				new ClipboardItem({
					'text/plain': new Blob(['test'], { type: 'text/plain' })
				}),
				new ClipboardItem({
					'text/html': new Blob(['<b>test</b>'], { type: 'text/html' })
				})
			];
			await window.navigator.clipboard.write(items);
			const data = await window.navigator.clipboard.read();
			expect(data).toEqual(items);
		});

		it('Throws an error if the permission is denied.', async () => {
			const permissionStatus = await window.navigator.permissions.query({
				name: 'clipboard-write'
			});
			permissionStatus.state = 'denied';

			let error: Error | null = null;

			try {
				await window.navigator.clipboard.write([]);
			} catch (e) {
				error = e;
			}

			expect(error?.message).toBe(
				"Failed to execute 'write' on 'Clipboard': The request is not allowed"
			);
		});
	});

	describe('writeText()', () => {
		it('Writes text to the clipboard.', async () => {
			const text = 'test';
			await window.navigator.clipboard.writeText(text);
			const data = await window.navigator.clipboard.readText();
			expect(data).toBe(text);
		});

		it('Throws an error if the permission is denied.', async () => {
			const permissionStatus = await window.navigator.permissions.query({
				name: 'clipboard-write'
			});
			permissionStatus.state = 'denied';

			let error: Error | null = null;

			try {
				await window.navigator.clipboard.writeText('test');
			} catch (e) {
				error = e;
			}

			expect(error?.message).toBe(
				"Failed to execute 'writeText' on 'Clipboard': The request is not allowed"
			);
		});
	});
});
