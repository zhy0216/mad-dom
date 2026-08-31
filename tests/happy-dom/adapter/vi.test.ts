/**
 * hdunit (T03) adapter self-test — `vi` compat surface.
 *
 * Verifies the mapping of the vitest `vi` API surface used by the vendored
 * suite onto bun primitives: fn, spyOn (with registry tracking), clearAllMocks,
 * restoreAllMocks, the mockImplementation family, and the `vi.mock`
 * placeholder error.
 */

import { describe, test, expect } from 'bun:test';
import { vi } from './index';

describe('vi.fn', () => {
	test('maps to bun mock and behaves as a plain mock function', () => {
		const fn = vi.fn((x: number) => x * 2);
		expect(fn(2)).toBe(4);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith(2);
	});

	test('mockImplementation family is equivalent to vi.fn', () => {
		const fn = vi.fn();
		fn.mockImplementation((x: number) => x + 1);
		expect(fn(1)).toBe(2);
		fn.mockImplementationOnce((x: number) => x * 10);
		expect(fn(1)).toBe(10);
		expect(fn(1)).toBe(2);

		const withReturn = vi.fn();
		withReturn.mockReturnValue('return-value');
		expect(withReturn()).toBe('return-value');

		const withResolved = vi.fn();
		withResolved.mockResolvedValue('resolved');
		expect(withResolved()).resolves.toBe('resolved');

		const withRejected = vi.fn();
		withRejected.mockRejectedValue(new Error('rejected'));
		expect(withRejected()).rejects.toThrow('rejected');
	});

	test('mockClear/mockReset/mockRestore exist on vi.fn mocks', () => {
		const fn = vi.fn(() => 42);
		fn();
		expect(typeof fn.mockClear).toBe('function');
		expect(typeof fn.mockReset).toBe('function');
		expect(typeof fn.mockRestore).toBe('function');
		fn.mockClear();
		expect(fn).toHaveBeenCalledTimes(0);
	});
});

describe('vi.spyOn', () => {
	test('registers spies so restoreAllMocks restores original implementations', () => {
		const object = {
			method(): string {
				return 'original';
			}
		};

		const spy = vi.spyOn(object, 'method');
		spy.mockImplementation(() => 'mocked');
		expect(object.method()).toBe('mocked');
		expect(spy).toHaveBeenCalledTimes(1);

		vi.restoreAllMocks();
		expect(object.method()).toBe('original');
		expect(spy).toHaveBeenCalledTimes(0);
	});

	test('restoreAllMocks is idempotent (registry is cleared)', () => {
		const object = {
			value(): number {
				return 1;
			}
		};
		vi.spyOn(object, 'value').mockReturnValue(2);
		vi.restoreAllMocks();
		expect(object.value()).toBe(1);
		expect(() => vi.restoreAllMocks()).not.toThrow();
	});

	test('spies on console like the vendored suite does', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		console.log('hidden');
		expect(spy).toHaveBeenCalledTimes(1);
		vi.restoreAllMocks();
	});
});

describe('vi.clearAllMocks', () => {
	test('clears call history but keeps implementations', () => {
		const fn = vi.fn(() => 'kept');
		fn();
		expect(fn).toHaveBeenCalledTimes(1);
		vi.clearAllMocks();
		expect(fn).toHaveBeenCalledTimes(0);
		expect(fn()).toBe('kept');
	});
});

describe('vi.mock', () => {
	test('is a placeholder that throws with guidance', () => {
		expect(() => vi.mock('http', () => ({}))).toThrow(/not implemented/);
		expect(() => vi.mock('http', () => ({}))).toThrow(/adapter-gaps/);
	});
});
