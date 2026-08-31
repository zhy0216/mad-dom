// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN TEST — mechanical rewrite of the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/css/CSSRule.test.ts
// Source:             scripts/rewrite-happy-dom-tests.mjs (hdunit T02)
//
// This file is a generated, fidelity-preserving rewrite: only import
// statements and the vitest → bun:test / vi → adapter API surface changed;
// assertions, behavior and structure are untouched. Do not edit by hand;
// regenerate with `bun run compat:hdunit:rewrite`.
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'bun:test';
import * as PropertySymbol from '../../shim/src/PropertySymbol.js';
import type BrowserWindow from '../../shim/src/window/BrowserWindow.js';
import Window from '../../shim/src/window/Window.js';
import CSSParser from '../../src/css/utilities/CSSParser.js';
import type CSSStyleSheet from '../../shim/src/css/CSSStyleSheet.js';
import CSSRuleTypeEnum from '../../src/css/CSSRuleTypeEnum.js';
import CSSStyleRule from '../../shim/src/css/rules/CSSStyleRule.js';
import CSSRule from '../../shim/src/css/CSSRule.js';

describe('CSSRule', () => {
	let window: BrowserWindow;
	let styleSheet: CSSStyleSheet;
	let cssParser: CSSParser;

	beforeEach(() => {
		window = new Window();
		styleSheet = new window.CSSStyleSheet();
		cssParser = new CSSParser(styleSheet);
	});

	for (const property of [
		['CONTAINER_RULE', CSSRuleTypeEnum.containerRule],
		['STYLE_RULE', CSSRuleTypeEnum.styleRule],
		['IMPORT_RULE', CSSRuleTypeEnum.importRule],
		['MEDIA_RULE', CSSRuleTypeEnum.mediaRule],
		['FONT_FACE_RULE', CSSRuleTypeEnum.fontFaceRule],
		['PAGE_RULE', CSSRuleTypeEnum.pageRule],
		['KEYFRAMES_RULE', CSSRuleTypeEnum.keyframesRule],
		['KEYFRAME_RULE', CSSRuleTypeEnum.keyframeRule],
		['NAMESPACE_RULE', CSSRuleTypeEnum.namespaceRule],
		['COUNTER_STYLE_RULE', CSSRuleTypeEnum.counterStyleRule],
		['SUPPORTS_RULE', CSSRuleTypeEnum.supportsRule],
		['DOCUMENT_RULE', CSSRuleTypeEnum.documentRule],
		['FONT_FEATURE_VALUES_RULE', CSSRuleTypeEnum.fontFeatureValuesRule],
		['REGION_STYLE_RULE', CSSRuleTypeEnum.regionStyleRule]
	]) {
		describe(`static get ${property}()`, () => {
			it(`Should have property ${property}`, () => {
				expect(CSSRule[property[0]]).toBe(property[1]);
			});
		});
	}

	describe('get parentRule()', () => {
		it('Returns parent rule', () => {
			const cssRule = new CSSStyleRule(PropertySymbol.illegalConstructor, window, cssParser);
			expect(cssRule.parentRule).toBe(null);
			const parentRule = <CSSRule>{};
			cssRule[PropertySymbol.parentRule] = parentRule;
			expect(cssRule.parentRule).toBe(parentRule);
		});
	});

	describe('get parentStyleSheet()', () => {
		it('Returns parent style sheet', () => {
			const cssRule = new CSSStyleRule(PropertySymbol.illegalConstructor, window, cssParser);
			expect(cssRule.parentStyleSheet).toBe(null);
			cssRule[PropertySymbol.parentStyleSheet] = styleSheet;
			expect(cssRule.parentStyleSheet).toBe(styleSheet);
		});
	});
});
