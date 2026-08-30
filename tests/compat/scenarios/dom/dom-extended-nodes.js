// Real differential scenario (T33): the extended-node surface.
//
// Scope is exactly the T33 slice — the CharacterData mutators on Text/Comment
// (and, happy-dom parity, on ProcessingInstruction), Text.splitText, the
// clone family (cloneNode / importNode / adoptNode), createProcessingInstruction
// and the nodeType/data/target reads. The observations deliberately use
// data values, lengths, nodeTypes and child counts instead of element
// nodeNames or snapshots: MAD DOM's frozen T23 contract lowercases
// Element.nodeName while happy-dom uppercases it, and happy-dom returns "" for
// ProcessingInstruction.nodeName / target-of-import while MAD DOM is
// spec-correct, so those unrelated divergences must not mask T33 parity. The
// scenario also avoids the frozen error-shape gap (Core violations throw a
// plain Error with an ERR_MAD_DOM_* code, happy-dom throws a DOMException) by
// never probing an error, and the adoptNode identity gap (happy-dom returns
// the same object, MAD DOM a fresh wrapper) by probing tree outcomes only.
export const id = "dom-extended-nodes";
export const description = "real differential: CharacterData data/length/substring/append/insert/delete/replace, splitText, cloneNode/importNode/adoptNode and ProcessingInstruction";
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
  const document = window.document;

  try {
    // Surface presence.
    api.record.value("surface-create-processing-instruction", typeof document.createProcessingInstruction);
    api.record.value("surface-create-comment", typeof document.createComment);
    api.record.value("surface-import-node", typeof document.importNode);
    api.record.value("surface-adopt-node", typeof document.adoptNode);
    api.record.value("surface-clone-node", typeof document.createElement("x").cloneNode);
    api.record.value("surface-split-text", typeof document.createTextNode("x").splitText);
    api.record.value("surface-substring-data", typeof document.createTextNode("x").substringData);
    api.record.value("surface-append-data", typeof document.createTextNode("x").appendData);
    api.record.value("surface-insert-data", typeof document.createTextNode("x").insertData);
    api.record.value("surface-delete-data", typeof document.createTextNode("x").deleteData);
    api.record.value("surface-replace-data", typeof document.createTextNode("x").replaceData);
    api.record.value("surface-comment-substring", typeof document.createComment("x").substringData);
    api.record.value("surface-pi-substring", typeof document.createProcessingInstruction("xml-stylesheet", "d").substringData);

    // CharacterData reads, writes and coercion.
    const text = document.createTextNode("hello world");
    api.record.value("text-data", text.data);
    api.record.value("text-length", text.length);
    api.record.value("text-node-value", text.nodeValue);
    api.record.value("text-data-number", (text.data = 42, text.data));
    api.record.value("text-data-null", (text.data = null, text.data));
    text.data = "hello world";

    api.record.value("substring-mid", text.substringData(6, 5));
    api.record.value("substring-count-clamp", text.substringData(6, 100));
    api.record.value("substring-past-end", text.substringData(100, 5));
    api.record.value("substring-zero-count", text.substringData(3, 0));

    const text2 = document.createTextNode("hello world");
    text2.appendData("!");
    api.record.value("after-append", text2.data);
    text2.insertData(6, "beautiful ");
    api.record.value("after-insert-mid", text2.data);
    text2.insertData(0, "pre");
    api.record.value("after-insert-front", text2.data);
    text2.insertData(3, "MID");
    api.record.value("after-insert-third", text2.data);
    text2.deleteData(0, 5);
    api.record.value("after-delete-front", text2.data);
    text2.replaceData(0, 5, "X");
    api.record.value("after-replace", text2.data);
    api.record.value("length-after-mutations", text2.length);

    // Inserting at the length appends.
    const text3 = document.createTextNode("abc");
    text3.insertData(3, "x");
    api.record.value("insert-at-length", text3.data);
    text3.deleteData(3, 99);
    api.record.value("delete-at-length", text3.data);
    text3.replaceData(3, 99, "Y");
    api.record.value("replace-at-length", text3.data);

    // Comment surface.
    const comment = document.createComment("a comment");
    api.record.value("comment-data", comment.data);
    api.record.value("comment-length", comment.length);
    api.record.value("comment-substring", comment.substringData(2, 4));
    api.record.value("comment-node-type", comment.nodeType);
    comment.appendData("!");
    api.record.value("comment-after-append", comment.data);
    comment.data = 42;
    api.record.value("comment-data-number", comment.data);
    api.record.value("comment-node-value", comment.nodeValue);

    // ProcessingInstruction.
    const pi = document.createProcessingInstruction("xml-stylesheet", "href=x");
    api.record.value("pi-node-type", pi.nodeType);
    api.record.value("pi-target", pi.target);
    api.record.value("pi-data", pi.data);
    api.record.value("pi-length", pi.length);
    api.record.value("pi-parent", pi.parentNode);
    pi.appendData(" type=y");
    api.record.value("pi-after-append", pi.data);
    api.record.value("pi-substring", pi.substringData(0, 7));
    api.record.value("pi-node-value", pi.nodeValue);

    // splitText in a tree.
    const parent = document.createElement("p");
    const splitText = document.createTextNode("abcdef");
    parent.appendChild(splitText);
    const tail = splitText.splitText(3);
    api.record.value("split-head", splitText.data);
    api.record.value("split-tail", tail.data);
    api.record.value("split-head-length", splitText.length);
    api.record.value("split-tail-node-type", tail.nodeType);
    api.record.value("split-parent-child-count", parent.childNodes.length);
    api.record.value("split-tail-parent", tail.parentNode === parent);
    api.record.identity("split-tail-is-second-child", parent.childNodes[1], tail);
    api.record.identity("split-head-next-is-tail", splitText.nextSibling, tail);
    api.record.identity("split-tail-prev-is-head", tail.previousSibling, splitText);

    // splitText at 0 and at the length.
    const splitZero = document.createTextNode("abc");
    const zeroTail = splitZero.splitText(0);
    api.record.value("split-zero-head", splitZero.data);
    api.record.value("split-zero-tail", zeroTail.data);
    const splitLen = document.createTextNode("abc");
    const lenTail = splitLen.splitText(3);
    api.record.value("split-len-head", splitLen.data);
    api.record.value("split-len-tail", lenTail.data);

    // cloneNode.
    const div = document.createElement("div");
    div.setAttribute("id", "a");
    const span = document.createElement("span");
    const spanText = document.createTextNode("hi");
    span.appendChild(spanText);
    div.appendChild(span);

    const shallow = div.cloneNode(false);
    api.record.identity("shallow-clone-distinct", shallow, div);
    api.record.value("shallow-clone-child-count", shallow.childNodes.length);
    api.record.value("shallow-clone-attribute", shallow.getAttribute("id"));
    api.record.value("shallow-clone-parent", shallow.parentNode);

    const deep = div.cloneNode(true);
    api.record.value("deep-clone-child-count", deep.childNodes.length);
    api.record.identity("deep-clone-child-distinct", deep.firstChild, span);
    api.record.identity("deep-clone-text-distinct", deep.firstChild.firstChild, spanText);
    api.record.value("deep-clone-text-data", deep.firstChild.firstChild.data);
    api.record.identity("deep-clone-text-parent", deep.firstChild.firstChild.parentNode, deep.firstChild);

    api.record.value("clone-text-data", document.createTextNode("hi").cloneNode(true).data);
    api.record.value("clone-comment-data", document.createComment("note").cloneNode(true).data);
    api.record.value("clone-pi-data", document.createProcessingInstruction("xml-stylesheet", "d=x").cloneNode(true).data);
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement("x"));
    api.record.value("clone-fragment-deep-count", fragment.cloneNode(true).childNodes.length);
    api.record.value("clone-fragment-shallow-count", fragment.cloneNode(false).childNodes.length);

    // importNode.
    const outer = document.createElement("outer");
    const inner = document.createElement("inner");
    inner.setAttribute("k", "v");
    outer.appendChild(inner);
    const imported = document.importNode(outer, true);
    api.record.identity("import-distinct", imported, outer);
    api.record.value("import-child-count", imported.childNodes.length);
    api.record.value("import-attribute", imported.firstChild.getAttribute("k"));
    api.record.value("import-parent", imported.parentNode);
    api.record.value("source-child-count-after-import", outer.childNodes.length);
    api.record.value("import-shallow-count", document.importNode(outer, false).childNodes.length);
    api.record.value("import-text-data", document.importNode(document.createTextNode("abc"), false).data);
    api.record.value("import-comment-data", document.importNode(document.createComment("cc"), false).data);
    api.record.value("import-pi-data", document.importNode(document.createProcessingInstruction("xml-stylesheet", "d=x"), false).data);

    // adoptNode.
    const secondWindow = new entry.Window();
    const secondDocument = secondWindow.document;
    const container = secondDocument.createElement("container");
    const src = secondDocument.createElement("src");
    const child = secondDocument.createElement("child");
    container.appendChild(src);
    src.appendChild(child);
    const adopted = document.adoptNode(src);
    api.record.value("adopt-node-type", adopted.nodeType);
    api.record.value("adopt-parent", adopted.parentNode);
    api.record.value("adopt-first-child-type", adopted.firstChild.nodeType);
    api.record.value("adopt-source-container-child-count", container.childNodes.length);

    // Same-document adopt returns the same node, detached.
    const sameDoc = document.createElement("x");
    const sameParent = document.createElement("p");
    sameParent.appendChild(sameDoc);
    const adoptedSame = document.adoptNode(sameDoc);
    api.record.identity("adopt-same-doc-identity", adoptedSame, sameDoc);
    api.record.value("adopt-same-doc-parent", sameDoc.parentNode);
    api.record.value("adopt-same-doc-parent-child-count", sameParent.childNodes.length);

    // Detached cross-document adopt keeps the payload.
    const detachedText = secondDocument.createTextNode("t");
    const adoptedText = document.adoptNode(detachedText);
    api.record.value("adopt-text-data", adoptedText.data);
    api.record.value("adopt-text-node-type", adoptedText.nodeType);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
