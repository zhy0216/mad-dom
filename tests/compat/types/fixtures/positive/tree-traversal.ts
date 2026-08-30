// T35 positive type fixture: the TreeWalker / NodeIterator / NodeFilter
// surface. Both happy-dom and mad-dom must type-check this file cleanly.
// "dom-under-test" is the virtual module resolving to happy-dom on one target
// and mad-dom (index.d.ts) on the other. The fixture reaches the traversal
// surface through the window/document members (both targets expose the
// classes and the NodeFilter constants there) rather than module-level
// exports.

import type { Document, Node, Window } from "dom-under-test";

declare function getNode(): Node;

export function exercise(doc: Document, root: Node, window: Window): Node | null {
  const showElement: number = window.NodeFilter.SHOW_ELEMENT;
  const showText: number = window.NodeFilter.SHOW_TEXT;
  const accept: number = window.NodeFilter.FILTER_ACCEPT;
  const reject: number = window.NodeFilter.FILTER_REJECT;
  const skip: number = window.NodeFilter.FILTER_SKIP;
  void showElement;
  void showText;
  void accept;
  void reject;
  void skip;

  // A function filter returning the raw FILTER_* number.
  const walker = doc.createTreeWalker(root, window.NodeFilter.SHOW_ELEMENT, (node) =>
    node === root ? window.NodeFilter.FILTER_SKIP : window.NodeFilter.FILTER_ACCEPT,
  );

  // An object filter with acceptNode.
  const iterator = doc.createNodeIterator(root, window.NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.nodeType === window.NodeFilter.SHOW_TEXT
        ? window.NodeFilter.FILTER_ACCEPT
        : window.NodeFilter.FILTER_REJECT;
    },
  });

  // The traversal surface types.
  const next: Node | null = walker.nextNode();
  const previous: Node | null = walker.previousNode();
  const parent: Node | null = walker.parentNode();
  const first: Node | null = walker.firstChild();
  const last: Node | null = walker.lastChild();
  const nextSibling: Node | null = walker.nextSibling();
  const previousSibling: Node | null = walker.previousSibling();
  const iteratorNext: Node | null = iterator.nextNode();
  const iteratorPrevious: Node | null = iterator.previousNode();

  // Property reads and the currentNode write.
  const rootNode: Node = walker.root;
  const mask: number = walker.whatToShow;
  const current = walker.currentNode;
  walker.currentNode = root;
  const iteratorRoot = iterator.root;
  const iteratorMask: number = iterator.whatToShow;

  // The window exposes the constructor accessors and the constants object.
  const walkerConstructor = window.TreeWalker;
  const iteratorConstructor = window.NodeIterator;
  const constants: typeof window.NodeFilter = window.NodeFilter;
  void walkerConstructor;
  void iteratorConstructor;
  void constants;

  return (
    next ??
    previous ??
    parent ??
    first ??
    last ??
    nextSibling ??
    previousSibling ??
    iteratorNext ??
    iteratorPrevious ??
    rootNode ??
    current ??
    iteratorRoot ??
    (mask + iteratorMask > 0 ? getNode() : null)
  );
}

export function checkFilterTypes(filter: unknown, node: Node): number {
  if (filter === null) return 1;
  if (typeof filter === "function") {
    return filter(node);
  }
  if (typeof filter === "object" && filter !== null && "acceptNode" in filter) {
    return (filter as { acceptNode(node: Node): number }).acceptNode(node);
  }
  return 1;
}
