// Real differential scenario (T36): the Range / Selection surface.
//
// Scope is exactly the T36 slice — document.createRange / getSelection,
// window.getSelection and the Range/Selection constructors, boundary
// validation (set/select/collapse), the comparisons (compareBoundaryPoints /
// comparePoint / isPointInRange / intersectsNode), the content operations
// (cloneContents / extractContents / deleteContents / insertNode /
// surroundContents), cloneRange / detach / commonAncestorContainer, the
// stringifier, the Selection range collection and direction behavior
// (anchor/focus, extend, setBaseAndExtent, selectAllChildren, containsNode,
// deleteFromDocument), the selectionchange event and the error surface.
//
// The observations deliberately avoid every known divergence: they use
// identity keys and nodeType numbers (never element nodeName — the frozen
// T23A casing gap), record error *presence* without name/message (the T21A
// napi4 degradation), never probe descriptor shape, and never compare
// `range.startContainer === document` (the Document facade is a distinct
// object from the document-root node in MAD DOM). Cross-document probes cover
// only the behaviors both implementations agree on: compareBoundaryPoints
// throws for a foreign range, isPointInRange/intersectsNode return false for
// foreign nodes, and the selection collapse/setBaseAndExtent/addRange silently
// ignore foreign nodes.
export const id = "dom-range-selection";
export const description = "real differential: createRange/getSelection, boundary validation, comparisons, clone/extract/delete/insert/surround, stringifier, selection direction and collection";
export const targets = "real";

function thrown(fn) {
  try {
    fn();
    return "no-throw";
  } catch (error) {
    return "threw";
  }
}

export async function run(api) {
  const entry = api.dom;

  const makeWindow = () => {
    try {
      return new entry.Window();
    } catch (error) {
      api.record.error(error, "setup");
      return null;
    }
  };

  const window = makeWindow();
  if (window === null) return;
  const document = window.document;

  try {
    document.body.innerHTML = '<p id="p1">Hello <b>world</b> foo</p>';
    const p = document.getElementById("p1");
    const text = p.childNodes[0];
    const b = p.childNodes[1];
    const bText = b.childNodes[0];

    // 1. Surface presence and the RangeHow constants.
    api.record.value("surface-create-range", typeof document.createRange);
    api.record.value("surface-doc-get-selection", typeof document.getSelection);
    api.record.value("surface-win-get-selection", typeof window.getSelection);
    api.record.value("surface-win-range", typeof window.Range);
    api.record.value("surface-win-selection", typeof window.Selection);
    api.record.value("how-start-to-start", window.Range.START_TO_START);
    api.record.value("how-start-to-end", window.Range.START_TO_END);
    api.record.value("how-end-to-end", window.Range.END_TO_END);
    api.record.value("how-end-to-start", window.Range.END_TO_START);

    // 2. Fresh range: collapsed at the document, offsets zero.
    {
      const r = document.createRange();
      api.record.value("fresh-start-doc-type", r.startContainer.nodeType);
      api.record.value("fresh-end-doc-type", r.endContainer.nodeType);
      api.record.value("fresh-offsets", [r.startOffset, r.endOffset]);
      api.record.value("fresh-collapsed", r.collapsed);
      api.record.value("fresh-tostring", r.toString());
      api.record.value("fresh-constants", [
        r.END_TO_END,
        r.END_TO_START,
        r.START_TO_END,
        r.START_TO_START,
      ]);
    }

    // 3. setStart / setEnd on a text node.
    {
      const r = document.createRange();
      r.setStart(text, 0);
      r.setEnd(text, 3);
      api.record.value("text-range", [
        r.startContainer === text,
        r.endContainer === text,
        r.startOffset,
        r.endOffset,
        r.collapsed,
      ]);
      api.record.value("text-tostring", r.toString());
      api.record.value("text-cac", r.commonAncestorContainer === text);
    }

    // 4. setEnd before the start reverses to a collapsed range.
    {
      const r = document.createRange();
      r.setStart(text, 3);
      r.setEnd(text, 0);
      api.record.value("reversed", [r.startOffset, r.endOffset, r.collapsed, r.toString()]);
    }

    // 5. setStart/setEnd relative to a node (before/after).
    {
      const r = document.createRange();
      r.setStartBefore(b);
      r.setEndAfter(b);
      api.record.value("before-after", [
        r.startContainer === p,
        r.endContainer === p,
        r.startOffset,
        r.endOffset,
        r.toString(),
      ]);
    }

    // 6. selectNode / selectNodeContents.
    {
      const r = document.createRange();
      r.selectNode(b);
      api.record.value("select-node", [
        r.startContainer === p,
        r.endContainer === p,
        r.startOffset,
        r.endOffset,
        r.toString(),
      ]);
      r.selectNodeContents(p);
      api.record.value("select-node-contents", [
        r.startContainer === p,
        r.endContainer === p,
        r.startOffset,
        r.endOffset,
        r.toString(),
      ]);
    }

    // 7. compareBoundaryPoints in all four directions.
    {
      const rA = document.createRange();
      rA.selectNodeContents(p);
      const rB = document.createRange();
      rB.selectNodeContents(b);
      api.record.value("compare-stt", rA.compareBoundaryPoints(window.Range.START_TO_START, rB));
      api.record.value("compare-ste", rA.compareBoundaryPoints(window.Range.START_TO_END, rB));
      api.record.value("compare-ete", rA.compareBoundaryPoints(window.Range.END_TO_END, rB));
      api.record.value("compare-ets", rA.compareBoundaryPoints(window.Range.END_TO_START, rB));
      api.record.value("compare-self", rA.compareBoundaryPoints(window.Range.START_TO_START, rA));
    }

    // 8. comparePoint / isPointInRange / intersectsNode.
    {
      const cp = document.createRange();
      cp.setStart(p, 0);
      cp.setEnd(p, 3);
      api.record.value("compare-point-start", cp.comparePoint(p, 0));
      api.record.value("compare-point-in-text", cp.comparePoint(text, 2));
      api.record.value("compare-point-in-child", cp.comparePoint(b, 0));
      api.record.value("compare-point-after", cp.comparePoint(text, 6));
      api.record.value("is-point-in", cp.isPointInRange(b, 0));
      api.record.value("is-point-out", cp.isPointInRange(text, 6));
      api.record.value("intersects-child", cp.intersectsNode(b));
      api.record.value("intersects-detached", cp.intersectsNode(document.createElement("x")));
      api.record.value("compare-point-badoff", thrown(() => cp.comparePoint(text, 999)));
      api.record.value("is-point-badoff", thrown(() => cp.isPointInRange(text, 999)));
    }

    // 9. cloneContents leaves the tree unchanged.
    {
      const r = document.createRange();
      r.setStart(p, 0);
      r.setEnd(p, 2);
      const fragment = r.cloneContents();
      api.record.value("clone-children", fragment.childNodes.length);
      api.record.value("clone-text", fragment.textContent);
      api.record.value("clone-tree-unchanged", p.textContent);
      api.record.value("clone-range-unchanged", [r.startOffset, r.endOffset]);
    }

    // 10. deleteContents truncates and the offsets clamp (same-node).
    {
      document.body.innerHTML = '<p id="p1">abcdef</p>';
      const p5 = document.getElementById("p1");
      const t5 = p5.childNodes[0];
      const r = document.createRange();
      r.setStart(t5, 1);
      r.setEnd(t5, 4);
      r.deleteContents();
      api.record.value("delete-text", [p5.textContent, r.startContainer === t5, r.startOffset, r.endOffset]);
    }

    // 11. deleteContents collapses a cross-node range.
    {
      document.body.innerHTML = '<p id="p1">abc <b>def</b> ghi</p>';
      const p6 = document.getElementById("p1");
      const r = document.createRange();
      r.setStart(p6, 0);
      r.setEnd(p6, 2);
      r.deleteContents();
      api.record.value("delete-cross", [p6.textContent, r.startContainer === p6, r.startOffset, r.endOffset, r.collapsed]);
    }

    // 12. extractContents (same-node text) returns a clone and truncates.
    {
      document.body.innerHTML = '<p id="p1">abcdef</p>';
      const p7 = document.getElementById("p1");
      const t7 = p7.childNodes[0];
      const r = document.createRange();
      r.setStart(t7, 1);
      r.setEnd(t7, 4);
      const fragment = r.extractContents();
      api.record.value("extract-text", [fragment.childNodes.length, fragment.textContent, p7.textContent, r.startContainer === t7, r.startOffset, r.endOffset]);
    }

    // 13. extractContents (cross-node element range) moves children and
    // collapses the range.
    {
      document.body.innerHTML = '<p id="p1">Hello <b>world</b> foo</p>';
      const p8 = document.getElementById("p1");
      const r = document.createRange();
      r.setStart(p8, 0);
      r.setEnd(p8, 1);
      const fragment = r.extractContents();
      api.record.value("extract-el", [fragment.childNodes.length, fragment.textContent, p8.textContent, r.startContainer === p8, r.startOffset, r.endOffset, r.collapsed]);
    }

    // 14. insertNode at a collapsed text offset splits and inserts.
    {
      document.body.innerHTML = '<p id="p1">abc</p>';
      const p9 = document.getElementById("p1");
      const t9 = p9.childNodes[0];
      const r = document.createRange();
      r.setStart(t9, 2);
      r.collapse(true);
      const em = document.createElement("em");
      em.textContent = "INS";
      r.insertNode(em);
      api.record.value("insert", [p9.textContent, r.startContainer === p9, r.endContainer === p9, r.startOffset, r.endOffset, r.collapsed, r.toString()]);
    }

    // 15. surroundContents wraps the selected contents.
    {
      document.body.innerHTML = '<p id="p1"><b>world</b></p>';
      const p10 = document.getElementById("p1");
      const b10 = p10.childNodes[0];
      const r = document.createRange();
      r.selectNodeContents(b10);
      const wrap = document.createElement("em");
      r.surroundContents(wrap);
      api.record.value("surround", [b10.innerHTML, p10.innerHTML, r.startContainer === b10, r.startOffset, r.endOffset, r.collapsed, r.toString()]);
      api.record.value("surround-partial", thrown(() => {
        document.body.innerHTML = '<p id="p1">a<b>b</b></p>';
        const p11 = document.getElementById("p1");
        const rr = document.createRange();
        rr.setStart(p11.childNodes[0], 0);
        rr.setEnd(p11.childNodes[1], 1);
        rr.surroundContents(document.createElement("em"));
      }));
      api.record.value("surround-doc-parent", thrown(() => {
        document.body.innerHTML = '<p id="p1">x</p>';
        const p12 = document.getElementById("p1");
        const rr = document.createRange();
        rr.selectNodeContents(p12);
        rr.surroundContents(document);
      }));
    }

    // 16. cloneRange / detach.
    {
      const r = document.createRange();
      r.setStart(text, 1);
      r.setEnd(text, 2);
      const clone = r.cloneRange();
      api.record.value("clone-range", [
        clone !== r,
        clone.startContainer === text,
        clone.startOffset,
        clone.endOffset,
      ]);
      r.detach();
      api.record.value("detach", [r.startContainer === text, r.startOffset]);
    }

    // 17. Mutation interplay: a removed container stays readable (no dangling
    // boundary) and offsets clamp after character-data changes.
    {
      document.body.innerHTML = '<p id="p1">abcdef</p>';
      const p13 = document.getElementById("p1");
      const t13 = p13.childNodes[0];
      const r = document.createRange();
      r.setStart(t13, 4);
      r.setEnd(t13, 5);
      t13.data = "a";
      api.record.value("after-data-change", [r.startOffset, r.endOffset, r.toString()]);
      p13.removeChild(t13);
      api.record.value("after-remove", [r.startContainer === t13, r.endContainer === t13, r.startOffset, r.endOffset, r.toString()]);
    }

    // 18. Selection: creation, range collection, anchor/focus and direction.
    {
      document.body.innerHTML = '<p id="p1">Hello <b>world</b></p>';
      const p14 = document.getElementById("p1");
      const t14 = p14.childNodes[0];
      const sel = document.getSelection();
      api.record.value("sel-identity", sel === window.getSelection());
      api.record.value("sel-init", [sel.rangeCount, sel.type, sel.isCollapsed, sel.anchorNode, sel.focusNode, sel.anchorOffset, sel.focusOffset, sel.toString()]);
      const r = document.createRange();
      r.setStart(t14, 0);
      r.setEnd(t14, 2);
      sel.addRange(r);
      api.record.value("sel-after-add", [sel.rangeCount, sel.type, sel.isCollapsed, sel.anchorNode === t14, sel.focusNode === t14, sel.anchorOffset, sel.focusOffset, sel.toString(), sel.baseNode === t14, sel.baseOffset, sel.extentNode === t14, sel.extentOffset]);
      api.record.value("sel-get-range-at", sel.getRangeAt(0) === r);
      api.record.value("sel-get-range-at-bad", thrown(() => sel.getRangeAt(1)));
      sel.extend(t14, 5);
      api.record.value("sel-after-extend", [sel.type, sel.anchorOffset, sel.focusOffset, sel.toString()]);
      sel.extend(p14, 0);
      api.record.value("sel-extend-backwards", [sel.anchorOffset, sel.focusOffset, sel.type, sel.toString()]);
      sel.removeRange(sel.getRangeAt(0));
      api.record.value("sel-after-remove-range", sel.rangeCount);
    }

    // 19. Selection: collapse / setPosition / collapseToStart / End.
    {
      document.body.innerHTML = '<p id="p1">abcdef</p>';
      const p15 = document.getElementById("p1");
      const t15 = p15.childNodes[0];
      const sel = document.getSelection();
      sel.collapse(t15, 3);
      api.record.value("sel-collapse", [sel.rangeCount, sel.type, sel.isCollapsed, sel.anchorNode === t15, sel.anchorOffset]);
      sel.collapseToStart();
      api.record.value("sel-collapse-to-start", [sel.anchorOffset, sel.focusOffset, sel.type]);
      sel.collapseToEnd();
      api.record.value("sel-collapse-to-end", [sel.anchorOffset, sel.focusOffset]);
      sel.setPosition(t15, 1);
      api.record.value("sel-set-position", [sel.anchorOffset, sel.focusOffset]);
      sel.collapse(null);
      api.record.value("sel-collapse-null", sel.rangeCount);
      api.record.value("sel-collapse-to-start-empty", thrown(() => sel.collapseToStart()));
      api.record.value("sel-collapse-to-end-empty", thrown(() => sel.collapseToEnd()));
      api.record.value("sel-badoff", thrown(() => sel.collapse(t15, 999)));
    }

    // 20. Selection: setBaseAndExtent / selectAllChildren / direction.
    {
      document.body.innerHTML = '<p id="p1">Hello <b>world</b></p>';
      const p16 = document.getElementById("p1");
      const t16 = p16.childNodes[0];
      const sel = document.getSelection();
      sel.setBaseAndExtent(t16, 0, t16, 4);
      api.record.value("sel-base-extent", [sel.anchorOffset, sel.focusOffset, sel.toString()]);
      sel.setBaseAndExtent(t16, 4, t16, 1);
      api.record.value("sel-base-extent-back", [sel.anchorOffset, sel.focusOffset, sel.toString(), sel.type]);
      sel.selectAllChildren(p16);
      api.record.value("sel-select-all", [sel.anchorNode === p16, sel.focusNode === p16, sel.anchorOffset, sel.focusOffset, sel.toString()]);
    }

    // 21. Selection: containsNode and deleteFromDocument.
    {
      document.body.innerHTML = '<p id="p1">Hello <b>world</b></p>';
      const p17 = document.getElementById("p1");
      const t17 = p17.childNodes[0];
      const b17 = p17.childNodes[1];
      const sel = document.getSelection();
      sel.setBaseAndExtent(t17, 1, t17, 3);
      api.record.value("sel-contains-inner-strict", sel.containsNode(t17, false));
      api.record.value("sel-contains-child-partial", sel.containsNode(b17, true));
      api.record.value("sel-contains-child-strict", sel.containsNode(b17, false));
      api.record.value("sel-contains-detached", sel.containsNode(document.createElement("x"), true));
      sel.setBaseAndExtent(t17, 1, t17, 3);
      sel.deleteFromDocument();
      api.record.value("sel-after-delete", [p17.textContent, sel.toString()]);
    }

    // 22. selectionchange events fire once per associated-range change.
    {
      document.body.innerHTML = '<p id="p1">abcdef</p>';
      const p18 = document.getElementById("p1");
      const t18 = p18.childNodes[0];
      let events = 0;
      document.addEventListener("selectionchange", () => events++);
      const sel = document.getSelection();
      sel.setBaseAndExtent(t18, 0, t18, 2);
      sel.addRange(sel.getRangeAt(0));
      sel.removeAllRanges();
      sel.removeAllRanges();
      api.record.value("selectionchange-count", events);
    }

    // 23. Error surface: oversized offsets, parentless selectNode.
    {
      document.body.innerHTML = '<p id="p1">abc</p>';
      const p19 = document.getElementById("p1");
      const t19 = p19.childNodes[0];
      const r = document.createRange();
      api.record.value("set-start-badoff", thrown(() => r.setStart(t19, 5)));
      api.record.value("set-end-badoff", thrown(() => r.setEnd(t19, 5)));
      api.record.value("select-node-parentless", thrown(() => r.selectNode(document.createElement("x"))));
      api.record.value("select-node-contents-detached", thrown(() => r.selectNodeContents(document.createElement("x"))));
      api.record.value("set-start-before-parentless", thrown(() => r.setStartBefore(document.createElement("x"))));
      api.record.value("insert-node-comment-start", thrown(() => {
        const c = document.createComment("x");
        const rr = document.createRange();
        rr.setStart(c, 0);
        rr.insertNode(document.createElement("em"));
      }));
    }

    // 24. Cross-document behavior both implementations agree on.
    {
      const other = makeWindow();
      if (other !== null) {
        const otherDoc = other.document;
        const foreignNode = otherDoc.createElement("x");
        const r = document.createRange();
        r.selectNodeContents(p);
        const foreignRange = otherDoc.createRange();
        foreignRange.selectNodeContents(foreignNode);
        api.record.value("cross-compare-boundary", thrown(() => r.compareBoundaryPoints(window.Range.START_TO_START, foreignRange)));
        api.record.value("cross-is-point-in", r.isPointInRange(foreignNode, 0));
        api.record.value("cross-intersects", r.intersectsNode(foreignNode));
        api.record.value("cross-compare-point", thrown(() => r.comparePoint(foreignNode, 0)));
        const sel = document.getSelection();
        sel.collapse(foreignNode, 0);
        api.record.value("cross-sel-collapse", sel.rangeCount);
        sel.setBaseAndExtent(foreignNode, 0, foreignNode, 0);
        api.record.value("cross-sel-sbe", sel.rangeCount);
        sel.addRange(foreignRange);
        api.record.value("cross-sel-add", sel.rangeCount);
        if (typeof other.destroy === "function") other.destroy();
      }
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
