// W9 svg value-class differential port facade additions integration tests.
//
// The W9 (svg 子系统内部类, SVGAngle–SVGTransformList) diff-port wave completed
// the SVG value-class surface on the facade to match the happy-dom model:
// - SVGMatrix: the SVG2 transform methods (multiply / translate / scale /
//   scaleNonUniform / rotate / rotateFromVector / skewX / skewY / flipX /
//   flipY / inverse), attribute-backed `a…f` reflection and read-only no-op
//   setters;
// - SVGTransform: type / angle / matrix reads for every transform function,
//   the cached bound matrix, setMatrix / setTranslate / setScale / setRotate /
//   setSkewX / setSkewY with read-only no-ops and the parse-error messages;
// - the SVGStringList / SVGNumberList / SVGPointList / SVGLengthList /
//   SVGTransformList mutation methods (clear / initialize / getItem /
//   insertItemBefore / replaceItem / removeItem / appendItem) with the
//   happy-dom item `attributeValue` model and read-only list errors;
// - SVGAngle: rad/grad/turn conversion in value/unitType,
//   valueInSpecifiedUnits, convertToSpecifiedUnits and the read-only errors.
// Each addition is pinned by at least one assertion here, mirroring the
// happy-dom behaviour the rewritten svg value-class tests observed.
import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "../../index.js";

const createdWindows = [];
function freshWindow(options) {
  const win = options === undefined ? new Window() : new Window(options);
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) win.destroy();
});

const SVG_NS = "http://www.w3.org/2000/svg";

describe("W9 SVGMatrix ops", () => {
  test("attribute-backed a-f reflection, setter write-back and read-only no-op", () => {
    const window = freshWindow();
    const document = window.document;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    const matrix = g.transform.baseVal.getItem(0).matrix;
    expect(matrix instanceof window.SVGMatrix).toBe(true);
    expect(matrix.a).toBe(1);
    expect(matrix.f).toBe(6);
    matrix.a = 10;
    expect(g.getAttribute("transform")).toBe("matrix(10 2 3 4 5 6)");
    const g2 = document.createElementNS(SVG_NS, "g");
    g2.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    const readOnly = g2.transform.animVal.getItem(0);
    readOnly.matrix.a = 10;
    expect(g2.getAttribute("transform")).toBe("matrix(1 2 3 4 5 6)");
  });

  test("multiply/translate/scale/rotate/skew/flip/inverse produce the happy-dom values", () => {
    const window = freshWindow();
    const document = window.document;
    const g1 = document.createElementNS(SVG_NS, "g");
    const g2 = document.createElementNS(SVG_NS, "g");
    g1.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g2.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    const m1 = g1.transform.baseVal.getItem(0).matrix;
    const m2 = g2.transform.baseVal.getItem(0).matrix;
    expect(m1.multiply(m2).a).toBe(7);
    expect(m1.multiply(m2).f).toBe(40);
    expect(m1.translate(10, 20).e).toBe(75);
    expect(m1.translate(10, 20).f).toBe(106);
    expect(m1.scale(10).a).toBe(10);
    expect(m1.scaleNonUniform(10, 20).d).toBe(80);
    expect(m1.rotate(90).a).toBe(3);
    expect(m1.rotate(90).d).toBe(-2);
    expect(m1.flipX().a).toBe(-1);
    expect(m1.flipY().d).toBe(-4);
    expect(m1.inverse().a).toBe(-2);
    expect(m1.inverse().e).toBe(1);
    const svg = document.createElementNS(SVG_NS, "svg");
    expect(svg.createSVGMatrix().a).toBe(1);
  });
});

describe("W9 SVGTransform surface", () => {
  test("type/angle/matrix read every transform function and setters write back", () => {
    const window = freshWindow();
    const document = window.document;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", "matrix(1 2 3 4 5 6) translate(10 20) rotate(90) scale(10 20) skewX(10) skewY(10)");
    const list = g.transform.baseVal;
    expect(list.getItem(0).type).toBe(window.SVGTransform.SVG_TRANSFORM_MATRIX);
    expect(list.getItem(1).type).toBe(window.SVGTransform.SVG_TRANSFORM_TRANSLATE);
    expect(list.getItem(2).type).toBe(window.SVGTransform.SVG_TRANSFORM_ROTATE);
    expect(list.getItem(2).angle).toBe(90);
    expect(list.getItem(3).type).toBe(window.SVGTransform.SVG_TRANSFORM_SCALE);
    expect(list.getItem(4).type).toBe(window.SVGTransform.SVG_TRANSFORM_SKEWX);
    expect(list.getItem(4).angle).toBe(10);
    expect(list.getItem(5).type).toBe(window.SVGTransform.SVG_TRANSFORM_SKEWY);
    expect(list.getItem(5).angle).toBe(10);
    const svg = document.createElementNS(SVG_NS, "svg");
    const t = svg.createSVGTransform();
    t.setTranslate(30, 40);
    expect(t.type).toBe(window.SVGTransform.SVG_TRANSFORM_TRANSLATE);
    const g2 = document.createElementNS(SVG_NS, "g");
    g2.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g2.transform.baseVal.getItem(0).setRotate(90, 10, 20);
    expect(g2.getAttribute("transform")).toBe("rotate(90 10 20)");
    g2.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g2.transform.baseVal.getItem(0).setSkewX(10);
    expect(g2.getAttribute("transform")).toBe("skewX(10)");
    g2.setAttribute("transform", "matrix(1 2 3 4 5 6)");
    g2.transform.baseVal.getItem(0).setSkewY(10);
    expect(g2.getAttribute("transform")).toBe("skewY(10)");
    const matrix = svg.createSVGMatrix();
    matrix.a = 10;
    const t2 = svg.createSVGTransform();
    t2.setMatrix(matrix);
    expect(t2.matrix).toBe(matrix);
    expect(() => t2.setMatrix({})).toThrow(
      'Failed to set the "matrix" property on "SVGTransform": The provided value is not of type "SVGMatrix".',
    );
  });

  test("invalid transform functions throw the happy-dom parse messages", () => {
    const window = freshWindow();
    const document = window.document;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", "invalid(10)");
    expect(() => g.transform.baseVal.getItem(0).matrix.a).toThrow(
      'Failed to parse transform attribute: Unknown transformation "invalid(10)".',
    );
    g.setAttribute("transform", "rotate(90 10)");
    expect(() => g.transform.baseVal.getItem(0).matrix.a).toThrow(
      'Failed to parse transform attribute: Expected 1 or 3 parameters in "rotate(90 10)".',
    );
    g.setAttribute("transform", "matrix(1 2 3 4 5)");
    expect(() => g.transform.baseVal.getItem(0).matrix.a).toThrow(
      'Failed to parse transform attribute: Expected 6 parameters in "matrix(1 2 3 4 5)".',
    );
    g.setAttribute("transform", "scale(1 0.5)");
    expect(g.transform.baseVal.getItem(0).matrix.d).toBe(1);
  });
});

describe("W9 SVG list mutation methods", () => {
  test("SVGStringList initialize/insertItemBefore/replaceItem", () => {
    const window = freshWindow();
    const document = window.document;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("requiredExtensions", "key1 key2 key3");
    expect(g.requiredExtensions.initialize("test")).toBe("test");
    expect(g.getAttribute("requiredExtensions")).toBe("test");

    const g2 = document.createElementNS(SVG_NS, "g");
    g2.setAttribute("requiredExtensions", "key1 key2 key3");
    expect(g2.requiredExtensions.insertItemBefore("test", 1)).toBe("test");
    expect(g2.getAttribute("requiredExtensions")).toBe("key1 test key2 key3");

    const g3 = document.createElementNS(SVG_NS, "g");
    g3.setAttribute("requiredExtensions", "key1 key2 key3");
    expect(g3.requiredExtensions.replaceItem("test", 1)).toBe("key2");
    expect(g3.getAttribute("requiredExtensions")).toBe("key1 test key3");
  });

  test("SVGNumberList initialize/insertItemBefore/replaceItem/removeItem", () => {
    const window = freshWindow();
    const document = window.document;
    const svg = document.createElementNS(SVG_NS, "svg");
    const fe = document.createElementNS(SVG_NS, "feColorMatrix");
    fe.setAttribute("values", "1 2.2 3");
    const item = svg.createSVGNumber();
    item.value = 10.5;
    expect(fe.values.baseVal.initialize(item)).toBe(item);
    expect(fe.getAttribute("values")).toBe("10.5");

    const fe2 = document.createElementNS(SVG_NS, "feColorMatrix");
    fe2.setAttribute("values", "1 2.2 3");
    const ins = svg.createSVGNumber();
    ins.value = 10.5;
    fe2.values.baseVal.insertItemBefore(ins, 1);
    expect(fe2.getAttribute("values")).toBe("1 10.5 2.2 3");

    const fe3 = document.createElementNS(SVG_NS, "feColorMatrix");
    fe3.setAttribute("values", "1 2.2 3");
    const rep = svg.createSVGNumber();
    rep.value = 10.5;
    fe3.values.baseVal.replaceItem(rep, 1);
    expect(fe3.getAttribute("values")).toBe("1 10.5 3");

    const fe4 = document.createElementNS(SVG_NS, "feColorMatrix");
    fe4.setAttribute("values", "1 2.2 3");
    expect(fe4.values.baseVal.removeItem(1).value).toBe(2.2);
    expect(fe4.getAttribute("values")).toBe("1 3");
  });

  test("SVGPointList initialize/insertItemBefore/replaceItem", () => {
    const window = freshWindow();
    const document = window.document;
    const svg = document.createElementNS(SVG_NS, "svg");
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", "1 2.2 3 4 5 6");
    const item = svg.createSVGPoint();
    item.x = 10.1;
    item.y = 20.2;
    expect(polygon.points.initialize(item)).toBe(item);
    expect(polygon.getAttribute("points")).toBe("10.1 20.2");

    const polygon2 = document.createElementNS(SVG_NS, "polygon");
    polygon2.setAttribute("points", "1 2.2 3 4 5 6");
    const ins = svg.createSVGPoint();
    ins.x = 10.1;
    ins.y = 20.2;
    polygon2.points.insertItemBefore(ins, 1);
    expect(polygon2.getAttribute("points")).toBe("1 2.2 10.1 20.2 3 4 5 6");

    const polygon3 = document.createElementNS(SVG_NS, "polygon");
    polygon3.setAttribute("points", "1 2.2 3 4 5 6");
    const rep = svg.createSVGPoint();
    rep.x = 10.1;
    rep.y = 20.2;
    polygon3.points.replaceItem(rep, 1);
    expect(polygon3.getAttribute("points")).toBe("1 2.2 10.1 20.2 5 6");
  });

  test("SVGLengthList mutation methods with minted items", () => {
    const window = freshWindow();
    const document = window.document;
    const svg = document.createElementNS(SVG_NS, "svg");
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    const item = svg.createSVGLength();
    item.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
    expect(text.x.baseVal.initialize(item)).toBe(item);
    expect(text.getAttribute("x")).toBe("100cm");

    const text2 = document.createElementNS(SVG_NS, "text");
    text2.setAttribute("x", "10px 10cm 10mm");
    const ins = svg.createSVGLength();
    ins.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
    text2.x.baseVal.insertItemBefore(ins, 1);
    expect(text2.getAttribute("x")).toBe("10px 100cm 10cm 10mm");

    const text3 = document.createElementNS(SVG_NS, "text");
    text3.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    expect(text3.x.baseVal.removeItem(1).valueInSpecifiedUnits).toBe(10);
    expect(text3.getAttribute("x")).toBe("10px 10mm 10in 10pt 10pc");

    const text4 = document.createElementNS(SVG_NS, "text");
    text4.setAttribute("x", "10px 10cm 10mm 10in 10pt 10pc");
    const rep = svg.createSVGLength();
    rep.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
    text4.x.baseVal.replaceItem(rep, 1);
    expect(text4.getAttribute("x")).toBe("10px 100cm 10mm 10in 10pt 10pc");
  });

  test("SVGTransformList mutation methods with minted items", () => {
    const window = freshWindow();
    const document = window.document;
    const svg = document.createElementNS(SVG_NS, "svg");
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", "matrix(1 2 3 4 5 6) translate(10 20) rotate(90)");
    const t = svg.createSVGTransform();
    t.setTranslate(10, 20);
    expect(g.transform.baseVal.initialize(t)).toBe(t);
    expect(g.getAttribute("transform")).toBe("translate(10 20)");

    const g2 = document.createElementNS(SVG_NS, "g");
    g2.setAttribute("transform", "matrix(1 2 3 4 5 6) translate(10 20) rotate(90)");
    const ins = svg.createSVGTransform();
    ins.setScale(100, 200);
    g2.transform.baseVal.insertItemBefore(ins, 1);
    expect(g2.getAttribute("transform")).toBe(
      "matrix(1 2 3 4 5 6) scale(100 200) translate(10 20) rotate(90)",
    );

    const g3 = document.createElementNS(SVG_NS, "g");
    g3.setAttribute("transform", "matrix(1 2 3 4 5 6) translate(10 20) rotate(90)");
    expect(g3.transform.baseVal.removeItem(1).matrix.e).toBe(10);
    expect(g3.getAttribute("transform")).toBe("matrix(1 2 3 4 5 6) rotate(90)");

    const g4 = document.createElementNS(SVG_NS, "g");
    g4.setAttribute("transform", "matrix(1 2 3 4 5 6) translate(10 20) rotate(90)");
    g4.transform.baseVal.appendItem(svg.createSVGTransform());
    expect(g4.getAttribute("transform")).toBe(
      "matrix(1 2 3 4 5 6) translate(10 20) rotate(90) matrix(1 0 0 1 0 0)",
    );

    const g5 = document.createElementNS(SVG_NS, "g");
    g5.setAttribute("transform", "matrix(1 2 3 4 5 6) translate(10 20) rotate(90)");
    expect(() => g5.transform.animVal.removeItem(1)).toThrow(
      "Failed to execute 'removeItem' on 'SVGTransformList': The object is read-only.",
    );
  });
});

describe("W9 SVGAngle units", () => {
  test("rad/grad/turn conversion in value/unitType and convertToSpecifiedUnits", () => {
    const window = freshWindow();
    const document = window.document;
    const marker = document.createElementNS(SVG_NS, "marker");
    const angle = marker.orientAngle.baseVal;
    marker.setAttribute("orient", `${Math.PI}rad`);
    expect(angle.value).toBe(180);
    expect(angle.unitType).toBe(window.SVGAngle.SVG_ANGLETYPE_RAD);
    marker.setAttribute("orient", "100grad");
    expect(angle.value).toBe(90);
    marker.setAttribute("orient", "0.5turn");
    expect(angle.value).toBe(180);
    expect(angle.unitType).toBe(window.SVGAngle.SVG_ANGLETYPE_UNKNOWN);
    marker.setAttribute("orient", "90");
    expect(angle.unitType).toBe(window.SVGAngle.SVG_ANGLETYPE_UNSPECIFIED);
    marker.setAttribute("orient", "90deg");
    angle.convertToSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_RAD);
    expect(marker.getAttribute("orient")).toBe(`${Math.PI / 2}rad`);
    marker.setAttribute("orient", "90deg");
    angle.convertToSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_UNKNOWN);
    expect(marker.getAttribute("orient")).toBe("0.25turn");
    expect(() => {
      marker.orientAngle.animVal.convertToSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_DEG);
    }).toThrow("Failed to execute 'convertToSpecifiedUnits' on 'SVGAngle': The object is read-only.");
  });
});
