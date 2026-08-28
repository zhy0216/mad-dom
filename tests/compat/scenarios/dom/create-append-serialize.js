// Real differential scenario (T10): element creation, tree attachment and
// serialization through the public entry of each implementation.
//
// The window-acquisition probe is uniform capability detection on the entry
// object: implementations expose either createWindow() or a Window
// constructor. MAD DOM currently exports createWindow() which throws in
// pre-alpha, so its side records a setup-phase error and stops — a genuine,
// visible compatibility gap that the normalizer must NOT hide. These
// differences are reported (non-fatal) in report mode and become ledger
// entries in T11.
export const id = "dom-create-append-serialize";
export const description = "real differential: create an element, attach it to body, serialize (mad-dom expected to fail at setup for now)";
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

  const section = document.createElement("section");
  section.setAttribute("class", "diff-probe");
  section.setAttribute("id", "probe");
  section.appendChild(document.createTextNode("differential body"));
  document.body.appendChild(section);

  api.record.snapshot("body", document.body);
  api.record.value("body-child-count", document.body.childNodes.length);
  api.record.identity("body-first-child-is-section", document.body.firstChild, section);
  api.record.identity("query-finds-appended-section", document.querySelector("section#probe"), section);
}
