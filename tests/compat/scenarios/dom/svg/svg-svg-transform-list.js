// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGTransformList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGTransformList(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<g>` `transform` `baseVal`
// (a real SVGTransformList backed by the `transform` attribute). The upstream
// `new window.SVGTransform(illegal, window)` items are minted through the
// public `svg.createSVGTransform()`. The read-only animVal error paths are
// observed through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-transform-list";
export const description = "real differential: SVGTransformList g transform baseVal index/matrix + clear/initialize/getItem/insertItemBefore/replaceItem/removeItem/appendItem";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";
const ATTRIBUTE = "matrix(1 2 3 4 5 6) translate(10 20) rotate(90) rotate(90 10 20) scale(10 20) skewX(10) skewY(10)";
const ATTRIBUTE3 = "matrix(1 2 3 4 5 6) translate(10 20) rotate(90)";

function recordMatrix(api, prefix, matrix) {
  api.record.value(`${prefix}-a`, matrix.a);
  api.record.value(`${prefix}-b`, matrix.b);
  api.record.value(`${prefix}-c`, matrix.c);
  api.record.value(`${prefix}-d`, matrix.d);
  api.record.value(`${prefix}-e`, matrix.e);
  api.record.value(`${prefix}-f`, matrix.f);
}

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
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", ATTRIBUTE);
    const list = g.transform.baseVal;
    api.record.value("type", list instanceof window.SVGTransformList);
    api.record.value("length", list.length);
    api.record.value("numberOfItems", list.numberOfItems);
    for (let i = 0; i < 7; i += 1) {
      api.record.value(`item-${i}-type`, list[i].type);
      recordMatrix(api, `item-${i}`, list[i].matrix);
    }
    api.record.value("item7", list[7]);
    const iterated = [];
    for (const item of list) {
      iterated.push(item);
    }
    api.record.value("iterator-length", iterated.length);
    api.record.identity("iterator-0", iterated[0], list[0]);
    api.record.identity("iterator-5", iterated[5], list[5]);

    g.setAttribute("transform", ATTRIBUTE3);
    const item1 = list[0];
    list.clear();
    api.record.value("clear-length", list.length);
    api.record.value("clear-attr", g.getAttribute("transform"));
    recordMatrix(api, "clear-item", item1.matrix);
    const svgMatrix = svg.createSVGMatrix();
    svgMatrix.a = 10;
    svgMatrix.b = 20;
    svgMatrix.c = 30;
    svgMatrix.d = 40;
    svgMatrix.e = 50;
    svgMatrix.f = 60;
    item1.setMatrix(svgMatrix);
    recordMatrix(api, "clear-item-after", item1.matrix);
    api.record.value("clear-item-detached-attr", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const item = svg.createSVGTransform();
    const itemMatrix = svg.createSVGMatrix();
    itemMatrix.a = 10;
    itemMatrix.b = 20;
    itemMatrix.c = 30;
    itemMatrix.d = 40;
    itemMatrix.e = 50;
    itemMatrix.f = 60;
    item.setMatrix(itemMatrix);
    api.record.value("initialize-return", list.initialize(item) === item);
    api.record.value("initialize-length", list.length);
    recordMatrix(api, "initialize-0", list[0].matrix);
    api.record.value("initialize-attr", g.getAttribute("transform"));
    itemMatrix.a = 100;
    api.record.value("initialize-item-writeback", g.getAttribute("transform"));
    const item2 = svg.createSVGTransform();
    const item2Matrix = svg.createSVGMatrix();
    item2Matrix.a = 1;
    item2Matrix.b = 2;
    item2Matrix.c = 3;
    item2Matrix.d = 4;
    item2Matrix.e = 5;
    item2Matrix.f = 6;
    item2.setMatrix(item2Matrix);
    list.appendItem(item2);
    api.record.value("initialize-append-attr", g.getAttribute("transform"));
    item2Matrix.a = 10;
    api.record.value("initialize-append-writeback", g.getAttribute("transform"));
    list.appendItem(svg.createSVGTransform());
    api.record.value("initialize-append-empty", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const t = svg.createSVGTransform();
    t.setTranslate(10, 20);
    api.record.value("initialize-translate-return", list.initialize(t) === t);
    api.record.value("initialize-translate-length", list.length);
    api.record.value("initialize-translate-type", list[0].type);
    api.record.value("initialize-translate-attr", g.getAttribute("transform"));
    recordMatrix(api, "initialize-translate-matrix", list[0].matrix);

    g.setAttribute("transform", ATTRIBUTE3);
    api.record.identity("getItem0", list.getItem(0), list[0]);
    api.record.identity("getItem1", list.getItem(1), list[1]);
    api.record.identity("getItemString2", list.getItem("2"), list[2]);
    api.record.value("getItem3", list.getItem(3));

    g.setAttribute("transform", ATTRIBUTE3);
    const ins = svg.createSVGTransform();
    const insMatrix = svg.createSVGMatrix();
    insMatrix.a = 10;
    insMatrix.b = 20;
    insMatrix.c = 30;
    insMatrix.d = 40;
    insMatrix.e = 50;
    insMatrix.f = 60;
    ins.setMatrix(insMatrix);
    api.record.value("insert-return", list.insertItemBefore(ins, 1) === ins);
    api.record.value("insert-length", list.length);
    recordMatrix(api, "insert-0", list[0].matrix);
    recordMatrix(api, "insert-1", list[1].matrix);
    recordMatrix(api, "insert-2", list[2].matrix);
    recordMatrix(api, "insert-3", list[3].matrix);
    api.record.value("insert-attr", g.getAttribute("transform"));
    insMatrix.a = 100;
    api.record.value("insert-item-writeback", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const insT = svg.createSVGTransform();
    insT.setTranslate(100, 200);
    api.record.value("insert-set-return", list.insertItemBefore(insT, 1) === insT);
    api.record.value("insert-set-length", list.length);
    api.record.value("insert-set-attr", g.getAttribute("transform"));
    insT.setRotate(90, 1, 1);
    api.record.value("insert-set-item-writeback", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const insOut = svg.createSVGTransform();
    const insOut2 = svg.createSVGTransform();
    list.insertItemBefore(insOut, -1);
    list.insertItemBefore(insOut2, 10);
    api.record.value("insert-outbound-length", list.length);
    api.record.identity("insert-outbound-0", list[0], insOut);
    api.record.identity("insert-outbound-4", list[4], insOut2);

    g.setAttribute("transform", ATTRIBUTE3);
    const rep = svg.createSVGTransform();
    const repMatrix = svg.createSVGMatrix();
    repMatrix.a = 10;
    repMatrix.b = 20;
    repMatrix.c = 30;
    repMatrix.d = 40;
    repMatrix.e = 50;
    repMatrix.f = 60;
    rep.setMatrix(repMatrix);
    api.record.value("replace-return", list.replaceItem(rep, 1) === list[1]);
    api.record.value("replace-length", list.length);
    recordMatrix(api, "replace-0", list[0].matrix);
    recordMatrix(api, "replace-1", list[1].matrix);
    recordMatrix(api, "replace-2", list[2].matrix);
    api.record.value("replace-attr", g.getAttribute("transform"));
    repMatrix.a = 100;
    api.record.value("replace-item-writeback", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const repS = svg.createSVGTransform();
    repS.setScale(100, 200);
    list.replaceItem(repS, 1);
    api.record.value("replace-set-attr", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const removed = list.removeItem(1);
    api.record.value("remove-return-type", removed.type);
    recordMatrix(api, "remove-return", removed.matrix);
    api.record.value("remove-length", list.length);
    recordMatrix(api, "remove-0", list[0].matrix);
    recordMatrix(api, "remove-1", list[1].matrix);
    api.record.value("remove-attr", g.getAttribute("transform"));
    list.removeItem(1);
    api.record.value("remove-2-length", list.length);
    recordMatrix(api, "remove-2-0", list[0].matrix);
    api.record.value("remove-2-attr", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const app = svg.createSVGTransform();
    const appMatrix = svg.createSVGMatrix();
    appMatrix.a = 10;
    appMatrix.b = 20;
    appMatrix.c = 30;
    appMatrix.d = 40;
    appMatrix.e = 50;
    appMatrix.f = 60;
    app.setMatrix(appMatrix);
    api.record.value("append-return", list.appendItem(app) === app);
    api.record.value("append-length", list.length);
    recordMatrix(api, "append-0", list[0].matrix);
    recordMatrix(api, "append-3", list[3].matrix);
    api.record.value("append-attr", g.getAttribute("transform"));
    appMatrix.a = 100;
    api.record.value("append-item-writeback", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const appT = svg.createSVGTransform();
    appT.setTranslate(100, 200);
    api.record.value("append-set-return", list.appendItem(appT) === appT);
    api.record.value("append-set-length", list.length);
    api.record.value("append-set-attr", g.getAttribute("transform"));

    g.setAttribute("transform", ATTRIBUTE3);
    const readOnly = g.transform.animVal;
    try {
      readOnly.initialize(svg.createSVGTransform());
      api.record.value("readonly-initialize", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.insertItemBefore(svg.createSVGTransform(), 1);
      api.record.value("readonly-insert", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.replaceItem(svg.createSVGTransform(), 1);
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
      readOnly.appendItem(svg.createSVGTransform());
      api.record.value("readonly-append", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
