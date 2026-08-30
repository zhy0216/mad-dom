// Real differential scenario (T29): the innerHTML / outerHTML accessors and
// the documentElement / head / body document-structure surface.
//
// Scope is exactly the T29 HTML API slice: the implied skeleton materialized
// by the document-structure accessors, the innerHTML/outerHTML getter/setter
// round trips (including the context-sensitive `table` parse), detached
// outerHTML no-op, the parent-context outerHTML replacement and the
// documentElement serialization. Observations deliberately avoid nodeName
// (the frozen Element.nodeName casing gap, T23A) and the happy-dom-specific
// head/body outerHTML replacement quirks; the Document-level `parseHtml`
// loader is mad-dom-specific and is covered by the Bun tests instead.
export const id = "dom-inner-outer-html";
export const description = "real differential: documentElement/head/body, innerHTML/outerHTML getters and setters (context-sensitive)";
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
    // Document structure accessors: the implied skeleton materializes on the
    // first read and the html element has exactly head + body children.
    api.record.value("document-element-type", document.documentElement && document.documentElement.nodeType);
    api.record.value("head-type", document.head && document.head.nodeType);
    api.record.value("body-type", document.body && document.body.nodeType);
    api.record.value(
      "document-element-child-count",
      document.documentElement ? document.documentElement.childNodes.length : null,
    );
    api.record.identity("document-element-identity", document.documentElement, document.documentElement);
    api.record.identity("body-identity", document.body, document.body);

    // innerHTML setter + getter on the live body.
    document.body.innerHTML = '<div id="a"><p>x</p></div>';
    api.record.value("body-inner-html", document.body.innerHTML);
    api.record.value("body-child-count", document.body.childNodes.length);
    api.record.value("body-first-child-type", document.body.firstChild && document.body.firstChild.nodeType);

    // Context-sensitive parsing: a table target inserts the tbody row group.
    const table = document.createElement("table");
    table.innerHTML = "<tr><td>cell</td></tr>";
    api.record.value("table-inner-html", table.innerHTML);
    api.record.value("table-first-child-type", table.firstChild && table.firstChild.nodeType);

    // Entity round trip and text-only content.
    const p = document.createElement("p");
    p.innerHTML = "a &amp; b &lt; c";
    api.record.value("p-inner-html", p.innerHTML);

    // outerHTML getter; the setter on a detached element is a no-op.
    const section = document.createElement("section");
    section.innerHTML = "<b>bold</b>";
    api.record.value("section-outer-html", section.outerHTML);
    section.outerHTML = "<article id='x'>content</article>";
    api.record.value("section-outer-html-after-set-detached", section.outerHTML);
    api.record.value("section-parent-after-set", section.parentNode);

    // outerHTML setter replaces the element in its parent.
    const host = document.createElement("div");
    host.innerHTML = "<p id='old'>old</p>";
    const oldP = host.firstChild;
    oldP.outerHTML = "<span id='new'>new</span>";
    api.record.value("host-inner-html-after-replace", host.innerHTML);
    api.record.value("host-child-count", host.childNodes.length);

    // The whole document skeleton serializes identically.
    api.record.value("document-element-outer-html", document.documentElement.outerHTML);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
