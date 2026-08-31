// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-body-element/HTMLBodyElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLBodyElement from '../../../shim/src/nodes/html-body-element/HTMLBodyElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';
import Event from '../../../shim/src/event/Event.js';

describe('HTMLBodyElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLBodyElement;

	beforeEach(() => {
		window = new Window({
			settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true }
		});
		document = window.document;
		element = document.createElement('body');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLBodyElement', () => {
			expect(element instanceof HTMLBodyElement).toBe(true);
		});
	});

	for (const event of [
		'afterprint',
		'beforeprint',
		'beforeunload',
		'gamepadconnected',
		'gamepaddisconnected',
		'hashchange',
		'languagechange',
		'message',
		'messageerror',
		'offline',
		'online',
		'pagehide',
		'pageshow',
		'popstate',
		'rejectionhandled',
		'storage',
		'unhandledrejection',
		'unload'
	]) {
		describe(`get on${event}()`, () => {
			it('Returns the event listener.', () => {
				element.setAttribute(`on${event}`, 'window.test = 1');
				expect((<any>element)[`on${event}`]).toBeTypeOf('function');
				(<any>element)[`on${event}`](new Event(event));
				expect((<any>window)['test']).toBe(1);
			});
		});

		describe(`set on${event}()`, () => {
			it('Sets the event listener.', () => {
				(<any>element)[`on${event}`] = () => {
					(<any>window)['test'] = 1;
				};
				element.dispatchEvent(new Event(event));
				expect(element.getAttribute(`on${event}`)).toBe(null);
				expect((<any>window)['test']).toBe(1);
			});
		});
	}
});
