/**
 * hdunit (T03) bun adapter — vi-compatible surface for the rewritten happy-dom
 * test suite.
 *
 * The rewritten tests (`tests/happy-dom/rewritten/**`, produced by T02) import
 * `{ vi }` from this module instead of `vitest`. Every backing primitive is the
 * native bun:test implementation:
 *
 *   - `vi.fn`            -> `mock` from `bun:test`
 *   - `vi.spyOn`         -> `spyOn` from `bun:test`, wrapped to register the
 *                           spy so `restoreAllMocks()` can walk it
 *   - `vi.clearAllMocks` -> `mock.clearAllMocks` from `bun:test`
 *   - `vi.restoreAllMocks`-> registry walk: calls `mockRestore()` on every
 *                           registered spy and empties the registry
 *   - `vi.mock`          -> placeholder that throws with guidance. The only
 *                           `vi.mock` call sites of the vendored suite are the
 *                           three in `test/setup.ts` (child_process/http/https),
 *                           which `./setup.ts` handles via `mock.module`; any
 *                           other dynamic `vi.mock` usage must be recorded in
 *                           `tests/happy-dom/adapter-gaps.json` (see T03 / T05).
 */

import { mock, spyOn as bunSpyOn } from 'bun:test';

type Spy = ReturnType<typeof bunSpyOn>;

const spyRegistry = new Set<Spy>();

export function spyOn<T extends object, K extends keyof T>(
	object: T,
	method: K
): ReturnType<typeof bunSpyOn<T, K>> {
	const spy = bunSpyOn(object, method);
	spyRegistry.add(spy as Spy);
	return spy as ReturnType<typeof bunSpyOn<T, K>>;
}

export function restoreAllMocks(): void {
	for (const spy of spyRegistry) {
		spy.mockRestore();
	}
	spyRegistry.clear();
}

export const clearAllMocks = mock.clearAllMocks;

export const vi = {
	fn: mock,
	spyOn,
	clearAllMocks: mock.clearAllMocks,
	restoreAllMocks,
	mock: (): never => {
		throw new Error(
			'vi.mock() is not implemented by the hdunit bun adapter. ' +
				'The only vi.mock call sites in the vendored suite are the three in ' +
				'test/setup.ts (child_process/http/https), handled by ' +
				'tests/happy-dom/adapter/setup.ts via bun mock.module. ' +
				'Any other dynamic vi.mock usage must be registered as an adapter-gap in ' +
				'tests/happy-dom/adapter-gaps.json instead of extending this adapter ' +
				'(fidelity first — do not invent new APIs).'
		);
	}
};
