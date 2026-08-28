// Real differential scenario (T10): selector queries, returned-element
// identity relations and event delivery order through the public entry of
// each implementation. Same setup probe and same expected mad-dom setup gap
// as dom-create-append-serialize.
export const id = "dom-query-selector-identity";
export const description = "real differential: querySelectorAll results, element identity across re-queries and bubbling click order";
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
  document.body.innerHTML = '<ul id="list"><li class="item">first</li><li class="item">second</li></ul>';

  const items = document.querySelectorAll("li.item");
  api.record.value("item-count", items.length);
  api.record.identity("requery-returns-same-element", items[0], document.querySelectorAll("li.item")[0]);
  api.record.identity("body-first-child-is-list", document.body.firstChild, document.getElementById("list"));
  api.record.snapshot("list", document.getElementById("list"));

  document.body.addEventListener("click", (event) =>
    api.record.event("click", { target: "body", defaultPrevented: event.defaultPrevented }),
  );
  items[0].addEventListener("click", (event) =>
    api.record.event("click", { target: "li.item:first", defaultPrevented: event.defaultPrevented }),
  );
  items[0].click();
}
