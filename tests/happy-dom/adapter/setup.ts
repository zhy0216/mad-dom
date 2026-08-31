/**
 * hdunit (T03) bun adapter — port of the upstream `test/setup.ts` to bun
 * semantics.
 *
 * Upstream (tests/happy-dom/vendor/setup.ts, v20.11.11 @ 64e2c774) registers
 * `mockModule`/`resetMockedModules` globals and `vi.mock('child_process'|'http'|'https')`
 * with an `importOriginal` lazy factory; the shared mutable implementation
 * object is what consumers import (vitest live-binds by reference, so mutating
 * the object is enough).
 *
 * Bun's `mock.module(path, factory)` does NOT provide `importOriginal` and does
 * not re-read a previously returned object on later imports. To keep the
 * upstream semantics we therefore:
 *
 *   1. eagerly import the real modules and snapshot their export values BEFORE
 *      any mock registration (mock.module patches the namespace object in
 *      place, so a late snapshot would read stale/mocked values);
 *   2. pre-build one mutable implementation copy per module and register it via
 *      `mock.module(name, () => impl[name])`;
 *   3. re-register `mock.module` every time the implementation object is
 *      mutated (mockModule) or restored (resetMockedModules), which makes bun
 *      re-patch existing ESM bindings so consumers see the change.
 *
 * `beforeAll` mirrors the upstream TZ pin (`Etc/GMT-2`); the same value is also
 * set at module scope so the adapter self-tests (which import this file without
 * a preload, where `beforeAll` would not fire) observe the same environment.
 */

import { beforeAll, mock } from 'bun:test';
import * as childProcessNS from 'child_process';
import * as httpNS from 'http';
import * as httpsNS from 'https';

const mockedModuleNames = ['child_process', 'http', 'https'];

const mockedModuleOriginals: Record<string, Record<string, unknown>> = {};
const mockedModuleImplementations: Record<string, Record<string, unknown>> = {};

const moduleOriginals: Record<string, Record<string, unknown>> = {
	child_process: childProcessNS,
	http: httpNS,
	https: httpsNS
};

for (const name of mockedModuleNames) {
	const original = moduleOriginals[name];
	// Snapshot own enumerable export values before any mock registration.
	const originalSnapshot: Record<string, unknown> = {};
	for (const key of Object.keys(original)) {
		originalSnapshot[key] = original[key];
	}
	mockedModuleOriginals[name] = originalSnapshot;
	mockedModuleImplementations[name] = Object.assign({}, originalSnapshot);
	mockedModuleImplementations[name].default =
		mockedModuleImplementations[name].default || mockedModuleImplementations[name];
	mock.module(name, () => mockedModuleImplementations[name]);
}

function reapplyMock(name: string): void {
	mock.module(name, () => mockedModuleImplementations[name]);
}

export function mockModule(name: string, module: Record<string, unknown>): void {
	if (!mockedModuleNames.includes(name)) {
		throw new Error(
			`The module "${name}" is not mocked. Please add it to the mocked modules array in "setup.js".`
		);
	}

	if (!mockedModuleImplementations[name]) {
		throw new Error(
			`The module "${name}" has not been imported and the mocking has not been invoked.`
		);
	}

	for (const key of Object.keys(module)) {
		mockedModuleImplementations[name][key] = module[key];
	}

	mockedModuleImplementations[name]['default'] = mockedModuleImplementations[name];
	reapplyMock(name);
}

export function resetMockedModules(): void {
	for (const name of mockedModuleNames) {
		if (!mockedModuleImplementations[name]) {
			throw new Error(`The module "${name}" has not been mocked.`);
		}
		mockedModuleImplementations[name] = Object.assign(
			mockedModuleImplementations[name],
			mockedModuleOriginals[name]
		);
		mockedModuleImplementations[name]['default'] = mockedModuleImplementations[name];
		reapplyMock(name);
	}
}

(globalThis as Record<string, unknown>)['mockModule'] = mockModule;
(globalThis as Record<string, unknown>)['resetMockedModules'] = resetMockedModules;

process.env.TZ = 'Etc/GMT-2';

try {
	beforeAll(() => {
		process.env.TZ = 'Etc/GMT-2';
	});
} catch {
	// Not running under `bun test` (e.g. a standalone `bun --check setup.ts`):
	// `beforeAll` is only legal inside the runner. The module-scope TZ pin above
	// already applies there; under `bun test` the hook additionally re-asserts
	// the value for each test file (matching upstream test/setup.ts).
}
