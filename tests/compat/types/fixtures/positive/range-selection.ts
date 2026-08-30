// T36 positive type fixture: the Range / Selection surface. Both happy-dom and
// mad-dom must type-check this file cleanly. "dom-under-test" is the virtual
// module resolving to happy-dom on one target and mad-dom (index.d.ts) on the
// other. The fixture reaches the surface through the document members
// (createRange / getSelection) and the window constructor accessors.

import type { Document, DocumentFragment, Node, Window } from "dom-under-test";

declare function getNode(): Node;

export function exercise(doc: Document, window: Window): string | null {
  // The RangeHow constants on the window constructor value.
  const startToStart: number = window.Range.START_TO_START;
  const startToEnd: number = window.Range.START_TO_END;
  const endToEnd: number = window.Range.END_TO_END;
  const endToStart: number = window.Range.END_TO_START;
  void startToEnd;
  void endToEnd;
  void endToStart;

  // Construction surfaces.
  const range = doc.createRange();
  const selection = doc.getSelection();
  const windowSelection = window.getSelection();
  const rangeConstructor = window.Range;
  const selectionConstructor = window.Selection;
  void rangeConstructor;
  void selectionConstructor;

  // Boundary reads and writes.
  const startContainer: Node = range.startContainer;
  const endContainer: Node = range.endContainer;
  const startOffset: number = range.startOffset;
  const endOffset: number = range.endOffset;
  const collapsed: boolean = range.collapsed;
  const common: Node | null = range.commonAncestorContainer;
  range.setStart(getNode(), 0);
  range.setEnd(getNode(), 1);
  range.setStartBefore(getNode());
  range.setStartAfter(getNode());
  range.setEndBefore(getNode());
  range.setEndAfter(getNode());
  range.selectNode(getNode());
  range.selectNodeContents(getNode());
  range.collapse(true);

  // Comparisons.
  const compared: number = range.compareBoundaryPoints(startToStart, range);
  const point: number = range.comparePoint(getNode(), 0);
  const inRange: boolean = range.isPointInRange(getNode(), 1);
  const intersects: boolean = range.intersectsNode(getNode());

  // Content operations.
  const clonedFragment: DocumentFragment = range.cloneContents();
  const extractedFragment: DocumentFragment = range.extractContents();
  range.deleteContents();
  range.insertNode(getNode());
  range.surroundContents(getNode());
  const clonedRange = range.cloneRange();
  range.detach();
  const text: string = range.toString();

  // Selection collection, direction and reads.
  const count: number = selection.rangeCount;
  const isCollapsed: boolean = selection.isCollapsed;
  const type: string = selection.type;
  const anchorNode: Node | null = selection.anchorNode;
  const anchorOffset: number = selection.anchorOffset;
  const baseNode: Node | null = selection.baseNode;
  const baseOffset: number = selection.baseOffset;
  const focusNode: Node | null = selection.focusNode;
  const focusOffset: number = selection.focusOffset;
  const extentNode: Node | null = selection.extentNode;
  const extentOffset: number = selection.extentOffset;
  selection.addRange(range);
  const at = selection.getRangeAt(0);
  selection.removeRange(at);
  selection.removeAllRanges();
  selection.empty();
  selection.collapse(getNode(), 0);
  selection.setPosition(getNode(), 1);
  selection.collapseToStart();
  selection.collapseToEnd();
  selection.extend(getNode(), 2);
  selection.setBaseAndExtent(getNode(), 0, getNode(), 1);
  selection.selectAllChildren(getNode());
  const contains: boolean = selection.containsNode(getNode(), true);
  selection.deleteFromDocument();
  const selectionText: string = selection.toString();

  return (
    startContainer.nodeName +
    endContainer.nodeName +
    startOffset +
    endOffset +
    collapsed +
    common?.nodeName +
    compared +
    point +
    inRange +
    intersects +
    clonedFragment.nodeName +
    extractedFragment.nodeName +
    text +
    count +
    isCollapsed +
    type +
    anchorNode?.nodeName +
    anchorOffset +
    baseNode?.nodeName +
    baseOffset +
    focusNode?.nodeName +
    focusOffset +
    extentNode?.nodeName +
    extentOffset +
    at.toString() +
    contains +
    selectionText +
    clonedRange.toString() +
    windowSelection.type
  );
}
