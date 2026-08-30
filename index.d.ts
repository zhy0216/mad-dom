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
// Public DOM facade surface. Windows are minted through `createWindow()`; the
// `Window`/`Document` classes only construct around a genuine native handle
// (throwing TypeError otherwise), so no user-visible path fabricates a
// document. Nodes (creation and navigation), tree mutation
// (append/insert/remove/replace) and the T25 surface — attributes,
// `textContent` and the live `childNodes` `NodeList` — are declared below by
// the T23, T24 and T25 gates.

export declare class Window {
  constructor(nativeHandle: WindowHandle);
  /** The live Document facade of this window (T20 wrapper identity). */
  readonly document: Document;
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
  /** Eagerly destroys the window's document; idempotent. */
  destroy(): void;
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

  /** WHATWG `EventTarget.addEventListener` (T37), registered on the document-root node. */
  addEventListener(type: string, listener: TEventListener | null, options?: boolean | IEventListenerOptions | null): void;
  /** WHATWG `EventTarget.removeEventListener` (T37), matching the registered callback. */
  removeEventListener(type: string, listener: TEventListener | null, options?: boolean | { capture?: boolean } | null): void;
  /** WHATWG `EventTarget.dispatchEvent` (T37): returns `false` when a cancelable event was default-prevented. */
  dispatchEvent(event: Event): boolean;
}

export declare function createWindow(): Window;

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
  /** WHATWG `HTMLElement.dataset` (T39): a live `DOMStringMap` over the element's `data-*` attributes (camelCase keys ↔ kebab-case attribute names). */
  readonly dataset: DOMStringMap;
  /** WHATWG `HTMLElement.click` (T39): dispatches a bubbling, cancelable, composed `click` event on the element. */
  click(): void;
  /** WHATWG `HTMLElement.focus` (T39): makes this element the document's active element and dispatches `focus`/`focusin` (a no-op when detached, inert or already focused). */
  focus(): void;
  /** WHATWG `HTMLElement.blur` (T39): clears the document's active element and dispatches `blur`/`focusout` (a no-op when not the active element). */
  blur(): void;
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
 * query key (`getElementsByTagName` / `getElementsByClassName`) and re-read
 * from Core on every access, so an existing collection reflects later tree and
 * attribute changes immediately (see `live-collections.js`). Numeric index
 * reads and the named getter mirror the WHATWG `HTMLCollection` surface. */
export interface HTMLCollection<T extends Element = Element> {
  /** Live number of matched elements; re-read from Core on every access. */
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
// native boundary as primitives. Methods throw TypeError / Error (with a
// stable `code`) on misuse; the exception taxonomy is T21.

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
  nodeType(): number;
  nodeName(): string;
  parentNode(): NodeHandle | null;
  firstChild(): NodeHandle | null;
  lastChild(): NodeHandle | null;
  previousSibling(): NodeHandle | null;
  nextSibling(): NodeHandle | null;
  childNodes(): NodeHandle[];
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
}
