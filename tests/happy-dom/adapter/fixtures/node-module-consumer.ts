/**
 * hdunit (T03) adapter self-test fixture.
 *
 * Simulates how happy-dom internals consume the mocked node modules: imports a
 * named export at module-evaluation time, then invokes it later. Because the
 * adapter registers `mock.module` for child_process/http/https before this
 * module is imported (setup.ts is imported first by the tests), these bindings
 * resolve to the adapter's mutable implementation copies, and mockModule()
 * mutations / resetMockedModules() are observable through the exported
 * functions below.
 */

import { request as httpsRequest } from 'https';
import { get as httpGet } from 'http';
import { exec as childProcessExec } from 'child_process';

export function doHttpsRequest(url: string): unknown {
	return httpsRequest(url);
}

export function doHttpGet(url: string): unknown {
	return httpGet(url);
}

export function doChildProcessExec(command: string): unknown {
	return childProcessExec(command);
}
