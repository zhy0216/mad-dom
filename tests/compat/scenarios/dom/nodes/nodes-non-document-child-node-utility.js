// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/child-node/NonDocumentChildNodeUtility.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the internal NonDocumentChildNodeUtility getters
// are the implementations of the public `previousElementSibling` /
// `nextElementSibling` members on a Comment child node; the scenario builds the
// sibling tree with `document.createElement` and observes the public getters.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-non-document-child-node-utility";
export const description = "real differential: public previousElementSibling/nextElementSibling on a Comment";
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
    const parent = document.createElement("div");
    const comment = document.createComment("test");
    const element1 = document.createElement("div");
    const element2 = document.createElement("div");

    parent.appendChild(element1);
    parent.appendChild(comment);
    parent.appendChild(element2);

    api.record.value("previous-element-sibling", comment.previousElementSibling === element1);
    api.record.value("next-element-sibling", comment.nextElementSibling === element2);

    // Head / tail return null.
    api.record.value("head-previous", element1.previousElementSibling);
    api.record.value("tail-next", element2.nextElementSibling);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
