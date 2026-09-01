// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/svg/SVGMatrix.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the upstream internal
// `new window.SVGMatrix(illegal, window, {getAttribute, setAttribute})`
// constructions are expressed through the public `<g>` `transform`
// `baseVal.getItem(i).matrix` (an attribute-backed SVGMatrix) and through the
// public `svg.createSVGMatrix()` mint. `a…f` reads, the attribute write-back
// of the setters, the SVG2 transform methods and the read-only no-op setters
// (via a read-only animVal list item matrix) are observed through that public
// surface.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "svg-svg-matrix";
export const description = "real differential: SVGMatrix a-f read/write + multiply/translate/scale/scaleNonUniform/rotate/rotateFromVector/skewX/skewY/flipX/flipY/inverse";
export const targets = "real";

const SVG_NS = "http://www.w3.org/2000/svg";

function matrixValues(api, prefix, matrix) {
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
    const minted = svg.createSVGMatrix();
    api.record.value("type", minted instanceof window.SVGMatrix);
    matrixValues(api, "identity", minted);

    const g1 = document.createElementNS(SVG_NS, "g");
    g1.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    const matrix = g1.transform.baseVal.getItem(0).matrix;
    matrixValues(api, "parsed", matrix);
    api.record.value("parsed-identity", matrix === matrix);

    matrix.a = 10;
    api.record.value("set-a", g1.getAttribute("transform"));
    g1.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    matrix.b = 10;
    api.record.value("set-b", g1.getAttribute("transform"));
    g1.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    matrix.c = 10;
    api.record.value("set-c", g1.getAttribute("transform"));
    g1.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    matrix.d = 10;
    api.record.value("set-d", g1.getAttribute("transform"));
    g1.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    matrix.e = 10;
    api.record.value("set-e", g1.getAttribute("transform"));
    g1.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    matrix.f = 10;
    api.record.value("set-f", g1.getAttribute("transform"));

    const g2 = document.createElementNS(SVG_NS, "g");
    g2.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    const matrix1 = g1.transform.baseVal.getItem(0).matrix;
    const matrix2 = g2.transform.baseVal.getItem(0).matrix;
    const multiplied = matrix1.multiply(matrix2);
    api.record.value("multiply-type", multiplied instanceof window.SVGMatrix);
    matrixValues(api, "multiply", multiplied);

    matrixValues(api, "translate", matrix1.translate(10, 20));
    matrixValues(api, "scale", matrix1.scale(10));
    matrixValues(api, "scaleNonUniform", matrix1.scaleNonUniform(10, 20));
    matrixValues(api, "rotate", matrix1.rotate(90));
    matrixValues(api, "rotateFromVector", matrix1.rotateFromVector(1, 7));
    matrixValues(api, "skewX", matrix1.skewX(90));
    matrixValues(api, "skewY", matrix1.skewY(90));
    matrixValues(api, "flipX", matrix1.flipX());
    matrixValues(api, "flipY", matrix1.flipY());
    matrixValues(api, "inverse", matrix1.inverse());

    const g3 = document.createElementNS(SVG_NS, "g");
    g3.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    const readOnly = g3.transform.animVal.getItem(0).matrix;
    readOnly.a = 10;
    api.record.value("readonly-set-a", g3.getAttribute("transform"));
    readOnly.b = 10;
    api.record.value("readonly-set-b", g3.getAttribute("transform"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
