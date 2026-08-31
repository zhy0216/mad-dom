// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/permissions/Permissions.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Window from '../../shim/src/window/Window.js';
import PermissionNameEnum from '../../src/permissions/PermissionNameEnum.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('Permissions', () => {
	let window: Window;

	beforeEach(() => {
		window = new Window();
	});

	describe('queue()', () => {
		for (const permissionName of Object.values(PermissionNameEnum)) {
			it(`Reads permissions for ${permissionName}.`, async () => {
				const permissionStatus = await window.navigator.permissions.query({
					name: permissionName
				});
				expect(permissionStatus).toBeInstanceOf(window.PermissionStatus);
				expect(permissionStatus.state).toBe('granted');
				const permissionStatus2 = await window.navigator.permissions.query({
					name: permissionName
				});
				expect(permissionStatus2).toBe(permissionStatus);
			});
		}

		it('Throws an error for unsupported permission names.', async () => {
			let error: Error | null = null;
			try {
				await window.navigator.permissions.query({
					name: 'test'
				});
			} catch (e) {
				error = e;
			}
			expect(error?.message).toBe(
				"Failed to execute 'query' on 'Permissions': Failed to read the 'name' property from 'PermissionDescriptor': The provided value 'test' is not a valid enum value of type PermissionName."
			);
		});
	});
});
