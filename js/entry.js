// Package runtime entry (T22 gate, extended by T23/T24/T25/T38).
//
// Single source of the public runtime surface: the root index.js re-exports
// everything from here, so the package entry, the facade wiring and the type
// declaration can never drift apart. `Window` and `Document` come from the
// js/facade layer (T22B); since T48E the package entry follows the happy-dom
// surface shape and no longer exports the `createWindow` convenience — the
// public construction path is `new Window()` / `new Window(options)` (the
// facade module keeps `createWindow` only as an internal compat alias). The
// node creation and navigation
// surface (T23B), the tree mutation surface (T24C) and the T25 attribute /
// textContent / live childNodes surface are installed onto the facade classes
// by the registry, so no new export is needed there — the shared entry keeps
// exactly one set of exports. The T37 base `Event` value was reached through
// `window.Event` only; T38 adds the full `Event` / concrete event classes and
// the `EventPhaseEnum` module export (the events.js facade owns their
// implementations, and the registry installs their window accessors). The
// low-level native bindings (T19) stay behind the shared lazy native loader
// (js/native-loader.js, wired by T49 per ADR-0005 §6/§8/§9); `project` is the
// frozen package metadata. The happy-dom surface additions keep the entry in
// lockstep with the baseline: `GlobalWindow` (the host-global-context window
// flavor), `CookieSameSiteEnum` (the browser context cookie store surface)
// and `VirtualConsole` / `VirtualConsoleLogTypeEnum` (the virtual console
// surface shared with the window side).
// index.d.ts is the single source for the type surface and must be kept in
// lockstep with the exports below.

import { isNativeAvailable, loadNative, nativeAbiVersion } from "./native-loader.js";

import { Window } from "./facade/window.js";
import { Document } from "./facade/document.js";
import {
  CustomEvent,
  Event,
  EventPhaseEnum,
  FocusEvent,
  InputEvent,
  KeyboardEvent,
  MouseEvent,
  UIEvent,
  WheelEvent,
} from "./facade/extensions/events.js";
import {
  CSSConditionRule,
  CSSContainerRule,
  CSSFontFaceRule,
  CSSGroupingRule,
  CSSKeyframeRule,
  CSSKeyframesRule,
  CSSKeywordValue,
  CSSMediaRule,
  CSSRule,
  CSSScopeRule,
  CSSStyleDeclaration,
  CSSStyleRule,
  CSSStyleSheet,
  CSSStyleValue,
  CSSSupportsRule,
  MediaList,
  MediaQueryListEvent,
} from "./facade/extensions/cssom.js";
import {
  Browser,
  BrowserContext,
  BrowserErrorCaptureEnum,
  BrowserFrame,
  BrowserPage,
  VirtualConsoleLogLevelEnum,
  VirtualConsolePrinter,
} from "./facade/extensions/browser.js";
import { CookieSameSiteEnum } from "./facade/extensions/cookie.js";
import { GlobalWindow } from "./facade/extensions/global-window.js";
import { VirtualConsole, VirtualConsoleLogTypeEnum } from "./facade/extensions/virtual-console.js";

export const project = Object.freeze({
  name: "mad-dom",
  version: "0.0.1-alpha.0",
  status: "pre-alpha",
  runtime: "bun",
  architecture: "native-memory-arena"
});

// Native binding access (T19 / T49, ADR-0005 §6). The resolution order and
// the load-time ABI probe live in js/native-loader.js and are shared by the
// entry and every facade module: explicit `MAD_DOM_NATIVE_PATH` → npm platform
// package → repository-local dev artifact. Loading stays lazy (importing the
// module is side-effect free) but fail-fast on first use with a stable
// `MAD_DOM_UNSUPPORTED_PLATFORM` / `MAD_DOM_ABI_MISMATCH` /
// `MAD_DOM_NATIVE_NOT_FOUND` error (ADR-0005 §9).
export { isNativeAvailable, nativeAbiVersion } from "./native-loader.js";

export function createDocument() {
  return loadNative().createDocument();
}

export function liveDocumentCount() {
  return loadNative().liveDocumentCount();
}

export { Window, Document, Event, CustomEvent, UIEvent, MouseEvent, KeyboardEvent, FocusEvent, WheelEvent, InputEvent, EventPhaseEnum, CSSStyleDeclaration, CSSRule, CSSStyleSheet, CSSStyleRule, CSSMediaRule, CSSKeyframesRule, CSSKeyframeRule, CSSFontFaceRule, CSSSupportsRule, CSSGroupingRule, CSSConditionRule, CSSContainerRule, CSSScopeRule, CSSStyleValue, CSSKeywordValue, MediaList, MediaQueryListEvent, Browser, BrowserContext, BrowserErrorCaptureEnum, BrowserFrame, BrowserPage, CookieSameSiteEnum, GlobalWindow, VirtualConsole, VirtualConsoleLogLevelEnum, VirtualConsoleLogTypeEnum, VirtualConsolePrinter };
