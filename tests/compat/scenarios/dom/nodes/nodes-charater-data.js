// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/character-data/CharaterData.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the CharacterData public data surface — length,
// data, nodeValue and textContent getters/setters plus cloneNode — is fully
// constructible and observable through `document.createComment` /
// `document.createTextNode`. The spyOn delegation assertions (that a public
// method forwards to the internal CharacterDataUtility /
// NonDocumentChildNodeUtility / ChildNodeUtility helpers) are internal
// implementation detail with no public observation surface and are dropped.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-charater-data";
export const description = "real differential: CharacterData length/data/nodeValue/textContent getters+setters and cloneNode";
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
    const comment = document.createComment("test");
    api.record.value("comment-length", comment.length);
    api.record.value("comment-data", comment.data);

    comment.data = "new text";
    api.record.value("comment-data-set", comment.data);
    comment.data = 0;
    api.record.value("comment-data-number", comment.data);

    const text = document.createTextNode("test");
    text.nodeValue = "new text";
    api.record.value("text-node-value", text.nodeValue);
    text.nodeValue = 0;
    api.record.value("text-node-value-number", text.nodeValue);

    comment.textContent = "new text";
    api.record.value("comment-text-content", comment.textContent);
    comment.textContent = 0;
    api.record.value("comment-text-content-number", comment.textContent);

    comment.textContent = "";
    api.record.value("comment-text-content-empty", comment.textContent);

    const clone = comment.cloneNode();
    api.record.value("clone-data", clone.data);
    api.record.value("clone-is-comment", clone.nodeName);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
