// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/selection/Selection.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: the upstream `new Selection(document)`
// construction of the internal Selection implementation class is replaced by
// the public `document.getSelection()` / `window.getSelection()` singleton
// (the baseline hands back one and the same per-document selection). The
// internal enum imports are inlined as their literal values
// (`SelectionDirectionEnum.forwards = 1` / `backwards = -1`, `NodeTypeEnum
// .documentTypeNode = 10`, `DOMExceptionNameEnum.*` string names).
//
// Narrowed assertion surfaces (documented):
//   - the `document.implementation.createDocumentType(...)` blocks are dropped
//     because mad-dom does not implement `createDocumentType` yet (a separate
//     implementation gap; the underlying `DocumentType`-boundary throw is a
//     Range/Selection boundary validation that cannot be reached publicly);
//   - the Document-node boundary blocks (`selection.collapse(document, 0)`,
//     `extend(document, 0)`, `selectAllChildren(document)`,
//     `setBaseAndExtent(document, 0, …)`) are dropped because mad-dom's
//     Range/Selection boundary helpers accept node handles only and reject the
//     Document facade (a facade gap, not a portability gap);
//   - the Range/Selection error *objects* differ between the sides (happy-dom
//     raises formatted `DOMException` instances, mad-dom surfaces the native
//     CoreError codes as plain `Error`s), so only the throw/no-throw behavior
//     is diffed for the error assertions and the error-formatting gap is noted.
//
// Everything else ports 1:1 through the public selection members.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "selection-selection";
export const description = "real differential: Selection range collection, anchor/focus reads, direction, mutations and selectionchange";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  try {
    const document = window.document;
    const selection = document.getSelection();

    // --- rangeCount ---
    api.record.value("rangeCount-0", selection.rangeCount);
    const range = document.createRange();
    selection.addRange(range);
    api.record.value("rangeCount-1", selection.rangeCount);
    selection.addRange(range);
    api.record.value("rangeCount-dup", selection.rangeCount);
    selection.removeAllRanges();

    // --- isCollapsed / type ---
    api.record.value("isCollapsed-empty", selection.isCollapsed);
    api.record.value("type-none", selection.type);
    selection.addRange(document.createRange());
    api.record.value("type-caret", selection.type);
    api.record.value("isCollapsed-caret", selection.isCollapsed);
    selection.removeAllRanges();

    const start = document.createElement("div");
    const end = document.createElement("div");
    document.body.appendChild(start);
    document.body.appendChild(end);
    const range2 = document.createRange();
    range2.setStart(start, 0);
    range2.setEnd(end, 0);
    selection.addRange(range2);
    api.record.value("type-range", selection.type);

    // --- anchor / base / focus / extent nodes and offsets (forward) ---
    api.record.value("anchor-node-forward", selection.anchorNode === start);
    api.record.value("base-node-forward", selection.baseNode === start);
    api.record.value("focus-node-forward", selection.focusNode === end);
    api.record.value("extent-node-forward", selection.extentNode === end);
    api.record.value("anchor-offset-forward", selection.anchorOffset);
    api.record.value("base-offset-forward", selection.baseOffset);
    api.record.value("focus-offset-forward", selection.focusOffset);
    api.record.value("extent-offset-forward", selection.extentOffset);
    api.record.value("anchor-offset-0-when-text", selection.anchorOffset);
    api.record.value("end-container-range", range2.endContainer === end);
    api.record.value("start-container-range", range2.startContainer === start);

    // --- null getters when no range ---
    selection.removeAllRanges();
    api.record.value("anchor-node-null", selection.anchorNode === null);
    api.record.value("base-node-null", selection.baseNode === null);
    api.record.value("focus-node-null", selection.focusNode === null);
    api.record.value("extent-node-null", selection.extentNode === null);
    api.record.value("anchor-offset-null", selection.anchorOffset);
    api.record.value("base-offset-null", selection.baseOffset);
    api.record.value("focus-offset-null", selection.focusOffset);
    api.record.value("extent-offset-null", selection.extentOffset);

    // --- direction: backwards after extend() ---
    const extend = document.createElement("div");
    document.body.insertBefore(extend, start);
    const backwardsRange = document.createRange();
    backwardsRange.setStart(start, 0);
    backwardsRange.setEnd(end, 0);
    selection.addRange(backwardsRange);
    selection.extend(extend, 0);
    api.record.value("anchor-node-backwards", selection.anchorNode === selection.getRangeAt(0).endContainer);
    api.record.value("focus-node-backwards", selection.focusNode === selection.getRangeAt(0).startContainer);
    api.record.value("extent-node-backwards", selection.extentNode === selection.getRangeAt(0).startContainer);
    api.record.value("anchor-offset-backwards", selection.anchorOffset === selection.getRangeAt(0).endOffset);
    api.record.value("focus-offset-backwards", selection.focusOffset === selection.getRangeAt(0).startOffset);
    selection.removeAllRanges();

    // --- addRange ---
    const r1 = document.createRange();
    selection.addRange(r1);
    api.record.value("add-range-identity", selection.getRangeAt(0) === r1);
    const r2b = document.createRange();
    selection.addRange(r2b);
    api.record.value("add-range-second-ignored", selection.rangeCount);
    api.record.value("add-range-first-kept", selection.getRangeAt(0) === r1);
    selection.removeAllRanges();

    // --- addRange from another document is ignored ---
    const otherSelection = new entry.Window().document.getSelection();
    const otherRange = new entry.Window().document.createRange();
    otherSelection.addRange(otherRange);
    selection.addRange(otherRange);
    api.record.value("add-range-other-document", selection.rangeCount);

    // --- addRange fires selectionchange ---
    selection.removeAllRanges();
    let triggered = null;
    document.addEventListener("selectionchange", (event) => (triggered = event));
    selection.addRange(document.createRange());
    api.record.value("selectionchange-bubbles", triggered !== null && triggered.bubbles);
    api.record.value("selectionchange-cancelable", triggered !== null && triggered.cancelable);
    selection.removeAllRanges();

    // --- getRangeAt ---
    const getRangeRange = document.createRange();
    selection.addRange(getRangeRange);
    api.record.value("get-range-at-0", selection.getRangeAt(0) === getRangeRange);
    let getRangeAt1Threw = false;
    try {
      selection.getRangeAt(1);
    } catch (error) {
      getRangeAt1Threw = true;
    }
    api.record.value("get-range-at-1", getRangeAt1Threw);
    selection.removeAllRanges();
    let getRangeAtEmptyThrew = false;
    try {
      selection.getRangeAt(0);
    } catch (error) {
      getRangeAtEmptyThrew = true;
    }
    api.record.value("get-range-at-empty", getRangeAtEmptyThrew);

    // --- removeRange ---
    const removeRange1 = document.createRange();
    selection.addRange(removeRange1);
    selection.removeRange(removeRange1);
    api.record.value("remove-range-count", selection.rangeCount);
    let removeAbsentThrew = false;
    try {
      selection.removeRange(removeRange1);
    } catch (error) {
      removeAbsentThrew = true;
    }
    api.record.value("remove-range-absent", removeAbsentThrew);
    const removeRange2 = document.createRange();
    selection.addRange(removeRange1);
    let removeMismatchThrew = false;
    try {
      selection.removeRange(removeRange2);
    } catch (error) {
      removeMismatchThrew = true;
    }
    api.record.value("remove-range-mismatch", removeMismatchThrew);
    selection.removeAllRanges();

    // --- removeRange fires selectionchange ---
    triggered = null;
    const rr = document.createRange();
    selection.addRange(rr);
    document.addEventListener("selectionchange", (event) => (triggered = event));
    selection.removeRange(rr);
    api.record.value("remove-range-selectionchange", triggered !== null && !triggered.bubbles && !triggered.cancelable);
    selection.removeAllRanges();

    // --- removeAllRanges / empty ---
    for (const method of ["removeAllRanges", "empty"]) {
      triggered = null;
      selection.addRange(document.createRange());
      document.addEventListener("selectionchange", (event) => (triggered = event));
      selection[method]();
      api.record.value(`clear-${method}-count`, selection.rangeCount);
      api.record.value(`clear-${method}-event`, triggered !== null && !triggered.bubbles && !triggered.cancelable);
    }

    // --- collapse / setPosition ---
    for (const method of ["collapse", "setPosition"]) {
      selection.addRange(document.createRange());
      selection[method](null, 0);
      api.record.value(`collapse-${method}-null`, selection.rangeCount);

      const text = document.createTextNode("Text");
      let offsetTooBigThrew = false;
      try {
        selection[method](text, 5);
      } catch (error) {
        offsetTooBigThrew = true;
      }
      api.record.value(`collapse-${method}-offset-too-big`, offsetTooBigThrew);

      selection[method](text, 2);
      const newRange = selection.getRangeAt(0);
      api.record.value(`collapse-${method}-applied`, newRange.startContainer === text && newRange.startOffset === 2 && newRange.endOffset === 2);

      triggered = null;
      document.addEventListener("selectionchange", (event) => (triggered = event));
      selection[method](text, 2);
      api.record.value(`collapse-${method}-event`, triggered !== null && !triggered.bubbles && !triggered.cancelable);

      selection.removeAllRanges();
    }

    // --- collapseToEnd / collapseToStart ---
    const startText = document.createTextNode("start");
    const endText = document.createTextNode("end");
    document.body.appendChild(startText);
    document.body.appendChild(endText);
    const cteRange = document.createRange();
    cteRange.setStart(startText, 1);
    cteRange.setEnd(endText, 2);
    selection.addRange(cteRange);
    selection.collapseToEnd();
    api.record.value("collapse-to-end-applied", (() => {
      const nr = selection.getRangeAt(0);
      return nr.startContainer === endText && nr.startOffset === 2 && nr.endOffset === 2;
    })());
    selection.removeAllRanges();
    let collapseToEndEmptyThrew = false;
    try {
      selection.collapseToEnd();
    } catch (error) {
      collapseToEndEmptyThrew = true;
    }
    api.record.value("collapse-to-end-empty", collapseToEndEmptyThrew);

    triggered = null;
    selection.addRange(document.createRange());
    document.addEventListener("selectionchange", (event) => (triggered = event));
    selection.collapseToEnd();
    api.record.value("collapse-to-end-event", triggered !== null && !triggered.bubbles && !triggered.cancelable);
    selection.removeAllRanges();

    const ctsRange = document.createRange();
    ctsRange.setStart(startText, 1);
    ctsRange.setEnd(endText, 2);
    selection.addRange(ctsRange);
    selection.collapseToStart();
    api.record.value("collapse-to-start-applied", (() => {
      const nr = selection.getRangeAt(0);
      return nr.startContainer === startText && nr.startOffset === 1 && nr.endOffset === 1;
    })());
    selection.removeAllRanges();
    let collapseToStartEmptyThrew = false;
    try {
      selection.collapseToStart();
    } catch (error) {
      collapseToStartEmptyThrew = true;
    }
    api.record.value("collapse-to-start-empty", collapseToStartEmptyThrew);
    triggered = null;
    selection.addRange(document.createRange());
    document.addEventListener("selectionchange", (event) => (triggered = event));
    selection.collapseToStart();
    api.record.value("collapse-to-start-event", triggered !== null && !triggered.bubbles && !triggered.cancelable);
    selection.removeAllRanges();

    // --- containsNode ---
    const nodeA = document.createTextNode("nodeA");
    const nodeB = document.createTextNode("nodeB");
    const nodeC = document.createTextNode("nodeC");
    document.body.appendChild(nodeA);
    document.body.appendChild(nodeC);
    document.body.insertBefore(nodeB, nodeC);
    const cnRange = document.createRange();
    cnRange.setStart(startText, 1);
    cnRange.setEnd(endText, 2);
    selection.addRange(cnRange);
    api.record.value("contains-node-inside", selection.containsNode(nodeB));
    api.record.value("contains-node-outside", selection.containsNode(nodeC));
    api.record.value("contains-node-partial", selection.containsNode(nodeC, true));
    selection.removeAllRanges();

    // --- deleteFromDocument ---
    selection.deleteFromDocument();
    api.record.value("delete-from-document-noop", true);
    const before = document.createTextNode("before");
    const delStart = document.createTextNode("start");
    const delEnd = document.createTextNode("end");
    const after = document.createTextNode("after");
    document.body.appendChild(before);
    document.body.appendChild(delStart);
    document.body.appendChild(delEnd);
    document.body.appendChild(after);
    const delRange = document.createRange();
    delRange.setStart(delStart, 1);
    delRange.setEnd(delEnd, 2);
    selection.addRange(delRange);
    selection.deleteFromDocument();
    api.record.value("delete-from-document-html", document.body.innerHTML);

    // --- extend ---
    const extBefore = document.createTextNode("before");
    const extStart = document.createTextNode("start");
    const extEnd = document.createTextNode("end");
    const extAfter = document.createTextNode("after");
    document.body.appendChild(extBefore);
    document.body.appendChild(extStart);
    document.body.appendChild(extEnd);
    document.body.appendChild(extAfter);
    const extRange = document.createRange();
    extRange.setStart(extStart, 1);
    extRange.setEnd(extEnd, 2);
    selection.addRange(extRange);
    selection.extend(extAfter, 3);
    selection.deleteFromDocument();
    api.record.value("extend-delete-html", document.body.innerHTML);
    selection.removeAllRanges();

    let extendEmptyThrew = false;
    try {
      selection.extend(document.createTextNode("after"), 3);
    } catch (error) {
      extendEmptyThrew = true;
    }
    api.record.value("extend-empty", extendEmptyThrew);

    const extendEventText = document.createTextNode("text");
    document.body.appendChild(extendEventText);
    const extEventRange = document.createRange();
    extEventRange.setStart(extStart, 1);
    extEventRange.setEnd(extEnd, 2);
    triggered = null;
    selection.addRange(extEventRange);
    document.addEventListener("selectionchange", (event) => (triggered = event));
    selection.extend(extendEventText, 1);
    api.record.value("extend-event", triggered !== null && !triggered.bubbles && !triggered.cancelable);
    selection.removeAllRanges();


    // --- selectAllChildren ---
    const container = document.createElement("div");
    const text1 = document.createTextNode("text1");
    const text2 = document.createTextNode("text2");
    const text3 = document.createTextNode("text3");
    container.appendChild(text1);
    container.appendChild(text2);
    container.appendChild(text3);
    selection.selectAllChildren(container);
    api.record.value("select-all-children", (() => {
      const nr = selection.getRangeAt(0);
      return nr.startContainer === container && nr.startOffset === 0 && nr.endContainer === container && nr.endOffset === 3;
    })());
    selection.removeAllRanges();


    triggered = null;
    const sacContainer = document.createElement("div");
    sacContainer.appendChild(document.createTextNode("child"));
    document.addEventListener("selectionchange", (event) => (triggered = event));
    selection.selectAllChildren(sacContainer);
    api.record.value("select-all-children-event", triggered !== null && !triggered.bubbles && !triggered.cancelable);
    selection.removeAllRanges();

    // --- setBaseAndExtent ---
    const sbaStart = document.createTextNode("start");
    const sbaEnd = document.createTextNode("end");
    document.body.appendChild(sbaStart);
    document.body.appendChild(sbaEnd);
    selection.setBaseAndExtent(sbaStart, 1, sbaEnd, 2);
    api.record.value("set-base-extent-forward", (() => {
      const nr = selection.getRangeAt(0);
      return nr.startContainer === sbaStart && nr.startOffset === 1 && nr.endContainer === sbaEnd && nr.endOffset === 2 && selection.anchorNode === nr.startContainer;
    })());
    selection.removeAllRanges();

    selection.setBaseAndExtent(sbaEnd, 2, sbaStart, 1);
    api.record.value("set-base-extent-backward", (() => {
      const nr = selection.getRangeAt(0);
      return nr.startContainer === sbaStart && nr.startOffset === 1 && nr.endContainer === sbaEnd && nr.endOffset === 2 && selection.anchorNode === nr.endContainer;
    })());
    selection.removeAllRanges();


    let anchorOffsetThrew = false;
    try {
      selection.setBaseAndExtent(sbaStart, 6, sbaEnd, 2);
    } catch (error) {
      anchorOffsetThrew = true;
    }
    api.record.value("set-base-extent-anchor-offset", anchorOffsetThrew);
    let focusOffsetThrew = false;
    try {
      selection.setBaseAndExtent(sbaStart, 1, sbaEnd, 4);
    } catch (error) {
      focusOffsetThrew = true;
    }
    api.record.value("set-base-extent-focus-offset", focusOffsetThrew);

    triggered = null;
    document.addEventListener("selectionchange", (event) => (triggered = event));
    selection.setBaseAndExtent(sbaStart, 1, sbaEnd, 2);
    api.record.value("set-base-extent-event", triggered !== null && !triggered.bubbles && !triggered.cancelable);
    selection.removeAllRanges();

    // --- toString ---
    api.record.value("toString-empty", selection.toString());
    const tsBefore = document.createTextNode("before");
    const tsStart = document.createTextNode("start");
    const tsEnd = document.createTextNode("end");
    const tsAfter = document.createTextNode("after");
    document.body.appendChild(tsBefore);
    document.body.appendChild(tsStart);
    document.body.appendChild(tsEnd);
    document.body.appendChild(tsAfter);
    const tsRange = document.createRange();
    tsRange.setStart(tsStart, 1);
    tsRange.setEnd(tsEnd, 2);
    selection.addRange(tsRange);
    api.record.value("toString-text", selection.toString());
    selection.removeAllRanges();
  } catch (error) {
    api.record.error(error, "facade");
  }
}
