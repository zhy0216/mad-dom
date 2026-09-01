// Shared observation helpers for the W7 svg element differential scenarios.
//
// The upstream svg-element tests (SVGAnimate* – SVGFETurbulence*) all follow
// the same public pattern: `document.createElementNS(SVG_NS, tag)` + the
// `SVGAnimated*` / `SVGStringList` reflected-property assertions. This module
// factors that observation vocabulary so every scenario records the same
// normalized shape (per the plan §4 "同类元素判定面合并" template).
//
// The `_` prefix keeps this file out of the runner's scenario discovery
// (tests/compat/runner/run.js skips files starting with `_`).

export const SVG_NS = "http://www.w3.org/2000/svg";

// Constructor identity: the public equivalent of the upstream `instanceof
// SVG<Class>` assertions is `instanceof window.SVG<Class>` on a
// `createElementNS`-created element (the same class the window exposes).
export function observeInstanceof(api, window, element, className, baseName = "SVGElement") {
  const key = className.toLowerCase();
  api.record.value(`instanceof-${key}`, element instanceof window[className]);
  if (baseName !== null) {
    api.record.value(`instanceof-${baseName.toLowerCase()}`, element instanceof window[baseName]);
  }
}

// SVGAnimatedLength reflection (cx/cy/r/rx/ry/x/y/width/height).
export function observeLength(api, window, element, prop, attr) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedLength);
  api.record.value(`${prop}-identity`, element[prop] === element[prop]);
  element.setAttribute(attr, "10cm");
  api.record.value(`${prop}-base-unitType`, element[prop].baseVal.unitType);
  api.record.value(`${prop}-base-valueAsString`, element[prop].baseVal.valueAsString);
  api.record.value(`${prop}-base-valueInSpecifiedUnits`, element[prop].baseVal.valueInSpecifiedUnits);
  api.record.value(`${prop}-anim-unitType`, element[prop].animVal.unitType);
  api.record.value(`${prop}-anim-valueAsString`, element[prop].animVal.valueAsString);
  api.record.value(`${prop}-anim-valueInSpecifiedUnits`, element[prop].animVal.valueInSpecifiedUnits);
  element[prop].baseVal.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 20);
  api.record.value(`${prop}-writeback`, element.getAttribute(attr));
  try {
    element[prop].animVal.newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 20);
    api.record.value(`${prop}-anim-readonly`, "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
}

// SVGAnimatedString reflection (in1/in2/result/href).
export function observeString(api, window, element, prop, attr) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedString);
  api.record.value(`${prop}-identity`, element[prop] === element[prop]);
  element.setAttribute(attr, "SourceGraphic");
  api.record.value(`${prop}-base`, element[prop].baseVal);
  api.record.value(`${prop}-anim`, element[prop].animVal);
  element[prop].baseVal = "BackgroundImage";
  api.record.value(`${prop}-writeback`, element.getAttribute(attr));
  element[prop].animVal = "Test";
  api.record.value(`${prop}-anim-write-noop`, element.getAttribute(attr));
}

// SVGAnimatedNumber reflection with an explicit default (bias/divisor/slope/…).
export function observeNumber(api, window, element, prop, attr, defaultValue = 0) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedNumber);
  api.record.value(`${prop}-identity`, element[prop] === element[prop]);
  api.record.value(`${prop}-default-base`, element[prop].baseVal);
  api.record.value(`${prop}-default-anim`, element[prop].animVal);
  element.setAttribute(attr, "10");
  api.record.value(`${prop}-base`, element[prop].baseVal);
  api.record.value(`${prop}-anim`, element[prop].animVal);
  element[prop].baseVal = 20;
  api.record.value(`${prop}-writeback`, element.getAttribute(attr));
  element[prop].animVal = 30;
  api.record.value(`${prop}-anim-write-noop`, element.getAttribute(attr));
  element.setAttribute(attr, "test");
  api.record.value(`${prop}-nonnumber-base`, element[prop].baseVal);
  api.record.value(`${prop}-nonnumber-anim`, element[prop].animVal);
  try {
    element[prop].baseVal = "test";
    api.record.value(`${prop}-nonfinite`, "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
}

// SVGAnimatedInteger reflection (orderX/orderY/targetX/targetY/numOctaves).
export function observeInteger(api, window, element, prop, attr) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedInteger);
  element.setAttribute(attr, "10");
  api.record.value(`${prop}-base`, element[prop].baseVal);
  api.record.value(`${prop}-anim`, element[prop].animVal);
  element[prop].baseVal = 20;
  api.record.value(`${prop}-writeback`, element.getAttribute(attr));
  element.setAttribute(attr, "20.5");
  api.record.value(`${prop}-truncate-read`, element[prop].baseVal);
  element[prop].baseVal = 20.6;
  api.record.value(`${prop}-truncate-write`, element.getAttribute(attr));
  element[prop].animVal = 30;
  api.record.value(`${prop}-anim-write-noop`, element.getAttribute(attr));
}

// SVGAnimatedBoolean reflection (preserveAlpha).
export function observeBoolean(api, window, element, prop, attr) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedBoolean);
  api.record.value(`${prop}-default`, element[prop].baseVal);
  api.record.value(`${prop}-default-anim`, element[prop].animVal);
  element.setAttribute(attr, "true");
  api.record.value(`${prop}-base`, element[prop].baseVal);
  api.record.value(`${prop}-anim`, element[prop].animVal);
  element[prop].baseVal = false;
  api.record.value(`${prop}-writeback`, element.getAttribute(attr));
  element[prop].animVal = true;
  api.record.value(`${prop}-anim-write-noop`, element.getAttribute(attr));
}

// SVGAnimatedEnumeration reflection (mode/type/edgeMode/operator/stitchTiles/
// clipPathUnits/xChannelSelector/yChannelSelector). `constantOf` maps an enum
// keyword to the class static (e.g. "multiply" → window.SVGFEBlendElement.
// SVG_FEBLEND_MODE_MULTIPLY) — the public equivalent of the upstream internal
// class static reads.
export function observeEnumeration(api, window, element, prop, attr, values, defaultValue, constantOf) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedEnumeration);
  api.record.value(`${prop}-default-base`, element[prop].baseVal);
  api.record.value(`${prop}-default-anim`, element[prop].animVal);
  for (const value of values) {
    const constant = constantOf(value);
    element.setAttribute(attr, value);
    api.record.value(`${prop}-${value}-base`, element[prop].baseVal);
    api.record.value(`${prop}-${value}-anim`, element[prop].animVal);
    element.removeAttribute(attr);
    element[prop].baseVal = constant;
    api.record.value(`${prop}-${value}-writeback`, element.getAttribute(attr));
    element.removeAttribute(attr);
    element[prop].animVal = constantOf(defaultValue);
    api.record.value(`${prop}-${value}-anim-write-noop`, element.getAttribute(attr));
  }
}

// SVGAnimatedNumberList reflection (values/kernelMatrix/tableValues).
// The upstream `new window.SVGNumber(…)` appendItem assertion is dropped:
// `SVGNumber` has no public constructor (happy-dom requires an internal
// constructor symbol), so it is not reproducible via the public surface
// (plan §4).
export function observeNumberList(api, window, element, prop, attr) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedNumberList);
  element.setAttribute(attr, "1 2.2 3 4");
  api.record.value(`${prop}-base-numberOfItems`, element[prop].baseVal.numberOfItems);
  api.record.value(`${prop}-base-item0`, element[prop].baseVal.getItem(0).value);
  api.record.value(`${prop}-base-item1`, element[prop].baseVal.getItem(1).value);
  api.record.value(`${prop}-base-item2`, element[prop].baseVal.getItem(2).value);
  api.record.value(`${prop}-base-item3`, element[prop].baseVal.getItem(3).value);
  api.record.value(`${prop}-anim-numberOfItems`, element[prop].animVal.numberOfItems);
  api.record.value(`${prop}-anim-item0`, element[prop].animVal.getItem(0).value);
  api.record.value(`${prop}-anim-item1`, element[prop].animVal.getItem(1).value);
  api.record.value(`${prop}-anim-item2`, element[prop].animVal.getItem(2).value);
  api.record.value(`${prop}-anim-item3`, element[prop].animVal.getItem(3).value);
  element.setAttribute(attr, "7 8 9");
  api.record.value(`${prop}-reset-length`, element[prop].baseVal.length);
  api.record.value(`${prop}-reset-index0`, element[prop].baseVal[0].value);
  api.record.value(`${prop}-reset-index1`, element[prop].baseVal[1].value);
  api.record.value(`${prop}-reset-index2`, element[prop].baseVal[2].value);
  element[prop].baseVal.clear();
  api.record.value(`${prop}-clear`, element.getAttribute(attr));
  try {
    element[prop].animVal.appendItem(null);
    api.record.value(`${prop}-anim-append`, "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
}

// SVGStringList reflection (requiredExtensions/systemLanguage).
export function observeStringList(api, window, element, prop, attr) {
  api.record.value(`${prop}-type`, element[prop] instanceof window.SVGStringList);
  api.record.value(`${prop}-identity`, element[prop] === element[prop]);
  element.setAttribute(attr, "key1 key2");
  api.record.value(`${prop}-length`, element[prop].length);
  api.record.value(`${prop}-index0`, element[prop][0]);
  api.record.value(`${prop}-index1`, element[prop][1]);
  element.setAttribute(attr, "key3 key4");
  api.record.value(`${prop}-relength`, element[prop].length);
  api.record.value(`${prop}-reindex0`, element[prop][0]);
  api.record.value(`${prop}-reindex1`, element[prop][1]);
  element[prop].appendItem("key5");
  api.record.value(`${prop}-append`, element.getAttribute(attr));
  element[prop].removeItem(1);
  api.record.value(`${prop}-remove`, element.getAttribute(attr));
  element[prop].clear();
  api.record.value(`${prop}-clear`, element.getAttribute(attr));
}

// SVGAnimatedPreserveAspectRatio reflection (feImage preserveAspectRatio).
export function observePreserveAspectRatio(api, window, element) {
  api.record.value(
    "preserveAspectRatio-type",
    element.preserveAspectRatio instanceof window.SVGAnimatedPreserveAspectRatio,
  );
  api.record.value("preserveAspectRatio-default-align", element.preserveAspectRatio.baseVal.align);
  api.record.value("preserveAspectRatio-default-meetOrSlice", element.preserveAspectRatio.baseVal.meetOrSlice);
  element.setAttribute("preserveAspectRatio", "xMaxYMin slice");
  api.record.value("preserveAspectRatio-base-align", element.preserveAspectRatio.baseVal.align);
  api.record.value("preserveAspectRatio-anim-align", element.preserveAspectRatio.animVal.align);
  api.record.value("preserveAspectRatio-base-meetOrSlice", element.preserveAspectRatio.baseVal.meetOrSlice);
  api.record.value("preserveAspectRatio-anim-meetOrSlice", element.preserveAspectRatio.animVal.meetOrSlice);
  element.preserveAspectRatio.baseVal.align = window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMAXYMIN;
  element.preserveAspectRatio.baseVal.meetOrSlice = window.SVGPreserveAspectRatio.SVG_MEETORSLICE_MEET;
  api.record.value("preserveAspectRatio-writeback", element.getAttribute("preserveAspectRatio"));
  try {
    element.preserveAspectRatio.animVal.align = window.SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMINYMIN;
    api.record.value("preserveAspectRatio-anim-align-readonly", "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
  try {
    element.preserveAspectRatio.animVal.meetOrSlice = window.SVGPreserveAspectRatio.SVG_MEETORSLICE_SLICE;
    api.record.value("preserveAspectRatio-anim-meetOrSlice-readonly", "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
}

// The `on<event>` handler-attribute observation shared by SVGElement (a
// representative subset of the upstream event list) and the animation element
// (begin / end / repeat). The upstream getter test compiles the attribute
// string into a listener and invokes it; the upstream setter test assigns a
// listener to a fresh element and dispatches the event (asserting the
// assignment never writes the attribute back).
export function observeEventHandler(api, window, element, eventName, recordPrefix) {
  element.setAttribute(`on${eventName}`, "window.test = 1");
  api.record.value(`${recordPrefix}${eventName}-getter-type`, typeof element[`on${eventName}`]);
  element[`on${eventName}`](new window.Event(eventName));
  api.record.value(`${recordPrefix}${eventName}-attr-called`, window.test);
  element.removeAttribute(`on${eventName}`);
  element[`on${eventName}`] = () => {
    window.test = 2;
  };
  element.dispatchEvent(new window.Event(eventName));
  api.record.value(`${recordPrefix}${eventName}-assigned-called`, window.test);
  api.record.value(`${recordPrefix}${eventName}-attr-removed`, element.getAttribute(`on${eventName}`));
}

// SVGAnimatedTransformList reflection (g transform / gradientTransform /
// patternTransform). The upstream write-back path constructs the transform
// through the internal `new window.SVGTransform(illegalConstructor, window)`;
// the public equivalent creates it through a scratch `<svg>` element's
// `createSVGTransform()` (the public mint entry both ends expose).
export function observeTransformList(api, window, element, prop, attr) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedTransformList);
  api.record.value(`${prop}-identity`, element[prop] === element[prop]);
  element.setAttribute(attr, "matrix(1 2 3 4 5 6) translate(10 20)");
  api.record.value(`${prop}-base-numberOfItems`, element[prop].baseVal.numberOfItems);
  api.record.value(`${prop}-base-item0-type`, element[prop].baseVal.getItem(0).type);
  api.record.value(`${prop}-base-item0-matrix-a`, element[prop].baseVal.getItem(0).matrix.a);
  api.record.value(`${prop}-base-item0-matrix-b`, element[prop].baseVal.getItem(0).matrix.b);
  api.record.value(`${prop}-base-item0-matrix-c`, element[prop].baseVal.getItem(0).matrix.c);
  api.record.value(`${prop}-base-item0-matrix-d`, element[prop].baseVal.getItem(0).matrix.d);
  api.record.value(`${prop}-base-item0-matrix-e`, element[prop].baseVal.getItem(0).matrix.e);
  api.record.value(`${prop}-base-item0-matrix-f`, element[prop].baseVal.getItem(0).matrix.f);
  api.record.value(`${prop}-base-item1-type`, element[prop].baseVal.getItem(1).type);
  api.record.value(`${prop}-base-item1-matrix-a`, element[prop].baseVal.getItem(1).matrix.a);
  api.record.value(`${prop}-base-item1-matrix-b`, element[prop].baseVal.getItem(1).matrix.b);
  api.record.value(`${prop}-base-item1-matrix-c`, element[prop].baseVal.getItem(1).matrix.c);
  api.record.value(`${prop}-base-item1-matrix-d`, element[prop].baseVal.getItem(1).matrix.d);
  api.record.value(`${prop}-base-item1-matrix-e`, element[prop].baseVal.getItem(1).matrix.e);
  api.record.value(`${prop}-base-item1-matrix-f`, element[prop].baseVal.getItem(1).matrix.f);
  api.record.value(`${prop}-anim-numberOfItems`, element[prop].animVal.numberOfItems);
  api.record.value(`${prop}-anim-item0-type`, element[prop].animVal.getItem(0).type);
  api.record.value(`${prop}-anim-item0-matrix-a`, element[prop].animVal.getItem(0).matrix.a);
  api.record.value(`${prop}-anim-item1-type`, element[prop].animVal.getItem(1).type);
  api.record.value(`${prop}-anim-item1-matrix-e`, element[prop].animVal.getItem(1).matrix.e);
  const transform = svgPublicMint(window, "createSVGTransform");
  transform.setScale(10, 20);
  element[prop].baseVal.initialize(transform);
  api.record.value(`${prop}-initialize-writeback`, element.getAttribute(attr));
  try {
    element[prop].animVal.initialize(transform);
    api.record.value(`${prop}-anim-initialize`, "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
}

// SVGPointList reflection (polygon/polyline points + read-only animatedPoints).
// The upstream `new window.SVGPoint(illegalConstructor, window)` construction
// is replaced by the public `createSVGPoint()` mint.
export function observePointList(api, window, element, prop, attr) {
  api.record.value(`${prop}-type`, element[prop] instanceof window.SVGPointList);
  api.record.value(`${prop}-identity`, element[prop] === element[prop]);
  element.setAttribute(attr, "10,10 20,20 30,30");
  api.record.value(`${prop}-length`, element[prop].length);
  api.record.value(`${prop}-item0-x`, element[prop][0].x);
  api.record.value(`${prop}-item0-y`, element[prop][0].y);
  api.record.value(`${prop}-item1-x`, element[prop][1].x);
  api.record.value(`${prop}-item1-y`, element[prop][1].y);
  api.record.value(`${prop}-item2-x`, element[prop][2].x);
  api.record.value(`${prop}-item2-y`, element[prop][2].y);
  element.setAttribute(attr, "10 20 30 40 50 60");
  api.record.value(`${prop}-relength`, element[prop].length);
  api.record.value(`${prop}-reitem0-x`, element[prop][0].x);
  api.record.value(`${prop}-reitem0-y`, element[prop][0].y);
  api.record.value(`${prop}-reitem2-x`, element[prop][2].x);
  api.record.value(`${prop}-reitem2-y`, element[prop][2].y);
  element.setAttribute(attr, "10,10 20,20 30,30");
  element[prop][0].x = 100;
  element[prop][0].y = 200;
  api.record.value(`${prop}-writeback`, element.getAttribute(attr));
  element[prop].removeItem(1);
  api.record.value(`${prop}-remove`, element.getAttribute(attr));
  const point = svgPublicMint(window, "createSVGPoint");
  point.x = 300;
  point.y = 400;
  element[prop].appendItem(point);
  api.record.value(`${prop}-append`, element.getAttribute(attr));
  element[prop].clear();
  api.record.value(`${prop}-clear`, element.getAttribute(attr));
}

// SVGAnimatedLengthList reflection (text x/y/dx/dy). The read-only animVal
// write is the same SVGLength read-only error observed in observeLength.
export function observeLengthList(api, window, element, prop, attr) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedLengthList);
  api.record.value(`${prop}-identity`, element[prop] === element[prop]);
  element.setAttribute(attr, "10px 20cm 30in 40mm");
  api.record.value(`${prop}-base-length`, element[prop].baseVal.length);
  api.record.value(`${prop}-base-item0-vius`, element[prop].baseVal[0].valueInSpecifiedUnits);
  api.record.value(`${prop}-base-item1-vius`, element[prop].baseVal[1].valueInSpecifiedUnits);
  api.record.value(`${prop}-base-item2-vius`, element[prop].baseVal[2].valueInSpecifiedUnits);
  api.record.value(`${prop}-base-item3-vius`, element[prop].baseVal[3].valueInSpecifiedUnits);
  api.record.value(`${prop}-anim-length`, element[prop].animVal.length);
  api.record.value(`${prop}-anim-item0-vius`, element[prop].animVal[0].valueInSpecifiedUnits);
  api.record.value(`${prop}-anim-item1-vius`, element[prop].animVal[1].valueInSpecifiedUnits);
  element[prop].baseVal[0].newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_CM, 100);
  api.record.value(`${prop}-writeback`, element.getAttribute(attr));
  try {
    element[prop].animVal[0].newValueSpecifiedUnits(window.SVGLength.SVG_LENGTHTYPE_PX, 20);
    api.record.value(`${prop}-anim-write`, "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
}

// SVGAnimatedNumberList rotate write-back (text rotate): baseVal[0].value
// re-serializes the list and the animVal item is read-only.
export function observeRotateList(api, window, element) {
  element.setAttribute("rotate", "10 20.2 30");
  api.record.value("rotate-type", element.rotate instanceof window.SVGAnimatedNumberList);
  api.record.value("rotate-base-length", element.rotate.baseVal.length);
  api.record.value("rotate-base-item0", element.rotate.baseVal[0].value);
  api.record.value("rotate-base-item1", element.rotate.baseVal[1].value);
  api.record.value("rotate-base-item2", element.rotate.baseVal[2].value);
  api.record.value("rotate-anim-item0", element.rotate.animVal[0].value);
  element.rotate.baseVal[0].value = 100;
  api.record.value("rotate-writeback", element.getAttribute("rotate"));
  try {
    element.rotate.animVal[0].value = 200;
    api.record.value("rotate-anim-write", "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
}

// SVGAnimatedRect reflection (marker/svg viewBox).
export function observeRect(api, window, element, prop, attr) {
  api.record.value(`${prop}-type`, element[prop] instanceof window.SVGAnimatedRect);
  element.setAttribute(attr, "10 20 100 200");
  api.record.value(`${prop}-base-x`, element[prop].baseVal.x);
  api.record.value(`${prop}-base-y`, element[prop].baseVal.y);
  api.record.value(`${prop}-base-width`, element[prop].baseVal.width);
  api.record.value(`${prop}-base-height`, element[prop].baseVal.height);
  api.record.value(`${prop}-anim-x`, element[prop].animVal.x);
  api.record.value(`${prop}-anim-y`, element[prop].animVal.y);
  api.record.value(`${prop}-anim-width`, element[prop].animVal.width);
  api.record.value(`${prop}-anim-height`, element[prop].animVal.height);
  element[prop].baseVal.x = 20;
  element[prop].baseVal.y = 30;
  element[prop].baseVal.width = 200;
  element[prop].baseVal.height = 300;
  api.record.value(`${prop}-writeback`, element.getAttribute(attr));
  try {
    element[prop].animVal.x = 40;
    api.record.value(`${prop}-anim-write`, "no-throw");
  } catch (error) {
    api.record.error(error, "sync-throw");
  }
}

// SVGAnimatedEnumeration reflection using window.SVGUnitTypes statics
// (filterUnits / primitiveUnits / gradientUnits / maskUnits / …).
export function observeUnitEnumeration(api, window, element, prop, attr, defaultValue) {
  api.record.value(`${prop}-animated-type`, element[prop] instanceof window.SVGAnimatedEnumeration);
  api.record.value(`${prop}-default-base`, element[prop].baseVal);
  api.record.value(`${prop}-default-anim`, element[prop].animVal);
  for (const value of ["userSpaceOnUse", "objectBoundingBox"]) {
    const constant = window.SVGUnitTypes[`SVG_UNIT_TYPE_${value.toUpperCase()}`];
    element.setAttribute(attr, value);
    api.record.value(`${prop}-${value}-base`, element[prop].baseVal);
    api.record.value(`${prop}-${value}-anim`, element[prop].animVal);
    element.removeAttribute(attr);
    element[prop].baseVal = constant;
    api.record.value(`${prop}-${value}-writeback`, element.getAttribute(attr));
    element.removeAttribute(attr);
    element[prop].animVal = window.SVGUnitTypes[`SVG_UNIT_TYPE_${defaultValue.toUpperCase()}`];
    api.record.value(`${prop}-${value}-anim-write-noop`, element.getAttribute(attr));
  }
}

// Mint a value object through the public `<svg>` element factory surface (the
// public equivalent of the upstream internal `new window.SVG<Value>(…,
// PropertySymbol.illegalConstructor, …)` constructions).
export function svgPublicMint(window, method) {
  const svg = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  return svg[method]();
}
