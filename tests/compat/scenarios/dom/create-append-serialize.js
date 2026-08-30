// Real differential scenario (T10): element creation, tree attachment and
// serialization through the public entry of each implementation.
//
// The window-acquisition probe is uniform capability detection on the entry
// object: implementations expose either createWindow() or a Window
// constructor. Since T25, MAD DOM's createElement/createTextNode, tree
// mutation and the attribute/textContent surface work, but the Document-level
// members (body, readyState, serialization) are not implemented yet, so the
// mad-dom side records a facade-phase error at document.body.appendChild and
// reads readyState as undefined. These differences are reported (non-fatal) in
// report mode and tracked as ledger entries.
export const id = "dom-create-append-serialize";
export const description = "real differential: create an element, attach it to body, serialize (mad-dom facade without document body/readyState/serialization)";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;
  api.record.value("entry-create-window-type", typeof entry.createWindow);
  api.record.value("entry-window-type", typeof entry.Window);

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  const document = window.document;
  api.record.value("document-ready-state", document.readyState);

  try {
    const section = document.createElement("section");
    section.setAttribute("class", "diff-probe");
    section.setAttribute("id", "probe");
    section.appendChild(document.createTextNode("differential body"));
    document.body.appendChild(section);

    api.record.snapshot("body", document.body);
    api.record.value("body-child-count", document.body.childNodes.length);
    api.record.identity("body-first-child-is-section", document.body.firstChild, section);
    api.record.identity("query-finds-appended-section", document.querySelector("section#probe"), section);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
