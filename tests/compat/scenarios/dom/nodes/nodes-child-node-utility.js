// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/child-node/ChildNodeUtility.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the internal ChildNodeUtility static functions
// (remove/replaceWith/before/after) are the implementations of the public
// ChildNode methods of the same name; the scenario drives the public methods
// and observes the resulting `innerHTML`, `children` and `parentNode`. The
// mixed Node + DOMString arguments are exercised as public calls (strings
// become Text nodes, matching the upstream expectations).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-child-node-utility";
export const description = "real differential: public ChildNode remove/replaceWith/before/after with innerHTML readback";
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
    // remove()
    const removeParent = document.createElement("div");
    const removeNode = document.createComment("test");
    removeParent.appendChild(removeNode);
    removeNode.remove();
    api.record.value("remove-parent-null", removeNode.parentNode);
    api.record.value("remove-child-count", removeParent.childNodes.length);

    // replaceWith() a single node
    const replaceParent = document.createElement("div");
    const newChild = document.createElement("span");
    newChild.className = "child4";
    replaceParent.innerHTML =
      '<span class="child1"></span><span class="child2"></span><span class="child3"></span>';
    replaceParent.children[2].replaceWith(newChild);
    api.record.value("replace-inner-html", replaceParent.innerHTML);
    api.record.value(
      "replace-children-html",
      Array.from(replaceParent.children)
        .map((element) => element.outerHTML)
        .join(""),
    );

    // replaceWith() a mixed list of Node and DOMString
    const replaceMixedParent = document.createElement("div");
    const mixedNewChildrenParent = document.createElement("div");
    const mixedTextContent = '<span class="child4"></span>';
    mixedNewChildrenParent.innerHTML =
      '<span class="child5"></span><span class="child6"></span><span class="child7"></span>';
    replaceMixedParent.innerHTML =
      '<span class="child1"></span><span class="child2"></span><span class="child3"></span>';
    replaceMixedParent.children[2].replaceWith(mixedTextContent, ...mixedNewChildrenParent.children);
    api.record.value("replace-mixed-inner-html", replaceMixedParent.innerHTML);
    api.record.value(
      "replace-mixed-children-html",
      Array.from(replaceMixedParent.children)
        .map((element) => element.outerHTML)
        .join(""),
    );

    // before() a single node
    const beforeParent = document.createElement("div");
    const beforeChild = document.createElement("span");
    beforeChild.className = "child4";
    beforeParent.innerHTML =
      '<span class="child1"></span><span class="child2"></span><span class="child3"></span>';
    beforeParent.children[2].before(beforeChild);
    api.record.value("before-inner-html", beforeParent.innerHTML);

    // before() a mixed list
    const beforeMixedParent = document.createElement("div");
    const beforeMixedNewParent = document.createElement("div");
    const beforeMixedText = '<span class="child4"></span>';
    beforeMixedNewParent.innerHTML =
      '<span class="child5"></span><span class="child6"></span><span class="child7"></span>';
    beforeMixedParent.innerHTML =
      '<span class="child1"></span><span class="child2"></span><span class="child3"></span>';
    beforeMixedParent.children[2].before(beforeMixedText, ...beforeMixedNewParent.children);
    api.record.value("before-mixed-inner-html", beforeMixedParent.innerHTML);

    // after() by appending (target is the last child)
    const afterAppendParent = document.createElement("div");
    const afterAppendChild = document.createElement("span");
    afterAppendChild.className = "child4";
    afterAppendParent.innerHTML =
      '<span class="child1"></span><span class="child2"></span><span class="child3"></span>';
    afterAppendParent.children[2].after(afterAppendChild);
    api.record.value("after-append-inner-html", afterAppendParent.innerHTML);

    // after() by inserting (target is a middle child)
    const afterInsertParent = document.createElement("div");
    const afterInsertChild = document.createElement("span");
    afterInsertChild.className = "child4";
    afterInsertParent.innerHTML =
      '<span class="child1"></span><span class="child2"></span><span class="child3"></span>';
    afterInsertParent.children[1].after(afterInsertChild);
    api.record.value("after-insert-inner-html", afterInsertParent.innerHTML);

    // after() a mixed list
    const afterMixedParent = document.createElement("div");
    const afterMixedNewParent = document.createElement("div");
    const afterMixedText = '<span class="child4"></span>';
    afterMixedNewParent.innerHTML =
      '<span class="child5"></span><span class="child6"></span><span class="child7"></span>';
    afterMixedParent.innerHTML =
      '<span class="child1"></span><span class="child2"></span><span class="child3"></span>';
    afterMixedParent.children[2].after(afterMixedText, ...afterMixedNewParent.children);
    api.record.value("after-mixed-inner-html", afterMixedParent.innerHTML);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
