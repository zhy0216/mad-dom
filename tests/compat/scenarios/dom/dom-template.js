// Real differential scenario (T40): HTMLTemplateElement.content.
//
// Scope is exactly the T40 template slice — the template-contents
// DocumentFragment behind `template.content` (stable identity, not an ordinary
// child), the `innerHTML` read/write routing through the fragment, the
// serializer round trip through `document.body.innerHTML`, a programmatic
// `createElement("template")` content, and `cloneNode(deep)` / `importNode`
// carrying the content with the element.
//
// The scenario deliberately avoids the frozen T40 deviation (pinned by the Bun
// tests instead): happy-dom redirects `template.firstChild` / `lastChild` /
// `appendChild` into the content fragment, while MAD DOM's single `Node` class
// shares those methods. All probes below stay on `content`, `innerHTML`,
// serialization and clone/import, where both sides agree observation for
// observation.
export const id = "dom-template";
export const description = "real differential: template content fragment, innerHTML routing, serializer round trip, clone/import";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    // --- parsed template: content is a separate DocumentFragment ---
    document.body.innerHTML = "<template><p>in</p></template>";
    const template = document.body.firstChild;
    api.record.value("content-node-type", template.content.nodeType);
    api.record.value("content-child-count", template.content.childNodes.length);
    api.record.value("element-child-count", template.childNodes.length);
    api.record.value("content-first-child-type", template.content.firstChild?.nodeType ?? null);
    api.record.identity("content-identity", template.content, template.content);

    // --- innerHTML routing through the fragment ---
    api.record.value("inner-html-read", template.innerHTML);
    template.innerHTML = "<span>a</span><b>b</b>";
    api.record.value("inner-html-after-set", template.innerHTML);
    api.record.value("content-child-count-after-set", template.content.childNodes.length);
    api.record.value("element-child-count-after-set", template.childNodes.length);
    api.record.value("body-serialized", document.body.innerHTML);

    // --- outerHTML of a programmatic template ---
    const created = document.createElement("template");
    api.record.value("created-content-type", created.content.nodeType);
    api.record.value("created-content-children", created.content.childNodes.length);
    api.record.value("created-outer-html", created.outerHTML);

    // --- cloneNode(deep) carries the content ---
    const clone = template.cloneNode(true);
    api.record.value("clone-inner-html", clone.innerHTML);
    api.record.value("clone-outer-html", clone.outerHTML);
    api.record.value("clone-content-children", clone.content.childNodes.length);
    api.record.identity("clone-content-distinct", clone.content !== template.content);

    // --- importNode carries the content ---
    const imported = document.importNode(template, true);
    api.record.value("import-outer-html", imported.outerHTML);
    api.record.value("import-content-children", imported.content.childNodes.length);

    // --- round trip through a re-parse in the same document ---
    const serializedBody = document.body.innerHTML;
    document.body.innerHTML = serializedBody;
    api.record.value("round-trip-body", document.body.innerHTML);
    api.record.value("round-trip-template-html", document.body.firstChild.innerHTML);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
