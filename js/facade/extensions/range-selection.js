// `Range` / `Selection` facade extension (T36).
//
// Installs the WHATWG Range and Selection surface: `document.createRange` /
// `document.getSelection`, `window.getSelection`, the `window.Range` /
// `window.Selection` constructor accessors, the `Range` facade class (boundary
// reads, set/select/collapse, the comparisons, clone/extract/delete/insert/
// surround and the stringifier) and the `Selection` facade class (range
// collection, anchor/focus reads, direction and the mutation surface). Every
// method delegates verbatim to the native T36 contract
// (crates/mad-dom-bun/src/extensions/range_api.rs) and through it to the Core
// range algorithms (`mad_dom_core::dom::range`), so the facade keeps **no
// second DOM state** and **no Range/Selection logic**.
//
// # Range/Selection state on the native handle
//
// A range's *position* (the two boundary points) lives in the native
// `RangeHandle` as stable node wrappers plus offsets; the selection's
// associated range and its direction live in the native `SelectionHandle`.
// The facade stores only the configuration the baseline exposes as plain
// properties (none for Range, none beyond the per-document singleton key for
// Selection) and the owner document needed to dispatch `selectionchange`.
//
// # Selection identity
//
// `document.getSelection()` / `window.getSelection()` return one and the same
// facade `Selection` per document: the facade caches the wrapped native
// selection in a WeakMap keyed by the native document handle (the same
// per-document key the T45 platform state uses), so both accessors — and every
// repeated read — hand back the same object, matching the baseline's
// per-document selection singleton.
//
// # selectionchange
//
// Every selection mutator that replaces the associated range fires a
// `selectionchange` event on the owner document (the native handle reports
// whether the range changed, so a no-op `addRange` / `removeAllRanges` on an
// empty selection dispatch nothing), exactly like the baseline.

import { Document } from "../document.js";
import { Event } from "./events.js";
import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/range-selection",
  owner: "T36",
  gate: "T36",
  status: "implemented",
});

// Native handle behind each facade range / selection.
const RANGE_HANDLES = new WeakMap();
const SELECTION_HANDLES = new WeakMap();

// Per-document selection singleton: native document handle → facade Selection,
// plus the owner document facade behind each selection (used to dispatch
// `selectionchange`).
const SELECTIONS = new WeakMap();
const SELECTION_DOC = new WeakMap();

function isRangeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.setStart === "function" &&
    typeof handle.deleteContents === "function" &&
    typeof handle.toString === "function"
  );
}

function isSelectionHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.addRange === "function" &&
    typeof handle.getRangeAt === "function" &&
    typeof handle.setBaseAndExtent === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    throw new TypeError(`Range/Selection.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function facadeDocumentHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isDocumentHandle(handle)) {
    throw new TypeError(`Document.${role} requires a genuine Document facade wrapper`);
  }
  return handle;
}

function isDocumentHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.destroy === "function" &&
    typeof handle.appendChild === "function"
  );
}

/**
 * Dispatches `selectionchange` on the selection's owner document when a
 * mutator reports that the associated range changed.
 */
function dispatchSelectionChange(selection, changed) {
  if (!changed) return;
  const doc = SELECTION_DOC.get(selection);
  if (doc && typeof doc.dispatchEvent === "function") {
    doc.dispatchEvent(new Event("selectionchange"));
  }
}

/**
 * The WHATWG `Range` facade (T36).
 *
 * Construction is restricted: it requires a genuine native range handle (only
 * minted by `document.createRange` / `range.cloneRange` / the selection
 * mutators); anything else throws a `TypeError`.
 */
export class Range {
  static END_TO_END = 2;
  static END_TO_START = 3;
  static START_TO_END = 1;
  static START_TO_START = 0;

  constructor(nativeHandle) {
    if (!isRangeHandle(nativeHandle)) {
      throw new TypeError(
        "Range can only be constructed from a genuine native Range handle",
      );
    }
    RANGE_HANDLES.set(this, nativeHandle);
    // Instance constants match the baseline instance shape.
    this.END_TO_END = Range.END_TO_END;
    this.END_TO_START = Range.END_TO_START;
    this.START_TO_END = Range.START_TO_END;
    this.START_TO_START = Range.START_TO_START;
  }
}

/**
 * The WHATWG `Selection` facade (T36).
 *
 * Construction is restricted like the range: only `document.getSelection` /
 * `window.getSelection` mints a genuine native selection handle.
 */
export class Selection {
  constructor(nativeHandle) {
    if (!isSelectionHandle(nativeHandle)) {
      throw new TypeError(
        "Selection can only be constructed from a genuine native Selection handle",
      );
    }
    SELECTION_HANDLES.set(this, nativeHandle);
  }
}

/**
 * Installs the T36 Range/Selection surface.
 */
export function install(ctx) {
  ctx.registerHandleType("RangeHandle", (handle) => new Range(handle));
  ctx.registerHandleType("SelectionHandle", (handle) => new Selection(handle));

  // Document surface.
  ctx.defineMethod(Document.prototype, "createRange", function createRange() {
    const handle = facadeDocumentHandle(ctx, this, "createRange");
    return ctx.wrap(handle.createRange());
  });

  ctx.defineMethod(Document.prototype, "getSelection", function getSelection() {
    const handle = facadeDocumentHandle(ctx, this, "getSelection");
    let selection = SELECTIONS.get(handle);
    if (selection === undefined) {
      selection = ctx.wrap(handle.getSelection());
      SELECTIONS.set(handle, selection);
      SELECTION_DOC.set(selection, this);
    }
    return selection;
  });

  // Window surface: `window.getSelection` plus the constructor accessors.
  ctx.defineMethod(Window.prototype, "getSelection", function getSelection() {
    const document = this.document;
    if (document === null || document === undefined) return null;
    return document.getSelection();
  });

  ctx.defineAccessor(Window.prototype, "Range", function getRange() {
    return Range;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "Selection", function getSelectionConstructor() {
    return Selection;
  }, undefined);

  // --- Range surface ---

  ctx.defineAccessor(Range.prototype, "startContainer", function startContainer() {
    return ctx.wrap(RANGE_HANDLES.get(this).startContainer());
  }, undefined);

  ctx.defineAccessor(Range.prototype, "startOffset", function startOffset() {
    return RANGE_HANDLES.get(this).startOffset();
  }, undefined);

  ctx.defineAccessor(Range.prototype, "endContainer", function endContainer() {
    return ctx.wrap(RANGE_HANDLES.get(this).endContainer());
  }, undefined);

  ctx.defineAccessor(Range.prototype, "endOffset", function endOffset() {
    return RANGE_HANDLES.get(this).endOffset();
  }, undefined);

  ctx.defineAccessor(Range.prototype, "collapsed", function collapsed() {
    return RANGE_HANDLES.get(this).collapsed();
  }, undefined);

  ctx.defineAccessor(Range.prototype, "commonAncestorContainer", function commonAncestorContainer() {
    return ctx.wrap(RANGE_HANDLES.get(this).commonAncestorContainer());
  }, undefined);

  ctx.defineMethod(Range.prototype, "setStart", function setStart(node, offset = 0) {
    RANGE_HANDLES.get(this).setStart(facadeNodeHandle(ctx, node, "setStart"), offset >>> 0);
  });

  ctx.defineMethod(Range.prototype, "setEnd", function setEnd(node, offset = 0) {
    RANGE_HANDLES.get(this).setEnd(facadeNodeHandle(ctx, node, "setEnd"), offset >>> 0);
  });

  ctx.defineMethod(Range.prototype, "setStartBefore", function setStartBefore(node) {
    RANGE_HANDLES.get(this).setStartBefore(facadeNodeHandle(ctx, node, "setStartBefore"));
  });

  ctx.defineMethod(Range.prototype, "setStartAfter", function setStartAfter(node) {
    RANGE_HANDLES.get(this).setStartAfter(facadeNodeHandle(ctx, node, "setStartAfter"));
  });

  ctx.defineMethod(Range.prototype, "setEndBefore", function setEndBefore(node) {
    RANGE_HANDLES.get(this).setEndBefore(facadeNodeHandle(ctx, node, "setEndBefore"));
  });

  ctx.defineMethod(Range.prototype, "setEndAfter", function setEndAfter(node) {
    RANGE_HANDLES.get(this).setEndAfter(facadeNodeHandle(ctx, node, "setEndAfter"));
  });

  ctx.defineMethod(Range.prototype, "selectNode", function selectNode(node) {
    RANGE_HANDLES.get(this).selectNode(facadeNodeHandle(ctx, node, "selectNode"));
  });

  ctx.defineMethod(Range.prototype, "selectNodeContents", function selectNodeContents(node) {
    RANGE_HANDLES.get(this).selectNodeContents(facadeNodeHandle(ctx, node, "selectNodeContents"));
  });

  ctx.defineMethod(Range.prototype, "collapse", function collapse(toStart = false) {
    RANGE_HANDLES.get(this).collapse(Boolean(toStart));
  });

  ctx.defineMethod(Range.prototype, "compareBoundaryPoints", function compareBoundaryPoints(how, sourceRange) {
    if (!(sourceRange instanceof Range)) {
      throw new TypeError(
        "Failed to execute 'compareBoundaryPoints' on 'Range': parameter 2 is not of type 'Range'.",
      );
    }
    return RANGE_HANDLES.get(this).compareBoundaryPoints(how >>> 0, RANGE_HANDLES.get(sourceRange));
  });

  ctx.defineMethod(Range.prototype, "comparePoint", function comparePoint(node, offset = 0) {
    return RANGE_HANDLES.get(this).comparePoint(facadeNodeHandle(ctx, node, "comparePoint"), offset >>> 0);
  });

  ctx.defineMethod(Range.prototype, "isPointInRange", function isPointInRange(node, offset = 0) {
    return RANGE_HANDLES.get(this).isPointInRange(facadeNodeHandle(ctx, node, "isPointInRange"), offset >>> 0);
  });

  ctx.defineMethod(Range.prototype, "intersectsNode", function intersectsNode(node) {
    return RANGE_HANDLES.get(this).intersectsNode(facadeNodeHandle(ctx, node, "intersectsNode"));
  });

  ctx.defineMethod(Range.prototype, "cloneContents", function cloneContents() {
    return ctx.wrap(RANGE_HANDLES.get(this).cloneContents());
  });

  ctx.defineMethod(Range.prototype, "extractContents", function extractContents() {
    return ctx.wrap(RANGE_HANDLES.get(this).extractContents());
  });

  ctx.defineMethod(Range.prototype, "deleteContents", function deleteContents() {
    RANGE_HANDLES.get(this).deleteContents();
  });

  ctx.defineMethod(Range.prototype, "insertNode", function insertNode(newNode) {
    RANGE_HANDLES.get(this).insertNode(facadeNodeHandle(ctx, newNode, "insertNode"));
  });

  ctx.defineMethod(Range.prototype, "surroundContents", function surroundContents(newParent) {
    RANGE_HANDLES.get(this).surroundContents(facadeNodeHandle(ctx, newParent, "surroundContents"));
  });

  ctx.defineMethod(Range.prototype, "cloneRange", function cloneRange() {
    return ctx.wrap(RANGE_HANDLES.get(this).cloneRange());
  });

  ctx.defineMethod(Range.prototype, "detach", function detach() {
    RANGE_HANDLES.get(this).detach();
  });

  ctx.defineMethod(Range.prototype, "toString", function toString() {
    return RANGE_HANDLES.get(this).toString();
  });

  // --- Selection surface ---

  ctx.defineAccessor(Selection.prototype, "rangeCount", function rangeCount() {
    return SELECTION_HANDLES.get(this).rangeCount();
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "isCollapsed", function isCollapsed() {
    return SELECTION_HANDLES.get(this).isCollapsed();
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "type", function type() {
    return SELECTION_HANDLES.get(this).selectionType();
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "anchorNode", function anchorNode() {
    return ctx.wrap(SELECTION_HANDLES.get(this).anchorNode());
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "anchorOffset", function anchorOffset() {
    return SELECTION_HANDLES.get(this).anchorOffset();
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "baseNode", function baseNode() {
    return ctx.wrap(SELECTION_HANDLES.get(this).anchorNode());
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "baseOffset", function baseOffset() {
    return SELECTION_HANDLES.get(this).anchorOffset();
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "focusNode", function focusNode() {
    return ctx.wrap(SELECTION_HANDLES.get(this).focusNode());
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "focusOffset", function focusOffset() {
    return SELECTION_HANDLES.get(this).focusOffset();
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "extentNode", function extentNode() {
    return ctx.wrap(SELECTION_HANDLES.get(this).focusNode());
  }, undefined);

  ctx.defineAccessor(Selection.prototype, "extentOffset", function extentOffset() {
    return SELECTION_HANDLES.get(this).focusOffset();
  }, undefined);

  ctx.defineMethod(Selection.prototype, "addRange", function addRange(range) {
    if (!(range instanceof Range)) {
      throw new TypeError(
        "Failed to execute 'addRange' on 'Selection': parameter 1 is not of type 'Range'.",
      );
    }
    dispatchSelectionChange(this, SELECTION_HANDLES.get(this).addRange(RANGE_HANDLES.get(range)));
  });

  ctx.defineMethod(Selection.prototype, "getRangeAt", function getRangeAt(index) {
    return ctx.wrap(SELECTION_HANDLES.get(this).getRangeAt(index >>> 0));
  });

  ctx.defineMethod(Selection.prototype, "removeRange", function removeRange(range) {
    if (!(range instanceof Range)) {
      throw new TypeError(
        "Failed to execute 'removeRange' on 'Selection': parameter 1 is not of type 'Range'.",
      );
    }
    dispatchSelectionChange(this, SELECTION_HANDLES.get(this).removeRange(RANGE_HANDLES.get(range)));
  });

  ctx.defineMethod(Selection.prototype, "removeAllRanges", function removeAllRanges() {
    dispatchSelectionChange(this, SELECTION_HANDLES.get(this).removeAllRanges());
  });

  ctx.defineMethod(Selection.prototype, "empty", function empty() {
    dispatchSelectionChange(this, SELECTION_HANDLES.get(this).empty());
  });

  ctx.defineMethod(Selection.prototype, "collapse", function collapse(node, offset = 0) {
    dispatchSelectionChange(
      this,
      SELECTION_HANDLES.get(this).collapse(
        node == null ? null : facadeNodeHandle(ctx, node, "collapse"),
        offset >>> 0,
      ),
    );
  });

  ctx.defineMethod(Selection.prototype, "setPosition", function setPosition(node, offset = 0) {
    dispatchSelectionChange(
      this,
      SELECTION_HANDLES.get(this).setPosition(
        node == null ? null : facadeNodeHandle(ctx, node, "setPosition"),
        offset >>> 0,
      ),
    );
  });

  ctx.defineMethod(Selection.prototype, "collapseToStart", function collapseToStart() {
    dispatchSelectionChange(this, SELECTION_HANDLES.get(this).collapseToStart());
  });

  ctx.defineMethod(Selection.prototype, "collapseToEnd", function collapseToEnd() {
    dispatchSelectionChange(this, SELECTION_HANDLES.get(this).collapseToEnd());
  });

  ctx.defineMethod(Selection.prototype, "extend", function extend(node, offset = 0) {
    dispatchSelectionChange(
      this,
      SELECTION_HANDLES.get(this).extend(facadeNodeHandle(ctx, node, "extend"), offset >>> 0),
    );
  });

  ctx.defineMethod(Selection.prototype, "setBaseAndExtent", function setBaseAndExtent(
    anchorNode,
    anchorOffset,
    focusNode,
    focusOffset,
  ) {
    dispatchSelectionChange(
      this,
      SELECTION_HANDLES.get(this).setBaseAndExtent(
        facadeNodeHandle(ctx, anchorNode, "setBaseAndExtent"),
        anchorOffset >>> 0,
        facadeNodeHandle(ctx, focusNode, "setBaseAndExtent"),
        focusOffset >>> 0,
      ),
    );
  });

  ctx.defineMethod(Selection.prototype, "selectAllChildren", function selectAllChildren(node) {
    dispatchSelectionChange(
      this,
      SELECTION_HANDLES.get(this).selectAllChildren(facadeNodeHandle(ctx, node, "selectAllChildren")),
    );
  });

  ctx.defineMethod(Selection.prototype, "containsNode", function containsNode(node, allowPartialContainment = false) {
    return SELECTION_HANDLES.get(this).containsNode(
      facadeNodeHandle(ctx, node, "containsNode"),
      Boolean(allowPartialContainment),
    );
  });

  ctx.defineMethod(Selection.prototype, "deleteFromDocument", function deleteFromDocument() {
    SELECTION_HANDLES.get(this).deleteFromDocument();
  });

  ctx.defineMethod(Selection.prototype, "toString", function toString() {
    return SELECTION_HANDLES.get(this).toString();
  });
}
