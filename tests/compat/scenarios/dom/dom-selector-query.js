// Real differential scenario (T31): the selector query surface.
//
// Scope is exactly the T31 query slice — querySelector / querySelectorAll /
// matches / closest / getElementById, document-order results and the static
// querySelectorAll snapshot — with no events (T37), no descriptor probes
// (prototype layout is a recorded facade gap) and no nodeName / snapshot
// observations (the frozen Element.nodeName casing gap, T23A). Syntax-error
// observations are deliberately absent too: MAD DOM's napi4 error degradation
// (a plain Error carrying ERR_MAD_DOM_SYNTAX vs happy-dom's real SyntaxError)
// is a recorded T21A gap and is covered by the Bun tests instead.
//
// The observations use nodeType, getAttribute and outerHTML so the T23A casing
// gap can never mask query parity, and the static NodeList snapshot behaviour
// is pinned: a captured collection is unaffected by a later mutation while a
// fresh query reflects it.
export const id = "dom-selector-query";
export const description = "real differential: querySelector/querySelectorAll/matches/closest/getElementById, document order and the static NodeList snapshot";
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
    document.body.innerHTML =
      '<ul id="list"><li class="item" data-i="0">first</li>' +
      '<li class="item" data-i="1">second</li><li data-i="2">third</li></ul>';

    // querySelectorAll: count, document order and per-element attribute reads.
    const items = document.querySelectorAll("li.item");
    api.record.value("item-count", items.length);
    api.record.value("item-order", Array.from(items, (li) => li.getAttribute("data-i")));
    api.record.value("item-types", Array.from(items, (li) => li.nodeType));
    api.record.value("no-result-count", document.querySelectorAll("li.missing").length);
    api.record.value("no-result-item", document.querySelectorAll("li.missing").item(0));

    // querySelector: the first match, then no match.
    const first = document.querySelector("li.item");
    api.record.value("first-match", first && first.getAttribute("data-i"));
    api.record.value("no-match", document.querySelector("li.missing"));

    // getElementById: finds the list and reports its direct children.
    const list = document.getElementById("list");
    api.record.value("list-type", list && list.nodeType);
    api.record.value("list-child-count", list ? list.childNodes.length : null);

    // Identity relations across entry points.
    api.record.identity("list-query-vs-get-element-by-id", document.querySelector("#list"), list);
    api.record.identity("first-item-vs-query", items[0], document.querySelector("li.item"));
    api.record.identity("requery-same-element", items[0], document.querySelectorAll("li.item")[0]);

    // matches / closest on a matched element.
    const second = items[1];
    api.record.value("second-matches-item", second.matches("li.item"));
    api.record.value("second-matches-other", second.matches("div"));
    api.record.value("closest-list-id", second.closest("ul") && second.closest("ul").getAttribute("id"));
    api.record.value("closest-self", second.closest("li.item") && second.closest("li.item").getAttribute("data-i"));
    api.record.value("closest-none", second.closest("table"));

    // Element-scoped query: descendants only, the scope itself is not a match.
    api.record.value("list-scoped-li-count", list.querySelectorAll("li").length);
    api.record.value("list-scoped-ul-match", list.querySelector("ul"));

    // Static snapshot: a captured collection is unaffected by a later mutation;
    // a fresh query reflects it.
    const captured = document.querySelectorAll("li.item");
    const before = captured.length;
    document.querySelector('[data-i="0"]').parentNode.removeChild(document.querySelector('[data-i="0"]'));
    api.record.value("captured-before-mutation", before);
    api.record.value("captured-after-mutation", captured.length);
    api.record.value("captured-first-still-readable", captured[0].getAttribute("data-i"));
    api.record.value("fresh-query-after-mutation", document.querySelectorAll("li.item").length);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
