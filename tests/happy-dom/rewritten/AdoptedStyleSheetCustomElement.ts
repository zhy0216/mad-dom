// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/AdoptedStyleSheetCustomElement.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import type ShadowRoot from '../shim/src/nodes/shadow-root/ShadowRoot.js';
import HTMLElement from '../shim/src/nodes/html-element/HTMLElement.js';

/**
 * CustomElement test class.
 */
export default class AdoptedStyleSheetCustomElement extends HTMLElement {
	public static observedAttributesCallCount = 0;
	public static shadowRootMode: 'open' | 'closed' = 'open';
	public changedAttributes: Array<{
		name: string;
		oldValue: string | null;
		newValue: string | null;
	}> = [];
	private internalShadowRoot: ShadowRoot;

	/**
	 * Constructor.
	 */
	constructor() {
		super();
		this.internalShadowRoot = this.attachShadow({
			mode: AdoptedStyleSheetCustomElement.shadowRootMode
		});
		const styleSheet = new this.ownerDocument.defaultView!.CSSStyleSheet();
		styleSheet.replaceSync(`
            :host {
                display: block;
                font: 14px "Lucida Grande", Helvetica, Arial, sans-serif;
            }
            span {
                color: pink;
            }
            .propKey {
                color: yellow;
            }
        `);
		this.internalShadowRoot.adoptedStyleSheets = [styleSheet];

		// Test to create a node while constructing this node.
		this.ownerDocument.createElement('div');
	}

	/**
	 * Returns a list of observed attributes.
	 *
	 * @returns Observered attributes.
	 */
	public static get observedAttributes(): string[] {
		this.observedAttributesCallCount++;
		return ['key1', 'key2'];
	}

	/**
	 * @override
	 */
	public attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
		this.changedAttributes.push({ name, oldValue, newValue });
	}

	/**
	 * @override
	 */
	public connectedCallback(): void {
		this.internalShadowRoot.innerHTML = `
            <div>
                <span class="propKey">
                    key1 is "${this.getAttribute('key1')}" and key2 is "${this.getAttribute(
											'key2'
										)}".
                </span>
                <span class="children">${Array.from(this.childNodes)
									.map(
										(child: any) =>
											'#' + child['nodeType'] + (child['tagName'] || '') + child.textContent
									)
									.join(', ')}</span>
                <span><slot></slot></span>
            </div>
        `;
	}
}
