/**
 * hdunit (T03) adapter self-test — mockModule / resetMockedModules workflow.
 *
 * Simulates the upstream `test/setup.ts` usage pattern: test files call the
 * global `mockModule(name, impl)` to install a node-module mock, exercise code
 * that imports the module, then `resetMockedModules()` in afterEach. This is
 * verified against a real consumer module that imports the mocked modules the
 * same way happy-dom internals would (see ./fixtures/node-module-consumer.ts).
 *
 * Semantic parity points with tests/happy-dom/vendor/setup.ts:
 *   - unknown module names throw the upstream error;
 *   - `mockModule` mutates the shared implementation object and sets `default`;
 *   - `resetMockedModules` copies the original exports back over the impl.
 */

import { afterEach, test, expect } from 'bun:test';
import { vi } from './index';
import { mockModule, resetMockedModules } from './setup';

const consumer = await import('./fixtures/node-module-consumer');
const g = globalThis as Record<string, unknown>;

afterEach(() => {
	resetMockedModules();
});

test('globals are installed for upstream (bare) usage', () => {
	expect(typeof g.mockModule).toBe('function');
	expect(typeof g.resetMockedModules).toBe('function');
});

test('mockModule lets a consumer observe the https.request mock', () => {
	const requestMock = vi.fn((url: string) => `MOCK:${url}`);
	mockModule('https', { request: requestMock });

	const result = consumer.doHttpsRequest('http://example.com/');
	expect(result).toBe('MOCK:http://example.com/');
	expect(requestMock).toHaveBeenCalledWith('http://example.com/');
});

test('mockModule covers http and child_process too', () => {
	mockModule('http', { get: () => 'HTTP-MOCKED' });
	mockModule('child_process', { exec: () => 'EXEC-MOCKED' });

	expect(consumer.doHttpGet('http://example.com/')).toBe('HTTP-MOCKED');
	expect(consumer.doChildProcessExec('ls')).toBe('EXEC-MOCKED');
});

test('resetMockedModules restores original implementations', () => {
	mockModule('https', { request: () => 'MOCKED' });
	expect(consumer.doHttpsRequest('http://example.com/')).toBe('MOCKED');

	resetMockedModules();

	// Real https.request rejects an invalid URL synchronously — proving the
	// mock was removed and the original binding is live again.
	expect(() => consumer.doHttpsRequest('not-a-valid-url')).toThrow();
});

test('mock -> reset -> mock roundtrip keeps working across re-registrations', () => {
	mockModule('https', { request: () => 'ONE' });
	expect(consumer.doHttpsRequest('u')).toBe('ONE');

	mockModule('https', { request: () => 'TWO' });
	expect(consumer.doHttpsRequest('u')).toBe('TWO');

	resetMockedModules();
	expect(() => consumer.doHttpsRequest('not-a-valid-url')).toThrow();

	mockModule('https', { request: () => 'THREE' });
	expect(consumer.doHttpsRequest('u')).toBe('THREE');
});

test('the global mockModule form works exactly like the imported one', () => {
	(g.mockModule as typeof mockModule)('https', { request: () => 'GLOBAL-MOCKED' });
	expect(consumer.doHttpsRequest('u')).toBe('GLOBAL-MOCKED');
});

test('unknown module names throw the upstream error', () => {
	expect(() => mockModule('fs', {})).toThrow(
		'The module "fs" is not mocked. Please add it to the mocked modules array in "setup.js".'
	);
});
