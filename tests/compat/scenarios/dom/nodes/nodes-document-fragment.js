// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/document-fragment/DocumentFragment.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public DocumentFragment surface — children /
// childElementCount / firstElementChild / lastElementChild / textContent and
// the appendChild/removeChild/insertBefore/cloneNode tree operations, plus the
// DocumentFragment move semantics (its children are spliced instead of the
// fragment itself). The spyOn delegation tests (ParentNodeUtility /
// QuerySelector / NodeList forwarding) are internal implementation detail and
// dropped.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-document-fragment";
export const description = "real differential: DocumentFragment children/element getters, textContent, tree mutation and cloneNode";
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
    const documentFragment = document.createDocumentFragment();
    const div = document.createElement("div");
    const span = document.createElement("span");

    // Element child getters with text interleaved.
    documentFragment.appendChild(document.createTextNode("test"));
    documentFragment.appendChild(div);
    documentFragment.appendChild(document.createTextNode("test"));
    documentFragment.appendChild(span);

    api.record.value(
      "children",
      Array.from(documentFragment.children, (child) => child.nodeName),
    );
    api.record.value("child-element-count", documentFragment.childElementCount);
    api.record.value("first-element-child", documentFragment.firstElementChild === div);
    api.record.value("last-element-child", documentFragment.lastElementChild === span);

    // textContent read (concatenates descendant text).
    const textFragment = document.createDocumentFragment();
    const textDiv = document.createElement("div");
    textDiv.appendChild(document.createTextNode("text1"));
    textFragment.appendChild(textDiv);
    textFragment.appendChild(document.createTextNode("text2"));
    api.record.value("text-content", textFragment.textContent);

    // textContent write replaces children.
    const writeFragment = document.createDocumentFragment();
    writeFragment.appendChild(document.createElement("div"));
    writeFragment.appendChild(document.createTextNode("text1"));
    writeFragment.appendChild(document.createTextNode("text2"));
    writeFragment.textContent = "new_text";
    api.record.value("text-content-write", writeFragment.textContent);
    api.record.value("text-content-write-child-count", writeFragment.childNodes.length);
    api.record.value("text-content-write-child", writeFragment.childNodes[0].textContent);

    // textContent = "" removes all children.
    writeFragment.textContent = "";
    api.record.value("text-content-empty-child-count", writeFragment.childNodes.length);

    // appendChild / removeChild / insertBefore keep `children` in sync.
    const mut = document.createDocumentFragment();
    const div1 = document.createElement("div");
    const div2 = document.createElement("div");
    const spanEl = document.createElement("span");
    mut.appendChild(document.createComment("test"));
    mut.appendChild(div1);
    mut.appendChild(document.createComment("test"));
    mut.appendChild(spanEl);
    api.record.value(
      "append-children",
      Array.from(mut.children, (child) => child.nodeName),
    );

    mut.removeChild(div1);
    api.record.value(
      "remove-children",
      Array.from(mut.children, (child) => child.nodeName),
    );

    const insertDiv = document.createElement("div");
    mut.appendChild(spanEl);
    mut.insertBefore(insertDiv, spanEl);
    api.record.value(
      "insert-children",
      Array.from(mut.children, (child) => child.nodeName),
    );

    // cloneNode deep / shallow.
    const cloneSource = document.createDocumentFragment();
    cloneSource.appendChild(document.createTextNode("test"));
    cloneSource.appendChild(document.createElement("div"));
    cloneSource.appendChild(document.createComment("test"));

    const shallow = cloneSource.cloneNode(false);
    api.record.value("shallow-node-type", shallow.nodeType);
    api.record.value("shallow-child-count", shallow.childNodes.length);

    const deep = cloneSource.cloneNode(true);
    api.record.value("deep-node-type", deep.nodeType);
    api.record.value("deep-child-count", deep.childNodes.length);
    api.record.value(
      "deep-children",
      Array.from(deep.children, (child) => child.nodeName),
    );

    // DocumentFragment move semantics on appendChild (children spliced, not the
    // fragment).
    const template = document.createElement("template");
    template.innerHTML = "<div>Div</div><span>Span</span>";
    const moveFragment = template.content.cloneNode(true);
    const host = document.createElement("div");
    host.appendChild(moveFragment);
    api.record.value("move-fragment-child-count", moveFragment.childNodes.length);
    api.record.value("move-fragment-children-count", moveFragment.children.length);
    api.record.value("move-host-inner-html", host.innerHTML);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
