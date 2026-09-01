// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-image-element/Image.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public `window.Image` constructor surface —
// the element identity (tagName/localName/namespaceURI/ownerDocument) and the
// width/height attributes minted from the constructor arguments (default 0).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-image";
export const description = "real differential: public window.Image constructor element identity and width/height";
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
    const image = new window.Image();
    api.record.value("width-default", image.width);
    api.record.value("height-default", image.height);
    api.record.value("tagName", image.tagName);
    api.record.value("localName", image.localName);
    api.record.value("namespaceURI", image.namespaceURI);
    api.record.identity("owner-document", image.ownerDocument, document);

    const sized = new window.Image(100, 200);
    api.record.value("width-sized", sized.width);
    api.record.value("height-sized", sized.height);
    api.record.value("width-attr", sized.getAttribute("width"));
    api.record.value("height-attr", sized.getAttribute("height"));
    api.record.value("sized-tagName", sized.tagName);
    api.record.value("sized-localName", sized.localName);
    api.record.value("sized-namespaceURI", sized.namespaceURI);
    api.record.identity("sized-owner-document", sized.ownerDocument, document);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
