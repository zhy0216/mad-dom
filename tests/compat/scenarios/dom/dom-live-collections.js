// Real differential scenario (T32): the live element collection surface.
//
// Scope is exactly the T32 slice — getElementsByTagName / getElementsByClassName
// returning a live HTMLCollection with the length / item / namedItem / named
// getter / iteration / identity semantics, document order and the live "re-read
// on every access" behaviour — with no events (T37), no descriptor probes
// (prototype layout is a recorded facade gap) and no nodeName / snapshot
// observations (the frozen Element.nodeName casing gap, T23A).
//
// Class-name edge cases are deliberately absent too: happy-dom throws a
// DOMException for empty / whitespace / leading-trailing-space class strings
// (it builds a `.`-prefixed CSS selector), while MAD DOM follows the WHATWG
// and returns an empty collection; that deviation is pinned by the Bun tests
// instead of the differential scenario.
//
// The observations use getAttribute("data-i") / getAttribute("id") and
// nodeType so the T23A casing gap can never mask collection parity, and the
// live semantics are pinned: an existing collection reflects a later attribute
// or tree mutation while a fresh query agrees.
export const id = "dom-live-collections";
export const description = "real differential: live getElementsByTagName/getElementsByClassName, the HTMLCollection read surface (length/item/namedItem/named getter/iteration) and live re-read semantics";
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
    document.body.innerHTML =
      '<ul id="list" name="menu">' +
      '<li class="item a" data-i="0">first</li>' +
      '<li class="item b" data-i="1">second</li>' +
      '<li data-i="2">third</li>' +
      '<span class="item a" id="tail" data-i="3">fourth</span>' +
      "</ul><p class=\"a\">p</p>";

    // Tag queries: counts, case-insensitivity, `*`, document order via data-i.
    const divs = document.getElementsByTagName("div");
    api.record.value("tag-div-count", divs.length);
    api.record.value("tag-div-uppercase", document.getElementsByTagName("DIV").length);
    api.record.value("tag-li-count", document.getElementsByTagName("li").length);
    api.record.value(
      "tag-li-order",
      Array.from(document.getElementsByTagName("li"), (li) => li.getAttribute("data-i")),
    );
    api.record.value("tag-star-count", document.getElementsByTagName("*").length);
    api.record.value("tag-missing-count", document.getElementsByTagName("table").length);

    // Class queries: single and multiple tokens.
    api.record.value("class-a-count", document.getElementsByClassName("a").length);
    api.record.value("class-item-count", document.getElementsByClassName("item").length);
    api.record.value("class-item-a-count", document.getElementsByClassName("item a").length);
    api.record.value("class-missing-count", document.getElementsByClassName("zzz").length);

    // HTMLCollection read surface.
    const items = document.getElementsByClassName("item");
    api.record.value("items-length", items.length);
    api.record.value("items-item-0", items.item(0).getAttribute("data-i"));
    api.record.value("items-item-99", items.item(99));
    api.record.value("items-item-minus-1", items.item(-1));
    api.record.value("items-index-1", items[1].getAttribute("data-i"));
    api.record.value("items-index-99", items[99]);

    // namedItem by id / name and the named getter.
    const uls = document.getElementsByTagName("ul");
    api.record.value("named-list-by-id", uls.namedItem("list").getAttribute("id"));
    api.record.value("named-menu-by-name", uls.namedItem("menu").getAttribute("id"));
    api.record.value("named-missing", uls.namedItem("nope"));
    api.record.value("named-getter", uls["list"].getAttribute("id"));
    api.record.value("named-getter-missing", uls["nope"]);
    api.record.value("collection-has-named", "list" in uls);

    // Iteration and toStringTag.
    api.record.value("iterated-count", Array.from(document.getElementsByClassName("item")).length);
    api.record.value(
      "toStringTag",
      Object.prototype.toString.call(document.getElementsByTagName("ul")),
    );

    // Element scope: descendants only, never the scope itself.
    const list = document.getElementById("list");
    api.record.value("scoped-li-count", list.getElementsByTagName("li").length);
    api.record.value("scoped-ul-match", list.getElementsByTagName("ul").length);
    api.record.value("scoped-class-count", list.getElementsByClassName("item").length);

    // Identity: fresh collection per call, stable element wrappers across calls.
    api.record.value(
      "fresh-per-call",
      document.getElementsByTagName("li") !== document.getElementsByTagName("li"),
    );
    api.record.identity(
      "same-element-across-calls",
      document.getElementsByTagName("li")[0],
      document.getElementsByTagName("li")[0],
    );

    // Live semantics: an existing collection reflects a later attribute change.
    const before = items.length;
    document.querySelector('[data-i="0"]').setAttribute("class", "b");
    api.record.value("live-before-attr", before);
    api.record.value("live-after-attr", items.length);
    api.record.value("live-fresh-attr", document.getElementsByClassName("item").length);

    // Live semantics: the same collection object reflects a later append.
    document.body.appendChild(document.createElement("div"));
    api.record.value("live-after-append", divs.length);
    api.record.value("live-fresh-append", document.getElementsByTagName("div").length);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
