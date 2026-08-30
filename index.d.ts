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
  /** Eagerly destroys the window's document; idempotent. */
  destroy(): void;
}

export declare class Document {
  constructor(nativeHandle: DocumentHandle);
  /** Eagerly destroys the document; idempotent. */
  destroy(): void;
  /** Creates a new detached Element (WHATWG `createElement`). */
  createElement(name: string): Element;
  /** Creates a new detached Text node (WHATWG `createTextNode`). */
  createTextNode(data: string): Text;
  /** Creates a new empty DocumentFragment (WHATWG `createDocumentFragment`). */
  createDocumentFragment(): DocumentFragment;
  /** The document element (`<html>`); `null` when the document has no root element (T29, implied skeleton on first read). */
  readonly documentElement: Element | null;
  /** The `<head>` element, or `null` (T29, implied skeleton on first read). */
  readonly head: Element | null;
  /** The `<body>` element, or `null` (T29, implied skeleton on first read). */
  readonly body: Element | null;
  /** Replaces the whole document content with a freshly parsed full HTML document (T29). */
  parseHtml(html: string): void;
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
  /** WHATWG `Element.innerHTML` (T29): the serialized children; setting parses in the element's own context and atomically replaces the children. */
  innerHTML: string;
  /** WHATWG `Element.outerHTML` (T29): the serialized element itself; setting parses in the parent's context and atomically replaces the element (a detached element is a no-op). */
  outerHTML: string;
}

/** A node minted by `Document.createTextNode` (T23 surface only). */
export interface Text extends Node {}

/** A node minted by `Document.createDocumentFragment` (T24 surface plus T29 innerHTML). */
export interface DocumentFragment extends Node {
  /** WHATWG `DocumentFragment.innerHTML` (T29): the serialized children; setting parses with the fallback body context and atomically replaces the children. */
  innerHTML: string;
}

/** The T25D live `childNodes` collection bound to one parent node. */
export interface NodeList {
  /** Live number of children; re-read from Core on every access. */
  readonly length: number;
  /** Returns the node at `index`, or `null` past the end (WHATWG `NodeList.item`). */
  item(index: number): Node | null;
  /** Iterates the live children in Core document order (WHATWG `NodeList.forEach`). */
  forEach(callback: (node: Node, index: number, list: NodeList) => void, thisArg?: unknown): void;
  /** Yields `[index, node]` pairs for the live children (WHATWG `NodeList.entries`). */
  entries(): IterableIterator<[number, Node]>;
  /** Yields the indices of the live children (WHATWG `NodeList.keys`). */
  keys(): IterableIterator<number>;
  /** Yields the live children in Core document order (WHATWG `NodeList.values`). */
  values(): IterableIterator<Node>;
  [Symbol.iterator](): IterableIterator<Node>;
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
}
