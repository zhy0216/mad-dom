export interface MadDomProject {
  readonly name: "mad-dom";
  readonly version: "0.0.1-alpha.0";
  readonly status: "pre-alpha";
  readonly runtime: "bun";
  readonly architecture: "native-memory-arena";
}

export declare const project: MadDomProject;

// --- Window / Document facade (T22) ----------------------------------------
//
// Public DOM facade surface. Since T48 `Window` is user-constructible like
// happy-dom: `new Window()` / `new Window(options)` mint a fresh native
// window+document pair through the constructor's mint path, and since T48E it
// is the only package-entry construction path (the `createWindow` convenience
// is retired from the entry, matching happy-dom's surface). The `Document`
// class still only constructs around a genuine native handle (throwing
// TypeError otherwise), so no user-visible path fabricates a document. Nodes
// (creation and navigation), tree mutation (append/insert/remove/replace) and
// the T25 surface — attributes, `textContent` and the live `childNodes`
// `NodeList` — are declared below by the T23, T24 and T25 gates.

/** The happy-dom-style `Window` constructor options (T48 closure): accepted and
 * loosely honored by `new Window(options)`. */
export interface IWindowOptions {
  /** Initial window URL; the T45 simulated location navigates to it. */
  url?: string;
  /** Viewport width (default 1024); accepted for happy-dom parity. */
  width?: number;
  /** Viewport height (default 768); accepted for happy-dom parity. */
  height?: number;
  /** Inner width (deprecated happy-dom alias); accepted for parity. */
  innerWidth?: number;
  /** Inner height (deprecated happy-dom alias); accepted for parity. */
  innerHeight?: number;
  /** Console (happy-dom parity): used directly as `window.console` when
   * given; otherwise the window logs into
   * `window.happyDOM.virtualConsolePrinter`. */
  console?: any;
  /** Browser-style settings (happy-dom parity): merged into the window's
   * `happyDOM.settings` (DefaultBrowserSettings shape); only
   * `enableJavaScriptEvaluation` governs `document.write` script evaluation
   * and `settings.navigator.userAgent` / `maxTouchPoints` feed
   * `window.navigator`. Unknown keys throw like happy-dom. */
  settings?: IBrowserSettings;
}

/** The `window.happyDOM` detached-window API (T48 closure): the happy-dom
 * surface for test-driving a window from the outside. */
export interface DetachedWindowAPI {
  /** The window's happy-dom browser settings (DefaultBrowserSettings merged
   * with the constructor `settings` option; writable sections like
   * `settings.navigation.userAgent` / `settings.navigator.userAgent` match
   * happy-dom's observable behavior). */
  settings: IBrowserSettings;
  /** The window's virtual console printer (the default `window.console`
   * writes into it; a browser page may repoint it at the page's printer). */
  readonly virtualConsolePrinter: VirtualConsolePrinter;
  /** Resolves once every registered pending task (window timers, external
   * script loads, navigation promises) has settled. */
  waitUntilComplete(): Promise<void>;
  /** Deprecated alias of `waitUntilComplete`. */
  whenAsyncComplete(): Promise<void>;
  /** Aborts pending async work. */
  abort(): Promise<void>;
  /** Deprecated alias of `abort`. */
  cancelAsync(): Promise<void>;
  /** Aborts async work and closes the window. */
  close(): Promise<void>;
  /** Sets the URL without navigating (simulated navigation). */
  setURL(url: string): void;
  /** Sets the viewport (`innerWidth` / `innerHeight` / `devicePixelRatio`
   * follow; a size change dispatches `resize`). */
  setViewport(viewport: { width?: number; height?: number; devicePixelRatio?: number }): void;
  /** Deprecated alias of `setViewport`. */
  setWindowSize(options?: { width?: number; height?: number }): void;
  /** Deprecated alias of `setViewport({ width })`. */
  setInnerWidth(width: number): void;
  /** Deprecated alias of `setViewport({ height })`. */
  setInnerHeight(height: number): void;
}

export declare class Window {
  constructor(options?: IWindowOptions);
  /** The live Document facade of this window (T20 wrapper identity). */
  readonly document: Document;
  /** The `window.happyDOM` detached-window API (T48): `waitUntilComplete()` etc. */
  readonly happyDOM: DetachedWindowAPI;
  /** The window console (happy-dom parity): the constructor `console` option
   * when given, otherwise a `VirtualConsole` writing into
   * `window.happyDOM.virtualConsolePrinter`. */
  readonly console: VirtualConsole;
  /** WHATWG `window.open` (happy-dom `WindowPageOpenUtility` parity): opens a
   * child page, navigates it (virtual-server-aware) and returns the child
   * window — `null` with `noopener` / `noreferrer`, a cross-origin shim for a
   * cross-origin target. The child navigation is covered by the opener's
   * `happyDOM.waitUntilComplete()`. */
  open(url?: string, target?: string, features?: string): Window | null;
  /** The WHATWG `Event` constructor (T37): `new window.Event("click", { bubbles: true })`. */
  readonly Event: typeof Event;
  /** The WHATWG `CustomEvent` constructor (T38). */
  readonly CustomEvent: typeof CustomEvent;
  /** The WHATWG `UIEvent` constructor (T38). */
  readonly UIEvent: typeof UIEvent;
  /** The WHATWG `MouseEvent` constructor (T38). */
  readonly MouseEvent: typeof MouseEvent;
  /** The WHATWG `KeyboardEvent` constructor (T38). */
  readonly KeyboardEvent: typeof KeyboardEvent;
  /** The WHATWG `FocusEvent` constructor (T38). */
  readonly FocusEvent: typeof FocusEvent;
  /** The WHATWG `WheelEvent` constructor (T38). */
  readonly WheelEvent: typeof WheelEvent;
  /** The WHATWG `InputEvent` constructor (T38). */
  readonly InputEvent: typeof InputEvent;
  /** The WHATWG `HTMLElement` constructor (T39): every `createElement` wrapper is `instanceof window.HTMLElement`. */
  readonly HTMLElement: typeof HTMLElement;
  /** The WHATWG `Node` constructor (T48A class hierarchy): Text/Comment/ProcessingInstruction wrappers are plain `Node`s. */
  readonly Node: typeof Node;
  /** The WHATWG `Element` constructor (T48A class hierarchy): the base of every element wrapper. */
  readonly Element: typeof Element;
  /** The WHATWG `DocumentFragment` constructor (T48A class hierarchy): fragments and (through the T43 re-parenting) shadow roots. */
  readonly DocumentFragment: typeof DocumentFragment;
  /** The WHATWG `HTMLUnknownElement` constructor (T48A): the direct prototype for an undefined plain tag name. */
  readonly HTMLUnknownElement: typeof HTMLUnknownElement;
  /** The WHATWG `HTMLDivElement` constructor (T48A): the direct prototype of a `div`. */
  readonly HTMLDivElement: typeof HTMLDivElement;
  /** The WHATWG `HTMLSpanElement` constructor (T48A). */
  readonly HTMLSpanElement: typeof HTMLSpanElement;
  /** The WHATWG `HTMLParagraphElement` constructor (T48A). */
  readonly HTMLParagraphElement: typeof HTMLParagraphElement;
  /** The WHATWG `HTMLAnchorElement` constructor (T48A). */
  readonly HTMLAnchorElement: typeof HTMLAnchorElement;
  /** The WHATWG `HTMLBodyElement` constructor (T48A). */
  readonly HTMLBodyElement: typeof HTMLBodyElement;
  /** The WHATWG `HTMLHeadingElement` constructor (T48A). */
  readonly HTMLHeadingElement: typeof HTMLHeadingElement;
  /** The WHATWG `HTMLUListElement` constructor (T48A). */
  readonly HTMLUListElement: typeof HTMLUListElement;
  /** The WHATWG `HTMLOListElement` constructor (T48A). */
  readonly HTMLOListElement: typeof HTMLOListElement;
  /** The WHATWG `HTMLLIElement` constructor (T48A). */
  readonly HTMLLIElement: typeof HTMLLIElement;
  /** The WHATWG `HTMLTableElement` constructor (T48A). */
  readonly HTMLTableElement: typeof HTMLTableElement;
  /** The WHATWG `HTMLTableCaptionElement` constructor (T48A). */
  readonly HTMLTableCaptionElement: typeof HTMLTableCaptionElement;
  /** The WHATWG `HTMLTableRowElement` constructor (T48A). */
  readonly HTMLTableRowElement: typeof HTMLTableRowElement;
  /** The WHATWG `HTMLTableCellElement` constructor (T48A). */
  readonly HTMLTableCellElement: typeof HTMLTableCellElement;
  /** The WHATWG `HTMLTableSectionElement` constructor (T48A). */
  readonly HTMLTableSectionElement: typeof HTMLTableSectionElement;
  /** The WHATWG `HTMLBRElement` constructor (T48A). */
  readonly HTMLBRElement: typeof HTMLBRElement;
  /** The WHATWG `HTMLHRElement` constructor (T48A). */
  readonly HTMLHRElement: typeof HTMLHRElement;
  /** The WHATWG `HTMLLabelElement` constructor (T48A). */
  readonly HTMLLabelElement: typeof HTMLLabelElement;
  /** The WHATWG `HTMLImageElement` constructor (T48A). */
  readonly HTMLImageElement: typeof HTMLImageElement;
  /** The WHATWG `HTMLScriptElement` constructor (T48A). */
  readonly HTMLScriptElement: typeof HTMLScriptElement;
  /** The WHATWG `HTMLStyleElement` constructor (T48A). */
  readonly HTMLStyleElement: typeof HTMLStyleElement;
  /** The WHATWG `HTMLLinkElement` constructor (T48A). */
  readonly HTMLLinkElement: typeof HTMLLinkElement;
  /** The WHATWG `HTMLMetaElement` constructor (T48A). */
  readonly HTMLMetaElement: typeof HTMLMetaElement;
  /** The WHATWG `HTMLTitleElement` constructor (T48A). */
  readonly HTMLTitleElement: typeof HTMLTitleElement;
  /** The WHATWG `HTMLHeadElement` constructor (T48A). */
  readonly HTMLHeadElement: typeof HTMLHeadElement;
  /** The WHATWG `HTMLHtmlElement` constructor (T48A). */
  readonly HTMLHtmlElement: typeof HTMLHtmlElement;
  /** The WHATWG `HTMLQuoteElement` constructor (T48A). */
  readonly HTMLQuoteElement: typeof HTMLQuoteElement;
  /** The WHATWG `HTMLSlotElement` constructor (T48A). */
  readonly HTMLSlotElement: typeof HTMLSlotElement;
  /** WHATWG `window.location` (T45): the live per-window Location (URL state linked to the document). */
  readonly location: Location;
  /** WHATWG `window.history` (T45): the per-window session History stack. */
  readonly history: History;
  /** WHATWG `window.navigator` (T45): the fixed mock Navigator surface (calibrated to the happy-dom baseline). */
  readonly navigator: Navigator;
  /** WHATWG `window.localStorage` (T45): the per-window local storage area. */
  readonly localStorage: Storage;
  /** WHATWG `window.sessionStorage` (T45): the per-window session storage area. */
  readonly sessionStorage: Storage;
  /** WHATWG `URL` constructor (T45): the standard URL, reused from the Bun/Web host. */
  readonly URL: typeof URL;
  /** WHATWG `DOMException` constructor (T45): reused from the Bun/Web host. */
  readonly DOMException: typeof DOMException;
  /** The WHATWG `NodeFilter` constant object (T35): `SHOW_ELEMENT`, `FILTER_ACCEPT`, ... */
  readonly NodeFilter: typeof NodeFilter;
  /** The `TreeWalker` class (T35); instances are minted by `document.createTreeWalker`. */
  readonly TreeWalker: typeof TreeWalker;
  /** The `NodeIterator` class (T35); instances are minted by `document.createNodeIterator`. */
  readonly NodeIterator: typeof NodeIterator;
  /** The WHATWG `MutationObserver` constructor (T41): `new window.MutationObserver(callback)`. */
  readonly MutationObserver: typeof MutationObserver;
  /** The WHATWG `window.customElements` registry (T42): define / get / getName / whenDefined / upgrade. */
  readonly customElements: CustomElementRegistry;
  /** The WHATWG `HTMLTemplateElement` constructor (T40): the template surface base class. */
  readonly HTMLTemplateElement: typeof HTMLTemplateElement;
  /** The WHATWG `ShadowRoot` constructor (T43): every `attachShadow` root is `instanceof window.ShadowRoot`. */
  readonly ShadowRoot: typeof ShadowRoot;
  /** The WHATWG `HTMLFormElement` constructor (T40). */
  readonly HTMLFormElement: typeof HTMLFormElement;
  /** The WHATWG `HTMLInputElement` constructor (T40). */
  readonly HTMLInputElement: typeof HTMLInputElement;
  /** The WHATWG `HTMLButtonElement` constructor (T40). */
  readonly HTMLButtonElement: typeof HTMLButtonElement;
  /** The WHATWG `HTMLSelectElement` constructor (T40). */
  readonly HTMLSelectElement: typeof HTMLSelectElement;
  /** The WHATWG `HTMLOptionElement` constructor (T40). */
  readonly HTMLOptionElement: typeof HTMLOptionElement;
  /** The WHATWG `HTMLTextAreaElement` constructor (T40). */
  readonly HTMLTextAreaElement: typeof HTMLTextAreaElement;
  /** The WHATWG `HTMLFormControlsCollection` constructor (T40). */
  readonly HTMLFormControlsCollection: typeof HTMLFormControlsCollection;
  /** The WHATWG `HTMLOptionsCollection` constructor (T40). */
  readonly HTMLOptionsCollection: typeof HTMLOptionsCollection;
  /** The WHATWG `SubmitEvent` constructor (T40). */
  readonly SubmitEvent: typeof SubmitEvent;
  /** The WHATWG `ValidityState` constructor (T48C). */
  readonly ValidityState: typeof ValidityState;
  /** The WHATWG `Headers` constructor (T46): the happy-dom-calibrated compat surface (per-window). */
  readonly Headers: typeof Headers;
  /** The WHATWG `Request` constructor (T46): the happy-dom-calibrated compat surface (per-window). */
  readonly Request: typeof Request;
  /** The WHATWG `Response` constructor (T46): the happy-dom-calibrated compat surface (per-window). */
  readonly Response: typeof Response;
  /** The WHATWG `AbortController` constructor (T46): per-window. */
  readonly AbortController: typeof AbortController;
  /** The WHATWG `AbortSignal` constructor (T46): per-window. */
  readonly AbortSignal: typeof AbortSignal;
  /** WHATWG `window.fetch` (T46): offline `data:` support plus Bun-adapted `http(s)` I/O. */
  fetch(url: TRequestInfo, init?: IRequestInit | null): Promise<Response>;
  /** The `Range` class (T36); instances are minted by `document.createRange` / `range.cloneRange` / the selection mutators. */
  readonly Range: typeof Range;
  /** The `Selection` class (T36); instances are minted by `document.getSelection` / `window.getSelection`. */
  readonly Selection: typeof Selection;
  /** WHATWG `window.getSelection` (T36): the per-document `Selection` singleton. */
  getSelection(): Selection;
  /** The window timer surface (T47): every timer is scheduled by Bun, and the returned host timer id is what the matching clear call accepts. */
  setTimeout(callback: Function, delay?: number, ...args: unknown[]): object;
  clearTimeout(id: object): void;
  setInterval(callback: Function, delay?: number, ...args: unknown[]): object;
  clearInterval(id: object): void;
  /** WHATWG `requestAnimationFrame` (T47): the callback receives a finite numeric timestamp; `cancelAnimationFrame` cancels it. */
  requestAnimationFrame(callback: (timestamp: number) => void): object;
  cancelAnimationFrame(id: object): void;
  /** WHATWG `queueMicrotask` (T47): schedules `callback` on the microtask queue. */
  queueMicrotask(callback: Function): void;
  /** The window `eval` (T47): evaluates `code` with the owning window's surface bound as its globals (`document`, `window`, `HTMLElement`, ...). */
  eval(code: string): any;
  /** Window self-references (T47, happy-dom parity): `window.window === window` and `window.globalThis === window`. */
  readonly window: Window;
  readonly globalThis: Window;
  /** The window-level EventTarget (T47): `addEventListener("error", ...)` receives the async-callback `error` events the timers dispatch. */
  addEventListener(type: string, listener: (event: ErrorEvent) => void, options?: { once?: boolean } | null): void;
  removeEventListener(type: string, listener: (event: ErrorEvent) => void): void;
  dispatchEvent(event: ErrorEvent): boolean;
  /** The WHATWG `ErrorEvent` constructor (T47): the `error` event dispatched on the window for async callback failures. */
  readonly ErrorEvent: typeof ErrorEvent;
  /** WHATWG `window.CSSStyleDeclaration` constructor (T44). */
  readonly CSSStyleDeclaration: typeof CSSStyleDeclaration;
  /** WHATWG `window.CSSRule` constructor (T44). */
  readonly CSSRule: typeof CSSRule;
  /** WHATWG `window.CSSStyleSheet` constructor (T44). */
  readonly CSSStyleSheet: typeof CSSStyleSheet;
  /** WHATWG `window.CSSStyleRule` constructor (T44). */
  readonly CSSStyleRule: typeof CSSStyleRule;
  /** WHATWG `window.CSSMediaRule` constructor (T44). */
  readonly CSSMediaRule: typeof CSSMediaRule;
  /** WHATWG `window.CSSKeyframesRule` constructor (T44). */
  readonly CSSKeyframesRule: typeof CSSKeyframesRule;
  /** WHATWG `window.CSSKeyframeRule` constructor (T44). */
  readonly CSSKeyframeRule: typeof CSSKeyframeRule;
  /** WHATWG `window.CSSFontFaceRule` constructor (T44). */
  readonly CSSFontFaceRule: typeof CSSFontFaceRule;
  /** WHATWG `window.CSSSupportsRule` constructor (T44). */
  readonly CSSSupportsRule: typeof CSSSupportsRule;
  /** WHATWG `window.CSSGroupingRule` constructor (T44). */
  readonly CSSGroupingRule: typeof CSSGroupingRule;
  /** WHATWG `window.CSSConditionRule` constructor (T44). */
  readonly CSSConditionRule: typeof CSSConditionRule;
  /** WHATWG `window.MediaList` constructor (T44). */
  readonly MediaList: typeof MediaList;
  /** WHATWG `window.MediaQueryListEvent` constructor (T44). */
  readonly MediaQueryListEvent: typeof MediaQueryListEvent;
  /** WHATWG `window.CSSStyleValue` constructor (T44). */
  readonly CSSStyleValue: typeof CSSStyleValue;
  /** WHATWG `window.CSSKeywordValue` constructor (T44). */
  readonly CSSKeywordValue: typeof CSSKeywordValue;
  /** WHATWG `window.CSS` namespace (T44): the CSS unit-value factories and `supports`. */
  readonly CSS: CSS;
  /** WHATWG `window.matchMedia` (T44): a `MediaQueryList` for the given media query, evaluated against the default viewport (1024×768). */
  matchMedia(mediaQuery: string): MediaQueryList;
  /** WHATWG `window.getComputedStyle` (T44): a layout-free computed `CSSStyleDeclaration` for the element (default tag CSS + inline style + inherited properties; empty for detached elements). */
  getComputedStyle(element: Element, pseudoElt?: string | null): CSSStyleDeclaration;
  /** WHATWG `window.innerWidth` (T44): the default viewport width (1024; no layout engine). */
  readonly innerWidth: number;
  /** WHATWG `window.innerHeight` (T44): the default viewport height (768; no layout engine). */
  readonly innerHeight: number;
  /** WHATWG `window.close` (happy-dom parity): a no-op — happy-dom only closes
   * script-opened windows (`window.open`), and every mad-dom window is detached. */
  close(): void;
  /** Eagerly destroys the window's document; idempotent. */
  destroy(): void;
}

/**
 * Browser window that runs scripts in the host global context (happy-dom
 * `GlobalWindow` parity).
 *
 * Where the sandboxed `Window` evaluates scripts in a per-window `node:vm`
 * context with its own intrinsics, `GlobalWindow` shadows `eval` with the host
 * `eval` (script writes to `globalThis` land at process level) and mirrors the
 * host intrinsics as instance members (`globalWindow.Array === global.Array`).
 */
export declare class GlobalWindow extends Window {
  constructor(options?: IWindowOptions);
  Array: typeof Array;
  ArrayBuffer: typeof ArrayBuffer;
  Boolean: typeof Boolean;
  Buffer: typeof Buffer;
  DataView: typeof DataView;
  Date: typeof Date;
  Error: typeof Error;
  EvalError: typeof EvalError;
  Float32Array: typeof Float32Array;
  Float64Array: typeof Float64Array;
  Function: typeof Function;
  Infinity: typeof Infinity;
  Int16Array: typeof Int16Array;
  Int32Array: typeof Int32Array;
  Int8Array: typeof Int8Array;
  Intl: typeof Intl;
  JSON: typeof JSON;
  Map: MapConstructor;
  Math: typeof Math;
  NaN: typeof NaN;
  Number: typeof Number;
  Object: typeof Object;
  Promise: typeof Promise;
  RangeError: typeof RangeError;
  ReferenceError: typeof ReferenceError;
  RegExp: typeof RegExp;
  Set: SetConstructor;
  String: typeof String;
  Symbol: Function;
  SyntaxError: typeof SyntaxError;
  TypeError: typeof TypeError;
  URIError: typeof URIError;
  Uint16Array: typeof Uint16Array;
  Uint32Array: typeof Uint32Array;
  Uint8Array: typeof Uint8Array;
  Uint8ClampedArray: typeof Uint8ClampedArray;
  WeakMap: WeakMapConstructor;
  WeakSet: WeakSetConstructor;
  decodeURI: typeof decodeURI;
  decodeURIComponent: typeof decodeURIComponent;
  encodeURI: typeof encodeURI;
  encodeURIComponent: typeof encodeURIComponent;
  eval: typeof eval;
  /** @deprecated */
  escape: (str: string) => string;
  global: typeof globalThis;
  isFinite: typeof isFinite;
  isNaN: typeof isNaN;
  parseFloat: typeof parseFloat;
  parseInt: typeof parseInt;
  undefined: typeof undefined;
  /** @deprecated */
  unescape: (str: string) => string;
}

// --- Event / EventTarget (T37, completed by T38) ------------------------------
//
// T37 wired the EventTarget methods onto `Node` / `Document` and the minimal
// `Event` value (reached through `window.Event`). T38 completes the base
// `Event` surface (phase constants, `timeStamp`, `cancelBubble`, `composedPath`,
// `initEvent`), exports the full `Event` value and the first batch of concrete
// event classes (`CustomEvent`, `UIEvent`, `MouseEvent`, `KeyboardEvent`,
// `FocusEvent`, `WheelEvent`, `InputEvent`), and exports the `EventPhaseEnum`
// plus the `I*Init` / `TEventListener*` types. The native handle surface and
// the package entry exports must stay in lockstep with these declarations.

export declare enum EventPhaseEnum {
  none = 0,
  capturing = 1,
  atTarget = 2,
  bubbling = 3,
}

/** The WHATWG `EventInit` dictionary (module type export, T38). */
export interface IEventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

/** A function event listener (WHATWG `EventListener` function form). */
export type TEventListenerFunction = (event: Event) => void;
/** An object event listener exposing `handleEvent` (WHATWG `EventListener` object form). */
export interface TEventListenerObject {
  handleEvent(event: Event): void;
}
/** The WHATWG `EventListener` union accepted by `addEventListener`. */
export type TEventListener = TEventListenerFunction | TEventListenerObject;

/** The WHATWG `EventListenerOptions` dictionary. */
export interface IEventListenerOptions {
  once?: boolean;
  capture?: boolean;
  passive?: boolean;
  signal?: unknown;
}

export declare class Event {
  static readonly NONE: EventPhaseEnum;
  static readonly CAPTURING_PHASE: EventPhaseEnum;
  static readonly AT_TARGET: EventPhaseEnum;
  static readonly BUBBLING_PHASE: EventPhaseEnum;
  /** The phase constants are also own instance fields (baseline shape). */
  readonly NONE: EventPhaseEnum;
  readonly CAPTURING_PHASE: EventPhaseEnum;
  readonly AT_TARGET: EventPhaseEnum;
  readonly BUBBLING_PHASE: EventPhaseEnum;
  constructor(type: string, eventInit?: IEventInit | null);
  /** The event's type string. */
  readonly type: string;
  /** Whether the event bubbles past its target. */
  readonly bubbles: boolean;
  /** Whether `preventDefault` may set `defaultPrevented`. */
  readonly cancelable: boolean;
  /** Whether the event is composed across shadow boundaries. */
  readonly composed: boolean;
  /** Whether `preventDefault` was called by a non-passive cancelable listener. */
  readonly defaultPrevented: boolean;
  /** The current phase: `EventPhaseEnum.none` outside a dispatch. */
  readonly eventPhase: EventPhaseEnum;
  /** The construction-time timestamp (a positive number). */
  readonly timeStamp: number;
  /** The node `dispatchEvent` was called on, or `null` before the first dispatch. */
  readonly target: Node | null;
  /** The node whose listeners are running, or `null` outside a dispatch. */
  readonly currentTarget: Node | null;
  /** Whether `stopPropagation` was called (baseline: read-only). */
  readonly cancelBubble: boolean;
  /** The propagation path of the event's target (target first), or `[]` before the first dispatch. */
  composedPath(): (Node | Window)[];
  /** Sets `defaultPrevented` when the event is cancelable and not passive. */
  preventDefault(): void;
  /** Ends the dispatch after the current target's listeners finish. */
  stopPropagation(): void;
  /** Ends the dispatch immediately. */
  stopImmediatePropagation(): void;
  /** Re-initializes `type` / `bubbles` / `cancelable` and resets the cancellation flags (deprecated WHATWG). */
  initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
}

/** The WHATWG `CustomEventInit` dictionary. */
export interface ICustomEventInit extends IEventInit {
  detail?: any;
}

export declare class CustomEvent<T = any> extends Event {
  readonly detail: T;
  constructor(type: string, eventInit?: ICustomEventInit | null);
  /** Re-initializes the event (deprecated WHATWG). */
  initCustomEvent(type: string, bubbles?: boolean, cancelable?: boolean, detail?: T): void;
}

/** The WHATWG `UIEventInit` dictionary. */
export interface IUIEventInit extends IEventInit {
  detail?: number;
  view?: Window | null;
}

export declare class UIEvent extends Event {
  static readonly NONE: EventPhaseEnum;
  static readonly CAPTURING_PHASE: EventPhaseEnum;
  static readonly AT_TARGET: EventPhaseEnum;
  static readonly BUBBLING_PHASE: EventPhaseEnum;
  readonly detail: number;
  readonly layerX: number;
  readonly layerY: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly view: Window | null;
  constructor(type: string, eventInit?: IUIEventInit | null);
}

/** The WHATWG `MouseEventInit` dictionary. */
export interface IMouseEventInit extends IUIEventInit {
  screenX?: number;
  screenY?: number;
  clientX?: number;
  clientY?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  movementX?: number;
  movementY?: number;
  offsetX?: number;
  offsetY?: number;
  button?: number;
  buttons?: number;
  relatedTarget?: Node | null;
  region?: string;
}

export declare class MouseEvent extends UIEvent {
  readonly altKey: boolean;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly movementX: number;
  readonly movementY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly region: string;
  readonly relatedTarget: Node | null;
  readonly screenX: number;
  readonly screenY: number;
  readonly shiftKey: boolean;
  constructor(type: string, eventInit?: IMouseEventInit | null);
}

/** The WHATWG `KeyboardEventInit` dictionary. */
export interface IKeyboardEventInit extends IUIEventInit {
  key?: string;
  code?: string;
  location?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  /** @deprecated */
  keyCode?: number;
  /** @deprecated */
  which?: number;
}

export declare class KeyboardEvent extends UIEvent {
  static readonly DOM_KEY_LOCATION_STANDARD: number;
  static readonly DOM_KEY_LOCATION_LEFT: number;
  static readonly DOM_KEY_LOCATION_RIGHT: number;
  static readonly DOM_KEY_LOCATION_NUMPAD: number;
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly location: number;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  /** @deprecated */
  readonly keyCode: number;
  /** @deprecated */
  readonly which: number;
  constructor(type: string, eventInit?: IKeyboardEventInit | null);
  /** Whether the named modifier is pressed. */
  getModifierState(key: string): boolean;
}

/** The WHATWG `FocusEventInit` dictionary. */
export interface IFocusEventInit extends IUIEventInit {
  relatedTarget?: Node | null;
}

export declare class FocusEvent extends UIEvent {
  readonly relatedTarget: Node | null;
  constructor(type: string, eventInit?: IFocusEventInit | null);
}

/** The WHATWG `WheelEventInit` dictionary. */
export interface IWheelEventInit extends IUIEventInit {
  deltaX?: number;
  deltaY?: number;
  deltaZ?: number;
  deltaMode?: number;
}

export declare class WheelEvent extends UIEvent {
  static readonly DOM_DELTA_PIXEL: number;
  static readonly DOM_DELTA_LINE: number;
  static readonly DOM_DELTA_PAGE: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly deltaMode: number;
  constructor(type: string, eventInit?: IWheelEventInit | null);
}

/** The WHATWG `InputEventInit` dictionary. */
export interface IInputEventInit extends IUIEventInit {
  inputType?: string;
  data?: string;
  dataTransfer?: unknown;
  isComposing?: boolean;
}

export declare class InputEvent extends UIEvent {
  readonly data: string;
  readonly dataTransfer: unknown;
  readonly inputType: string;
  readonly isComposing: boolean;
  constructor(type: string, eventInit?: IInputEventInit | null);
}

/** The WHATWG `ErrorEventInit` dictionary (T47): the `error` event payload happy-dom dispatches on the window for async callback failures. */
export interface IErrorEventInit {
  message?: string;
  error?: unknown;
  filename?: string;
  lineno?: number;
}

/** The WHATWG `ErrorEvent` (T47): dispatched on the window when an async callback (timer / rAF / queueMicrotask) throws or rejects. */
export declare class ErrorEvent {
  readonly type: string;
  readonly message: string;
  readonly error: unknown;
  readonly filename: string;
  readonly lineno: number;
  readonly target: Window | null;
  readonly currentTarget: Window | null;
  constructor(type: string, eventInit?: IErrorEventInit | null);
}

export declare class Document {
  constructor(nativeHandle: DocumentHandle);
  /** Eagerly destroys the document; idempotent. */
  destroy(): void;
  /** Creates a new detached Element (WHATWG `createElement`). */
  createElement(name: string): HTMLElement;
  /** Creates a new detached Text node (WHATWG `createTextNode`). */
  createTextNode(data: string): Text;
  /** Creates a new empty DocumentFragment (WHATWG `createDocumentFragment`). */
  createDocumentFragment(): DocumentFragment;
  /** Creates a new detached Comment node (WHATWG `createComment`, T33). */
  createComment(data: string): Comment;
  /** The document element (`<html>`); `null` when the document has no root element (T29, implied skeleton on first read). */
  readonly documentElement: Element | null;
  /** The `<head>` element, or `null` (T29, implied skeleton on first read). */
  readonly head: Element | null;
  /** The `<body>` element, or `null` (T29, implied skeleton on first read). */
  readonly body: Element | null;
  /** WHATWG `Document.readyState` (T48): `"interactive"` for a detached window (happy-dom parity). */
  readonly readyState: string;
  /** WHATWG `Document.title` (T48): the first `<title>` element's tree-order text under head, `""` when absent; setting creates or updates that `<title>` element. */
  title: string;
  /** The currently focused element (T39): the stored `focus()` target, or `body` / `documentElement` / `null` when nothing is focused. */
  readonly activeElement: Element | null;
  /** Replaces the whole document content with a freshly parsed full HTML document (T29). */
  parseHtml(html: string): void;

  /** WHATWG `Document.querySelector` (T31): the first descendant element of the document matching `selectors`, or `null`. */
  querySelector<E extends Element = Element>(selectors: string): E | null;
  /** WHATWG `Document.querySelectorAll` (T31): every descendant element matching `selectors`, in document order, as a static `NodeList` snapshot (later mutations do not change it). */
  querySelectorAll<E extends Element = Element>(selectors: string): NodeList<E>;
  /** WHATWG `Document.getElementById` (T31): the first element in the document whose `id` attribute equals `elementId`, or `null`. */
  getElementById(elementId: string): Element | null;
  /** WHATWG `Document.getElementsByTagName` (T32): every descendant element whose tag matches `tagName` (ASCII case-insensitive, `"*"` matches all), in document order, as a live `HTMLCollection` (later tree/attribute changes are reflected on every access). */
  getElementsByTagName(tagName: string): HTMLCollection<Element>;
  /** WHATWG `Document.getElementsByClassName` (T32): every descendant element whose `class` attribute contains every whitespace token of `classNames`, in document order, as a live `HTMLCollection`. */
  getElementsByClassName(classNames: string): HTMLCollection<Element>;
  /** WHATWG `Document.createProcessingInstruction` (T33): a detached `ProcessingInstruction`; an invalid "Name" target or a `?>` in `data` throws `ERR_MAD_DOM_INVALID_CHARACTER`. */
  createProcessingInstruction(target: string, data: string): ProcessingInstruction;
  /** WHATWG `Document.importNode` (T33): a copy of `node` (and its whole subtree when `deep`) in this document, leaving the source untouched. */
  importNode<T extends Node>(node: T, deep?: boolean): T;
  /** WHATWG `Document.adoptNode` (T33): `node` moved (with its subtree) into this document; a same-document node is detached from its parent and returned. */
  adoptNode<T extends Node>(node: T): T;
  /** WHATWG `Document.doctype` (T33): the document's parsed `DocumentType`, or `null` on a fresh/empty document. */
  readonly doctype: DocumentType | null;
  /** WHATWG `Document.createAttribute` (T34): a detached `Attr` with the given qualified name; an invalid WHATWG "Name" throws `ERR_MAD_DOM_INVALID_CHARACTER`. */
  createAttribute(name: string): Attr;
  /** WHATWG `Document.URL` (T45): the owning window's current location href (`"about:blank"` for a window-less document). */
  readonly URL: string;
  /** WHATWG `Document.documentURI` (T45): an alias of `URL`. */
  readonly documentURI: string;
  /** WHATWG `Document.cookie` (T45): the per-window cookie jar read as a `key=value; ...` string, written as a `Set-Cookie`-style string. */
  cookie: string;
  /** WHATWG `Document.createTreeWalker` (T35): a `TreeWalker` over the subtree rooted at `root`. */
  createTreeWalker(root: Node, whatToShow?: number, filter?: TNodeFilter | null): TreeWalker;
  /** WHATWG `Document.createNodeIterator` (T35): a `NodeIterator` over the subtree rooted at `root`. */
  createNodeIterator(root: Node, whatToShow?: number, filter?: TNodeFilter | null): NodeIterator;
  /** WHATWG `Document.createRange` (T36): a `Range` collapsed at the document root. */
  createRange(): Range;
  /** WHATWG `Document.getSelection` (T36): the per-document `Selection` singleton. */
  getSelection(): Selection;

  /** WHATWG `EventTarget.addEventListener` (T37), registered on the document-root node. */
  addEventListener(type: string, listener: TEventListener | null, options?: boolean | IEventListenerOptions | null): void;
  /** WHATWG `EventTarget.removeEventListener` (T37), matching the registered callback. */
  removeEventListener(type: string, listener: TEventListener | null, options?: boolean | { capture?: boolean } | null): void;
  /** WHATWG `EventTarget.dispatchEvent` (T37): returns `false` when a cancelable event was default-prevented. */
  dispatchEvent(event: Event): boolean;
}

// --- Window platform objects (T45) -------------------------------------------
//
// The platform objects live on `window` (reached through the `Window` facade,
// never exported from the package entry): `location`, `history`, `navigator`,
// `localStorage`, `sessionStorage` and the `URL` / `DOMException` constructors
// reused from the Bun/Web host. `Location` and `History` share one per-window
// URL / session-history state; `document.URL` / `documentURI` read the same
// state. Navigation is simulated (T45 boundary): `href` assignment and the
// property setters update the URL and history state synchronously without any
// real page load, and `reload()` / `history.back/forward/go` are no-ops.

declare class Location {
  hash: string;
  readonly host: string;
  readonly hostname: string;
  readonly href: string;
  readonly origin: string;
  readonly pathname: string;
  readonly port: string;
  readonly protocol: string;
  readonly search: string;
  assign(url: string | URL): void;
  replace(url: string | URL): void;
  reload(): void;
  toString(): string;
}

declare class History {
  readonly length: number;
  readonly state: object | null;
  scrollRestoration: string;
  back(): void;
  forward(): void;
  go(delta?: number): void;
  pushState(state: unknown, unused: unknown, url?: string | URL | null): void;
  replaceState(state: unknown, unused: unknown, url?: string | URL | null): void;
}

declare class Navigator {
  readonly cookieEnabled: boolean;
  readonly credentials: null;
  readonly geolocation: null;
  readonly language: string;
  readonly languages: string[];
  readonly locks: null;
  readonly maxTouchPoints: number;
  readonly hardwareConcurrency: number;
  readonly appCodeName: string;
  readonly appName: string;
  readonly appVersion: string;
  readonly platform: string;
  readonly product: string;
  readonly productSub: string;
  readonly vendor: string;
  readonly vendorSub: string;
  readonly userAgent: string;
  readonly onLine: boolean;
  readonly permissions: null;
  readonly clipboard: null;
  readonly webdriver: boolean;
  readonly doNotTrack: string;
  readonly mimeTypes: object;
  readonly plugins: object;
  sendBeacon(url: string, data?: unknown): boolean;
  toString(): string;
}

declare class Storage {
  readonly length: number;
  key(index: number): string | null;
  setItem(name: string, item: string): void;
  getItem(name: string): string | null;
  removeItem(name: string): void;
  clear(): void;
}

// --- TreeWalker / NodeIterator / NodeFilter (T35) ----------------------------
//
// The traversal classes are not exported from the package entry in T35 — they
// are reached through `document.createTreeWalker` / `document.createNodeIterator`
// and `window.TreeWalker` / `window.NodeIterator` — and `NodeFilter` is the
// frozen constant object exposed as `window.NodeFilter`. The user filter is a
// function `(node) => FILTER_*` or an object with `acceptNode`; see the WHATWG
// `NodeFilter` interface.

declare const NodeFilter: {
  readonly FILTER_ACCEPT: 1;
  readonly FILTER_REJECT: 2;
  readonly FILTER_SKIP: 3;
  readonly SHOW_ALL: -1;
  readonly SHOW_ELEMENT: 1;
  readonly SHOW_ATTRIBUTE: 2;
  readonly SHOW_TEXT: 4;
  readonly SHOW_CDATA_SECTION: 8;
  readonly SHOW_ENTITY_REFERENCE: 16;
  readonly SHOW_ENTITY: 32;
  readonly SHOW_PROCESSING_INSTRUCTION: 64;
  readonly SHOW_COMMENT: 128;
  readonly SHOW_DOCUMENT: 256;
  readonly SHOW_DOCUMENT_TYPE: 512;
  readonly SHOW_DOCUMENT_FRAGMENT: 1024;
  readonly SHOW_NOTATION: 2048;
};

/** A user filter: a function returning `FILTER_*`, or an object with `acceptNode`. */
type TNodeFilter = ((node: Node) => number) | { acceptNode(node: Node): number };

/** A filtered traversal cursor over a document subtree (WHATWG `TreeWalker`, T35). */
declare class TreeWalker {
  readonly root: Node;
  readonly whatToShow: number;
  readonly filter: TNodeFilter | null;
  currentNode: Node;
  parentNode(): Node | null;
  firstChild(): Node | null;
  lastChild(): Node | null;
  nextSibling(): Node | null;
  previousSibling(): Node | null;
  nextNode(): Node | null;
  previousNode(): Node | null;
}

/** A filtered traversal cursor over a document subtree (WHATWG `NodeIterator`, T35). */
declare class NodeIterator {
  readonly root: Node;
  readonly whatToShow: number;
  readonly filter: TNodeFilter | null;
  nextNode(): Node | null;
  previousNode(): Node | null;
}

// --- MutationObserver / MutationRecord (T41) -----------------------------------
//
// The `MutationObserver` class is not exported from the package entry — it is
// reached through `window.MutationObserver`, exactly like `Event` (T37). Every
// record is generated by the Core observer engine at the unified mutation
// sources and delivered by one microtask per (observer, target) listener
// (records accumulated in the same task batch into a single callback). The
// `oldValue` of attribute / characterData records is always populated
// (happy-dom baseline parity); the `attributeFilter` is matched case-against
// the stored attribute name.

declare class MutationObserver {
  constructor(callback: (records: MutationRecord[], observer: MutationObserver) => void);
  /** Starts observing `target` for the given options; re-observing the same target replaces its options. */
  observe(target: Node, options?: MutationObserverInit): void;
  /** Stops observing; queued records are discarded (never delivered). */
  disconnect(): void;
  /** Returns and clears the queued records without notifying the callback. */
  takeRecords(): MutationRecord[];
}

declare interface MutationObserverInit {
  /** Whether child list changes are reported. */
  childList?: boolean;
  /** Whether attribute changes are reported. */
  attributes?: boolean;
  /** Whether character data changes are reported. */
  characterData?: boolean;
  /** Whether mutations anywhere in `target`'s subtree are reported. */
  subtree?: boolean;
  /** When set without `attributes`, `attributes` is enabled; requires `attributes` not be false. */
  attributeOldValue?: boolean;
  /** When set without `characterData`, `characterData` is enabled; requires `characterData` not be false. */
  characterDataOldValue?: boolean;
  /** Only the listed attribute names are reported (names are lowercased); requires `attributes`. */
  attributeFilter?: string[];
}

/** One delivered DOM mutation. Node references are live facade wrappers minted
 * through the same identity cache as every other node read. */
declare interface MutationRecord {
  /** `"childList"`, `"attributes"` or `"characterData"`. */
  readonly type: "childList" | "attributes" | "characterData";
  /** The node whose children / attributes / data changed. */
  readonly target: Node;
  /** The added nodes (childList records). */
  readonly addedNodes: Node[];
  /** The removed nodes (childList records). */
  readonly removedNodes: Node[];
  /** The removed node's previous sibling (childList removal records), or `null`. */
  readonly previousSibling: Node | null;
  /** The removed node's next sibling (childList removal records), or `null`. */
  readonly nextSibling: Node | null;
  /** The changed attribute's name (attributes records), or `null`. */
  readonly attributeName: string | null;
  /** The changed attribute's namespace (always `null` in this milestone). */
  readonly attributeNamespace: string | null;
  /** The old value (attributes / characterData records), or `null`. */
  readonly oldValue: string | null;
}

// --- Custom Element registry (T42 / T48D) ------------------------------------
//
// The WHATWG `CustomElementRegistry`, reached through `window.customElements`.
// A custom element class extends `window.HTMLElement` and carries the optional
// lifecycle callbacks; `define` registers it for a name, `createElement` /
// the parser upgrade the matching elements by re-parenting their wrapper
// prototype onto the class (the single-class upgrade), and `define`-after-
// connect physically replaces each connected candidate with a fresh custom
// element (the pre-created reference stays a plain `HTMLElement`, happy-dom
// parity). The lifecycle callbacks fire synchronously at the mutation point
// (happy-dom parity); `observedAttributes` is read once at define and
// lowercased.

/** A custom element constructor: any `window.HTMLElement` subclass. */
export type CustomElementConstructor = new (...args: never[]) => HTMLElement;

/** The WHATWG `ElementDefinitionOptions` (T42). */
export interface IElementDefinitionOptions {
  /** Customized built-in support is not implemented; the option is accepted and ignored. */
  extends?: string;
}

/** The WHATWG `CustomElementRegistry` (T42): one per window. */
export interface CustomElementRegistry {
  /** Defines `name` for `elementClass`. Validates the name and constructor; a
   * failed definition leaves the registry unchanged. */
  define(name: string, elementClass: CustomElementConstructor, options?: IElementDefinitionOptions): void;
  /** The class defined for `name`, or `undefined`. */
  get(name: string): CustomElementConstructor | undefined;
  /** The name `elementClass` was defined under, or `null`. */
  getName(elementClass: CustomElementConstructor): string | null;
  /** A promise resolving once `name` is defined (rejects for invalid names). */
  whenDefined(name: string): Promise<void>;
  /** A no-op (happy-dom parity: documented as "Not implemented yet"). */
  upgrade(root: Node): void;
}

// --- Fetch network surface (T46) ----------------------------------------------
//
// The WHATWG fetch classes live on `window` (reached through the `Window`
// facade, never exported from the package entry): `Headers`, `Request`,
// `Response`, `AbortController`, `AbortSignal` and `window.fetch`. They are
// happy-dom-calibrated compat wrappers over the WHATWG / Bun primitives: the
// baseline exception names and verbatim messages, `bodyUsed` / `clone` /
// `Set-Cookie`-stripping semantics and the offline `data:` URL transport are
// replicated exactly, while `http(s)` I/O is adapted to Bun's native fetch.
// The constructors are per-window, so `window.Request` resolves against the
// owning window's location / cookie jar / navigator.

/** The WHATWG `RequestInfo` input accepted by `Request` / `fetch`. */
export type TRequestInfo = Request | string | URL;
/** The WHATWG `RequestBodyInit` subset this facade handles. */
export type TRequestBody = ArrayBuffer | ArrayBufferView | string | URLSearchParams | null;
/** The WHATWG `HeadersInit` accepted by `Headers` / `Request` / `Response`. */
export type THeadersInit = string[][] | Record<string, string> | Headers;
/** The WHATWG `RequestMode` enum. */
export type TRequestMode = "navigate" | "same-origin" | "no-cors" | "cors" | "websocket";
/** The WHATWG `RequestCredentials` enum. */
export type TRequestCredentials = "omit" | "same-origin" | "include";
/** The WHATWG `RequestRedirect` enum. */
export type TRequestRedirect = "follow" | "error" | "manual";
/** The WHATWG `ReferrerPolicy` enum. */
export type TRequestReferrerPolicy =
  | ""
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "same-origin"
  | "origin"
  | "strict-origin"
  | "origin-when-cross-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";

/** The WHATWG `RequestInit` dictionary. */
export interface IRequestInit {
  body?: TRequestBody | null;
  headers?: THeadersInit;
  method?: string;
  mode?: TRequestMode;
  redirect?: TRequestRedirect;
  signal?: AbortSignal | null;
  referrer?: string | URL;
  credentials?: TRequestCredentials;
  referrerPolicy?: TRequestReferrerPolicy;
}

/** The WHATWG `ResponseInit` dictionary. */
export interface IResponseInit {
  headers?: THeadersInit;
  status?: number;
  statusText?: string;
}

/** A `Set-Cookie`-style response body. */
export type TResponseBody = ArrayBuffer | ArrayBufferView | string | URLSearchParams | null;

/** The WHATWG `Headers` constructor value (T46). */
declare const Headers: {
  readonly prototype: Headers;
  new (init?: THeadersInit | null): Headers;
};

/** The WHATWG `Headers` instance surface (T46). */
export interface Headers {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  getSetCookie(): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(callback: (value: string, key: string, parent: Headers) => void, thisArg?: unknown): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  entries(): IterableIterator<[string, string]>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

/** The WHATWG `Request` constructor value (T46). */
declare const Request: {
  readonly prototype: Request;
  new (input: TRequestInfo, init?: IRequestInit | null): Request;
};

/** The WHATWG `Request` instance surface (T46). */
export interface Request {
  readonly method: string;
  readonly body: ReadableStream | null;
  readonly mode: TRequestMode;
  readonly headers: Headers;
  readonly redirect: TRequestRedirect;
  readonly referrerPolicy: TRequestReferrerPolicy;
  readonly signal: AbortSignal;
  readonly bodyUsed: boolean;
  readonly credentials: TRequestCredentials;
  readonly referrer: string;
  readonly url: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  clone(): Request;
}

/** The WHATWG `Response` constructor value (T46). */
declare const Response: {
  readonly prototype: Response;
  new (body?: TResponseBody | null, init?: IResponseInit | null): Response;
  readonly redirect: (url: string, status?: number) => Response;
  readonly error: () => Response;
  readonly json: (data: object, init?: IResponseInit | null) => Response;
};

/** The WHATWG `Response` instance surface (T46). */
export interface Response {
  readonly body: ReadableStream | null;
  readonly bodyUsed: boolean;
  readonly redirected: boolean;
  readonly type: "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly headers: Headers;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  clone(): Response;
}

/** The WHATWG `AbortController` constructor value (T46). */
declare const AbortController: {
  readonly prototype: AbortController;
  new (): AbortController;
};

/** The WHATWG `AbortController` instance surface (T46). */
export interface AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}

/** The WHATWG `AbortSignal` constructor value (T46). */
declare const AbortSignal: {
  readonly prototype: AbortSignal;
  new (): AbortSignal;
  readonly abort: (reason?: unknown) => AbortSignal;
  readonly timeout: (time: number) => AbortSignal;
  readonly any: (signals: Iterable<AbortSignal>) => AbortSignal;
};

/** The WHATWG `AbortSignal` instance surface (T46). */
export interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  onabort: ((event: unknown) => void) | null;
  throwIfAborted(): void;
  addEventListener(type: string, listener: ((event: unknown) => void) | { handleEvent(event: unknown): void } | null, options?: unknown): void;
  removeEventListener(type: string, listener: ((event: unknown) => void) | { handleEvent(event: unknown): void } | null, options?: unknown): void;
}

// --- Range / Selection (T36) -------------------------------------------------
//
// The Range and Selection classes are not exported from the package entry —
// ranges are minted by `document.createRange` / `range.cloneRange` / the
// selection mutators and selections by `document.getSelection` /
// `window.getSelection`, and the constructors are reached through
// `window.Range` / `window.Selection`. Every algorithm delegates to Core; the
// facade holds no second DOM state.

/** A pair of boundary points (WHATWG `Range`, T36): the start/end containers and their offsets. */
declare class Range {
  /** Compare `start` of the two ranges (`RangeHowEnum`). */
  static readonly START_TO_START: number;
  /** Compare `this.end` to the source `start`. */
  static readonly START_TO_END: number;
  /** Compare `end` of the two ranges. */
  static readonly END_TO_END: number;
  /** Compare `this.start` to the source `end`. */
  static readonly END_TO_START: number;
  readonly START_TO_START: number;
  readonly START_TO_END: number;
  readonly END_TO_END: number;
  readonly END_TO_START: number;
  readonly startContainer: Node;
  readonly startOffset: number;
  readonly endContainer: Node;
  readonly endOffset: number;
  readonly collapsed: boolean;
  readonly commonAncestorContainer: Node | null;
  setStart(node: Node, offset?: number): void;
  setEnd(node: Node, offset?: number): void;
  setStartBefore(node: Node): void;
  setStartAfter(node: Node): void;
  setEndBefore(node: Node): void;
  setEndAfter(node: Node): void;
  selectNode(node: Node): void;
  selectNodeContents(node: Node): void;
  collapse(toStart?: boolean): void;
  compareBoundaryPoints(how: number, sourceRange: Range): number;
  comparePoint(node: Node, offset?: number): number;
  isPointInRange(node: Node, offset?: number): boolean;
  intersectsNode(node: Node): boolean;
  cloneContents(): DocumentFragment;
  extractContents(): DocumentFragment;
  deleteContents(): void;
  insertNode(newNode: Node): void;
  surroundContents(newParent: Node): void;
  cloneRange(): Range;
  detach(): void;
  toString(): string;
}

/** The document selection (WHATWG `Selection`, T36): at most one range plus the anchor/focus direction. */
declare class Selection {
  readonly rangeCount: number;
  readonly isCollapsed: boolean;
  readonly type: "None" | "Caret" | "Range";
  readonly anchorNode: Node | null;
  readonly anchorOffset: number;
  readonly baseNode: Node | null;
  readonly baseOffset: number;
  readonly focusNode: Node | null;
  readonly focusOffset: number;
  readonly extentNode: Node | null;
  readonly extentOffset: number;
  addRange(newRange: Range): void;
  getRangeAt(index: number): Range;
  removeRange(range: Range): void;
  removeAllRanges(): void;
  empty(): void;
  collapse(node: Node, offset?: number): void;
  setPosition(node: Node, offset?: number): void;
  collapseToStart(): void;
  collapseToEnd(): void;
  extend(node: Node, offset?: number): void;
  setBaseAndExtent(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number): void;
  selectAllChildren(node: Node): void;
  containsNode(node: Node, allowPartialContainment?: boolean): boolean;
  deleteFromDocument(): void;
  toString(): string;
}

// --- Node creation, navigation, mutation, attributes, text and NodeList (T23/T24/T25) --
//
// Nodes are minted through `Document.createElement` / `createTextNode` /
// `createDocumentFragment` and expose the WHATWG `Node` navigation surface
// (T23), the tree mutation surface (T24), and the T25 surface: the element
// attribute methods, the `textContent` accessor and the live `childNodes`
// `NodeList`. Every read and every write delegates to the Core tree through the
// native binding — the facade keeps no second DOM state, so Core remains the
// only tree-state source. All mutation methods return the same facade wrapper
// they were called with (stable identity); a failed call throws before any
// observable tree change.

export interface Node {
  /** WHATWG `Node.nodeType` (1 Element, 3 Text, 8 Comment, 9 Document, 11 DocumentFragment). */
  readonly nodeType: number;
  /** Lowercased tag for Element, otherwise `#text` / `#comment` / `#document` / `#document-fragment`. */
  readonly nodeName: string;
  readonly parentNode: Node | null;
  readonly firstChild: Node | null;
  readonly lastChild: Node | null;
  readonly previousSibling: Node | null;
  readonly nextSibling: Node | null;
  /** The T25D live `childNodes` collection: re-reads the parent's children from Core on every access, so an existing `NodeList` reflects later tree and `textContent` changes immediately, and one and the same `NodeList` object is returned per parent. */
  readonly childNodes: NodeList;
  /** WHATWG `Node.textContent` (T25): reads the tree-order concatenation of descendant text; writes replace children with a single text node (`null` clears). */
  textContent: string;

  /** Appends `child` as the last child and returns it (WHATWG `Node.appendChild`). */
  appendChild(child: Node): Node;
  /** Inserts `child` immediately before `reference` and returns it (WHATWG `Node.insertBefore`). */
  insertBefore(child: Node, reference: Node): Node;
  /** Removes `child` from this parent, detaching it, and returns it (WHATWG `Node.removeChild`). */
  removeChild(child: Node): Node;
  /** Replaces `oldChild` with `newChild` and returns `oldChild` (WHATWG `Node.replaceChild`). */
  replaceChild(newChild: Node, oldChild: Node): Node;
  /** WHATWG `Node.cloneNode` (T33): a detached copy of this node — the whole subtree when `deep` — sharing no mutable state with the source. */
  cloneNode(deep?: boolean): Node;
  /** WHATWG `Node.nodeValue` (T33): the character data of a `Text`/`Comment`/`ProcessingInstruction` node, `null` otherwise (setting is a no-op on other kinds). */
  nodeValue: string | null;
  /** WHATWG `Node.isConnected` (T39/T40): whether the node's root ancestor is the `Document` node. */
  readonly isConnected: boolean;

  /** T40: whether the node's root ancestor is the `Document` node (the form
   * `input`/`change` rule and general DOM usage). */
  // (declared as isConnected above)

  /** WHATWG `EventTarget.addEventListener` (T37). */
  addEventListener(type: string, listener: TEventListener | null, options?: boolean | IEventListenerOptions | null): void;
  /** WHATWG `EventTarget.removeEventListener` (T37), matching the registered callback. */
  removeEventListener(type: string, listener: TEventListener | null, options?: boolean | { capture?: boolean } | null): void;
  /** WHATWG `EventTarget.dispatchEvent` (T37): returns `false` when a cancelable event was default-prevented. */
  dispatchEvent(event: Event): boolean;
}

/** The WHATWG `CharacterData` mutation surface (T33), shared by `Text`, `Comment` and `ProcessingInstruction`. */
export interface CharacterData {
  /** WHATWG `CharacterData.data`: the node's character data (`undefined` on non-character-data nodes). */
  data: string;
  /** WHATWG `CharacterData.length`: the UTF-16 length of the data. */
  readonly length: number;
  /** WHATWG `CharacterData.substringData(offset, count)`: the UTF-16 substring, clamped to the data (an offset past the end returns `""`). */
  substringData(offset: number, count: number): string;
  /** WHATWG `CharacterData.appendData(data)`: appends `data`. */
  appendData(data: string): void;
  /** WHATWG `CharacterData.insertData(offset, data)`: inserts at the UTF-16 offset (an out-of-range offset throws `ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS`). */
  insertData(offset: number, data: string): void;
  /** WHATWG `CharacterData.deleteData(offset, count)`: deletes with a clamped count. */
  deleteData(offset: number, count: number): void;
  /** WHATWG `CharacterData.replaceData(offset, count, data)`: replaces with a clamped count. */
  replaceData(offset: number, count: number, data: string): void;
}

/** A node minted by `Document.createElement` (T23 surface plus T25 element attributes and T29 inner/outerHTML). */
export interface Element extends Node {
  /** WHATWG `Element.localName` (T48): the lowercased local tag name for an element, `undefined` on non-element nodes (happy-dom parity). */
  readonly localName: string;
  /** WHATWG `Element.tagName` (T48): the uppercase tag name for an HTML element (equal to `nodeName`), `undefined` on non-element nodes. */
  readonly tagName: string;
  /** WHATWG `Element.getAttribute` (T25): the attribute value, or `null` when absent. */
  getAttribute(name: string): string | null;
  /** WHATWG `Element.setAttribute` (T25): stores the string form of `value`; an invalid WHATWG "Name" throws `ERR_MAD_DOM_INVALID_CHARACTER` and leaves the element unchanged. */
  setAttribute(name: string, value: string): void;
  /** WHATWG `Element.removeAttribute` (T25): absent names are a no-op. */
  removeAttribute(name: string): void;
  /** WHATWG `Element.hasAttribute` (T25): whether the element has the named attribute. */
  hasAttribute(name: string): boolean;
  /** WHATWG `Element.id` (T39): the `id` attribute, two-way reflected (setting stores the string form; the getter reads `""` when absent). */
  id: string;
  /** WHATWG `Element.className` (T39): the `class` attribute, two-way reflected (`""` when absent). */
  className: string;
  /** WHATWG `Element.innerHTML` (T29): the serialized children; setting parses in the element's own context and atomically replaces the children. */
  innerHTML: string;
  /** WHATWG `Element.outerHTML` (T29): the serialized element itself; setting parses in the parent's context and atomically replaces the element (a detached element is a no-op). */
  outerHTML: string;

  /** WHATWG `Element.querySelector` (T31): the first descendant element matching `selectors`, or `null` (the element itself is never a candidate). */
  querySelector<E extends Element = Element>(selectors: string): E | null;
  /** WHATWG `Element.querySelectorAll` (T31): every descendant element matching `selectors`, in document order, as a static `NodeList` snapshot (later mutations do not change it). */
  querySelectorAll<E extends Element = Element>(selectors: string): NodeList<E>;
  /** WHATWG `Element.matches` (T31): whether this element matches `selectors`. */
  matches(selectors: string): boolean;
  /** WHATWG `Element.closest` (T31): the closest ancestor — this element itself included — that matches `selectors`, or `null`. */
  closest<E extends Element = Element>(selectors: string): E | null;
  /** WHATWG `Element.getElementsByTagName` (T32): the descendant elements whose tag matches `tagName` (ASCII case-insensitive, `"*"` matches all), in document order, as a live `HTMLCollection` (the element itself is never a candidate). */
  getElementsByTagName(tagName: string): HTMLCollection<Element>;
  /** WHATWG `Element.getElementsByClassName` (T32): the descendant elements whose `class` attribute contains every whitespace token of `classNames`, in document order, as a live `HTMLCollection`. */
  getElementsByClassName(classNames: string): HTMLCollection<Element>;
  /** WHATWG `Element.attributes` (T34): a live `NamedNodeMap` of this element's attributes, re-read from Core on every access (one and the same map per element). */
  readonly attributes: NamedNodeMap;
  /** WHATWG `Element.classList` (T34): a live `DOMTokenList` over the `class` attribute, kept bidirectionally in sync with it (one and the same list per element). */
  readonly classList: DOMTokenList;
  /** WHATWG `Element.namespaceURI` (T34): the element's namespace URI (the WHATWG HTML namespace for a `createElement` element), `null` for non-elements. */
  readonly namespaceURI: string | null;
  /** WHATWG `Element.attachShadow` (T43): creates a shadow root of the given `mode` for this element. */
  attachShadow(init: ShadowRootInit): ShadowRoot;
  /** WHATWG `Element.shadowRoot` (T43): the `open` shadow root, or `null` (a `closed` root never leaks). */
  readonly shadowRoot: ShadowRoot | null;
  /** WHATWG `Element.slot` (T43): the `slot` attribute, two-way reflected (`""` when absent). */
  slot: string;
  /** WHATWG `HTMLSlotElement.assignedNodes` (T43): the host children assigned to this `<slot>` element (basic named assignment), or `[]` for other nodes. */
  assignedNodes(options?: { flatten?: boolean }): Node[];
  /** WHATWG `HTMLSlotElement.assignedElements` (T43): the assigned element children (basic named assignment), or `[]` for other nodes. */
  assignedElements(options?: { flatten?: boolean }): Element[];
  /** WHATWG `Element.style` (T44): a live `CSSStyleDeclaration` over the element's `style` attribute — every read re-parses the attribute and every mutation writes back through it, so the Core attribute stays the single authoritative state. */
  readonly style: CSSStyleDeclaration;
}

/** The WHATWG `ShadowRootInit` dictionary (T43): the `attachShadow` option object. */
export interface ShadowRootInit {
  /** The shadow root mode: `"open"` roots are reachable through `host.shadowRoot`, `"closed"` roots are not. */
  mode: "open" | "closed";
}

/** A node minted by `Document.createElement` — the WHATWG `HTMLElement`
 * surface (T39). In the single-`Node`-class model every element wrapper's
 * prototype chain runs `Node.prototype → HTMLElement.prototype`, so
 * `el instanceof window.HTMLElement` holds and the reflected attribute
 * accessors (`title` / `dir` / `lang` / `hidden` / `inert` / `tabIndex` /
 * `contentEditable`) plus `dataset` and the `click`/`focus`/`blur`
 * interaction live here, two-way synced with the element's attribute storage. */
export interface HTMLElement extends Element {
  /** WHATWG `HTMLElement.title`: the `title` attribute (`""` when absent). */
  title: string;
  /** WHATWG `HTMLElement.dir`: the `dir` attribute (`""` when absent). */
  dir: string;
  /** WHATWG `HTMLElement.lang`: the `lang` attribute (`""` when absent). */
  lang: string;
  /** WHATWG `HTMLElement.hidden`: whether the `hidden` attribute is present. */
  hidden: boolean;
  /** WHATWG `HTMLElement.inert`: whether the `inert` attribute is present. */
  inert: boolean;
  /** WHATWG `HTMLElement.tabIndex`: the `tabindex` attribute as a `long` (`-1` when absent or non-numeric; setting a non-number stores `"0"`). */
  tabIndex: number;
  /** WHATWG `HTMLElement.contentEditable`: the `contentEditable` enum (`"true"` / `"false"` / `"plaintext-only"` / `"inherit"`); an invalid setter throws `SyntaxError`. */
  contentEditable: string;
  /** WHATWG `HTMLElement.isContentEditable`: whether this element (or its nearest editable ancestor) is content-editable. */
  readonly isContentEditable: boolean;
  /** WHATWG `HTMLElement.innerText` (happy-dom parity): the rendered text — a
   * disconnected element reads its `textContent`, a connected one walks its
   * children honoring computed `display` / `text-transform`; the setter
   * rebuilds the children as text nodes separated by `<br>`. */
  innerText: string;
  /** WHATWG `HTMLElement.dataset` (T39): a live `DOMStringMap` over the element's `data-*` attributes (camelCase keys ↔ kebab-case attribute names). */
  readonly dataset: DOMStringMap;
  /** WHATWG `HTMLStyleElement.sheet` (T44): the `CSSStyleSheet` parsed from this `<style>` element's `textContent` (re-parsed when the text changes), or `null` when the element is not a connected `<style>` element. */
  readonly sheet: CSSStyleSheet | null;
  /** WHATWG `HTMLElement.click` (T39): dispatches a bubbling, cancelable, composed `click` event on the element. */
  click(): void;
  /** WHATWG `HTMLElement.focus` (T39): makes this element the document's active element and dispatches `focus`/`focusin` (a no-op when detached, inert or already focused). */
  focus(): void;
  /** WHATWG `HTMLElement.blur` (T39): clears the document's active element and dispatches `blur`/`focusout` (a no-op when not the active element). */
  blur(): void;

  // T40 form/template surface (single-class shared members). Every element
  // wrapper carries these; the per-tag interfaces above document the subset
  // happy-dom exposes on each tag (ineligible tags read `undefined` at
  // runtime).
  /** `template.content` (T40): the template-contents fragment. */
  readonly content: DocumentFragment;
  /** Serializes a template's contents (T40). */
  getInnerHTML(): string;
  /** Serializes the element's children (happy-dom `Element.getHTML` parity,
   * T40): honors the `serializableShadowRoots` / `shadowRoots` /
   * `allShadowRoots` / `excludeShadowRootTags` options; a template serializes
   * its content fragment. */
  getHTML(options?: {
    serializableShadowRoots?: boolean;
    shadowRoots?: unknown[];
    allShadowRoots?: boolean;
    excludeShadowRootTags?: string[];
  }): string;
  /** The control value (input/select/textarea/button/option, T40). */
  value: string;
  /** The control or form `name` (T40). */
  name: string;
  /** The control `type` (input/button/select, T40). */
  type: string;
  /** The control `disabled` (T40). */
  disabled: boolean;
  /** The input `checked` (T40). */
  checked: boolean;
  /** The input `defaultChecked` (T40). */
  defaultChecked: boolean;
  /** The input/textarea `defaultValue` (T40). */
  defaultValue: string;
  /** The control `required` (T40). */
  required: boolean;
  /** The input/textarea `readOnly` (T40). */
  readOnly: boolean;
  /** The input/select `multiple` (T40). */
  multiple: boolean;
  /** The option `selected` (T40). */
  selected: boolean;
  /** The option `index` (T40). */
  readonly index: number;
  /** The option `text` (T40). */
  text: string;
  /** The select `options` collection (T40, live). */
  readonly options: HTMLOptionsCollection;
  /** The select `selectedIndex` (T40). */
  selectedIndex: number;
  /** The select `selectedOptions` collection (T40, live). */
  readonly selectedOptions: HTMLCollection<HTMLOptionElement>;
  /** The select/form `length` (T40, live). */
  readonly length: number;
  /** The form `elements` collection (T40, live). */
  readonly elements: HTMLFormControlsCollection;
  /** The form `method` (T40). */
  method: string;
  /** The form `action` (T40). */
  action: string;
  /** The form `enctype` (T40). */
  enctype: string;
  /** The form `acceptCharset` (T40). */
  acceptCharset: string;
  /** The form `noValidate` (T40). */
  noValidate: boolean;
  /** The nearest ancestor form of a control (T40). */
  readonly form: HTMLFormElement | null;
  /** Select `item(index)` (T40). */
  item(index: number): HTMLOptionElement | null;
  /** Form `submit()` (T40; no navigation). */
  submit(): void;
  /** Form `requestSubmit(submitter)` (T40). */
  requestSubmit(submitter?: HTMLElement): void;
  /** Form `reset()` (T40). */
  reset(): void;
  /** Form `checkValidity()` (T48C): evaluates every will-validating control and
   * dispatches a bubbling cancelable `invalid` event on each invalid one;
   * `false` when any control fails. */
  checkValidity(): boolean;
  /** Form `reportValidity()` (T48C): identical to `checkValidity()`. */
  reportValidity(): boolean;
  /** The live `ValidityState` of a form control (T48C), or `undefined` for
   * tags outside the validation surface (`fieldset` included). */
  readonly validity: ValidityState | undefined;
  /** Whether the control is a candidate for constraint validation (T48C). */
  readonly willValidate: boolean | undefined;
  /** The control's validation message (T48C): the `setCustomValidity` payload,
   * or `"Constraints not satisfied"` for a will-validating control that fails
   * a constraint, or `""`. */
  readonly validationMessage: string | undefined;
  /** Stores the custom validation message (T48C); `""` clears it (a no-op on
   * `fieldset`). */
  setCustomValidity(message: string): void;
  /** The submitter-side `formnovalidate` reflection (T48C): lets a submit
   * button / submit input bypass the form's validation gate. */
  formNoValidate: boolean;
}

/** The WHATWG `DOMStringMap` behind `HTMLElement.dataset` (T39): a live,
 * proxy-backed view over the element's `data-*` attributes, mapping camelCase
 * property keys to kebab-case attribute names. */
export interface DOMStringMap {
  [name: string]: string;
}

/** The WHATWG `HTMLElement` constructor value reached through
 * `window.HTMLElement` (T39). The class is not user-constructible in MAD DOM
 * (it requires the internal prototype wiring); every `createElement` wrapper
 * is `instanceof window.HTMLElement`. */
declare const HTMLElement: {
  readonly prototype: HTMLElement;
  new (): HTMLElement;
};

/** The WHATWG `Node` constructor value reached through `window.Node` (T48A
 * class hierarchy). The base of every wrapper — Text / Comment /
 * ProcessingInstruction are plain `Node`s and never reach the element members. */
declare const Node: {
  readonly prototype: Node;
  new (): Node;
};

/** The WHATWG `Element` constructor value reached through `window.Element`
 * (T48A class hierarchy): the base of every element wrapper, between `Node`
 * and `HTMLElement`. Not user-constructible. */
declare const Element: {
  readonly prototype: Element;
  new (): Element;
};

/** The WHATWG `DocumentFragment` constructor value reached through
 * `window.DocumentFragment` (T48A class hierarchy): fragments (and, through
 * the T43 re-parenting, shadow roots) reach the ParentNode query surface and
 * `innerHTML`. */
declare const DocumentFragment: {
  readonly prototype: DocumentFragment;
  new (): DocumentFragment;
};

// --- Per-tag element classes (T48A) -------------------------------------------
//
// One empty class per common HTML tag, exposed as a `window.HTML*Element`
// constructor and selected by `createElement` / parse / import as the
// wrapper's direct prototype so `Object.getPrototypeOf(el)` matches happy-dom.
// The classes add no members of their own — every surface is inherited from
// `Element` / `HTMLElement`.

/** The WHATWG `HTMLUnknownElement` constructor (T48A): the direct prototype
 * for an undefined plain tag name. */
declare const HTMLUnknownElement: {
  readonly prototype: HTMLElement;
  new (): HTMLElement;
};
/** The WHATWG `HTMLDivElement` constructor (T48A). */
declare const HTMLDivElement: { readonly prototype: HTMLDivElement; new (): HTMLDivElement };
/** The WHATWG `HTMLSpanElement` constructor (T48A). */
declare const HTMLSpanElement: { readonly prototype: HTMLSpanElement; new (): HTMLSpanElement };
/** The WHATWG `HTMLParagraphElement` constructor (T48A). */
declare const HTMLParagraphElement: { readonly prototype: HTMLParagraphElement; new (): HTMLParagraphElement };
/** The WHATWG `HTMLAnchorElement` constructor (T48A). */
declare const HTMLAnchorElement: { readonly prototype: HTMLAnchorElement; new (): HTMLAnchorElement };
/** The WHATWG `HTMLBodyElement` constructor (T48A). */
declare const HTMLBodyElement: { readonly prototype: HTMLBodyElement; new (): HTMLBodyElement };
/** The WHATWG `HTMLHeadingElement` constructor (T48A). */
declare const HTMLHeadingElement: { readonly prototype: HTMLHeadingElement; new (): HTMLHeadingElement };
/** The WHATWG `HTMLUListElement` constructor (T48A). */
declare const HTMLUListElement: { readonly prototype: HTMLUListElement; new (): HTMLUListElement };
/** The WHATWG `HTMLOListElement` constructor (T48A). */
declare const HTMLOListElement: { readonly prototype: HTMLOListElement; new (): HTMLOListElement };
/** The WHATWG `HTMLLIElement` constructor (T48A). */
declare const HTMLLIElement: { readonly prototype: HTMLLIElement; new (): HTMLLIElement };
/** The WHATWG `HTMLTableElement` constructor (T48A). */
declare const HTMLTableElement: { readonly prototype: HTMLTableElement; new (): HTMLTableElement };
/** The WHATWG `HTMLTableCaptionElement` constructor (T48A). */
declare const HTMLTableCaptionElement: { readonly prototype: HTMLTableCaptionElement; new (): HTMLTableCaptionElement };
/** The WHATWG `HTMLTableRowElement` constructor (T48A). */
declare const HTMLTableRowElement: { readonly prototype: HTMLTableRowElement; new (): HTMLTableRowElement };
/** The WHATWG `HTMLTableCellElement` constructor (T48A). */
declare const HTMLTableCellElement: { readonly prototype: HTMLTableCellElement; new (): HTMLTableCellElement };
/** The WHATWG `HTMLTableSectionElement` constructor (T48A). */
declare const HTMLTableSectionElement: { readonly prototype: HTMLTableSectionElement; new (): HTMLTableSectionElement };
/** The WHATWG `HTMLBRElement` constructor (T48A). */
declare const HTMLBRElement: { readonly prototype: HTMLBRElement; new (): HTMLBRElement };
/** The WHATWG `HTMLHRElement` constructor (T48A). */
declare const HTMLHRElement: { readonly prototype: HTMLHRElement; new (): HTMLHRElement };
/** The WHATWG `HTMLLabelElement` constructor (T48A). */
declare const HTMLLabelElement: { readonly prototype: HTMLLabelElement; new (): HTMLLabelElement };
/** The WHATWG `HTMLImageElement` constructor (T48A). */
declare const HTMLImageElement: { readonly prototype: HTMLImageElement; new (): HTMLImageElement };
/** The WHATWG `HTMLScriptElement` constructor (T48A). */
declare const HTMLScriptElement: { readonly prototype: HTMLScriptElement; new (): HTMLScriptElement };
/** The WHATWG `HTMLStyleElement` constructor (T48A). */
declare const HTMLStyleElement: { readonly prototype: HTMLStyleElement; new (): HTMLStyleElement };
/** The WHATWG `HTMLLinkElement` constructor (T48A). */
declare const HTMLLinkElement: { readonly prototype: HTMLLinkElement; new (): HTMLLinkElement };
/** The WHATWG `HTMLMetaElement` constructor (T48A). */
declare const HTMLMetaElement: { readonly prototype: HTMLMetaElement; new (): HTMLMetaElement };
/** The WHATWG `HTMLTitleElement` constructor (T48A). */
declare const HTMLTitleElement: { readonly prototype: HTMLTitleElement; new (): HTMLTitleElement };
/** The WHATWG `HTMLHeadElement` constructor (T48A). */
declare const HTMLHeadElement: { readonly prototype: HTMLHeadElement; new (): HTMLHeadElement };
/** The WHATWG `HTMLHtmlElement` constructor (T48A). */
declare const HTMLHtmlElement: { readonly prototype: HTMLHtmlElement; new (): HTMLHtmlElement };
/** The WHATWG `HTMLQuoteElement` constructor (T48A). */
declare const HTMLQuoteElement: { readonly prototype: HTMLQuoteElement; new (): HTMLQuoteElement };
/** The WHATWG `HTMLSlotElement` constructor (T48A). */
declare const HTMLSlotElement: { readonly prototype: HTMLSlotElement; new (): HTMLSlotElement };

// --- Per-tag element interfaces (T48A) ----------------------------------------
//
// One empty interface per per-tag class: since T48A the facade owns the WHATWG
// class chain (`Node → Element → HTMLElement → per-tag`) and `createElement` /
// parse / import select the per-tag class as the wrapper's direct prototype.
// These interfaces carry no members of their own — everything is inherited
// from `HTMLElement` — and exist so the `window.HTML*Element` constructors and
// `instanceof` narrowing line up with happy-dom.

export interface HTMLUnknownElement extends HTMLElement {}
export interface HTMLDivElement extends HTMLElement {}
export interface HTMLSpanElement extends HTMLElement {}
export interface HTMLParagraphElement extends HTMLElement {}
export interface HTMLAnchorElement extends HTMLElement {}
export interface HTMLBodyElement extends HTMLElement {}
export interface HTMLHeadingElement extends HTMLElement {}
export interface HTMLUListElement extends HTMLElement {}
export interface HTMLOListElement extends HTMLElement {}
export interface HTMLLIElement extends HTMLElement {}
export interface HTMLTableElement extends HTMLElement {}
export interface HTMLTableCaptionElement extends HTMLElement {}
export interface HTMLTableRowElement extends HTMLElement {}
export interface HTMLTableCellElement extends HTMLElement {}
export interface HTMLTableSectionElement extends HTMLElement {}
export interface HTMLBRElement extends HTMLElement {}
export interface HTMLHRElement extends HTMLElement {}
export interface HTMLLabelElement extends HTMLElement {}
export interface HTMLImageElement extends HTMLElement {}
export interface HTMLScriptElement extends HTMLElement {}
export interface HTMLStyleElement extends HTMLElement {}
export interface HTMLLinkElement extends HTMLElement {}
export interface HTMLMetaElement extends HTMLElement {}
export interface HTMLTitleElement extends HTMLElement {}
export interface HTMLHeadElement extends HTMLElement {}
export interface HTMLHtmlElement extends HTMLElement {}
export interface HTMLQuoteElement extends HTMLElement {}
export interface HTMLSlotElement extends HTMLElement {}

// --- Form controls and template (T40, validation T48C) -----------------------
//
// The first-batch form contract: `input` / `button` / `select` / `option` /
// `textarea` value/name/disabled/checked/selected basics, the `form` element's
// `elements` / `submit` / `requestSubmit` / `reset`, and
// `HTMLTemplateElement.content`. The per-tag classes (T48A) give these the
// happy-dom direct prototypes; the form surface itself is declared on the
// `Element`/`Node` surface below. Since T48C the constraint-validation surface
// is real: the live `ValidityState` (`validity`), `willValidate`,
// `validationMessage`, `setCustomValidity` and the control / form
// `checkValidity` / `reportValidity` that dispatch the bubbling cancelable
// `invalid` event and gate the `requestSubmit` path through `noValidate` /
// `formnovalidate`.

/** The WHATWG `SubmitEvent` (T40): dispatched by `form.requestSubmit`, carrying
 * the `submitter` button/input (or the form itself). */
export interface ISubmitEventInit extends IEventInit {
  submitter?: HTMLElement | null;
}

export declare class SubmitEvent extends Event {
  readonly submitter: HTMLElement | null;
  constructor(type: string, eventInit?: ISubmitEventInit | null);
}

/** The WHATWG `HTMLTemplateElement` surface (T40): the template-contents
 * `DocumentFragment` behind `content` and the content serialization methods.
 * The fragment is not exposed as ordinary children; `innerHTML` /
 * `outerHTML` route through it. */
export interface HTMLTemplateElement extends HTMLElement {
  /** The template-contents `DocumentFragment` (stable identity; created on first access). */
  readonly content: DocumentFragment;
  /** Serializes the template contents (happy-dom `getInnerHTML`). */
  getInnerHTML(): string;
  /** Serializes the template contents (happy-dom `getHTML`). */
  getHTML(): string;
}

/** The WHATWG `ValidityState` (T48C): a control's live constraint-validation
 * flags, recomputed from the element's attributes / value / checkedness on
 * every flag read. `valid` is `true` only when every other flag is `false`.
 * One cached instance per control: `el.validity === el.validity`. */
export interface ValidityState {
  /** The `input.type` is `number`/`range` and the value is not a valid
   * number/range shape (`"12.5"` ok, `"abc"` not). */
  readonly badInput: boolean;
  /** A non-empty message was set with `setCustomValidity`. */
  readonly customError: boolean;
  /** The `input` has a `pattern` and the value is not covered by its first
   * regex match. */
  readonly patternMismatch: boolean;
  /** The `input.type` is `number`/`range`, a `max` exists and the value is
   * greater than it. */
  readonly rangeOverflow: boolean;
  /** The `input.type` is `number`/`range`, a `min` exists and the value is
   * less than it. */
  readonly rangeUnderflow: boolean;
  /** The `input.type` is `number`/`range` and the value is not on the `step`
   * grid (the default step is 1; `step="any"` never mismatches). */
  readonly stepMismatch: boolean;
  /** The input/textarea has a `maxlength` and the value is longer than it. */
  readonly tooLong: boolean;
  /** The input/textarea has a `minlength` and the value is shorter than it. */
  readonly tooShort: boolean;
  /** The `input.type` is `email`/`url` and the value does not match the type's
   * format. */
  readonly typeMismatch: boolean;
  /** A `required` control (a checkbox/radio unchecked, or any other required
   * control with an empty value) is missing its value. */
  readonly valueMissing: boolean;
  /** `true` only when every flag above is `false`. */
  readonly valid: boolean;
}

/** The WHATWG `HTMLInputElement` basics (T40, validation T48C):
 * value/name/type/disabled/checked/defaultChecked/defaultValue/required/
 * readOnly/multiple plus the constraint-validation surface. The dirty text-like
 * `value` and the dirty `checked` are stored in Core, not the attribute list. */
export interface HTMLInputElement extends HTMLElement {
  value: string;
  name: string;
  type: string;
  disabled: boolean;
  checked: boolean;
  defaultChecked: boolean;
  defaultValue: string;
  required: boolean;
  readOnly: boolean;
  multiple: boolean;
  /** The nearest ancestor `<form>` element, or `null`. */
  readonly form: HTMLFormElement | null;
  /** The live constraint-validation flags (T48C). */
  readonly validity: ValidityState;
  /** Whether the input is a candidate for constraint validation (T48C). */
  readonly willValidate: boolean;
  /** The input's validation message (T48C). */
  readonly validationMessage: string;
  /** Stores the custom validation message; `""` clears it (T48C). */
  setCustomValidity(message: string): void;
  /** Evaluates the input's constraints, dispatching `invalid` when it fails
   * (T48C). */
  checkValidity(): boolean;
  /** Identical to `checkValidity()` (T48C). */
  reportValidity(): boolean;
  /** The submitter-side `formnovalidate` reflection (T48C). */
  formNoValidate: boolean;
}

/** The WHATWG `HTMLButtonElement` basics (T40, validation T48C). */
export interface HTMLButtonElement extends HTMLElement {
  value: string;
  name: string;
  type: string;
  disabled: boolean;
  /** The nearest ancestor `<form>` element, or `null`. */
  readonly form: HTMLFormElement | null;
  /** The live constraint-validation flags (T48C). */
  readonly validity: ValidityState;
  /** Whether the button is a candidate for constraint validation (T48C). */
  readonly willValidate: boolean;
  /** The button's validation message (T48C). */
  readonly validationMessage: string;
  /** Stores the custom validation message; `""` clears it (T48C). */
  setCustomValidity(message: string): void;
  /** Evaluates the button's constraints, dispatching `invalid` when it fails
   * (T48C). */
  checkValidity(): boolean;
  /** Identical to `checkValidity()` (T48C). */
  reportValidity(): boolean;
  /** The submitter-side `formnovalidate` reflection (T48C). */
  formNoValidate: boolean;
}

/** The WHATWG `HTMLSelectElement` basics (T40, validation T48C): the
 * value/selectedIndex selection model, the live `options` and
 * `selectedOptions` collections. */
export interface HTMLSelectElement extends HTMLElement {
  value: string;
  name: string;
  disabled: boolean;
  multiple: boolean;
  required: boolean;
  type: string;
  readonly length: number;
  readonly options: HTMLOptionsCollection;
  selectedIndex: number;
  readonly selectedOptions: HTMLCollection<HTMLOptionElement>;
  /** Returns the option at `index`, or `null` past the end. */
  item(index: number): HTMLOptionElement | null;
  /** The nearest ancestor `<form>` element, or `null`. */
  readonly form: HTMLFormElement | null;
  /** The live constraint-validation flags (T48C). */
  readonly validity: ValidityState;
  /** Whether the select is a candidate for constraint validation (T48C). */
  readonly willValidate: boolean;
  /** The select's validation message (T48C). */
  readonly validationMessage: string;
  /** Stores the custom validation message; `""` clears it (T48C). */
  setCustomValidity(message: string): void;
  /** Evaluates the select's constraints, dispatching `invalid` when it fails
   * (T48C). */
  checkValidity(): boolean;
  /** Identical to `checkValidity()` (T48C). */
  reportValidity(): boolean;
}

/** The WHATWG `HTMLOptionElement` basics (T40). */
export interface HTMLOptionElement extends HTMLElement {
  value: string;
  text: string;
  selected: boolean;
  readonly index: number;
  disabled: boolean;
  /** The owning select's form, or `null`. */
  readonly form: HTMLFormElement | null;
}

/** The WHATWG `HTMLTextAreaElement` basics (T40, validation T48C). */
export interface HTMLTextAreaElement extends HTMLElement {
  value: string;
  name: string;
  disabled: boolean;
  required: boolean;
  readOnly: boolean;
  defaultValue: string;
  /** The nearest ancestor `<form>` element, or `null`. */
  readonly form: HTMLFormElement | null;
  /** The live constraint-validation flags (T48C). */
  readonly validity: ValidityState;
  /** Whether the textarea is a candidate for constraint validation (T48C). */
  readonly willValidate: boolean;
  /** The textarea's validation message (T48C). */
  readonly validationMessage: string;
  /** Stores the custom validation message; `""` clears it (T48C). */
  setCustomValidity(message: string): void;
  /** Evaluates the textarea's constraints, dispatching `invalid` when it
   * fails (T48C). */
  checkValidity(): boolean;
  /** Identical to `checkValidity()` (T48C). */
  reportValidity(): boolean;
}

/** The WHATWG `HTMLFormElement` basics (T40, validation T48C): the live
 * `elements` collection, the attribute reflections and the submit/reset /
 * validity surface. `submit()` performs no navigation (T40 boundary). */
export interface HTMLFormElement extends HTMLElement {
  readonly elements: HTMLFormControlsCollection;
  readonly length: number;
  name: string;
  method: string;
  action: string;
  enctype: string;
  acceptCharset: string;
  noValidate: boolean;
  /** Submits without dispatching a `submit` event; navigation is a no-op. */
  submit(): void;
  /** Dispatches a cancelable `SubmitEvent('submit')` (with `submitter`), then submits when not default-prevented; an invalid form (unless `noValidate` or a `formnovalidate` submitter) does not dispatch `submit`. */
  requestSubmit(submitter?: HTMLElement): void;
  /** Resets every control to its default value, then dispatches a cancelable `Event('reset')`. */
  reset(): void;
  /** Evaluates every will-validating control, dispatching a bubbling cancelable `invalid` event on each invalid one; `false` when any control fails. */
  checkValidity(): boolean;
  /** Identical to `checkValidity()`. */
  reportValidity(): boolean;
}

/** A live collection of form controls (T40). Every access re-reads Core, so an
 * existing collection reflects any tree change immediately. */
export interface HTMLFormControlsCollection {
  readonly length: number;
  item(index: number): HTMLElement | null;
  namedItem(name: string): HTMLElement | null;
  [index: number]: HTMLElement;
  [Symbol.iterator](): IterableIterator<HTMLElement>;
}

/** A live collection of `<option>` elements (T40). */
export interface HTMLOptionsCollection {
  readonly length: number;
  item(index: number): HTMLOptionElement | null;
  namedItem(name: string): HTMLOptionElement | null;
  [index: number]: HTMLOptionElement;
  [Symbol.iterator](): IterableIterator<HTMLOptionElement>;
}

/** Constructor values reached through `window.HTMLFormElement` / ... (T40).
 * The classes are not user-constructible in MAD DOM; every `createElement`
 * wrapper is a shared `Node`, so the per-tag classes exist only as the
 * constructor accessors. */
declare const HTMLTemplateElement: { readonly prototype: HTMLTemplateElement; new (): HTMLTemplateElement };
declare const HTMLFormElement: { readonly prototype: HTMLFormElement; new (): HTMLFormElement };
declare const HTMLInputElement: { readonly prototype: HTMLInputElement; new (): HTMLInputElement };
declare const HTMLButtonElement: { readonly prototype: HTMLButtonElement; new (): HTMLButtonElement };
declare const HTMLSelectElement: { readonly prototype: HTMLSelectElement; new (): HTMLSelectElement };
declare const HTMLOptionElement: { readonly prototype: HTMLOptionElement; new (): HTMLOptionElement };
declare const HTMLTextAreaElement: { readonly prototype: HTMLTextAreaElement; new (): HTMLTextAreaElement };
declare const HTMLFormControlsCollection: { readonly prototype: HTMLFormControlsCollection; new (): HTMLFormControlsCollection };
declare const HTMLOptionsCollection: { readonly prototype: HTMLOptionsCollection; new (): HTMLOptionsCollection };
declare const ValidityState: { readonly prototype: ValidityState; new (): ValidityState };

/** A live map of an element's attributes (T34). Each access re-reads the
 * element's ordered attribute list from Core, so an existing map reflects
 * later attribute writes immediately, and one and the same map is returned per
 * element. Indexed reads, the named getter and the iteration surface mirror the
 * WHATWG `NamedNodeMap`. */
export interface NamedNodeMap {
  /** Live number of attributes; re-read from Core on every access. */
  readonly length: number;
  /** Returns the `Attr` at `index`, or `null` past the end (WHATWG `NamedNodeMap.item`). */
  item(index: number): Attr | null;
  /** Returns the `Attr` whose name equals `name`, or `null` (WHATWG `NamedNodeMap.getNamedItem`). */
  getNamedItem(name: string): Attr | null;
  [index: number]: Attr;
  [Symbol.iterator](): IterableIterator<Attr>;
}

/** A single element attribute (T34). `value` re-reads (and writes through to)
 * the element's Core attribute storage when the `Attr` is attached, and its own
 * stored string when detached. One live `Attr` wrapper is cached per
 * `(element, attribute-name)`, so identity is stable across reads. */
export interface Attr {
  /** The attribute's qualified name (also `localName` in the no-namespace model). */
  readonly name: string;
  /** The attribute's local name. */
  readonly localName: string;
  /** The attribute's namespace prefix (`null` for the no-namespace model). */
  readonly prefix: string | null;
  /** The attribute's namespace URI (`null` for the no-namespace model). */
  readonly namespaceURI: string | null;
  /** Whether the attribute was explicitly set (always `true` for the current model). */
  readonly specified: boolean;
  /** WHATWG `Node.nodeType`: 2 for an `Attr`. */
  readonly nodeType: number;
  /** WHATWG `Node.nodeName`: the attribute's qualified name. */
  readonly nodeName: string;
  /** The attribute's owner element, or `null` when detached/removed. */
  readonly ownerElement: Element | null;
  /** The attribute's value: reads/writes the element's attribute when attached. */
  value: string;
  /** WHATWG `Node.nodeValue`: an alias of the value. */
  nodeValue: string | null;
  /** WHATWG `Node.textContent`: an alias of the value (`""` for a null value). */
  textContent: string;
}

/** A live token list over an element attribute (T34). `Element.classList`
 * returns the list over the `class` attribute; every read re-derives the
 * WHATWG ordered set from the attribute value in Core and every mutation
 * writes back through the attribute storage, so the two stay bidirectionally in
 * sync. One and the same list is returned per element. */
export interface DOMTokenList {
  /** Live number of tokens; re-read from Core on every access. */
  readonly length: number;
  /** The raw attribute string (verbatim); setting stores the raw string. */
  value: string;
  /** Returns the token at `index`, or `null` past the end (WHATWG `DOMTokenList.item`). */
  item(index: number): string | null;
  /** Whether the token set contains `token` (an empty token is absent; never throws). */
  contains(token: string): boolean;
  /** Adds the tokens to the set (an empty token throws `ERR_MAD_DOM_SYNTAX`, a whitespace token `ERR_MAD_DOM_INVALID_CHARACTER`, atomically). */
  add(...tokens: string[]): void;
  /** Removes the tokens from the set (same validation as `add`). */
  remove(...tokens: string[]): void;
  /** Toggles `token` and returns whether it is present afterwards; `force` makes the operation one-way. */
  toggle(token: string, force?: boolean): boolean;
  /** Replaces `oldToken` with `newToken`, returning whether the replacement happened (missing `oldToken` yields `false`). */
  replace(oldToken: string, newToken: string): boolean;
  /** Iterates the tokens in order (WHATWG `DOMTokenList.forEach`). */
  forEach(callback: (token: string, index: number, list: DOMTokenList) => void, thisArg?: unknown): void;
  /** Yields `[index, token]` pairs. */
  entries(): IterableIterator<[number, string]>;
  /** Yields the indices. */
  keys(): IterableIterator<number>;
  /** Yields the tokens in order. */
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<string>;
}

/** A node minted by `Document.createTextNode` (T23 surface plus the T33 CharacterData surface). */
export interface Text extends Node, CharacterData {
  /** WHATWG `Text.splitText(offset)` (T33): splits this text at the UTF-16 offset and returns the new tail node, inserted right after it. */
  splitText(offset: number): Text;
}

/** A node minted by `Document.createComment` (T33 surface). */
export interface Comment extends Node, CharacterData {}

/** A node minted by `Document.createProcessingInstruction` (T33 surface). */
export interface ProcessingInstruction extends Node, CharacterData {
  /** WHATWG `ProcessingInstruction.target`: the instruction target (also the `nodeName`). */
  readonly target: string;
}

/** A `DocumentType` node produced by the HTML parser (T33 surface: doctype payload reads). */
export interface DocumentType extends Node {
  /** WHATWG `DocumentType.name`: the doctype name (also the `nodeName`). */
  readonly name: string;
  /** WHATWG `DocumentType.publicId`: the doctype public identifier. */
  readonly publicId: string;
  /** WHATWG `DocumentType.systemId`: the doctype system identifier. */
  readonly systemId: string;
}

/** A node minted by `Document.createDocumentFragment` (T24 surface plus T29 innerHTML). */
export interface DocumentFragment extends Node {
  /** WHATWG `DocumentFragment.innerHTML` (T29): the serialized children; setting parses with the fallback body context and atomically replaces the children. */
  innerHTML: string;
}

/** A `ShadowRoot` (T43): the tree owner behind an `attachShadow` host. In the
 * single-class model every shadow-root wrapper's prototype chain runs
 * `ShadowRoot.prototype → Node.prototype`, so the whole Node surface is
 * inherited; `host` / `mode` are the shadow-root-specific reads. The shadow
 * tree is never part of the host's light DOM: navigation, queries and
 * serialization on the host stay on the light side. */
export interface ShadowRoot extends DocumentFragment {
  /** The element this shadow root is attached to. */
  readonly host: Element | null;
  /** The shadow root mode: `"open"` or `"closed"`. */
  readonly mode: "open" | "closed";
}

/** A `NodeList` collection of nodes. The T25D live `childNodes` collection is
 * bound to one parent node and re-read from Core on every access; the T31
 * `querySelectorAll` returns a static snapshot collection with the same
 * read surface (see `query.js`). */
export interface NodeList<T extends Node = Node> {
  /** Live number of children; re-read from Core on every access. */
  readonly length: number;
  /** Returns the node at `index`, or `null` past the end (WHATWG `NodeList.item`). */
  item(index: number): T | null;
  /** Iterates the children in Core document order (WHATWG `NodeList.forEach`). */
  forEach(callback: (node: T, index: number, list: NodeList<T>) => void, thisArg?: unknown): void;
  /** Yields `[index, node]` pairs (WHATWG `NodeList.entries`). */
  entries(): IterableIterator<[number, T]>;
  /** Yields the indices (WHATWG `NodeList.keys`). */
  keys(): IterableIterator<number>;
  /** Yields the nodes in Core document order (WHATWG `NodeList.values`). */
  values(): IterableIterator<T>;
  [Symbol.iterator](): IterableIterator<T>;
}

/** A live `HTMLCollection` of elements (T32). It is bound to one scope and one
 * query key (`getElementsByTagName` / `getElementsByClassName`) and validated
 * against native mutation generations, so an existing collection reflects
 * later tree and attribute changes immediately (see `live-collections.js`).
 * Numeric index reads and the named getter mirror the WHATWG surface. */
export interface HTMLCollection<T extends Element = Element> {
  /** Live number of matched elements. */
  readonly length: number;
  /** Returns the element at `index`, or `null` past the end (WHATWG `HTMLCollection.item`). */
  item(index: number): T | null;
  /** Returns the first element whose `id` or `name` attribute equals `name`, or `null` (WHATWG `HTMLCollection.namedItem`). */
  namedItem(name: string): T | null;
  [index: number]: T;
  [Symbol.iterator](): IterableIterator<T>;
}

// --- Minimal native binding (T19) -----------------------------------------
//
// Low-level binding entry, not the public DOM facade. Every handle object is
// opaque: the underlying Core NodeId and document ownership never cross the
// native boundary. Optional performance methods may exchange document-scoped
// numeric tokens, which cannot be interpreted without their DocumentHandle.
// Methods throw TypeError / Error (with a stable `code`) on misuse; the
// exception taxonomy is T21.

export declare function isNativeAvailable(): boolean;
export declare function createDocument(): DocumentHandle;
export declare function liveDocumentCount(): number;
export declare function nativeAbiVersion(): number;

/** Opaque wrapper for a live Core window (native binding). */
export interface WindowHandle {
  document(): DocumentHandle;
  destroy(): void;
}

/** Opaque wrapper for a live Core document. */
export interface DocumentHandle {
  /**
   * Optional JS-owned structural-generation view used by facade navigation caches.
   * `-2147483648` means destroyed; `-1` permanently disables equality-based caching.
   */
  epochView?(): ArrayBuffer;
  /**
   * Optional JS-owned attribute-generation view used by facade reflected-value caches.
   * `-2147483648` means destroyed; `-1` permanently disables equality-based caching.
   */
  attributeEpochView?(): ArrayBuffer;
  /** Internal facade-local structural view paired with token hot-write epoch returns. */
  facadeEpochView?(): ArrayBuffer;
  /** Internal facade-local attribute view paired with token hot-write epoch returns. */
  facadeAttributeEpochView?(): ArrayBuffer;
  /** Optional lazy-node companion to `createElement`. */
  createElementToken?(name: string): number;
  /** Optional amortized lazy-node element creation. */
  createElementTokenBatch?(name: string, count: number): number[];
  /** Optional contiguous-range form of lazy-node element creation. */
  createElementTokenRange?(name: string, count: number): number;
  /** Optional lazy-node companion to `createText`. */
  createTextToken?(data: string): number;
  /** Resolves a document-scoped lazy token to its canonical native handle. */
  materializeNodeToken?(token: number): NodeHandle;
  /** Resolves a pre-token raw node wrapper into the document token registry. */
  nodeToken?(node: NodeHandle): number;
  /** Optional token-based attribute write. */
  setAttributeToken?(token: number, name: string, value: string): void;
  /** Internal token write returning the canonical attribute epoch. */
  setAttributeTokenLocal?(token: number, name: string, value: string): number;
  /** Optional token-based append for two nodes owned by this document. */
  appendChildToken?(parent: number, child: number): void;
  /** Internal token append returning the canonical structural epoch. */
  appendChildTokenLocal?(parent: number, child: number): number;
  /** Optional bounded pre-order snapshot: continuation-depth header, then `(token, descriptor/depth)` pairs. */
  preorderTokenSnapshot?(rootToken: number): Uint32Array;
  createElement(name: string): NodeHandle;
  createText(data: string): NodeHandle;
  createComment(data: string): NodeHandle;
  createDocumentFragment(): NodeHandle;
  appendChild(parent: NodeHandle, child: NodeHandle): void;
  insertBefore(parent: NodeHandle, child: NodeHandle, reference: NodeHandle): void;
  removeChild(parent: NodeHandle, child: NodeHandle): void;
  replaceChild(parent: NodeHandle, child: NodeHandle, node: NodeHandle): void;
  /** T29 native `documentElement` read; `null` when the document has no root element. */
  documentElement(): NodeHandle | null;
  /** T29 native `head` read. */
  head(): NodeHandle | null;
  /** T29 native `body` read. */
  body(): NodeHandle | null;
  /** T29 native full-document parse and replace. */
  parseHtml(html: string): void;
  /** T31 native `querySelector`: first descendant element matching the selector, or `null`. */
  querySelector(selector: string): NodeHandle | null;
  /** T31 native `querySelectorAll`: every descendant element matching the selector, in document order. */
  querySelectorAll(selector: string): NodeHandle[];
  /** T31 native `getElementById`: first element whose `id` attribute equals the argument, or `null`. */
  getElementById(id: string): NodeHandle | null;
  /** T32 native `getElementsByTagName`: every descendant element matching the tag (ASCII case-insensitive, `"*"` matches all), in document order. */
  getElementsByTagName(tagName: string): NodeHandle[];
  /** T32 native `getElementsByClassName`: every descendant element whose `class` attribute contains every whitespace token of the argument, in document order. */
  getElementsByClassName(className: string): NodeHandle[];
  /** T32 native live tag-query count used by `HTMLCollection.length`; does not materialize result node handles. */
  countElementsByTagName?(tagName: string): number;
  /** T32 native live class-query count used by `HTMLCollection.length`; does not materialize result node handles. */
  countElementsByClassName?(className: string): number;
  /** T33 native `createProcessingInstruction`: a detached ProcessingInstruction node. */
  createProcessingInstruction(target: string, data: string): NodeHandle;
  /** T33 native `importNode`: a copy of `node` (subtree when `deep`) in this document; the source is never modified. */
  importNode(node: NodeHandle, deep: boolean): NodeHandle;
  /** T33 native `adoptNode`: `node` moved (with its subtree) into this document. */
  adoptNode(node: NodeHandle): NodeHandle;
  /** T33 native `doctype`: the document's parsed `DocumentType`, or `null`. */
  doctype(): NodeHandle | null;
  /** T34 native `createAttribute` name check: throws `ERR_MAD_DOM_INVALID_CHARACTER` for a non-"Name" qualified name. */
  validateAttributeName(name: string): void;
  /** T37 native `addEventListener` on the document-root node. */
  addEventListener(type: string, listener: unknown, capture: boolean, once: boolean, passive: boolean): void;
  /** T37 native `removeEventListener` on the document-root node. */
  removeEventListener(type: string, listener: unknown, capture: boolean): void;
  /** T37 native `dispatchEvent` on the document-root node; returns the WHATWG boolean. */
  dispatchEvent(event: unknown): boolean;
  destroy(): void;
}

/** Opaque wrapper for a Core node (document ownership reference + NodeId). */
export interface NodeHandle {
  /** Internal immutable document-scoped token stamped by current bindings. */
  readonly madDomToken?: number;
  /** Internal immutable WHATWG node-type stamp. */
  readonly madDomType?: number;
  /** Internal immutable element local-name stamp. */
  readonly madDomName?: string;
  /** Internal immutable element namespace stamp. */
  readonly madDomNamespace?: string;
  nodeType(): number;
  nodeName(): string;
  parentNode(): NodeHandle | null;
  firstChild(): NodeHandle | null;
  lastChild(): NodeHandle | null;
  previousSibling(): NodeHandle | null;
  nextSibling(): NodeHandle | null;
  /** Optional bounded navigation prefetch: at most the first two children, with a trailing null only when the native read proved that no third child exists. */
  firstChildPair?(): Array<NodeHandle | null>;
  /** Optional bounded navigation prefetch: at most 32 following siblings, with a trailing null only when the native walk reached the chain end. */
  nextSiblingChunk?(): Array<NodeHandle | null>;
  childNodes(): NodeHandle[];
  /** Optional fixed-name reflected-attribute reads used by the facade cache. */
  idAttribute?(): string | null;
  classAttribute?(): string | null;
  /** Optional bundled cold fill for the facade's id/class cache. */
  idClassAttributes?(): [id: string | null, classValue: string | null];
  /** T25E native attribute read (`getAttribute`), `null` when absent. */
  getAttribute(name: string): string | null;
  /** T25E native attribute write (`setAttribute`). */
  setAttribute(name: string, value: string): void;
  /** T25E native attribute removal (`removeAttribute`). */
  removeAttribute(name: string): void;
  /** T25E native attribute presence test (`hasAttribute`). */
  hasAttribute(name: string): boolean;
  /** T25E native `textContent` read; `null` for a Document node. */
  textContent(): string | null;
  /** T25E native `textContent` write. */
  setTextContent(value: string): void;
  /** T29 native `innerHTML` read: serialized children of an Element/DocumentFragment. */
  innerHTML(): string;
  /** T29 native `innerHTML` write: parse in the target's own context and atomically replace its children. */
  setInnerHTML(html: string): void;
  /** T29 native `outerHTML` read: the serialized node itself. */
  outerHTML(): string;
  /** T29 native `outerHTML` write: parse in the parent's context and atomically replace the node (detached is a no-op). */
  setOuterHTML(html: string): void;
  /** T31 native `querySelector`: first descendant element matching the selector, or `null`. */
  querySelector(selector: string): NodeHandle | null;
  /** T31 native `querySelectorAll`: every descendant element matching the selector, in document order. */
  querySelectorAll(selector: string): NodeHandle[];
  /** T31 native `matches`: whether this element matches the selector. */
  matches(selector: string): boolean;
  /** T31 native `closest`: the closest ancestor (itself included) matching the selector, or `null`. */
  closest(selector: string): NodeHandle | null;
  /** T32 native `getElementsByTagName`: the descendant elements matching the tag (ASCII case-insensitive, `"*"` matches all), in document order. */
  getElementsByTagName(tagName: string): NodeHandle[];
  /** T32 native `getElementsByClassName`: the descendant elements whose `class` attribute contains every whitespace token of the argument, in document order. */
  getElementsByClassName(className: string): NodeHandle[];
  /** T32 native scoped live tag-query count used by `HTMLCollection.length`; does not materialize result node handles. */
  countElementsByTagName?(tagName: string): number;
  /** T32 native scoped live class-query count used by `HTMLCollection.length`; does not materialize result node handles. */
  countElementsByClassName?(className: string): number;
  /** T33 native `data`: the character data of a Text/Comment/ProcessingInstruction node, or `null` for other kinds. */
  data(): string | null;
  /** T33 native `data` write. */
  setData(value: string): void;
  /** T33 native `length`: the UTF-16 length of the character data, or `null`. */
  dataLength(): number | null;
  /** T33 native `nodeValue`: the data for character-data nodes, `null` otherwise. */
  nodeValue(): string | null;
  /** T33 native `nodeValue` write. */
  setNodeValue(value: string): void;
  /** T33 native `ProcessingInstruction.target`, or `null`. */
  target(): string | null;
  /** T33 native `DocumentType.name`, or `null`. */
  name(): string | null;
  /** T33 native `DocumentType.publicId`, or `null`. */
  publicId(): string | null;
  /** T33 native `DocumentType.systemId`, or `null`. */
  systemId(): string | null;
  /** T33 native `substringData(offset, count)`. */
  substringData(offset: number, count: number): string;
  /** T33 native `appendData(data)`. */
  appendData(data: string): void;
  /** T33 native `insertData(offset, data)`. */
  insertData(offset: number, data: string): void;
  /** T33 native `deleteData(offset, count)`. */
  deleteData(offset: number, count: number): void;
  /** T33 native `replaceData(offset, count, data)`. */
  replaceData(offset: number, count: number, data: string): void;
  /** T33 native `splitText(offset)`: the new tail node. */
  splitText(offset: number): NodeHandle;
  /** T33 native `cloneNode(deep)`: a detached copy under a fresh handle. */
  cloneNode(deep: boolean): NodeHandle;
  /** T34 native `getAttributes`: the element's ordered `[name, value]` pairs (backing `Element.attributes`). */
  getAttributes(): [string, string][];
  /** T34 native `namespaceUri`: the element's namespace URI, or `null` for non-elements. */
  namespaceUri(): string | null;
  /** T34 native `tokenList(name)`: the ordered de-duplicated token set of the named attribute. */
  tokenList(name: string): string[];
  /** T34 native `tokenListContains(name, token)`. */
  tokenListContains(name: string, token: string): boolean;
  /** T34 native `tokenListAdd(name, tokens)`. */
  tokenListAdd(name: string, tokens: string[]): void;
  /** T34 native `tokenListRemove(name, tokens)`. */
  tokenListRemove(name: string, tokens: string[]): void;
  /** T34 native `tokenListToggle(name, token, force?)`: whether the token is present afterwards. */
  tokenListToggle(name: string, token: string, force?: boolean): boolean;
  /** T34 native `tokenListReplace(name, oldToken, newToken)`: whether the replacement happened. */
  tokenListReplace(name: string, oldToken: string, newToken: string): boolean;
  /** T37 native `addEventListener` on this node. */
  addEventListener(type: string, listener: unknown, capture: boolean, once: boolean, passive: boolean): void;
  /** T37 native `removeEventListener` on this node. */
  removeEventListener(type: string, listener: unknown, capture: boolean): void;
  /** T37 native `dispatchEvent` on this node; returns the WHATWG boolean. */
  dispatchEvent(event: unknown): boolean;
  /** T43 native `attachShadow(mode)`: mode `0` = open, `1` = closed. */
  attachShadow(mode: number): NodeHandle;
  /** T43 native `shadowRoot`: this element's open shadow root, or `null` (closed roots never leak). */
  shadowRoot(): NodeHandle | null;
  /** T43 native `shadowRootMode`: the mode of a shadow root (`0` open / `1` closed), or `null` for other nodes. */
  shadowRootMode(): number | null;
  /** T43 native `shadowHost`: the host of a shadow root, or `null` for other nodes. */
  shadowHost(): NodeHandle | null;
  /** T43 native `isShadowRoot`: whether this node is a shadow root. */
  isShadowRoot(): boolean;
  /** T43 native `slotAssignedNodes(flatten)`: the host children assigned to this `<slot>` element. */
  slotAssignedNodes(flatten: boolean): NodeHandle[];
  /** T43 native `slotAssignedElements(flatten)`: the assigned element children of this `<slot>` element. */
  slotAssignedElements(flatten: boolean): NodeHandle[];
}

// --- CSSOM (T44) -------------------------------------------------------------
//
// The CSS Object Model surface: `CSSStyleDeclaration` (a live view over the
// `style` attribute), the first batch of stylesheet/rule types
// (`CSSStyleSheet`, `CSSRule` and the concrete rule classes), `MediaList`,
// `MediaQueryList` / `MediaQueryListEvent` (from `window.matchMedia`) and the
// `CSS` unit-value namespace. `document.styleSheets` and `document.adoptedStyleSheets`
// are declared on `Document`. The rule / declaration classes are exported from
// the package entry like the baseline.

/** WHATWG `CSSRuleTypeEnum` numbers (T44): the `CSSRule.type` constants. */
export declare enum CSSRuleTypeEnum {
  CONTAINER_RULE = 0,
  STYLE_RULE = 1,
  IMPORT_RULE = 3,
  MEDIA_RULE = 4,
  FONT_FACE_RULE = 5,
  PAGE_RULE = 6,
  KEYFRAMES_RULE = 7,
  KEYFRAME_RULE = 8,
  NAMESPACE_RULE = 10,
  COUNTER_STYLE_RULE = 11,
  SUPPORTS_RULE = 12,
  DOCUMENT_RULE = 13,
  FONT_FEATURE_VALUES_RULE = 14,
  REGION_STYLE_RULE = 16,
}

/** A single stored CSS declaration (`name → { value, important }`). */
export interface IProperty {
  value: string;
  important: boolean;
}

/** WHATWG `CSSRule` (T44): the base interface of every parsed rule. */
export declare class CSSRule {
  static readonly CONTAINER_RULE: number;
  static readonly STYLE_RULE: number;
  static readonly IMPORT_RULE: number;
  static readonly MEDIA_RULE: number;
  static readonly FONT_FACE_RULE: number;
  static readonly PAGE_RULE: number;
  static readonly KEYFRAMES_RULE: number;
  static readonly KEYFRAME_RULE: number;
  static readonly NAMESPACE_RULE: number;
  static readonly COUNTER_STYLE_RULE: number;
  static readonly SUPPORTS_RULE: number;
  static readonly DOCUMENT_RULE: number;
  static readonly FONT_FEATURE_VALUES_RULE: number;
  static readonly REGION_STYLE_RULE: number;
  readonly type: number;
  readonly cssText: string;
  readonly parentRule: CSSRule | null;
  readonly parentStyleSheet: CSSStyleSheet | null;
}

/** WHATWG `CSSStyleRule` (T44): a selector + declaration-block rule. */
export declare class CSSStyleRule extends CSSRule {
  readonly type: number;
  readonly cssText: string;
  readonly selectorText: string;
  readonly style: CSSStyleDeclaration;
}

/** WHATWG `CSSGroupingRule` (T44): a rule that owns nested rules. */
export declare class CSSGroupingRule extends CSSRule {
  readonly cssRules: CSSRule[];
  insertRule(rule: string, index?: number): number;
  deleteRule(index: number): void;
}

/** WHATWG `CSSConditionRule` (T44): a grouping rule with a condition text. */
export declare class CSSConditionRule extends CSSGroupingRule {
  readonly conditionText: string;
}

/** WHATWG `CSSMediaRule` (T44): an `@media` grouping rule. */
export declare class CSSMediaRule extends CSSConditionRule {
  readonly type: number;
  readonly cssText: string;
  readonly media: MediaList;
}

/** WHATWG `CSSSupportsRule` (T44): an `@supports` grouping rule. */
export declare class CSSSupportsRule extends CSSConditionRule {
  readonly type: number;
  readonly cssText: string;
}

/** WHATWG `CSSContainerRule` (T44): an `@container` grouping rule. */
export declare class CSSContainerRule extends CSSConditionRule {
  readonly type: number;
  readonly cssText: string;
}

/** WHATWG `CSSScopeRule` (T44): an `@scope` grouping rule. */
export declare class CSSScopeRule extends CSSGroupingRule {
  readonly type: number;
  readonly cssText: string;
  readonly start: string;
  readonly end: string;
}

/** WHATWG `CSSKeyframesRule` (T44): an `@keyframes` rule. */
export declare class CSSKeyframesRule extends CSSRule {
  readonly type: number;
  readonly cssText: string;
  readonly cssRules: CSSKeyframeRule[];
  readonly name: string;
  readonly length: number;
  appendRule(rule: string): void;
  deleteRule(select: string): void;
  findRule(select: string): CSSKeyframeRule | null;
}

/** WHATWG `CSSKeyframeRule` (T44): one `from`/`to`/percentage keyframe. */
export declare class CSSKeyframeRule extends CSSRule {
  readonly type: number;
  readonly cssText: string;
  readonly keyText: string;
  readonly style: CSSStyleDeclaration;
}

/** WHATWG `CSSFontFaceRule` (T44): an `@font-face` rule. */
export declare class CSSFontFaceRule extends CSSRule {
  readonly type: number;
  readonly cssText: string;
  readonly style: CSSStyleDeclaration;
}

/** WHATWG `CSSStyleDeclaration` (T44): a live CSS declaration block — the
 * element-backed form re-parses the `style` attribute on every read and writes
 * every mutation back through it (single authoritative state), while a
 * standalone form (rule.style / getComputedStyle result) owns its own manager. */
export declare class CSSStyleDeclaration {
  /** The owning rule, or `null` for an element style / computed style. */
  parentRule: CSSRule | null;
  /** The serialized declaration text (`name: value;` joined by space). */
  cssText: string;
  /** The number of expanded longhand properties (shorthands count their sub-properties). */
  readonly length: number;
  /** The property name at `index` (expanded longhands), or `""`. */
  item(index: number): string;
  /** The value of `name` (kebab-case; the camelCase accessors map onto this), or `""`. */
  getPropertyValue(name: string): string;
  /** `"important"` when the named property carries the `!important` priority, else `""`. */
  getPropertyPriority(name: string): string;
  /** Sets `name` to `value` with the optional priority (`"important"`); an empty value removes the property. */
  setProperty(name: string, value: string, priority?: string): void;
  /** Removes the named property. */
  removeProperty(name: string): void;
  readonly accentColor: string;
  readonly alignContent: string;
  readonly alignItems: string;
  readonly alignSelf: string;
  readonly all: string;
  readonly animation: string;
  readonly animationDelay: string;
  readonly animationDirection: string;
  readonly animationDuration: string;
  readonly animationFillMode: string;
  readonly animationIterationCount: string;
  readonly animationName: string;
  readonly animationPlayState: string;
  readonly animationTimingFunction: string;
  readonly appearance: string;
  readonly backdropFilter: string;
  readonly backfaceVisibility: string;
  readonly background: string;
  readonly backgroundAttachment: string;
  readonly backgroundClip: string;
  readonly backgroundColor: string;
  readonly backgroundImage: string;
  readonly backgroundOrigin: string;
  readonly backgroundPosition: string;
  readonly backgroundRepeat: string;
  readonly backgroundSize: string;
  readonly border: string;
  readonly borderBottom: string;
  readonly borderBottomColor: string;
  readonly borderBottomLeftRadius: string;
  readonly borderBottomRightRadius: string;
  readonly borderBottomStyle: string;
  readonly borderBottomWidth: string;
  readonly borderCollapse: string;
  readonly borderColor: string;
  readonly borderImage: string;
  readonly borderLeft: string;
  readonly borderLeftColor: string;
  readonly borderLeftStyle: string;
  readonly borderLeftWidth: string;
  readonly borderRadius: string;
  readonly borderRight: string;
  readonly borderRightColor: string;
  readonly borderRightStyle: string;
  readonly borderRightWidth: string;
  readonly borderStyle: string;
  readonly borderTop: string;
  readonly borderTopColor: string;
  readonly borderTopLeftRadius: string;
  readonly borderTopRightRadius: string;
  readonly borderTopStyle: string;
  readonly borderTopWidth: string;
  readonly borderWidth: string;
  readonly bottom: string;
  readonly boxShadow: string;
  readonly boxSizing: string;
  readonly captionSide: string;
  readonly caretColor: string;
  readonly clear: string;
  readonly clip: string;
  readonly clipPath: string;
  readonly color: string;
  readonly columnCount: string;
  readonly columnFill: string;
  readonly columnGap: string;
  readonly columnRule: string;
  readonly columnRuleColor: string;
  readonly columnRuleStyle: string;
  readonly columnRuleWidth: string;
  readonly columnSpan: string;
  readonly columnWidth: string;
  readonly columns: string;
  readonly content: string;
  readonly counterIncrement: string;
  readonly counterReset: string;
  readonly cssFloat: string;
  readonly cursor: string;
  readonly direction: string;
  readonly display: string;
  readonly emptyCells: string;
  readonly fill: string;
  readonly fillOpacity: string;
  readonly fillRule: string;
  readonly filter: string;
  readonly flex: string;
  readonly flexBasis: string;
  readonly flexDirection: string;
  readonly flexFlow: string;
  readonly flexGrow: string;
  readonly flexShrink: string;
  readonly flexWrap: string;
  readonly float: string;
  readonly floodColor: string;
  readonly floodOpacity: string;
  readonly font: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontStretch: string;
  readonly fontStyle: string;
  readonly fontVariant: string;
  readonly fontWeight: string;
  readonly gap: string;
  readonly grid: string;
  readonly gridArea: string;
  readonly gridAutoColumns: string;
  readonly gridAutoFlow: string;
  readonly gridAutoRows: string;
  readonly gridColumn: string;
  readonly gridColumnEnd: string;
  readonly gridColumnGap: string;
  readonly gridColumnStart: string;
  readonly gridRow: string;
  readonly gridRowEnd: string;
  readonly gridRowGap: string;
  readonly gridRowStart: string;
  readonly gridTemplate: string;
  readonly gridTemplateAreas: string;
  readonly gridTemplateColumns: string;
  readonly gridTemplateRows: string;
  readonly height: string;
  readonly justifyContent: string;
  readonly justifyItems: string;
  readonly justifySelf: string;
  readonly left: string;
  readonly letterSpacing: string;
  readonly lineHeight: string;
  readonly listStyle: string;
  readonly listStyleImage: string;
  readonly listStylePosition: string;
  readonly listStyleType: string;
  readonly margin: string;
  readonly marginBottom: string;
  readonly marginLeft: string;
  readonly marginRight: string;
  readonly marginTop: string;
  readonly maxHeight: string;
  readonly maxWidth: string;
  readonly minHeight: string;
  readonly minWidth: string;
  readonly mixBlendMode: string;
  readonly objectFit: string;
  readonly objectPosition: string;
  readonly opacity: string;
  readonly order: string;
  readonly orphans: string;
  readonly outline: string;
  readonly outlineColor: string;
  readonly outlineOffset: string;
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly overflow: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly padding: string;
  readonly paddingBottom: string;
  readonly paddingLeft: string;
  readonly paddingRight: string;
  readonly paddingTop: string;
  readonly pageBreakAfter: string;
  readonly pageBreakBefore: string;
  readonly pageBreakInside: string;
  readonly perspective: string;
  readonly perspectiveOrigin: string;
  readonly pointerEvents: string;
  readonly position: string;
  readonly quotes: string;
  readonly resize: string;
  readonly right: string;
  readonly rowGap: string;
  readonly scrollBehavior: string;
  readonly tabSize: string;
  readonly tableLayout: string;
  readonly textAlign: string;
  readonly textAlignLast: string;
  readonly textDecoration: string;
  readonly textDecorationColor: string;
  readonly textDecorationLine: string;
  readonly textDecorationStyle: string;
  readonly textIndent: string;
  readonly textOverflow: string;
  readonly textShadow: string;
  readonly textTransform: string;
  readonly top: string;
  readonly touchAction: string;
  readonly transform: string;
  readonly transformOrigin: string;
  readonly transformStyle: string;
  readonly transition: string;
  readonly transitionDelay: string;
  readonly transitionDuration: string;
  readonly transitionProperty: string;
  readonly transitionTimingFunction: string;
  readonly unicodeBidi: string;
  readonly userSelect: string;
  readonly verticalAlign: string;
  readonly visibility: string;
  readonly whiteSpace: string;
  readonly widows: string;
  readonly width: string;
  readonly willChange: string;
  readonly wordBreak: string;
  readonly wordSpacing: string;
  readonly wordWrap: string;
  readonly writingMode: string;
  readonly zIndex: string;
  readonly zoom: string;
}

/** WHATWG `CSSStyleSheet` (T44): the parsed rule list of a `<style>` element
 * (or a standalone constructible sheet). `insertRule` / `deleteRule` mutate the
 * sheet's own rule list; `replaceSync` re-parses the given CSS text. */
export declare class CSSStyleSheet {
  cssRules: CSSRule[];
  media: string;
  title: string;
  alternate: boolean;
  disabled: boolean;
  insertRule(rule: string, index?: number): number;
  deleteRule(index: number): void;
  replaceSync(text: string): void;
  replace(text: string): Promise<void>;
}

/** WHATWG `MediaList` (T44): the comma-separated media list of a `CSSMediaRule`. */
export declare class MediaList {
  readonly length: number;
  mediaText: string;
  item(index: number): string | null;
  appendMedium(medium: string): void;
  deleteMedium(medium: string): void;
}

/** WHATWG `MediaQueryListEventInit` (T44). */
export interface IMediaQueryListEventInit extends IEventInit {
  media?: string;
  matches?: boolean;
}

/** WHATWG `MediaQueryListEvent` (T44): the `change` event payload. */
export declare class MediaQueryListEvent extends Event {
  readonly media: string;
  readonly matches: boolean;
  constructor(type: string, eventInit?: IMediaQueryListEventInit | null);
}

/** WHATWG `MediaQueryList` (T44): returned by `window.matchMedia`. */
export declare class MediaQueryList {
  readonly media: string;
  readonly matches: boolean;
  onchange: ((event: MediaQueryListEvent) => void) | null;
  addListener(callback: (event: MediaQueryListEvent) => void): void;
  removeListener(callback: (event: MediaQueryListEvent) => void): void;
  addEventListener(type: string, listener: (event: MediaQueryListEvent) => void): void;
  removeEventListener(type: string, listener: (event: MediaQueryListEvent) => void): void;
  dispatchEvent(event: MediaQueryListEvent): boolean;
}

/** WHATWG `CSSStyleValue` (T44): the base of the typed-OM value classes. */
export declare class CSSStyleValue {
  toString(): string;
}

/** WHATWG `CSSKeywordValue` (T44): a keyword CSS value. */
export declare class CSSKeywordValue {
  value: string;
  constructor(value: string);
}

/** WHATWG `CSS` namespace (T44): unit-value factories and `supports`. */
export declare class CSS {
  static supports(conditionText: string): boolean;
  static escape(value: string): string;
  readonly px: (value: number) => CSSUnitValue;
  readonly em: (value: number) => CSSUnitValue;
  readonly rem: (value: number) => CSSUnitValue;
  readonly percent: (value: number) => CSSUnitValue;
  readonly number: (value: number) => CSSUnitValue;
  readonly vw: (value: number) => CSSUnitValue;
  readonly vh: (value: number) => CSSUnitValue;
  readonly s: (value: number) => CSSUnitValue;
  readonly ms: (value: number) => CSSUnitValue;
  readonly deg: (value: number) => CSSUnitValue;
  readonly rad: (value: number) => CSSUnitValue;
  readonly turn: (value: number) => CSSUnitValue;
  readonly Hz: (value: number) => CSSUnitValue;
  readonly kHz: (value: number) => CSSUnitValue;
  readonly cm: (value: number) => CSSUnitValue;
  readonly mm: (value: number) => CSSUnitValue;
  readonly in: (value: number) => CSSUnitValue;
  readonly pt: (value: number) => CSSUnitValue;
  readonly pc: (value: number) => CSSUnitValue;
  readonly Q: (value: number) => CSSUnitValue;
}

/** WHATWG `CSSUnitValue` (T44): a typed value with a unit. */
export declare class CSSUnitValue {
  value: number;
  readonly unit: string;
  toString(): string;
}

/** T44 native `Document.styleSheets`: the array of sheets for the document's connected `<style>` elements. */
export interface Document {
  readonly styleSheets: CSSStyleSheet[];
  adoptedStyleSheets: CSSStyleSheet[];
}

// --- Browser / page / frame model (integration surface) ----------------------
//
// The happy-dom browser/page model the vendored integration suite drives:
// `new Browser({ settings })` → `newPage()` → `goto()` server-side navigation
// + `waitUntilComplete()` / `waitForNavigation()` + the `virtualConsolePrinter`
// error surface. Navigation is script-free (no page JavaScript evaluation);
// `errorCapture: "processLevel"` observes the Node process for uncaught
// window-script errors while pages are open.

/** Error capture policy (happy-dom parity). */
export declare enum BrowserErrorCaptureEnum {
  /** Errors and Promise rejections are thrown to the caller (try/catch). */
  tryAndCatch = "tryAndCatch",
  /** Process-level listeners capture every error and Promise rejection. */
  processLevel = "processLevel",
  /** Error capturing is disabled. */
  disabled = "disabled"
}

/** `goto` / history-navigation options (happy-dom `IGoToOptions` shape). */
export interface IGoToOptions {
  referrer?: string;
  referrerPolicy?: string;
  hard?: boolean;
  timeout?: number;
  headers?: Record<string, string> | Headers;
  beforeContentCallback?: (window: Window) => void;
}

/** `reload` options (happy-dom `IReloadOptions` shape). */
export interface IReloadOptions {
  hard?: boolean;
  timeout?: number;
  headers?: Record<string, string> | Headers;
}

/** Browser settings (happy-dom shape; accepted and stored). */
export interface IBrowserSettings {
  disableJavaScriptEvaluation?: boolean;
  enableJavaScriptEvaluation?: boolean;
  disableJavaScriptFileLoading?: boolean;
  disableCSSFileLoading?: boolean;
  enableImageFileLoading?: boolean;
  disableIframePageLoading?: boolean;
  disableComputedStyleRendering?: boolean;
  handleDisabledFileLoadingAsSuccess?: boolean;
  suppressCodeGenerationFromStringsWarning?: boolean;
  suppressInsecureJavaScriptEnvironmentWarning?: boolean;
  timer?: {
    maxTimeout?: number;
    maxIntervalTime?: number;
    maxIntervalIterations?: number;
    preventTimerLoops?: boolean;
  };
  fetch?: {
    disableSameOriginPolicy?: boolean;
    disableStrictSSL?: boolean;
    interceptor?: any;
    requestHeaders?: any;
    virtualServers?: Array<{ url: string | RegExp; directory: string }>;
  };
  module?: {
    resolveNodeModules?: any;
    urlResolver?: any;
    disableCache?: boolean;
  };
  disableErrorCapturing?: boolean;
  errorCapture?: BrowserErrorCaptureEnum;
  enableFileSystemHttpRequests?: boolean;
  navigation?: {
    disableMainFrameNavigation?: boolean;
    disableChildFrameNavigation?: boolean;
    disableChildPageNavigation?: boolean;
    disableFallbackToSetURL?: boolean;
    crossOriginPolicy?: string;
    beforeContentCallback?: any;
    /** Writable happy-dom parity slot; `window.navigator.userAgent` reads
     * `navigator.userAgent` below, not this field (baseline behavior). */
    userAgent?: string;
  };
  navigator?: {
    /** Feeds `window.navigator.userAgent` (default embeds HappyDOM/20.11.11). */
    userAgent?: string;
    /** Feeds `window.navigator.maxTouchPoints` (default 0). */
    maxTouchPoints?: number;
  };
  device?: {
    prefersColorScheme?: string;
    prefersReducedMotion?: string;
    mediaType?: string;
    forcedColors?: string;
  };
  debug?: {
    traceWaitUntilComplete?: number;
  };
  viewport?: { width?: number; height?: number; devicePixelRatio?: number };
  canvasAdapter?: any;
}

/** A virtual console log level (happy-dom parity). */
export declare enum VirtualConsoleLogLevelEnum {
  log = 0,
  info = 1,
  warn = 2,
  error = 3
}

/** A virtual console log type (happy-dom parity): the `type` of an
 * `IVirtualConsoleLogEntry`. Exported like the baseline does. */
export declare enum VirtualConsoleLogTypeEnum {
  log = "log",
  table = "table",
  trace = "trace",
  dir = "dir",
  dirxml = "dirxml",
  group = "group",
  groupCollapsed = "groupCollapsed",
  debug = "debug",
  timeLog = "timeLog",
  info = "info",
  count = "count",
  timeEnd = "timeEnd",
  warn = "warn",
  countReset = "countReset",
  error = "error",
  assert = "assert"
}

/** A virtual console log group (happy-dom `IVirtualConsoleLogGroup` shape). */
export interface IVirtualConsoleLogGroup {
  id: number;
  label: string;
  collapsed: boolean;
  parent: IVirtualConsoleLogGroup | null;
}

/** A virtual console log entry (happy-dom `IVirtualConsoleLogEntry` shape;
 * the browser error path also prints plain-string messages). */
export interface IVirtualConsoleLogEntry {
  type?: VirtualConsoleLogTypeEnum | string;
  level: VirtualConsoleLogLevelEnum | number;
  message: any[] | string;
  group?: IVirtualConsoleLogGroup | null;
  time?: number;
}

/** The page's virtual console printer: a buffer of log entries with the
 * `print` / `clear` event surface and `read` / `readAsString` consumers. */
export declare class VirtualConsolePrinter {
  readonly closed: boolean;
  print(logEntry: IVirtualConsoleLogEntry): void;
  clear(): void;
  close(): void;
  addEventListener(eventType: "print" | "clear", listener: (event: Event) => void): void;
  removeEventListener(eventType: "print" | "clear", listener: (event: Event) => void): void;
  dispatchEvent(event: { type: "print" | "clear" }): void;
  read(): IVirtualConsoleLogEntry[];
  readAsString(logLevel?: VirtualConsoleLogLevelEnum): string;
}

/** The window's virtual console (happy-dom `VirtualConsole` parity): every
 * console method writes one log entry into the printer. Exported like the
 * baseline does; `Window.console` reads it. */
export declare class VirtualConsole {
  constructor(printer: VirtualConsolePrinter | (() => VirtualConsolePrinter));
  assert(assertion?: any, message?: any, ...args: any[]): void;
  clear(): void;
  count(label?: string): void;
  countReset(label?: string): void;
  debug(message?: any, ...args: any[]): void;
  dir(data?: any): void;
  dirxml(data?: any): void;
  error(message?: any, ...args: any[]): void;
  exception(...args: any[]): void;
  group(label?: string): void;
  groupCollapsed(label?: string): void;
  groupEnd(): void;
  info(message?: any, ...args: any[]): void;
  log(message?: any, ...args: any[]): void;
  profile(): void;
  profileEnd(): void;
  table(data?: any): void;
  time(label?: string): void;
  timeEnd(label?: string): void;
  timeLog(label?: string, ...args: any[]): void;
  timeStamp(): void;
  trace(message?: any, ...args: any[]): void;
  warn(message?: any, ...args: any[]): void;
}

/** A cookie `SameSite` attribute value (happy-dom parity). */
export declare enum CookieSameSiteEnum {
  strict = "Strict",
  lax = "Lax",
  none = "None"
}

/** A cookie (happy-dom `ICookie` shape). */
export interface ICookie {
  key: string;
  originURL: string | URL;
  value: string | null;
  domain: string;
  path: string;
  expires: Date | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: CookieSameSiteEnum;
}

/** A cookie to add, with every field but `key` / `originURL` optional
 * (happy-dom `IOptionalCookie` shape; the container merges its own defaults). */
export interface IOptionalCookie {
  key: string;
  originURL: string | URL;
  value?: string | null;
  domain?: string;
  path?: string;
  expires?: Date | null;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: CookieSameSiteEnum;
}

/** The `addCookies` rollup (happy-dom `ICookieContainerChangedCookies`). */
export interface ICookieContainerChangedCookies {
  changed: ICookie[];
  deleted: ICookie[];
}

/** The cookie store a `BrowserContext` carries (happy-dom `CookieContainer`
 * parity): `addCookies` replaces cookies by key/origin/path/value-type,
 * `getCookies(url, clientSide)` filters expired / `httpOnly` (when
 * `clientSide`) / non-matching cookies, `clearCookies` empties the store. */
export declare class CookieContainer {
  addCookies(cookies: IOptionalCookie[]): ICookieContainerChangedCookies;
  getCookies(url?: string | URL | null, clientSide?: boolean): ICookie[];
  clearCookies(): void;
}

/** The top-level frame of a browser page: owns the Window facade and performs
 * server-side navigation (`goto`) with session history. */
export declare class BrowserFrame {
  readonly page: BrowserPage;
  readonly window: Window;
  readonly document: Document;
  readonly childFrames: BrowserFrame[];
  readonly parentFrame: BrowserFrame | null;
  readonly closed: boolean;
  url: string;
  content: string;
  goto(url: string, options?: IGoToOptions): Promise<Response | null>;
  goBack(options?: IGoToOptions): Promise<Response | null>;
  goForward(options?: IGoToOptions): Promise<Response | null>;
  goSteps(steps: number, options?: IGoToOptions): Promise<Response | null>;
  reload(options?: IReloadOptions): Promise<Response | null>;
  waitUntilComplete(): Promise<void>;
  waitForNavigation(): Promise<void>;
  abort(): Promise<void>;
  close(): Promise<void>;
  evaluate(script: string | { runInContext(context: unknown): unknown }): any;
}

/** A browser page (tab) with exactly one main frame. */
export declare class BrowserPage {
  readonly virtualConsolePrinter: VirtualConsolePrinter;
  readonly mainFrame: BrowserFrame;
  readonly frames: BrowserFrame[];
  readonly context: BrowserContext;
  readonly viewport: { width: number; height: number; devicePixelRatio: number };
  readonly closed: boolean;
  url: string;
  content: string;
  goto(url: string, options?: IGoToOptions): Promise<Response | null>;
  goBack(options?: IGoToOptions): Promise<Response | null>;
  goForward(options?: IGoToOptions): Promise<Response | null>;
  goSteps(steps: number, options?: IGoToOptions): Promise<Response | null>;
  reload(options?: IReloadOptions): Promise<Response | null>;
  waitUntilComplete(): Promise<void>;
  waitForNavigation(): Promise<void>;
  abort(): Promise<void>;
  close(): Promise<void>;
  evaluate(script: string | { runInContext(context: unknown): unknown }): any;
  setViewport(viewport: { width?: number; height?: number; devicePixelRatio?: number }): void;
}

/** A browser context: the page list, the cookie container and the lifecycle
 * of one context. */
export declare class BrowserContext {
  readonly pages: BrowserPage[];
  readonly browser: Browser;
  readonly closed: boolean;
  /** The context's cookie store (happy-dom parity; cleared by `close`). */
  readonly cookieContainer: CookieContainer;
  newPage(): BrowserPage;
  close(): Promise<void>;
  waitUntilComplete(): Promise<void>;
  abort(): Promise<void>;
}

/** The happy-dom `Browser` surface: settings, contexts, pages and lifecycle. */
export declare class Browser {
  constructor(options?: { settings?: IBrowserSettings; console?: any });
  readonly contexts: BrowserContext[];
  readonly defaultContext: BrowserContext;
  readonly settings: IBrowserSettings;
  readonly console: any;
  readonly closed: boolean;
  newPage(): BrowserPage;
  newIncognitoContext(): BrowserContext;
  close(): Promise<void>;
  waitUntilComplete(): Promise<void>;
  abort(): Promise<void>;
}
