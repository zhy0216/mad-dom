// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGPointList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGPointList(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<polygon>` `points` `baseVal`
// (a real SVGPointList backed by the `points` attribute). The upstream
// `new window.SVGPoint(illegal, window)` items are minted through the public
// `svg.createSVGPoint()`. The read-only animatedPoints error paths are
// observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-point-list";
export const description = "real differential: SVGPointList polygon points baseVal index/length/iterator + clear/initialize/getItem/insertItemBefore/replaceItem/removeItem/appendItem";
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
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const list = polygon.points;
    api.record.value("type", list instanceof window.SVGPointList);
    api.record.value("length", list.length);
    api.record.value("numberOfItems", list.numberOfItems);
    api.record.value("index0-x", list[0].x);
    api.record.value("index0-y", list[0].y);
    api.record.value("index1-x", list[1].x);
    api.record.value("index1-y", list[1].y);
    api.record.value("index2-x", list[2].x);
    api.record.value("index2-y", list[2].y);
    api.record.value("index3", list[3]);
    const iterated = [];
    for (const item of list) {
      iterated.push(`${item.x}:${item.y}`);
    }
    api.record.value("iterator-length", iterated.length);
    api.record.value("iterator-0", iterated[0]);
    api.record.value("iterator-2", iterated[2]);

    polygon.setAttribute("points", `1,2.2 3,4\t5\t
                6`);
    api.record.value("separator-0-x", list[0].x);
    api.record.value("separator-0-y", list[0].y);
    api.record.value("separator-2-x", list[2].x);
    api.record.value("separator-2-y", list[2].y);

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const item1 = list[0];
    list.clear();
    api.record.value("clear-length", list.length);
    api.record.value("clear-attr", polygon.getAttribute("points"));
    api.record.value("clear-item-x", item1.x);
    api.record.value("clear-item-y", item1.y);
    item1.x = 10;
    item1.y = 20;
    api.record.value("clear-item-after", `${item1.x} ${item1.y}`);
    api.record.value("clear-item-detached-attr", polygon.getAttribute("points"));

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const item = svg.createSVGPoint();
    item.x = 10.1;
    item.y = 20.2;
    api.record.value("initialize-return", list.initialize(item) === item);
    api.record.value("initialize-length", list.length);
    api.record.value("initialize-0-x", list[0].x);
    api.record.value("initialize-0-y", list[0].y);
    api.record.value("initialize-attr", polygon.getAttribute("points"));
    item.x = 20;
    item.y = 30;
    api.record.value("initialize-item-writeback", polygon.getAttribute("points"));
    const item2 = svg.createSVGPoint();
    item2.x = 40;
    item2.y = 50;
    list.appendItem(item2);
    api.record.value("initialize-append-attr", polygon.getAttribute("points"));
    item2.x = 60;
    item2.y = 70;
    api.record.value("initialize-append-writeback", polygon.getAttribute("points"));
    list.appendItem(svg.createSVGPoint());
    api.record.value("initialize-append-empty", polygon.getAttribute("points"));

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    api.record.value("getItem0-x", list.getItem(0).x);
    api.record.value("getItem0-y", list.getItem(0).y);
    api.record.value("getItem1-x", list.getItem(1).x);
    api.record.value("getItemString2-x", list.getItem("2").x);
    api.record.value("getItemString2-y", list.getItem("2").y);
    api.record.value("getItem3", list.getItem(3));

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const ins = svg.createSVGPoint();
    ins.x = 10.1;
    ins.y = 20.2;
    api.record.value("insert-return", list.insertItemBefore(ins, 1) === ins);
    api.record.value("insert-length", list.length);
    api.record.value("insert-0-x", list[0].x);
    api.record.value("insert-1-x", list[1].x);
    api.record.value("insert-1-y", list[1].y);
    api.record.value("insert-2-x", list[2].x);
    api.record.value("insert-3-x", list[3].x);
    api.record.value("insert-attr", polygon.getAttribute("points"));
    ins.x = 20;
    ins.y = 30;
    api.record.value("insert-item-writeback", polygon.getAttribute("points"));

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const insOut = svg.createSVGPoint();
    const insOut2 = svg.createSVGPoint();
    list.insertItemBefore(insOut, -1);
    list.insertItemBefore(insOut2, 10);
    api.record.value("insert-outbound-length", list.length);
    api.record.identity("insert-outbound-0", list[0], insOut);
    api.record.identity("insert-outbound-4", list[4], insOut2);

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const rep = svg.createSVGPoint();
    rep.x = 10.1;
    rep.y = 20.2;
    api.record.value("replace-return", list.replaceItem(rep, 1) === list[1]);
    api.record.value("replace-length", list.length);
    api.record.value("replace-0-x", list[0].x);
    api.record.value("replace-1-x", list[1].x);
    api.record.value("replace-1-y", list[1].y);
    api.record.value("replace-2-x", list[2].x);
    api.record.value("replace-attr", polygon.getAttribute("points"));
    rep.x = 20;
    rep.y = 30;
    api.record.value("replace-item-writeback", polygon.getAttribute("points"));

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const removed = list.removeItem(1);
    api.record.value("remove-return-x", removed.x);
    api.record.value("remove-return-y", removed.y);
    api.record.value("remove-length", list.length);
    api.record.value("remove-0-x", list[0].x);
    api.record.value("remove-0-y", list[0].y);
    api.record.value("remove-1-x", list[1].x);
    api.record.value("remove-1-y", list[1].y);
    api.record.value("remove-attr", polygon.getAttribute("points"));
    list.removeItem(1);
    api.record.value("remove-2-length", list.length);
    api.record.value("remove-2-0-x", list[0].x);
    api.record.value("remove-2-0-y", list[0].y);
    api.record.value("remove-2-attr", polygon.getAttribute("points"));

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const app = svg.createSVGPoint();
    app.x = 10.1;
    app.y = 20.2;
    api.record.value("append-return", list.appendItem(app) === app);
    api.record.value("append-length", list.length);
    api.record.value("append-0-x", list[0].x);
    api.record.value("append-3-x", list[3].x);
    api.record.value("append-3-y", list[3].y);
    api.record.value("append-attr", polygon.getAttribute("points"));
    app.x = 20;
    app.y = 30;
    api.record.value("append-item-writeback", polygon.getAttribute("points"));

    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const readOnly = polygon.animatedPoints;
    try {
      readOnly.initialize(svg.createSVGPoint());
      api.record.value("readonly-initialize", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.insertItemBefore(svg.createSVGPoint(), 1);
      api.record.value("readonly-insert", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.replaceItem(svg.createSVGPoint(), 1);
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
      readOnly.appendItem(svg.createSVGPoint());
      api.record.value("readonly-append", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
