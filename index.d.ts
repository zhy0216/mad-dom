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
// document. The remaining DOM surface — mutation, attributes, `textContent`,
// live `childNodes` — lands with T24-T25; nodes (creation and navigation) are
// declared below by the T23 gate.

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
}

export declare function createWindow(): Window;

// --- Node creation and navigation (T23) ------------------------------------
//
// Detached Element/Text nodes are minted through `Document.createElement` /
// `createTextNode` and expose the WHATWG `Node` navigation surface. Every read
// delegates to the Core tree through the native binding — the facade keeps no
// second DOM state, so Core remains the only tree-state source. Mutation,
// attributes, `textContent` and the live `childNodes` facade land with
// T24-T25.

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
  /** Ordered children as a snapshot array; empty for a leaf node (the live `childNodes` facade is T25D's). */
  readonly childNodes: Node[];
}

/** A node minted by `Document.createElement` (T23 surface only). */
export interface Element extends Node {}

/** A node minted by `Document.createTextNode` (T23 surface only). */
export interface Text extends Node {}

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
}
