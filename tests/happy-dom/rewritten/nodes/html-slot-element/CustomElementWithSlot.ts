// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-slot-element/CustomElementWithSlot.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLElement from '../../../shim/src/nodes/html-element/HTMLElement.js';
import type ShadowRoot from '../../../shim/src/nodes/shadow-root/ShadowRoot.js';

/**
 * Custom element test class.
 */
export default class CustomElementWithSlot extends HTMLElement {
	/**
	 * Constructor.
	 */
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
	}

	/**
	 * @override
	 */
	public connectedCallback(): void {
		(<ShadowRoot>this.shadowRoot).innerHTML = `
            <div>
                <span><slot></slot></span>
            </div>
        `;
	}
}
