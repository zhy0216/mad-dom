// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-legend-element/HTMLLegendElement.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import HTMLLegendElement from '../../../shim/src/nodes/html-legend-element/HTMLLegendElement.js';
import Window from '../../../shim/src/window/Window.js';
import type Document from '../../../shim/src/nodes/document/Document.js';
import { beforeEach, describe, it, expect } from 'bun:test';

describe('HTMLLegendElement', () => {
	let window: Window;
	let document: Document;
	let element: HTMLLegendElement;

	beforeEach(() => {
		window = new Window();
		document = window.document;
		element = document.createElement('legend');
	});

	describe('constructor()', () => {
		it('Should be an instanceof HTMLLegendElement', () => {
			expect(element instanceof HTMLLegendElement).toBe(true);
		});
	});

	describe('get form()', () => {
		it('Returns null if no parent fieldset or form element exists.', () => {
			expect(element.form).toBe(null);

			document.body.innerHTML = `<form><legend></legend></form>`;

			expect(document.querySelector('legend')?.form).toBe(null);

			document.body.innerHTML = `<fieldset><legend></legend></fieldset>`;

			expect(document.querySelector('legend')?.form).toBe(null);
		});

		it('Returns form of the parent fieldset.', () => {
			document.body.innerHTML = `<form>
                <fieldset>
                    <legend>Choose your favorite monster</legend>

                    <input type="radio" id="kraken" name="monster" value="K" />
                    <label for="kraken">Kraken</label><br />

                    <input type="radio" id="sasquatch" name="monster" value="S" />
                    <label for="sasquatch">Sasquatch</label><br />

                    <input type="radio" id="mothman" name="monster" value="M" />
                    <label for="mothman">Mothman</label>
                </fieldset>
            </form>`;

			const form = document.querySelector('form');
			const legend = document.querySelector('legend');

			expect(legend?.form).toBe(form);
		});
	});
});
