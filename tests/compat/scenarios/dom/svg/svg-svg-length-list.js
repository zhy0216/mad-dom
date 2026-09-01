// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGLengthList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGLengthList(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<text>` `x` `baseVal` (a
// real SVGLengthList backed by the `x` attribute). The upstream
// `new window.SVGLength(illegal, window)` items are minted through the public
// `svg.createSVGLength()`. The read-only animVal list error paths are observed
// through the public surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-length-list";
export const description = "real differential: SVGLengthList text x baseVal index/length/iterator + clear/initialize/getItem/insertItemBefore/replaceItem/removeItem/appendItem";
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
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    const list = text.x.baseVal;
    api.record.value("type", list instanceof window.SVGLengthList);
    api.record.value("length", list.length);
    api.record.value("numberOfItems", list.numberOfItems);
    api.record.value("index0-vius", list[0].valueInSpecifiedUnits);
    api.record.value("index0-unitType", list[0].unitType);
    api.record.value("index1-vius", list[1].valueInSpecifiedUnits);
    api.record.value("index2-vius", list[2].valueInSpecifiedUnits);
    api.record.value("index3-vius", list[3].valueInSpecifiedUnits);
    api.record.value("index4-vius", list[4].valueInSpecifiedUnits);
    api.record.value("index5-vius", list[5].valueInSpecifiedUnits);
    api.record.value("index6", list[6]);
    const iterated = [];
    for (const item of list) {
      iterated.push(item.valueInSpecifiedUnits);
    }
    api.record.value("iterator-length", iterated.length);
    api.record.value("iterator-0", iterated[0]);
    api.record.value("iterator-5", iterated[5]);

    text.setAttribute("x", `10px,10cm,10mm,10in,10pt\t
                10pc`);
    api.record.value("separator-0-vius", list[0].valueInSpecifiedUnits);
    api.record.value("separator-5-vius", list[5].valueInSpecifiedUnits);
    api.record.value("separator-6", list[6]);

    text.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    list.clear();
    api.record.value("clear-length", list.length);
    api.record.value("clear-attr", text.getAttribute("x"));

    text.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    const item = svg.createSVGLength();
    item.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
    api.record.value("initialize-return", list.initialize(item) === item);
    api.record.value("initialize-length", list.length);
    api.record.value("initialize-0-vius", list[0].valueInSpecifiedUnits);
    api.record.value("initialize-attr", text.getAttribute("x"));
    item.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 10);
    api.record.value("initialize-item-writeback", text.getAttribute("x"));
    const item2 = svg.createSVGLength();
    item2.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 20);
    list.appendItem(item2);
    api.record.value("initialize-append-attr", text.getAttribute("x"));
    item.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 30);
    api.record.value("initialize-item2-writeback", text.getAttribute("x"));
    list.appendItem(svg.createSVGLength());
    api.record.value("initialize-append-empty", text.getAttribute("x"));

    text.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    api.record.value("getItem0-vius", list.getItem(0).valueInSpecifiedUnits);
    api.record.value("getItem0-unitType", list.getItem(0).unitType);
    api.record.value("getItem1-vius", list.getItem(1).valueInSpecifiedUnits);
    api.record.value("getItemString5-vius", list.getItem("5").valueInSpecifiedUnits);
    api.record.value("getItem6", list.getItem(6));

    text.setAttribute("x", "10px 10cm 10mm");
    const ins = svg.createSVGLength();
    ins.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
    api.record.value("insert-return", list.insertItemBefore(ins, 1) === ins);
    api.record.value("insert-length", list.length);
    api.record.value("insert-0-vius", list[0].valueInSpecifiedUnits);
    api.record.value("insert-1-vius", list[1].valueInSpecifiedUnits);
    api.record.value("insert-2-vius", list[2].valueInSpecifiedUnits);
    api.record.value("insert-3-vius", list[3].valueInSpecifiedUnits);
    api.record.value("insert-attr", text.getAttribute("x"));
    ins.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 20);
    api.record.value("insert-item-writeback", text.getAttribute("x"));

    text.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    const rep = svg.createSVGLength();
    rep.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
    api.record.value("replace-return", list.replaceItem(rep, 1) === list[1]);
    api.record.value("replace-length", list.length);
    api.record.value("replace-0-vius", list[0].valueInSpecifiedUnits);
    api.record.value("replace-1-vius", list[1].valueInSpecifiedUnits);
    api.record.value("replace-2-vius", list[2].valueInSpecifiedUnits);
    api.record.value("replace-attr", text.getAttribute("x"));

    text.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    const removed = list.removeItem(1);
    api.record.value("remove-return-vius", removed.valueInSpecifiedUnits);
    api.record.value("remove-return-unitType", removed.unitType);
    api.record.value("remove-length", list.length);
    api.record.value("remove-0-vius", list[0].valueInSpecifiedUnits);
    api.record.value("remove-1-vius", list[1].valueInSpecifiedUnits);
    api.record.value("remove-attr", text.getAttribute("x"));
    list.removeItem(1);
    api.record.value("remove-2-length", list.length);
    api.record.value("remove-2-attr", text.getAttribute("x"));

    text.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    const app = svg.createSVGLength();
    app.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
    api.record.value("append-return", list.appendItem(app) === app);
    api.record.value("append-length", list.length);
    api.record.value("append-6-vius", list[6].valueInSpecifiedUnits);
    api.record.value("append-attr", text.getAttribute("x"));

    text.setAttribute("x", "10px 10cm 10mm");
    const readOnly = text.x.animVal;
    try {
      readOnly.initialize(svg.createSVGLength());
      api.record.value("readonly-initialize", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.insertItemBefore(svg.createSVGLength(), 1);
      api.record.value("readonly-insert", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      readOnly.replaceItem(svg.createSVGLength(), 1);
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
      readOnly.appendItem(svg.createSVGLength());
      api.record.value("readonly-append", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
