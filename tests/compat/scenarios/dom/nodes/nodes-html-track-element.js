// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-track-element/HTMLTrackElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLTrackElement surface — the kind
// enum reflection (default "subtitles", invalid → "metadata"), the
// URL-resolved src getter with the raw setter, the srclang/label string
// reflections, the default boolean reflection and the constant readyState.
// The `track` getter (a TextTrack with the TextTrackKindEnum values) is
// dropped — the TextTrack class surface is not implemented.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-track-element";
export const description = "real differential: public HTMLTrackElement kind/src/srclang/label/default/readyState";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window({ url: "https://localhost:8080/test/path/" });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const element = document.createElement("track");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // kind enum reflection.
    api.record.value("kind-default", element.kind);
    element.setAttribute("kind", "subtitles");
    api.record.value("kind-subtitles", element.kind);
    element.setAttribute("kind", "captions");
    api.record.value("kind-captions", element.kind);
    element.setAttribute("kind", "invalid");
    api.record.value("kind-invalid", element.kind);
    element.kind = "subtitles";
    api.record.value("kind-set", element.getAttribute("kind"));
    element.kind = "invalid";
    api.record.value("kind-set-invalid", element.getAttribute("kind"));

    // src getter resolves against the window location; setter writes raw.
    element.setAttribute("src", "test");
    api.record.value("src-relative", element.src);
    element.setAttribute("src", "https://example.com/file.vtt");
    api.record.value("src-absolute", element.src);
    element.removeAttribute("src");
    api.record.value("src-empty", element.src);
    element.src = "test";
    api.record.value("src-set-attr", element.getAttribute("src"));

    // srclang / label reflections.
    api.record.value("srclang-default", element.srclang);
    element.setAttribute("srclang", "test");
    api.record.value("srclang-attr", element.srclang);
    element.srclang = "test";
    api.record.value("srclang-set", element.getAttribute("srclang"));
    api.record.value("label-default", element.label);
    element.setAttribute("label", "test");
    api.record.value("label-attr", element.label);
    element.label = "test";
    api.record.value("label-set", element.getAttribute("label"));

    // default boolean reflection.
    api.record.value("default-default", element.default);
    element.setAttribute("default", "");
    api.record.value("default-attr", element.default);
    element.default = true;
    api.record.value("default-set", element.getAttribute("default"));

    // readyState constant.
    api.record.value("readyState", element.readyState);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
