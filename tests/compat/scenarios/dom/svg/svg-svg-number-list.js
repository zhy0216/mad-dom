// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGNumberList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGNumberList(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<feColorMatrix>` `values`
// `baseVal` (a real SVGNumberList backed by the `values` attribute). The
// upstream `new window.SVGNumber(illegal, window)` items are minted through
// the public `svg.createSVGNumber()`. The read-only animVal list error paths
// are observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-number-list";
export const description = "real differential: SVGNumberList feColorMatrix values baseVal index/length/iterator + clear/initialize/getItem/insertItemBefore/replaceItem/removeItem/appendItem";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";

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
    const svg = document.createElementNS(SVG_NS, "svg");
    const element = document.createElementNS(SVG_NS, "feColorMatrix");
    element.setAttribute("values", "1 2.2 3");
    const list = element.values.baseVal;
    api.record.value("type", list instanceof window.SVGNumberList);
    api.record.value("length", list.length);
    api.record.value("numberOfItems", list.numberOfItems);
    api.record.value("index0-value", list[0].value);
    api.record.value("index1-value", list[1].value);
    api.record.value("index2-value", list[2].value);
    api.record.value("index3", list[3]);
    const iterated = [];
    for (const item of list) {
      iterated.push(item.value);
    }
    api.record.value("iterator-length", iterated.length);
    api.record.value("iterator-0", iterated[0]);
    api.record.value("iterator-2", iterated[2]);

    element.setAttribute("values", `1,2.2\t
                3`);
    api.record.value("separator-0", list[0].value);
    api.record.value("separator-2", list[2].value);

    element.setAttribute("values", "1 2.2 3");
    const item1 = list[0];
    list.clear();
    api.record.value("clear-length", list.length);
    api.record.value("clear-attr", element.getAttribute("values"));
    api.record.value("clear-item-value", item1.value);
    item1.value = 10;
    api.record.value("clear-item-after", item1.value);
    api.record.value("clear-item-detached-attr", element.getAttribute("values"));

    element.setAttribute("values", "1 2.2 3");
    const item = svg.createSVGNumber();
    item.value = 10.5;
    api.record.value("initialize-return", list.initialize(item) === item);
    api.record.value("initialize-length", list.length);
    api.record.value("initialize-0", list[0].value);
    api.record.value("initialize-attr", element.getAttribute("values"));
    item.value = 20;
    api.record.value("initialize-item-writeback", element.getAttribute("values"));
    const item2 = svg.createSVGNumber();
    item2.value = 30;
    list.appendItem(item2);
    api.record.value("initialize-append-attr", element.getAttribute("values"));
    item2.value = 40;
    api.record.value("initialize-append-writeback", element.getAttribute("values"));
    list.appendItem(svg.createSVGNumber());
    api.record.value("initialize-append-empty", element.getAttribute("values"));

    element.setAttribute("values", "1 2.2 3");
    api.record.value("getItem0", list.getItem(0).value);
    api.record.value("getItem1", list.getItem(1).value);
    api.record.value("getItemString2", list.getItem("2").value);
    api.record.value("getItem3", list.getItem(3));

    element.setAttribute("values", "1 2.2 3");
    const ins = svg.createSVGNumber();
    ins.value = 10.5;
    api.record.value("insert-return", list.insertItemBefore(ins, 1) === ins);
    api.record.value("insert-length", list.length);
    api.record.value("insert-0", list[0].value);
    api.record.value("insert-1", list[1].value);
    api.record.value("insert-2", list[2].value);
    api.record.value("insert-3", list[3].value);
    api.record.value("insert-attr", element.getAttribute("values"));
    ins.value = 20;
    api.record.value("insert-item-writeback", element.getAttribute("values"));

    element.setAttribute("values", "1 2.2 3");
    const insOut = svg.createSVGNumber();
    const insOut2 = svg.createSVGNumber();
    list.insertItemBefore(insOut, -1);
    list.insertItemBefore(insOut2, 10);
    api.record.value("insert-outbound-length", list.length);
    api.record.identity("insert-outbound-0", list[0], insOut);
    api.record.identity("insert-outbound-4", list[4], insOut2);

    element.setAttribute("values", "1 2.2 3");
    const rep = svg.createSVGNumber();
    rep.value = 10.5;
    api.record.value("replace-return", list.replaceItem(rep, 1) === list[1]);
    api.record.value("replace-length", list.length);
    api.record.value("replace-0", list[0].value);
    api.record.value("replace-1", list[1].value);
    api.record.value("replace-2", list[2].value);
    api.record.value("replace-attr", element.getAttribute("values"));
    rep.value = 20;
    api.record.value("replace-item-writeback", element.getAttribute("values"));

    element.setAttribute("values", "1 2.2 3");
    const removed = list.removeItem(1);
    api.record.value("remove-return", removed.value);
    api.record.value("remove-length", list.length);
    api.record.value("remove-0", list[0].value);
    api.record.value("remove-1", list[1].value);
    api.record.value("remove-attr", element.getAttribute("values"));
    list.removeItem(1);
    api.record.value("remove-2-length", list.length);
    api.record.value("remove-2-0", list[0].value);
    api.record.value("remove-2-attr", element.getAttribute("values"));

    element.setAttribute("values", "1 2.2 3");
    const app = svg.createSVGNumber();
    app.value = 10.5;
    api.record.value("append-return", list.appendItem(app) === app);
    api.record.value("append-length", list.length);
    api.record.value("append-0", list[0].value);
    api.record.value("append-3", list[3].value);
    api.record.value("append-attr", element.getAttribute("values"));
    app.value = 20;
    api.record.value("append-item-writeback", element.getAttribute("values"));

    element.setAttribute("values", "1 2.2 3");
    const readOnly = element.values.animVal;
    try {
      readOnly.initialize(svg.createSVGNumber());
      api.record.value("readonly-initialize", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.insertItemBefore(svg.createSVGNumber(), 1);
      api.record.value("readonly-insert", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.replaceItem(svg.createSVGNumber(), 1);
      api.record.value("readonly-replace", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.removeItem(1);
      api.record.value("readonly-remove", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.appendItem(svg.createSVGNumber());
      api.record.value("readonly-append", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
