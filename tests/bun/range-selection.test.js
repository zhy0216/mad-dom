import { describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Document } from "../../js/facade/document.js";
import { Range, Selection } from "../../js/facade/extensions/range-selection.js";
import { Node } from "../../js/facade/extensions/node.js";
import { Window } from "../../js/facade/window.js";

// T36 Range / Selection integration tests.
//
// They drive the complete Range/Selection surface through the official package
// entry (index.js → js/entry.js) and the facade classes and pin the acceptance
// criteria:
//
//   - boundary validation — setStart/setEnd and the before/after variants,
//     selectNode/selectNodeContents, collapse, and the error surface (an
//     oversized offset throws ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS, a parentless
//     selectNode throws ERR_MAD_DOM_HIERARCHY);
//   - comparisons — compareBoundaryPoints returns -1/0/1 in all four
//     directions, comparePoint/isPointInRange/intersectsNode agree;
//   - content operations — cloneContents copies without mutating,
//     extractContents/deleteContents remove and collapse (or truncate for a
//     same-node text range), insertNode splits and inserts, surroundContents
//     wraps and re-selects the new parent;
//   - stringification — toString over text and mixed trees;
//   - mutation interplay — offsets clamp after character-data changes and a
//     removed container stays readable (no dangling boundary);
//   - Selection — per-document identity (document.getSelection ===
//     window.getSelection), the range collection (addRange / getRangeAt
//     identity / removeRange / removeAllRanges / empty), the anchor/focus and
//     direction reads (extend, setBaseAndExtent backwards), selectAllChildren,
//     containsNode, deleteFromDocument and toString;
//   - selectionchange — fires once per associated-range change;
//   - errors — a non-Range argument throws a TypeError, and a destroyed
//     document fails every Core-touching surface per T21.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function build(window) {
  window.document.body.innerHTML = '<p id="p1">Hello <b>world</b> foo</p>';
  const doc = window.document;
  const p = doc.getElementById("p1");
  return {
    doc,
    p,
    text: p.childNodes[0],
    b: p.childNodes[1],
    bText: p.childNodes[1].childNodes[0],
  };
}

describe("T36 Range/Selection surface shape", () => {
  test("the facade installs createRange/getSelection with frozen descriptors", () => {
    for (const name of ["createRange", "getSelection"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
      expect(descriptor, `Document.${name}`).toBeDefined();
      expect(typeof descriptor.value, `Document.${name}`).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
      expect(descriptor.writable).toBe(false);
    }
    for (const name of [
      "startContainer",
      "startOffset",
      "endContainer",
      "endOffset",
      "collapsed",
      "commonAncestorContainer",
    ]) {
      expect(Object.getOwnPropertyDescriptor(Range.prototype, name), `Range.${name}`).toBeDefined();
    }
    for (const name of [
      "setStart",
      "setEnd",
      "setStartBefore",
      "setStartAfter",
      "setEndBefore",
      "setEndAfter",
      "selectNode",
      "selectNodeContents",
      "collapse",
      "compareBoundaryPoints",
      "comparePoint",
      "isPointInRange",
      "intersectsNode",
      "cloneContents",
      "extractContents",
      "deleteContents",
      "insertNode",
      "surroundContents",
      "cloneRange",
      "detach",
      "toString",
    ]) {
      expect(typeof Range.prototype[name], `Range.${name}`).toBe("function");
    }
    for (const name of [
      "rangeCount",
      "isCollapsed",
      "type",
      "anchorNode",
      "anchorOffset",
      "focusNode",
      "focusOffset",
    ]) {
      expect(Object.getOwnPropertyDescriptor(Selection.prototype, name), `Selection.${name}`).toBeDefined();
    }
    for (const name of [
      "addRange",
      "getRangeAt",
      "removeRange",
      "removeAllRanges",
      "empty",
      "collapse",
      "setPosition",
      "collapseToStart",
      "collapseToEnd",
      "extend",
      "setBaseAndExtent",
      "selectAllChildren",
      "containsNode",
      "deleteFromDocument",
      "toString",
    ]) {
      expect(typeof Selection.prototype[name], `Selection.${name}`).toBe("function");
    }
    // Window surface accessors.
    expect(Object.getOwnPropertyDescriptor(Window.prototype, "Range")).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(Window.prototype, "Selection")).toBeDefined();
    expect(typeof Window.prototype.getSelection).toBe("function");
  });

  test("Range exposes the RangeHow constants on the class and instances", () => {
    expect(Range.START_TO_START).toBe(0);
    expect(Range.START_TO_END).toBe(1);
    expect(Range.END_TO_END).toBe(2);
    expect(Range.END_TO_START).toBe(3);
    const win = createWindow();
    try {
      const r = win.document.createRange();
      expect(r.START_TO_START).toBe(0);
      expect(r.START_TO_END).toBe(1);
      expect(r.END_TO_END).toBe(2);
      expect(r.END_TO_START).toBe(3);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T36 Range boundary and comparisons", () => {
  test("a fresh range is collapsed at the document root", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      const r = doc.createRange();
      expect(r.startContainer.nodeType).toBe(9);
      expect(r.endContainer.nodeType).toBe(9);
      expect(r.startOffset).toBe(0);
      expect(r.endOffset).toBe(0);
      expect(r.collapsed).toBe(true);
      expect(r.toString()).toBe("");
    } finally {
      win.destroy();
    }
  });

  test("setStart/setEnd select a text slice", () => {
    const win = createWindow();
    try {
      const { doc, text } = build(win);
      const r = doc.createRange();
      r.setStart(text, 0);
      r.setEnd(text, 3);
      expect(r.startContainer).toBe(text);
      expect(r.endContainer).toBe(text);
      expect(r.startOffset).toBe(0);
      expect(r.endOffset).toBe(3);
      expect(r.collapsed).toBe(false);
      expect(r.toString()).toBe("Hel");
      expect(r.commonAncestorContainer).toBe(text);
    } finally {
      win.destroy();
    }
  });

  test("setEnd before the start collapses at the earlier point", () => {
    const win = createWindow();
    try {
      const { doc, text } = build(win);
      const r = doc.createRange();
      r.setStart(text, 3);
      r.setEnd(text, 0);
      expect(r.startOffset).toBe(0);
      expect(r.endOffset).toBe(0);
      expect(r.collapsed).toBe(true);
    } finally {
      win.destroy();
    }
  });

  test("selectNode and selectNodeContents set the boundary points", () => {
    const win = createWindow();
    try {
      const { doc, p, b } = build(win);
      const r = doc.createRange();
      r.selectNode(b);
      expect(r.startContainer).toBe(p);
      expect(r.endContainer).toBe(p);
      expect(r.startOffset).toBe(1);
      expect(r.endOffset).toBe(2);
      expect(r.toString()).toBe("world");
      r.selectNodeContents(p);
      expect(r.startOffset).toBe(0);
      expect(r.endOffset).toBe(3);
      expect(r.toString()).toBe("Hello world foo");
    } finally {
      win.destroy();
    }
  });

  test("setStartBefore/After and setEndBefore/After address the sibling offsets", () => {
    const win = createWindow();
    try {
      const { doc, p, b } = build(win);
      const r = doc.createRange();
      r.setStartBefore(b);
      r.setEndAfter(b);
      expect(r.startContainer).toBe(p);
      expect(r.endContainer).toBe(p);
      expect(r.startOffset).toBe(1);
      expect(r.endOffset).toBe(2);
      expect(r.toString()).toBe("world");
    } finally {
      win.destroy();
    }
  });

  test("compareBoundaryPoints returns -1/0/1 in all four directions", () => {
    const win = createWindow();
    try {
      const { doc, p, b } = build(win);
      const rA = doc.createRange();
      rA.selectNodeContents(p);
      const rB = doc.createRange();
      rB.selectNodeContents(b);
      expect(rA.compareBoundaryPoints(win.Range.START_TO_START, rB)).toBe(-1);
      expect(rA.compareBoundaryPoints(win.Range.START_TO_END, rB)).toBe(1);
      expect(rA.compareBoundaryPoints(win.Range.END_TO_END, rB)).toBe(1);
      expect(rA.compareBoundaryPoints(win.Range.END_TO_START, rB)).toBe(-1);
      expect(rA.compareBoundaryPoints(win.Range.START_TO_START, rA)).toBe(0);
    } finally {
      win.destroy();
    }
  });

  test("comparePoint / isPointInRange / intersectsNode agree", () => {
    const win = createWindow();
    try {
      const { doc, p, text, b } = build(win);
      // A range over the whole paragraph: every descendant position is inside.
      const r = doc.createRange();
      r.setStart(p, 0);
      r.setEnd(p, 3);
      expect(r.comparePoint(p, 0)).toBe(0);
      expect(r.comparePoint(b, 0)).toBe(0);
      expect(r.comparePoint(text, 6)).toBe(0);
      expect(r.isPointInRange(b, 0)).toBe(true);
      expect(r.isPointInRange(text, 6)).toBe(true);
      expect(r.intersectsNode(b)).toBe(true);
      // A detached node of the same document intersects (baseline behavior).
      expect(r.intersectsNode(doc.createElement("x"))).toBe(true);
      // A sub-range of the leading text: an offset past the end is "after".
      const r2 = doc.createRange();
      r2.setStart(text, 1);
      r2.setEnd(text, 3);
      expect(r2.comparePoint(text, 4)).toBe(1);
      expect(r2.comparePoint(text, 0)).toBe(-1);
      expect(r2.isPointInRange(text, 5)).toBe(false);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T36 Range content operations", () => {
  test("cloneContents copies without mutating the tree", () => {
    const win = createWindow();
    try {
      const { doc, p } = build(win);
      const r = doc.createRange();
      r.setStart(p, 0);
      r.setEnd(p, 2);
      const fragment = r.cloneContents();
      expect(fragment.childNodes.length).toBe(2);
      expect(fragment.textContent).toBe("Hello world");
      expect(p.textContent).toBe("Hello world foo");
      expect(r.startOffset).toBe(0);
      expect(r.endOffset).toBe(2);
    } finally {
      win.destroy();
    }
  });

  test("deleteContents truncates a same-node text range without collapsing", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      doc.body.innerHTML = '<p id="p1">abcdef</p>';
      const p = doc.getElementById("p1");
      const t = p.childNodes[0];
      const r = doc.createRange();
      r.setStart(t, 1);
      r.setEnd(t, 4);
      r.deleteContents();
      expect(p.textContent).toBe("aef");
      expect(r.startContainer).toBe(t);
      expect(r.startOffset).toBe(1);
      expect(r.endOffset).toBe(3);
    } finally {
      win.destroy();
    }
  });

  test("deleteContents collapses a cross-node range", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      doc.body.innerHTML = '<p id="p1">abc <b>def</b> ghi</p>';
      const p = doc.getElementById("p1");
      const r = doc.createRange();
      r.setStart(p, 0);
      r.setEnd(p, 2);
      r.deleteContents();
      expect(p.textContent).toBe(" ghi");
      expect(r.startContainer).toBe(p);
      expect(r.startOffset).toBe(0);
      expect(r.endOffset).toBe(0);
      expect(r.collapsed).toBe(true);
    } finally {
      win.destroy();
    }
  });

  test("extractContents moves the selected contents into a fragment", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      doc.body.innerHTML = '<p id="p1">abcdef</p>';
      const p = doc.getElementById("p1");
      const t = p.childNodes[0];
      const r = doc.createRange();
      r.setStart(t, 1);
      r.setEnd(t, 4);
      const fragment = r.extractContents();
      expect(fragment.childNodes.length).toBe(1);
      expect(fragment.textContent).toBe("bcd");
      expect(p.textContent).toBe("aef");
      expect(r.startContainer).toBe(t);
      expect(r.startOffset).toBe(1);
      expect(r.endOffset).toBe(3);
    } finally {
      win.destroy();
    }
  });

  test("extractContents over an element range collapses the range", () => {
    const win = createWindow();
    try {
      const { doc, p } = build(win);
      const r = doc.createRange();
      r.setStart(p, 0);
      r.setEnd(p, 1);
      const fragment = r.extractContents();
      expect(fragment.childNodes.length).toBe(1);
      expect(fragment.textContent).toBe("Hello ");
      expect(p.textContent).toBe("world foo");
      expect(r.startContainer).toBe(p);
      expect(r.startOffset).toBe(0);
      expect(r.endOffset).toBe(0);
      expect(r.collapsed).toBe(true);
    } finally {
      win.destroy();
    }
  });

  test("insertNode splits a text container and moves the collapsed end", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      doc.body.innerHTML = '<p id="p1">abc</p>';
      const p = doc.getElementById("p1");
      const t = p.childNodes[0];
      const r = doc.createRange();
      r.setStart(t, 2);
      r.collapse(true);
      const em = doc.createElement("em");
      em.textContent = "INS";
      r.insertNode(em);
      expect(p.textContent).toBe("abINSc");
      expect(r.startContainer).toBe(t);
      expect(r.endContainer).toBe(p);
      expect(r.startOffset).toBe(2);
      expect(r.endOffset).toBe(2);
      expect(r.toString()).toBe("INS");
    } finally {
      win.destroy();
    }
  });

  test("surroundContents wraps the contents and re-selects the new parent", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      doc.body.innerHTML = '<p id="p1"><b>world</b></p>';
      const p = doc.getElementById("p1");
      const b = p.childNodes[0];
      const r = doc.createRange();
      r.selectNodeContents(b);
      const wrap = doc.createElement("em");
      r.surroundContents(wrap);
      expect(b.innerHTML).toBe("<em>world</em>");
      expect(p.innerHTML).toBe("<b><em>world</em></b>");
      expect(r.startContainer).toBe(b);
      expect(r.startOffset).toBe(0);
      expect(r.endOffset).toBe(1);
      expect(r.toString()).toBe("world");
    } finally {
      win.destroy();
    }
  });

  test("cloneRange copies the boundary points and detach is a no-op", () => {
    const win = createWindow();
    try {
      const { doc, text } = build(win);
      const r = doc.createRange();
      r.setStart(text, 1);
      r.setEnd(text, 2);
      const clone = r.cloneRange();
      expect(clone).not.toBe(r);
      expect(clone.startContainer).toBe(text);
      expect(clone.startOffset).toBe(1);
      expect(clone.endOffset).toBe(2);
      r.detach();
      expect(r.startContainer).toBe(text);
      expect(r.startOffset).toBe(1);
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T36 mutation interplay", () => {
  test("offsets clamp after a character-data change", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      doc.body.innerHTML = '<p id="p1">abcdef</p>';
      const p = doc.getElementById("p1");
      const t = p.childNodes[0];
      const r = doc.createRange();
      r.setStart(t, 4);
      r.setEnd(t, 5);
      t.data = "a";
      expect(r.startOffset).toBe(1);
      expect(r.endOffset).toBe(1);
      expect(r.toString()).toBe("");
    } finally {
      win.destroy();
    }
  });

  test("a removed container stays readable (no dangling boundary)", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      doc.body.innerHTML = '<p id="p1">abcdef</p>';
      const p = doc.getElementById("p1");
      const t = p.childNodes[0];
      const r = doc.createRange();
      r.setStart(t, 1);
      r.setEnd(t, 2);
      p.removeChild(t);
      expect(r.startContainer).toBe(t);
      expect(r.endContainer).toBe(t);
      expect(r.startOffset).toBe(1);
      expect(r.endOffset).toBe(2);
      expect(r.toString()).toBe("b");
      expect(t.parentNode).toBeNull();
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T36 Selection", () => {
  test("document and window expose one Selection per document", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      const sel = doc.getSelection();
      expect(sel).toBe(win.getSelection());
      expect(sel).toBe(doc.getSelection());
      expect(sel.rangeCount).toBe(0);
      expect(sel.type).toBe("None");
      expect(sel.isCollapsed).toBe(true);
      expect(sel.anchorNode).toBeNull();
      expect(sel.focusNode).toBeNull();
      expect(sel.anchorOffset).toBe(0);
      expect(sel.toString()).toBe("");
    } finally {
      win.destroy();
    }
  });

  test("addRange / getRangeAt / removeRange / removeAllRanges manage the range", () => {
    const win = createWindow();
    try {
      const { doc, text } = build(win);
      const sel = doc.getSelection();
      const r = doc.createRange();
      r.setStart(text, 0);
      r.setEnd(text, 2);
      sel.addRange(r);
      expect(sel.rangeCount).toBe(1);
      expect(sel.type).toBe("Range");
      expect(sel.anchorNode).toBe(text);
      expect(sel.anchorOffset).toBe(0);
      expect(sel.focusNode).toBe(text);
      expect(sel.focusOffset).toBe(2);
      expect(sel.toString()).toBe("He");
      expect(sel.baseNode).toBe(text);
      expect(sel.baseOffset).toBe(0);
      expect(sel.extentNode).toBe(text);
      expect(sel.extentOffset).toBe(2);
      expect(sel.getRangeAt(0)).toBe(r);
      sel.removeRange(r);
      expect(sel.rangeCount).toBe(0);
      sel.addRange(r);
      sel.empty();
      expect(sel.rangeCount).toBe(0);
      sel.addRange(r);
      sel.removeAllRanges();
      expect(sel.rangeCount).toBe(0);
      expect(sel.type).toBe("None");
    } finally {
      win.destroy();
    }
  });

  test("extend moves the focus and tracks the direction", () => {
    const win = createWindow();
    try {
      const { doc, p, text } = build(win);
      const sel = doc.getSelection();
      const r = doc.createRange();
      r.setStart(text, 0);
      r.setEnd(text, 2);
      sel.addRange(r);
      sel.extend(text, 5);
      expect(sel.anchorOffset).toBe(0);
      expect(sel.focusOffset).toBe(5);
      expect(sel.toString()).toBe("Hello");
      // Extending backwards to p@0 re-anchors both boundaries at the earlier
      // point (the anchor was at text@0, so the direction flips backwards).
      sel.extend(p, 0);
      expect(sel.anchorOffset).toBe(0);
      expect(sel.focusOffset).toBe(0);
      expect(sel.type).toBe("Range");
      expect(sel.toString()).toBe("");
    } finally {
      win.destroy();
    }
  });

  test("setBaseAndExtent and selectAllChildren set the direction", () => {
    const win = createWindow();
    try {
      const { doc, p, text } = build(win);
      const sel = doc.getSelection();
      sel.setBaseAndExtent(text, 0, text, 4);
      expect(sel.anchorOffset).toBe(0);
      expect(sel.focusOffset).toBe(4);
      expect(sel.toString()).toBe("Hell");
      sel.setBaseAndExtent(text, 4, text, 1);
      expect(sel.anchorOffset).toBe(4);
      expect(sel.focusOffset).toBe(1);
      expect(sel.toString()).toBe("ell");
      sel.selectAllChildren(p);
      expect(sel.anchorNode).toBe(p);
      expect(sel.focusNode).toBe(p);
      expect(sel.anchorOffset).toBe(0);
      expect(sel.focusOffset).toBe(3);
      expect(sel.toString()).toBe("Hello world foo");
    } finally {
      win.destroy();
    }
  });

  test("collapse / setPosition / collapseToStart / collapseToEnd", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      doc.body.innerHTML = '<p id="p1">abcdef</p>';
      const p = doc.getElementById("p1");
      const t = p.childNodes[0];
      const sel = doc.getSelection();
      sel.collapse(t, 3);
      expect(sel.rangeCount).toBe(1);
      expect(sel.type).toBe("Caret");
      expect(sel.anchorOffset).toBe(3);
      expect(sel.isCollapsed).toBe(true);
      sel.collapseToStart();
      expect(sel.anchorOffset).toBe(3);
      sel.collapseToEnd();
      expect(sel.anchorOffset).toBe(3);
      sel.setPosition(t, 1);
      expect(sel.anchorOffset).toBe(1);
      sel.collapse(null);
      expect(sel.rangeCount).toBe(0);
      expect(thrown(() => sel.collapseToStart())).toBeDefined();
      expect(thrown(() => sel.collapseToEnd())).toBeDefined();
    } finally {
      win.destroy();
    }
  });

  test("containsNode and deleteFromDocument", () => {
    const win = createWindow();
    try {
      const { doc, p, text, b } = build(win);
      const sel = doc.getSelection();
      sel.setBaseAndExtent(text, 1, text, 3);
      expect(sel.containsNode(text, false)).toBe(false);
      expect(sel.containsNode(b, true)).toBe(true);
      expect(sel.containsNode(b, false)).toBe(false);
      sel.setBaseAndExtent(text, 1, text, 3);
      sel.deleteFromDocument();
      expect(p.textContent).toBe("Hlo world foo");
      expect(sel.toString()).toBe("lo");
    } finally {
      win.destroy();
    }
  });

  test("selectionchange fires once per associated-range change", () => {
    const win = createWindow();
    try {
      const { doc, text } = build(win);
      let events = 0;
      doc.addEventListener("selectionchange", () => events++);
      const sel = doc.getSelection();
      const r = doc.createRange();
      r.setStart(text, 0);
      r.setEnd(text, 2);
      sel.addRange(r);
      expect(events).toBe(1);
      sel.addRange(r);
      expect(events).toBe(1, "re-adding the current range dispatches nothing");
      sel.removeAllRanges();
      expect(events).toBe(2);
      sel.removeAllRanges();
      expect(events).toBe(2, "clearing an empty selection dispatches nothing");
    } finally {
      win.destroy();
    }
  });
});

describe.skipIf(!nativeAvailable)("T36 errors", () => {
  test("oversized offsets and parentless selectNode throw the frozen codes", () => {
    const win = createWindow();
    try {
      const { doc, text } = build(win);
      const r = doc.createRange();
      const offsetError = thrown(() => r.setStart(text, 999));
      expect(offsetError).toBeDefined();
      expect(offsetError.code).toBe("ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS");
      const parentless = thrown(() => r.selectNode(doc.createElement("x")));
      expect(parentless).toBeDefined();
      expect(parentless.code).toBe("ERR_MAD_DOM_HIERARCHY");
      const getRangeAtError = thrown(() => doc.getSelection().getRangeAt(0));
      expect(getRangeAtError).toBeDefined();
      expect(getRangeAtError.code).toBe("ERR_MAD_DOM_INDEX_OUT_OF_BOUNDS");
    } finally {
      win.destroy();
    }
  });

  test("non-Range arguments throw a TypeError", () => {
    const win = createWindow();
    try {
      const { doc } = build(win);
      const r = doc.createRange();
      const sel = doc.getSelection();
      expect(thrown(() => sel.addRange({})), "addRange").toBeInstanceOf(TypeError);
      expect(thrown(() => sel.removeRange({})), "removeRange").toBeInstanceOf(TypeError);
      expect(thrown(() => r.compareBoundaryPoints(0, {})), "compareBoundaryPoints").toBeInstanceOf(TypeError);
    } finally {
      win.destroy();
    }
  });

  test("a destroyed document fails every Core-touching surface per T21", () => {
    const win = createWindow();
    const { doc, text } = build(win);
    const r = doc.createRange();
    r.setStart(text, 0);
    r.setEnd(text, 2);
    const sel = doc.getSelection();
    sel.addRange(r);
    win.destroy();
    // Core-touching operations fail with the frozen lifecycle error; the pure
    // state reads (rangeCount, the stored anchor/focus wrappers) keep working.
    for (const op of [
      () => r.startOffset,
      () => r.collapsed,
      () => r.toString(),
      () => r.setStart(text, 0),
      () => r.deleteContents(),
      () => sel.type,
      () => sel.anchorOffset,
      () => sel.toString(),
    ]) {
      const error = thrown(op);
      expect(error).toBeDefined();
      expect(error.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
    expect(sel.rangeCount).toBe(1);
    expect(sel.anchorNode).toBe(text);
  });

  test("a foreign range fails compareBoundaryPoints with WrongDocument", () => {
    const win = createWindow();
    const other = createWindow();
    try {
      const { doc, p } = build(win);
      other.document.body.innerHTML = "<x></x>";
      const foreignRange = other.document.createRange();
      foreignRange.selectNodeContents(other.document.body.firstChild);
      const r = doc.createRange();
      r.selectNodeContents(p);
      const error = thrown(() => r.compareBoundaryPoints(win.Range.START_TO_START, foreignRange));
      expect(error).toBeDefined();
      expect(error.code).toBe("ERR_MAD_DOM_WRONG_DOCUMENT");
      expect(r.isPointInRange(other.document.body, 0)).toBe(false);
      expect(r.intersectsNode(other.document.body)).toBe(false);
      const sel = doc.getSelection();
      sel.collapse(other.document.body, 0);
      expect(sel.rangeCount).toBe(0);
      sel.addRange(foreignRange);
      expect(sel.rangeCount).toBe(0);
    } finally {
      win.destroy();
      other.destroy();
    }
  });
});
