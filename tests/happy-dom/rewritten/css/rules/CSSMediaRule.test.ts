// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/rules/CSSMediaRule.test.ts
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
import CSSRuleTypeEnum from '../../../src/css/CSSRuleTypeEnum.js';
import CSSMediaRule from '../../../shim/src/css/rules/CSSMediaRule.js';
import MediaList from '../../../shim/src/css/MediaList.js';

describe('CSSMediaRule', () => {
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
			const cssRule = new CSSMediaRule(PropertySymbol.illegalConstructor, window, cssParser);
			expect(cssRule.type).toBe(4);
			expect(cssRule.type).toBe(CSSRuleTypeEnum.mediaRule);
		});
	});

	describe('get media()', () => {
		it('Returns media', () => {
			const cssRule = new CSSMediaRule(PropertySymbol.illegalConstructor, window, cssParser);

			expect(cssRule.media).toBe(cssRule.media);
			expect(cssRule.media).toBeInstanceOf(MediaList);

			cssRule.media.appendMedium('screen');
			cssRule.media.appendMedium('print');

			expect(cssRule.media.mediaText).toBe('screen, print');
			expect(cssRule.conditionText).toBe('screen, print');
			expect(cssRule.media.length).toBe(2);
			expect(cssRule.media[0]).toBe('screen');
			expect(cssRule.media[1]).toBe('print');

			cssRule.media.mediaText = 'test';

			expect(cssRule.media.mediaText).toBe('test');
			expect(cssRule.conditionText).toBe('test');
			expect(cssRule.media.length).toBe(1);
			expect(cssRule.media[0]).toBe('test');
		});
	});

	describe('get cssText()', () => {
		it('Returns CSS text', () => {
			const cssRule = new CSSMediaRule(PropertySymbol.illegalConstructor, window, cssParser);

			expect(cssRule.cssText).toBe('@media  {  }');

			cssRule.media.appendMedium('screen');
			cssRule.media.appendMedium('print');

			cssRule.insertRule('body { color: red; }');
			cssRule.insertRule('.test { color: blue; }');

			expect(cssRule.cssText).toBe(
				'@media screen, print {\n  .test { color: blue; }\n  body { color: red; }\n}'
			);
		});
	});

	describe('get conditionText()', () => {
		it('Returns conditional text', () => {
			const cssRule = new CSSMediaRule(PropertySymbol.illegalConstructor, window, cssParser);

			cssRule.media.appendMedium('screen');
			cssRule.media.appendMedium('print');

			expect(cssRule.conditionText).toBe('screen, print');

			cssRule.media.mediaText = 'test';

			expect(cssRule.conditionText).toBe('test');
		});
	});
});
