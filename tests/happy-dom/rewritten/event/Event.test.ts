// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/event/Event.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import Window from '../../shim/src/window/Window.js';
import type Document from '../../shim/src/nodes/document/Document.js';
import Event from '../../shim/src/event/Event.js';
import CustomElement from '../CustomElement.js';
import { beforeEach, afterEach, describe, it, expect, spyOn } from 'bun:test';
import { restoreAllMocks } from '../../adapter/index.js';
import type EventTarget from '../../shim/src/event/EventTarget.js';
import * as PropertySymbol from '../../shim/src/PropertySymbol.js';

describe('Event', () => {
	let window: Window;
	let document: Document;

	beforeEach(() => {
		window = new Window();
		document = window.document;

		window.customElements.define('custom-element', CustomElement);
	});

	afterEach(() => {
		restoreAllMocks();
	});

	describe('get target()', () => {
		it('Returns target.', () => {
			const event = new Event('click', { bubbles: true });
			let target: EventTarget | null = null;
			expect(event.target === null).toBe(true);

			const div = document.createElement('div');
			const span = document.createElement('span');

			div.appendChild(span);

			span.addEventListener('click', (e: Event) => {
				target = e.target;
			});
			span.dispatchEvent(event);

			expect(event.target).toBe(span);
			expect(target).toBe(span);
		});
	});

	describe('get currentTarget()', () => {
		it('Returns current target.', () => {
			const event = new Event('click', { bubbles: true });
			let currentTarget: EventTarget | null = null;
			expect(event.currentTarget === null).toBe(true);

			const div = document.createElement('div');
			const span = document.createElement('span');

			div.appendChild(span);

			span.addEventListener('click', (e: Event) => {
				currentTarget = e.currentTarget;
			});
			span.dispatchEvent(event);

			expect(event.currentTarget).toBe(null);
			expect(currentTarget).toBe(span);
		});
	});

	describe('get cancelBubble()', () => {
		it('Returns "true" if propagation has been stopped.', () => {
			const event = new Event('click');
			expect(event.cancelBubble).toBe(false);
			event.stopPropagation();
			expect(event.cancelBubble).toBe(true);
		});
	});

	describe('initEvent()', () => {
		it('Deprecated way to init an event.', () => {
			const event = new Event('click');
			event.initEvent('newEventType', true, true);
			expect(event.type).toBe('newEventType');
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(true);
		});

		it('Sets "defaultPrevented" to "false" when initEvent() is called.', () => {
			const event = new Event('click', { cancelable: true });
			event.preventDefault();
			expect(event.defaultPrevented).toBe(true);
			event.initEvent('newEventType', true, true);
			expect(event.defaultPrevented).toBe(false);
		});

		it('Sets "propagationStopped" to "false" when initEvent() is called.', () => {
			const event = new Event('click');
			event.stopPropagation();
			expect(event.cancelBubble).toBe(true);
			event.initEvent('newEventType', true, true);
			expect(event.cancelBubble).toBe(false);
		});

		it('Sets "immediatePropagationStopped" to "false" when initEvent() is called.', () => {
			const event = new Event('click');
			event.stopImmediatePropagation();
			expect(event[PropertySymbol.immediatePropagationStopped]).toBe(true);
			event.initEvent('newEventType', true, true);
			expect(event[PropertySymbol.immediatePropagationStopped]).toBe(false);
		});
	});

	describe('preventDefault()', () => {
		it('Prevents default behaviour.', () => {
			const event = new Event('click', { cancelable: true });
			event.preventDefault();
			expect(event.defaultPrevented).toBe(true);
		});

		it("Doesn't prevent default if event is in a passive listener.", () => {
			const event = new Event('click', { bubbles: true, cancelable: true });
			expect(event.currentTarget === null).toBe(true);

			const div = document.createElement('div');
			const span = document.createElement('span');

			div.appendChild(span);

			span.addEventListener(
				'click',
				(e: Event) => {
					e.preventDefault();
				},
				{ passive: true }
			);

			span.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(false);

			span.addEventListener('click', (e: Event) => {
				e.preventDefault();
			});

			span.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(true);
		});

		it("Doesn't prevent default if event is not cancelable.", () => {
			const event = new Event('click', { bubbles: true, cancelable: false });
			event.preventDefault();
			expect(event.defaultPrevented).toBe(false);
		});
	});

	describe('stopImmediatePropagation()', () => {
		it('Stops any proceeding listener from beeing called.', () => {
			const event = new Event('click', { bubbles: true });

			expect(event.currentTarget === null).toBe(true);

			const div = document.createElement('div');
			const span = document.createElement('span');
			let isSpanListenerCalled = false;
			let isDivListenerCalled = false;

			div.appendChild(span);

			span.addEventListener('click', (e: Event) => e.stopImmediatePropagation());
			span.addEventListener('click', () => (isSpanListenerCalled = true));
			div.addEventListener('click', () => (isDivListenerCalled = true));

			span.dispatchEvent(event);

			expect(isSpanListenerCalled).toBe(false);
			expect(isDivListenerCalled).toBe(false);
		});
	});

	describe('stopPropagation()', () => {
		it('Stops bubbling to the parent node.', () => {
			const event = new Event('click', { bubbles: true });

			expect(event.currentTarget === null).toBe(true);

			const div = document.createElement('div');
			const span = document.createElement('span');
			let isSpanListenerCalled = false;
			let isDivListenerCalled = false;

			div.appendChild(span);

			span.addEventListener('click', (e: Event) => e.stopPropagation());
			span.addEventListener('click', () => (isSpanListenerCalled = true));
			div.addEventListener('click', () => (isDivListenerCalled = true));

			span.dispatchEvent(event);

			expect(isSpanListenerCalled).toBe(true);
			expect(isDivListenerCalled).toBe(false);
		});
	});

	describe('get timeStamp()', () => {
		it('Returns the value returned by performance.now() at the time it was created.', () => {
			const performanceNow = 12345;
			spyOn(performance, 'now').mockImplementation(() => {
				return performanceNow;
			});
			const event = new Event('click');
			expect(event.timeStamp).toBe(performanceNow);
		});
	});

	describe('composedPath()', () => {
		it('Returns a composed path.', () => {
			const div = document.createElement('div');
			const span = document.createElement('span');
			let composedPath: EventTarget[] | null = null;

			div.appendChild(span);
			document.body.appendChild(div);

			div.addEventListener('click', (event: Event) => {
				composedPath = event.composedPath();
			});

			span.dispatchEvent(
				new Event('click', {
					bubbles: true
				})
			);

			expect((<EventTarget[]>(<unknown>composedPath)).length).toBe(6);
			expect((<EventTarget[]>(<unknown>composedPath))[0] === span).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[1] === div).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[2] === document.body).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[3] === document.documentElement).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[4] === document).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[5] === window).toBe(true);
		});

		it('Excludes Window from the composed path if the event type is "load".', () => {
			const div = document.createElement('div');
			const span = document.createElement('span');
			let composedPath: EventTarget[] | null = null;

			div.appendChild(span);
			document.body.appendChild(div);

			div.addEventListener('load', (event: Event) => {
				composedPath = event.composedPath();
			});

			span.dispatchEvent(
				new Event('load', {
					bubbles: true
				})
			);

			expect((<EventTarget[]>(<unknown>composedPath)).length).toBe(5);
			expect((<EventTarget[]>(<unknown>composedPath))[0] === span).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[1] === div).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[2] === document.body).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[3] === document.documentElement).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[4] === document).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[5] === undefined).toBe(true);
		});

		it('Goes through shadow roots if composed is set to "true".', () => {
			const div = document.createElement('div');
			const customELement = document.createElement('custom-element');
			let composedPath: EventTarget[] | null = null;

			div.appendChild(customELement);

			document.body.appendChild(div);

			div.addEventListener('click', (event: Event) => {
				composedPath = event.composedPath();
			});

			customELement.shadowRoot?.children[1].children[0].dispatchEvent(
				new Event('click', {
					bubbles: true,
					composed: true
				})
			);

			expect((<EventTarget[]>(<unknown>composedPath)).length).toBe(9);
			expect(
				(<EventTarget[]>(<unknown>composedPath))[0] ===
					customELement.shadowRoot?.children[1].children[0]
			).toBe(true);
			expect(
				(<EventTarget[]>(<unknown>composedPath))[1] === customELement.shadowRoot?.children[1]
			).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[2] === customELement.shadowRoot).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[3] === customELement).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[4] === div).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[5] === document.body).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[6] === document.documentElement).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[7] === document).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[8] === window).toBe(true);
		});

		it('Does not go through shadow roots if composed is set to "false".', () => {
			const customELement = document.createElement('custom-element');
			let composedPath: EventTarget[] | null = null;

			document.body.appendChild(customELement);

			customELement.shadowRoot?.children[1].addEventListener('click', (event: Event) => {
				composedPath = event.composedPath();
			});

			customELement.shadowRoot?.children[1].children[0].dispatchEvent(
				new Event('click', {
					bubbles: true
				})
			);

			expect((<EventTarget[]>(<unknown>composedPath)).length).toBe(3);
			expect(
				(<EventTarget[]>(<unknown>composedPath))[0] ===
					customELement.shadowRoot?.children[1].children[0]
			).toBe(true);
			expect(
				(<EventTarget[]>(<unknown>composedPath))[1] === customELement.shadowRoot?.children[1]
			).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[2] === customELement.shadowRoot).toBe(true);
		});

		it('Returns correct composed for HTMLAnchorElement event target and composed is set to "true".', () => {
			const anchor = document.createElement('a');
			anchor.setAttribute('href', 'https://example.com');
			let composedPath: EventTarget[] | null = null;

			document.body.appendChild(anchor);

			anchor.addEventListener('click', (event: Event) => {
				composedPath = event.composedPath();
			});

			anchor.dispatchEvent(
				new Event('click', {
					bubbles: true,
					composed: true
				})
			);

			expect((<EventTarget[]>(<unknown>composedPath)).length).toBe(5);
			expect((<EventTarget[]>(<unknown>composedPath))[0] === anchor).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[1] === document.body).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[2] === document.documentElement).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[3] === document).toBe(true);
			expect((<EventTarget[]>(<unknown>composedPath))[4] === window).toBe(true);
		});
	});
});
