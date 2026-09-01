// W7 nodes svg element differential port facade additions integration tests.
//
// The W7 (nodes svg 元素, SVGAnimate*–SVGFETurbulence*) diff-port wave added the
// SVG surface to the facade: `document.createElementNS`, the SVG element class
// hierarchy (SVGElement → SVGGraphicsElement → SVGGeometryElement → the
// per-tag classes) and the SVG value classes (SVGAnimatedLength /
// SVGAnimatedString / SVGAnimatedNumber / SVGAnimatedInteger /
// SVGAnimatedBoolean / SVGAnimatedEnumeration / SVGAnimatedNumberList /
// SVGStringList / SVGAnimatedPreserveAspectRatio / …) exposed as `window.SVG*`
// globals. Each addition is pinned by at least one assertion here, mirroring
// the happy-dom behaviour the rewritten svg element tests observed.
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

describe("W7 document.createElementNS", () => {
  test("mints an SVG element with the SVG namespace, verbatim mixed-case name and per-tag class", () => {
    const window = freshWindow();
    const document = window.document;
    const feBlend = document.createElementNS(SVG_NS, "feBlend");
    expect(feBlend instanceof window.SVGFEBlendElement).toBe(true);
    expect(feBlend instanceof window.SVGElement).toBe(true);
    expect(feBlend.namespaceURI).toBe(SVG_NS);
    expect(feBlend.nodeName).toBe("feBlend");
    expect(feBlend.tagName).toBe("feBlend");
    expect(feBlend.localName).toBe("feBlend");
    expect(feBlend.constructor.name).toBe("SVGFEBlendElement");
  });

  test("an unknown SVG tag falls back to SVGElement", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "unknown");
    expect(element instanceof window.SVGElement).toBe(true);
    expect(element.constructor.name).toBe("SVGElement");
  });

  test("a non-SVG namespace returns a plain Element keeping its namespace", () => {
    const window = freshWindow();
    const element = window.document.createElementNS("http://example.com/ns", "thing");
    expect(element.constructor.name).toBe("Element");
    expect(element.namespaceURI).toBe("http://example.com/ns");
    expect(element.nodeName).toBe("thing");
  });

  test("an HTML element still uppercases its nodeName", () => {
    const window = freshWindow();
    const div = window.document.createElement("div");
    expect(div.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    expect(div.nodeName).toBe("DIV");
  });
});

describe("W7 SVG element class hierarchy", () => {
  test("the geometry classes form the happy-dom chain", () => {
    const window = freshWindow();
    const document = window.document;
    const circle = document.createElementNS(SVG_NS, "circle");
    expect(circle instanceof window.SVGCircleElement).toBe(true);
    expect(circle instanceof window.SVGGeometryElement).toBe(true);
    expect(circle instanceof window.SVGGraphicsElement).toBe(true);
    expect(circle instanceof window.SVGElement).toBe(true);
    expect(circle instanceof window.Element).toBe(true);
    const defs = document.createElementNS(SVG_NS, "defs");
    expect(defs instanceof window.SVGDefsElement).toBe(true);
    expect(defs instanceof window.SVGGraphicsElement).toBe(true);
  });

  test("the animation family extends SVGAnimationElement / SVGComponentTransferFunctionElement", () => {
    const window = freshWindow();
    const document = window.document;
    const animate = document.createElementNS(SVG_NS, "animate");
    expect(animate instanceof window.SVGAnimateElement).toBe(true);
    expect(animate instanceof window.SVGAnimationElement).toBe(true);
    const funcA = document.createElementNS(SVG_NS, "feFuncA");
    expect(funcA instanceof window.SVGFEFuncAElement).toBe(true);
    expect(funcA instanceof window.SVGComponentTransferFunctionElement).toBe(true);
  });
});

describe("W7 SVGAnimatedLength reflection", () => {
  test("cx reads the attribute units and writes back through newValueSpecifiedUnits", () => {
    const window = freshWindow();
    const document = window.document;
    const circle = document.createElementNS(SVG_NS, "circle");
    expect(circle.cx instanceof window.SVGAnimatedLength).toBe(true);
    expect(circle.cx).toBe(circle.cx);
    circle.setAttribute("cx", "10cm");
    expect(circle.cx.baseVal.unitType).toBe(window.SVGLength.SVG_LENGTHTYPE_CM);
    expect(circle.cx.baseVal.valueAsString).toBe("10cm");
    expect(circle.cx.baseVal.valueInSpecifiedUnits).toBe(10);
    expect(circle.cx.animVal.unitType).toBe(window.SVGLength.SVG_LENGTHTYPE_CM);
    circle.cx.baseVal.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 20);
    expect(circle.getAttribute("cx")).toBe("20px");
    expect(() =>
      circle.cx.animVal.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 20),
    ).toThrow("Failed to execute 'newValueSpecifiedUnits' on 'SVGLength': The object is read-only.");
  });
});

describe("W7 SVGAnimatedEnumeration / SVGUnitTypes reflection", () => {
  test("clipPathUnits defaults to userSpaceOnUse and reflects objectBoundingBox", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "clipPath");
    expect(element.clipPathUnits instanceof window.SVGAnimatedEnumeration).toBe(true);
    expect(element.clipPathUnits.baseVal).toBe(window.SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE);
    element.setAttribute("clipPathUnits", "objectBoundingBox");
    expect(element.clipPathUnits.baseVal).toBe(window.SVGUnitTypes.SVG_UNIT_TYPE_OBJECTBOUNDINGBOX);
    element.clipPathUnits.baseVal = window.SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE;
    expect(element.getAttribute("clipPathUnits")).toBe("userSpaceOnUse");
  });

  test("feBlend mode reflects every keyword against the public statics", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "feBlend");
    expect(element.mode.baseVal).toBe(window.SVGFEBlendElement.SVG_FEBLEND_MODE_NORMAL);
    element.setAttribute("mode", "color-dodge");
    expect(element.mode.baseVal).toBe(window.SVGFEBlendElement.SVG_FEBLEND_MODE_COLOR_DODGE);
    element.removeAttribute("mode");
    element.mode.baseVal = window.SVGFEBlendElement.SVG_FEBLEND_MODE_COLOR_DODGE;
    expect(element.getAttribute("mode")).toBe("color-dodge");
  });
});

describe("W7 SVGAnimatedNumber / SVGAnimatedInteger / SVGAnimatedBoolean reflection", () => {
  test("slope reflects numbers with a non-finite throw and a non-numeric fallback", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "feFuncA");
    expect(element.slope instanceof window.SVGAnimatedNumber).toBe(true);
    expect(element.slope.baseVal).toBe(1);
    element.setAttribute("slope", "2.2");
    expect(element.slope.baseVal).toBe(2.2);
    element.slope.baseVal = 3.3;
    expect(element.getAttribute("slope")).toBe("3.3");
    element.setAttribute("slope", "test");
    expect(element.slope.baseVal).toBe(1);
    expect(() => (element.slope.baseVal = "test")).toThrow(
      "TypeError: Failed to set the 'baseVal' property on 'SVGAnimatedNumber': The provided float value is non-finite.",
    );
  });

  test("orderX truncates through SVGAnimatedInteger", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "feConvolveMatrix");
    expect(element.orderX instanceof window.SVGAnimatedInteger).toBe(true);
    element.setAttribute("orderX", "20.5");
    expect(element.orderX.baseVal).toBe(20);
    element.orderX.baseVal = 20.6;
    expect(element.getAttribute("orderX")).toBe("20");
  });

  test("preserveAlpha reflects the boolean attribute", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "feConvolveMatrix");
    expect(element.preserveAlpha instanceof window.SVGAnimatedBoolean).toBe(true);
    expect(element.preserveAlpha.baseVal).toBe(false);
    element.setAttribute("preserveAlpha", "true");
    expect(element.preserveAlpha.baseVal).toBe(true);
    element.preserveAlpha.baseVal = false;
    expect(element.getAttribute("preserveAlpha")).toBe("false");
  });
});

describe("W7 SVGAnimatedNumberList / SVGStringList reflection", () => {
  test("values number list reads getItem/index, clears and has a read-only animVal", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "feColorMatrix");
    expect(element.values instanceof window.SVGAnimatedNumberList).toBe(true);
    element.setAttribute("values", "1 2.2 3 4");
    expect(element.values.baseVal.numberOfItems).toBe(4);
    expect(element.values.baseVal.getItem(1).value).toBe(2.2);
    expect(element.values.baseVal[2].value).toBe(3);
    expect(element.values.animVal.numberOfItems).toBe(4);
    element.values.baseVal.clear();
    expect(element.getAttribute("values")).toBe("");
    expect(() => element.values.animVal.appendItem(null)).toThrow(
      "Failed to execute 'appendItem' on 'SVGNumberList': The object is read-only.",
    );
  });

  test("requiredExtensions string list reflects appendItem/removeItem/clear", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "animate");
    expect(element.requiredExtensions instanceof window.SVGStringList).toBe(true);
    element.setAttribute("requiredExtensions", "key1 key2");
    expect(element.requiredExtensions.length).toBe(2);
    expect(element.requiredExtensions[1]).toBe("key2");
    element.requiredExtensions.appendItem("key5");
    expect(element.getAttribute("requiredExtensions")).toBe("key1 key2 key5");
    element.requiredExtensions.removeItem(1);
    expect(element.getAttribute("requiredExtensions")).toBe("key1 key5");
    element.requiredExtensions.clear();
    expect(element.getAttribute("requiredExtensions")).toBe("");
  });
});

describe("W7 SVGAnimatedPreserveAspectRatio reflection", () => {
  test("feImage preserveAspectRatio reads/writes align and meetOrSlice", () => {
    const window = freshWindow();
    const element = window.document.createElementNS(SVG_NS, "feImage");
    expect(element.preserveAspectRatio instanceof window.SVGAnimatedPreserveAspectRatio).toBe(true);
    expect(element.preserveAspectRatio.baseVal.align).toBe(
      window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMIDYMID,
    );
    expect(element.preserveAspectRatio.baseVal.meetOrSlice).toBe(
      window.SVGPreserveAspectRatio.SVG_MEETORSLICE_MEET,
    );
    element.setAttribute("preserveAspectRatio", "xMaxYMin slice");
    expect(element.preserveAspectRatio.baseVal.align).toBe(
      window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMAXYMIN,
    );
    expect(element.preserveAspectRatio.baseVal.meetOrSlice).toBe(
      window.SVGPreserveAspectRatio.SVG_MEETORSLICE_SLICE,
    );
    element.preserveAspectRatio.baseVal.align = window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMAXYMIN;
    element.preserveAspectRatio.baseVal.meetOrSlice = window.SVGPreserveAspectRatio.SVG_MEETORSLICE_MEET;
    expect(element.getAttribute("preserveAspectRatio")).toBe("xMaxYMin meet");
    expect(() => (element.preserveAspectRatio.animVal.align = 1)).toThrow(
      "Failed to set the 'align' property on 'SVGPreserveAspectRatio': The object is read-only.",
    );
  });
});

describe("W7 SVGElement base surface", () => {
  test("ownerSVGElement / viewportElement walk to the nearest svg ancestor", () => {
    const window = freshWindow();
    const document = window.document;
    const svg = document.createElementNS(SVG_NS, "svg");
    const rect = document.createElementNS(SVG_NS, "rect");
    const unknown = document.createElementNS(SVG_NS, "unknown");
    svg.appendChild(rect);
    rect.appendChild(unknown);
    expect(unknown.ownerSVGElement).toBe(svg);
    expect(unknown.viewportElement).toBe(svg);
  });

  test("dataset and tabIndex mirror HTMLElement on SVG elements", () => {
    const window = freshWindow();
    const document = window.document;
    const element = document.createElementNS(SVG_NS, "rect");
    element.dataset.alpha = "1";
    expect(element.getAttribute("data-alpha")).toBe("1");
    element.setAttribute("tabindex", "5");
    expect(element.tabIndex).toBe(5);
    element.tabIndex = -1;
    expect(element.getAttribute("tabindex")).toBe(null);
  });

  test("on* handler-attribute accessors compile the attribute and wire assignments", () => {
    const window = freshWindow({
      settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true },
    });
    const element = window.document.createElementNS(SVG_NS, "rect");
    element.setAttribute("onclick", "window.test = 1");
    expect(typeof element.onclick).toBe("function");
    element.onclick(new window.Event("click"));
    expect(window.test).toBe(1);
    element.removeAttribute("onclick");
    element.onclick = () => {
      window.test = 2;
    };
    element.dispatchEvent(new window.Event("click"));
    expect(window.test).toBe(2);
  });
});
