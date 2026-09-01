// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGTransform.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGTransform(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<g>` `transform` list items
// (attribute-backed) and the public `svg.createSVGTransform()` mint (for the
// standalone setters / read-only no-ops). The `SVGTransformTypeEnum` import is
// replaced by the window statics; the invalid-transform parse errors are
// observed through the public `transform.baseVal.getItem(i).matrix` reads.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-transform";
export const description = "real differential: SVGTransform type/angle/matrix reads + setMatrix/setTranslate/setScale/setRotate/setSkewX/setSkewY write-back + parse errors";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";

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
    const minted = svg.createSVGTransform();
    api.record.value("type", minted instanceof window.SVGTransform);
    api.record.value("type-default", minted.type);
    api.record.value("angle-default", minted.angle);

    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute(
      "transform",
      "matrix(1 2 3 4 5 6) translate(10 20) rotate(90) rotate(90 10 20) scale(10 20) skewX(10) skewY(10)",
    );
    const list = g.transform.baseVal;
    const expectedTypes = [1, 2, 4, 4, 3, 5, 6];
    for (let i = 0; i < expectedTypes.length; i += 1) {
      api.record.value(`item-${i}-type`, list.getItem(i).type);
      recordMatrix(api, `item-${i}-matrix`, list.getItem(i).matrix);
    }
    api.record.value("item-2-angle", list.getItem(2).angle);
    api.record.value("item-3-angle", list.getItem(3).angle);
    api.record.value("item-5-angle", list.getItem(5).angle);
    api.record.value("item-6-angle", list.getItem(6).angle);
    api.record.value("item-0-angle", list.getItem(0).angle);

    const g2 = document.createElementNS(SVG_NS, "g");
    g2.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    const transform2 = g2.transform.baseVal.getItem(0);
    const matrix = svg.createSVGMatrix();
    const rotatedMatrix = matrix.rotate(90);
    transform2.setMatrix(rotatedMatrix);
    api.record.value("setMatrix-identity", transform2.matrix === rotatedMatrix);
    api.record.value("setMatrix-attr", g2.getAttribute("transform"));
    recordMatrix(api, "setMatrix", transform2.matrix);

    const g3 = document.createElementNS(SVG_NS, "g");
    g3.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g3.transform.baseVal.getItem(0).setTranslate(30, 40);
    api.record.value("setTranslate-attr", g3.getAttribute("transform"));
    g3.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g3.transform.baseVal.getItem(0).setScale(10, 20);
    api.record.value("setScale-attr", g3.getAttribute("transform"));
    g3.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g3.transform.baseVal.getItem(0).setRotate(90, 10, 20);
    api.record.value("setRotate-attr", g3.getAttribute("transform"));
    g3.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g3.transform.baseVal.getItem(0).setSkewX(10);
    api.record.value("setSkewX-attr", g3.getAttribute("transform"));
    g3.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g3.transform.baseVal.getItem(0).setSkewY(10);
    api.record.value("setSkewY-attr", g3.getAttribute("transform"));

    for (const invalid of [
      "invalid(10)",
      "rotateX(10)",
      "rotateY(10)",
      "scaleX(10)",
      "scaleY(10)",
      "rotate(90 10)",
      "matrix(1 2 3 4 5)",
      "skewX(10 20)",
      "skewY(10 20)",
    ]) {
      g.setAttribute("transform", invalid);
      try {
        api.record.value(`invalid-${invalid}-read`, g.transform.baseVal.getItem(0).matrix.a);
      } catch (error) {
        api.record.error(error, "sync-throw");
      }
    }

    try {
      const minted2 = svg.createSVGTransform();
      minted2.setMatrix({});
      api.record.value("setMatrix-not-svgmatrix", "no-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    const g4 = document.createElementNS(SVG_NS, "g");
    g4.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    const readOnly = g4.transform.animVal.getItem(0);
    readOnly.setTranslate(30, 40);
    api.record.value("readonly-setTranslate", g4.getAttribute("transform"));
    readOnly.setScale(10, 20);
    api.record.value("readonly-setScale", g4.getAttribute("transform"));
    readOnly.setRotate(90, 10, 20);
    api.record.value("readonly-setRotate", g4.getAttribute("transform"));
    readOnly.setSkewX(10);
    api.record.value("readonly-setSkewX", g4.getAttribute("transform"));
    readOnly.setSkewY(10);
    api.record.value("readonly-setSkewY", g4.getAttribute("transform"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}