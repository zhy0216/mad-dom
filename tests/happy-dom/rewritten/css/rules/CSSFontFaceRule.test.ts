// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSFontFaceRule.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'bun:test';
import * as PropertySymbol from '../../../shim/src/PropertySymbol.js';
import type BrowserWindow from '../../../shim/src/window/BrowserWindow.js';
import Window from '../../../shim/src/window/Window.js';
import CSSParser from '../../../src/css/utilities/CSSParser.js';
import type CSSStyleSheet from '../../../shim/src/css/CSSStyleSheet.js';
import CSSFontFaceRule from '../../../shim/src/css/rules/CSSFontFaceRule.js';
import CSSRuleTypeEnum from '../../../src/css/CSSRuleTypeEnum.js';

describe('CSSFontFaceRule', () => {
	let window: BrowserWindow;
	let styleSheet: CSSStyleSheet;
	let cssParser: CSSParser;

	beforeEach(() => {
		window = new Window();
		styleSheet = new window.CSSStyleSheet();
		cssParser = new CSSParser(styleSheet);
	});

	describe('get type()', () => {
		it('Returns container rule type', () => {
			const cssRule = new CSSFontFaceRule(PropertySymbol.illegalConstructor, window, cssParser);
			expect(cssRule.type).toBe(5);
			expect(cssRule.type).toBe(CSSRuleTypeEnum.fontFaceRule);
		});
	});

	describe('get style()', () => {
		it('Returns style declaration', () => {
			const cssRule = new CSSFontFaceRule(PropertySymbol.illegalConstructor, window, cssParser);
			cssRule[PropertySymbol.cssText] = 'font-family: "Trickster";';
			expect(cssRule.style).toBe(cssRule.style);
			expect(cssRule.style.cssText).toBe('font-family: Trickster;');
			expect(cssRule.style.fontFamily).toBe('Trickster');
		});
	});

	describe('get cssText()', () => {
		it('Returns CSS text', () => {
			const cssRule = new CSSFontFaceRule(PropertySymbol.illegalConstructor, window, cssParser);
			cssRule[PropertySymbol.cssText] = 'font-family: "Trickster";';
			expect(cssRule.cssText).toBe('@font-face { font-family: Trickster; }');
		});
	});
});
