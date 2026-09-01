// W8 nodes svg element differential port facade additions integration tests.
//
// The W8 (nodes svg 元素 FI–V, SVGFilterElement–SVGViewElement) diff-port wave
// added the remaining SVG value classes (SVGPoint / SVGPointList /
// SVGMatrix / SVGTransform / SVGTransformList / SVGAnimatedTransformList /
// SVGRect / SVGAnimatedRect / SVGAngle / SVGAnimatedAngle / SVGLengthList /
// SVGAnimatedLengthList, plus the NodeList window global) and the per-tag
// element classes of the wave (SVGGraphicsElement transform + string lists +
// geometry stubs, SVGGeometryElement pathLength, the text family, the
// gradients, the marker, the mask, the root SVGSVGElement factory/methods,
// the SVGStyleElement attribute surface and the computed-style sheet cascade).
// Each addition is pinned by at least one assertion here, mirroring the
// happy-dom behaviour the rewritten svg element tests observed.
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

describe("W8 per-tag element classes", () => {
  test("the W8 tags resolve to their classes and the happy-dom chains", () => {
    const window = freshWindow();
    const document = window.document;
    const filter = document.createElementNS(SVG_NS, "filter");
    expect(filter instanceof window.SVGFilterElement).toBe(true);
    expect(filter instanceof window.SVGElement).toBe(true);
    const line = document.createElementNS(SVG_NS, "line");
    expect(line instanceof window.SVGLineElement).toBe(true);
    expect(line instanceof window.SVGGeometryElement).toBe(true);
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    expect(grad instanceof window.SVGLinearGradientElement).toBe(true);
    expect(grad instanceof window.SVGGradientElement).toBe(true);
    expect(grad instanceof window.SVGGraphicsElement).toBe(true);
    const text = document.createElementNS(SVG_NS, "text");
    expect(text instanceof window.SVGTextElement).toBe(true);
    expect(text instanceof window.SVGTextPositioningElement).toBe(true);
    const textPath = document.createElementNS(SVG_NS, "textPath");
    expect(textPath instanceof window.SVGTextPathElement).toBe(true);
    expect(textPath.constructor.name).toBe("SVGTextPathElement");
    const svg = document.createElementNS(SVG_NS, "svg");
    expect(svg instanceof window.SVGSVGElement).toBe(true);
    expect(svg instanceof window.SVGGraphicsElement).toBe(true);
    const style = document.createElementNS(SVG_NS, "style");
    expect(style instanceof window.SVGStyleElement).toBe(true);
    expect(Object.prototype.toString.call(style)).toBe("[object SVGStyleElement]");
  });
});

describe("W8 SVGTransform / SVGAnimatedTransformList", () => {
  test("transform attribute parses matrix/translate and initialize writes back", () => {
    const window = freshWindow();
    const document = window.document;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", "matrix(1 2 3 4 5 6) translate(10 20)");
    expect(g.transform instanceof window.SVGAnimatedTransformList).toBe(true);
    expect(g.transform).toBe(g.transform);
    expect(g.transform.baseVal.numberOfItems).toBe(2);
    expect(g.transform.baseVal.getItem(0).type).toBe(1);
    expect(g.transform.baseVal.getItem(0).matrix.a).toBe(1);
    expect(g.transform.baseVal.getItem(0).matrix.f).toBe(6);
    expect(g.transform.baseVal.getItem(1).type).toBe(2);
    expect(g.transform.baseVal.getItem(1).matrix.a).toBe(1);
    expect(g.transform.baseVal.getItem(1).matrix.f).toBe(20);
    const svg = document.createElementNS(SVG_NS, "svg");
    const transform = svg.createSVGTransform();
    expect(transform.type).toBe(0);
    transform.setScale(10, 20);
    expect(transform.type).toBe(3);
    g.transform.baseVal.initialize(transform);
    expect(g.getAttribute("transform")).toBe("scale(10 20)");
    expect(() => g.transform.animVal.initialize(transform)).toThrow(
      "Failed to execute 'initialize' on 'SVGTransformList': The object is read-only.",
    );
  });
});

describe("W8 SVGPoint / SVGPointList", () => {
  test("points reflects attribute, writes back through items and has a read-only animatedPoints", () => {
    const window = freshWindow();
    const document = window.document;
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", "10,10 20,20 30,30");
    expect(polygon.points instanceof window.SVGPointList).toBe(true);
    expect(polygon.points.length).toBe(3);
    expect(polygon.points[2].x).toBe(30);
    polygon.points[0].x = 100;
    polygon.points[0].y = 200;
    expect(polygon.getAttribute("points")).toBe("100 200 20 20 30 30");
    polygon.points.removeItem(1);
    expect(polygon.getAttribute("points")).toBe("100 200 30 30");
    const svg = document.createElementNS(SVG_NS, "svg");
    const point = svg.createSVGPoint();
    expect(point instanceof window.SVGPoint).toBe(true);
    point.x = 300;
    point.y = 400;
    polygon.points.appendItem(point);
    expect(polygon.getAttribute("points")).toBe("100 200 30 30 300 400");
    polygon.points.clear();
    expect(polygon.getAttribute("points")).toBe("");
    polygon.setAttribute("points", "10,10 20,20");
    expect(polygon.animatedPoints instanceof window.SVGPointList).toBe(true);
    expect(polygon.animatedPoints.length).toBe(2);
    expect(() => (polygon.animatedPoints[0].x = 100)).toThrow(
      "Failed to set the 'x' property on 'SVGPoint': The object is read-only.",
    );
    expect(() => polygon.animatedPoints.appendItem(point)).toThrow(
      "Failed to execute 'appendItem' on 'SVGPointList': The object is read-only.",
    );
  });
});

describe("W8 SVGRect / SVGAnimatedRect", () => {
  test("viewBox reads and writes back x/y/width/height with a read-only animVal", () => {
    const window = freshWindow();
    const document = window.document;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "10 20 100 200");
    expect(svg.viewBox instanceof window.SVGAnimatedRect).toBe(true);
    expect(svg.viewBox.baseVal.x).toBe(10);
    expect(svg.viewBox.animVal.height).toBe(200);
    svg.viewBox.baseVal.x = 20;
    svg.viewBox.baseVal.y = 30;
    svg.viewBox.baseVal.width = 200;
    svg.viewBox.baseVal.height = 300;
    expect(svg.getAttribute("viewBox")).toBe("20 30 200 300");
    expect(() => (svg.viewBox.animVal.x = 40)).toThrow(
      "Failed to set the 'x' property on 'SVGRect': The object is read-only.",
    );
  });
});

describe("W8 SVGAngle / SVGAnimatedAngle + orientType", () => {
  test("orientAngle reflects deg and writes back newValueSpecifiedUnits", () => {
    const window = freshWindow();
    const document = window.document;
    const marker = document.createElementNS(SVG_NS, "marker");
    expect(marker.orientAngle instanceof window.SVGAnimatedAngle).toBe(true);
    expect(marker.orientAngle.baseVal.value).toBe(0);
    expect(marker.orientAngle.baseVal.unitType).toBe(window.SVGAngle.SVG_ANGLETYPE_UNKNOWN);
    marker.setAttribute("orient", "90deg");
    expect(marker.orientAngle.baseVal.value).toBe(90);
    expect(marker.orientAngle.baseVal.unitType).toBe(window.SVGAngle.SVG_ANGLETYPE_DEG);
    expect(marker.orientAngle.baseVal.valueAsString).toBe("90deg");
    marker.orientAngle.baseVal.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_RAD, 1.5708);
    expect(marker.getAttribute("orient")).toBe("1.5708rad");
    expect(() =>
      marker.orientAngle.animVal.newValueSpecifiedUnits(window.SVGAngle.SVG_ANGLETYPE_GRAD, 100),
    ).toThrow("Failed to execute 'newValueSpecifiedUnits' on 'SVGAngle': The object is read-only.");
  });

  test("orientType treats any non-auto orient as the angle sentinel and writes '0'", () => {
    const window = freshWindow();
    const document = window.document;
    const marker = document.createElementNS(SVG_NS, "marker");
    expect(marker.orientType.baseVal).toBe(window.SVGMarkerElement.SVG_MARKER_ORIENT_AUTO);
    marker.setAttribute("orient", "90deg");
    expect(marker.orientType.baseVal).toBe(window.SVGMarkerElement.SVG_MARKER_ORIENT_ANGLE);
    marker.removeAttribute("orient");
    marker.orientType.baseVal = window.SVGMarkerElement.SVG_MARKER_ORIENT_ANGLE;
    expect(marker.getAttribute("orient")).toBe("0");
    marker.setOrientToAuto();
    expect(marker.getAttribute("orient")).toBe("auto");
  });
});

describe("W8 SVGLengthList / SVGAnimatedLengthList", () => {
  test("x reflects per-segment lengths and writes back through newValueSpecifiedUnits", () => {
    const window = freshWindow();
    const document = window.document;
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", "10px 20cm 30in 40mm");
    expect(text.x instanceof window.SVGAnimatedLengthList).toBe(true);
    expect(text.x.baseVal.length).toBe(4);
    expect(text.x.baseVal[1].valueInSpecifiedUnits).toBe(20);
    text.x.baseVal[0].newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
    expect(text.getAttribute("x")).toBe("100cm 20cm 30in 40mm");
    expect(() => text.x.animVal[0].newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 20)).toThrow(
      "Failed to execute 'newValueSpecifiedUnits' on 'SVGLength': The object is read-only.",
    );
    text.setAttribute("rotate", "10 20.2 30");
    text.rotate.baseVal[0].value = 100;
    expect(text.getAttribute("rotate")).toBe("100 20.2 30");
    expect(() => (text.rotate.animVal[0].value = 200)).toThrow(
      "Failed to set the 'value' property on 'SVGNumber': The object is read-only.",
    );
  });
});

describe("W8 SVGSVGElement surface", () => {
  test("currentScale ignores values below 1, currentTranslate is an SVGPoint", () => {
    const window = freshWindow();
    const document = window.document;
    const svg = document.createElementNS(SVG_NS, "svg");
    expect(svg.currentScale).toBe(1);
    svg.currentScale = 2;
    svg.currentScale = 0;
    expect(svg.currentScale).toBe(2);
    svg.currentScale = -1;
    expect(svg.currentScale).toBe(2);
    expect(() => (svg.currentScale = "foo")).toThrow(
      "Failed to set the 'currentScale' property on 'SVGSVGElement': The provided float value is non-finite.",
    );
    expect(svg.currentTranslate instanceof window.SVGPoint).toBe(true);
  });

  test("createSVG* factories return the value classes and the transform wraps the matrix", () => {
    const window = freshWindow();
    const document = window.document;
    const svg = document.createElementNS(SVG_NS, "svg");
    expect(svg.createSVGNumber() instanceof window.SVGNumber).toBe(true);
    expect(svg.createSVGLength() instanceof window.SVGLength).toBe(true);
    expect(svg.createSVGAngle() instanceof window.SVGAngle).toBe(true);
    expect(svg.createSVGPoint() instanceof window.SVGPoint).toBe(true);
    expect(svg.createSVGMatrix() instanceof window.SVGMatrix).toBe(true);
    expect(svg.createSVGRect() instanceof window.SVGRect).toBe(true);
    expect(svg.createSVGTransform() instanceof window.SVGTransform).toBe(true);
    const matrix = svg.createSVGMatrix();
    const transform = svg.createSVGTransformFromMatrix(matrix);
    expect(transform.matrix).toBe(matrix);
    expect(svg.getIntersectionList(svg.createSVGRect(), document.createElementNS(SVG_NS, "rect")).length).toBe(0);
    expect(svg.getCurrentTime()).toBe(0);
    expect(svg.checkIntersection(document.createElementNS(SVG_NS, "rect"), svg.createSVGRect())).toBe(false);
  });
});

describe("W8 SVGGeometryElement + SVGGraphicsElement surface", () => {
  test("pathLength reflects and the geometry probes are stubbed like happy-dom", () => {
    const window = freshWindow();
    const document = window.document;
    const circle = document.createElementNS(SVG_NS, "circle");
    expect(circle.pathLength instanceof window.SVGAnimatedNumber).toBe(true);
    circle.setAttribute("pathLength", "2.2");
    expect(circle.pathLength.baseVal).toBe(2.2);
    circle.pathLength.baseVal = 3.3;
    expect(circle.getAttribute("pathLength")).toBe("3.3");
    const svg = document.createElementNS(SVG_NS, "svg");
    expect(circle.isPointInFill(svg.createSVGPoint())).toBe(false);
    expect(circle.isPointInStroke(svg.createSVGPoint())).toBe(false);
    expect(circle.getTotalLength()).toBe(0);
    expect(circle.getPointAtLength(10).x).toBe(0);
  });

  test("SVGGraphicsElement exposes the string lists and geometry stubs", () => {
    const window = freshWindow();
    const document = window.document;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("requiredExtensions", "key1 key2");
    expect(g.requiredExtensions instanceof window.SVGStringList).toBe(true);
    expect(g.requiredExtensions.length).toBe(2);
    g.requiredExtensions.appendItem("key5");
    expect(g.getAttribute("requiredExtensions")).toBe("key1 key2 key5");
    expect(g.getBBox() instanceof window.DOMRect).toBe(true);
    expect(g.getCTM() instanceof window.DOMMatrix).toBe(true);
    expect(g.getScreenCTM() instanceof window.DOMMatrix).toBe(true);
  });
});

describe("W8 SVGStyleElement + computed-style sheet cascade", () => {
  test("media/type/title/disabled reflect with defaults and no disabled attribute write", () => {
    const window = freshWindow();
    const document = window.document;
    const style = document.createElementNS(SVG_NS, "style");
    expect(style.media).toBe("all");
    expect(style.type).toBe("text/css");
    expect(style.title).toBe("");
    expect(style.disabled).toBe(false);
    style.media = "test";
    expect(style.getAttribute("media")).toBe("test");
    style.type = "test";
    expect(style.getAttribute("type")).toBe("test");
    style.title = "test";
    expect(style.getAttribute("title")).toBe("test");
    style.disabled = true;
    expect(style.disabled).toBe(true);
    expect(style.getAttribute("disabled")).toBe(null);
  });

  test("a connected svg <style> sheet feeds matching rules into getComputedStyle", () => {
    const window = freshWindow();
    const document = window.document;
    const style = document.createElementNS(SVG_NS, "style");
    document.head.appendChild(style);
    const textNode = document.createTextNode("body { background-color: red }");
    style.appendChild(textNode);
    expect(style.sheet.cssRules.length).toBe(1);
    const computed = window.getComputedStyle(document.documentElement);
    expect(computed.backgroundColor).toBe("");
    textNode.data = "html { background-color: blue }";
    expect(style.sheet.cssRules.length).toBe(1);
    expect(computed.backgroundColor).toBe("blue");
  });
});
