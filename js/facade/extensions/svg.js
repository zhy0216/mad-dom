// SVG element + value surface (W7 svg element wave, differential-port D07).
//
// The nodes svg wave ports the happy-dom (MIT) svg-element test files
// (`SVGAnimate*` – `SVGFETurbulence*`) to the differential suite. The upstream
// tests construct elements through the public `document.createElementNS(svgNS,
// tag)` and read/write the public SVG animated-value reflections, so the
// scenario surface is exactly: `createElementNS` + the per-element reflected
// properties + the `window.SVG*` classes. This extension implements that
// surface on the facade:
//
//   - `document.createElementNS` (the native `createElementNS` mints the node
//     in the requested namespace; the facade wires the SVG namespace to the
//     happy-dom tag → class selection);
//   - the SVG element class hierarchy (`SVGElement → Element`,
//     `SVGGraphicsElement`, `SVGGeometryElement`, the concrete per-tag classes
//     and the `SVGAnimationElement` animation family), each exposing the
//     happy-dom reflected properties (`cx` / `cy` / `r` / `width` / `x` / … as
//     `SVGAnimated*` objects and the static enum constants);
//   - the SVG value classes (`SVGLength`, `SVGAnimatedLength`,
//     `SVGAnimatedString`, `SVGAnimatedNumber`, `SVGAnimatedInteger`,
//     `SVGAnimatedBoolean`, `SVGAnimatedEnumeration`, `SVGNumber`,
//     `SVGNumberList`, `SVGAnimatedNumberList`, `SVGStringList`, `SVGUnitTypes`,
//     `SVGPreserveAspectRatio`, `SVGAnimatedPreserveAspectRatio`) with the
//     happy-dom parsing / write-back semantics;
//   - the `window.SVG*` globals happy-dom exposes (the same classes the
//     scenarios do `instanceof` against).
//
// Everything is facade-only: every attribute read/write routes through the
// native handle (`getAttribute` / `setAttribute`), so there is no second DOM
// state and the per-element `SVGAnimated*` objects stay pure reflections.

import {
  Element,
  nodeHandleOf,
  registerSvgElementClass,
  setSvgElementFallbackClass,
} from "./classes.js";
import { Document } from "../document.js";
import { Window } from "../window.js";
import { datasetFor } from "./html-element.js";
import { eventHandlerGetter, eventHandlerSetter } from "./hdunit-nodes.js";
import { Event } from "./events.js";
import { rethrowDomError, webidlMessage } from "./dom-error.js";
import { DOMMatrix } from "./dom-matrix.js";
import { DOMRect } from "./dom-geometry.js";
import { NodeList } from "./child-nodelist.js";

export const seam = Object.freeze({
  id: "facade/extensions/svg",
  owner: "W7",
  gate: "W7",
  status: "implemented",
});

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// The value-class "illegal constructor" mint token. happy-dom guards these
// classes with `PropertySymbol.illegalConstructor`; the facade mirrors that by
// requiring this module-local token so `new window.SVGLength()` throws
// `TypeError: Illegal constructor` like the baseline.
const MINT = Symbol("mad-dom svg value mint");

// Lazy per-element cache of the `SVGAnimated*` value objects (happy-dom's
// `[PropertySymbol.<prop>] = null` slots: one stable object per (element,
// property), so `element.cx === element.cx` holds).
const ANIMATED = new WeakMap();

function animatedState(element) {
  let state = ANIMATED.get(element);
  if (state === undefined) {
    state = {};
    ANIMATED.set(element, state);
  }
  return state;
}

function animatedLength(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedLength(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedString(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedString(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedNumber(element, attr, defaultValue = 0) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedNumber(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
      defaultValue,
    });
  }
  return state[attr];
}

// happy-dom feGaussianBlur's `stdDeviationX` / `stdDeviationY` default through
// the getter (`getAttribute('stdDeviationX') || '2'`), so a non-numeric
// attribute value still reads 0 (SVGAnimatedNumber's default) while an absent
// attribute reads 2. The facade mirrors that with a fallback string.
function animatedNumberWithFallback(element, attr, fallback) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedNumber(MINT, {
      getAttribute: () => element.getAttribute(attr) || fallback,
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedInteger(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedInteger(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedBoolean(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedBoolean(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedEnumeration(element, attr, values, defaultValue, attributeName = attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedEnumeration(MINT, {
      getAttribute: () => element.getAttribute(attributeName),
      setAttribute: (value) => element.setAttribute(attributeName, value),
      values,
      defaultValue,
    });
  }
  return state[attr];
}

function animatedNumberList(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedNumberList(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedPreserveAspectRatio(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedPreserveAspectRatio(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedTransformList(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedTransformList(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedRect(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedRect(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function animatedAngle(element, attr, attributeName = attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedAngle(MINT, {
      getAttribute: () => element.getAttribute(attributeName),
      setAttribute: (value) => element.setAttribute(attributeName, value),
    });
  }
  return state[attr];
}

function animatedLengthList(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGAnimatedLengthList(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

function pointList(element, attr, attributeName = attr, readOnly = false) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGPointList(MINT, {
      readOnly,
      getAttribute: () => element.getAttribute(attributeName),
      setAttribute: (value) => element.setAttribute(attributeName, value),
    });
  }
  return state[attr];
}

function stringList(element, attr) {
  const state = animatedState(element);
  if (state[attr] === undefined) {
    state[attr] = new SVGStringList(MINT, {
      getAttribute: () => element.getAttribute(attr),
      setAttribute: (value) => element.setAttribute(attr, value),
    });
  }
  return state[attr];
}

// ── SVG value classes ───────────────────────────────────────────────────────

// happy-dom SVGLengthTypeEnum values (vendor-src literal source).
const LENGTH_TYPE_UNKNOWN = 0;
const LENGTH_TYPE_NUMBER = 1;
const LENGTH_TYPE_PERCENTAGE = 2;
const LENGTH_TYPE_EMS = 3;
const LENGTH_TYPE_EXS = 4;
const LENGTH_TYPE_PX = 5;
const LENGTH_TYPE_CM = 6;
const LENGTH_TYPE_MM = 7;
const LENGTH_TYPE_IN = 8;
const LENGTH_TYPE_PT = 9;
const LENGTH_TYPE_PC = 10;

const LENGTH_ATTRIBUTE_REGEXP = /^(\d+|\d+\.\d+)(px|em|ex|cm|mm|in|pt|pc|%|)$/;

class SVGLength {
  static SVG_LENGTHTYPE_UNKNOWN = LENGTH_TYPE_UNKNOWN;
  static SVG_LENGTHTYPE_NUMBER = LENGTH_TYPE_NUMBER;
  static SVG_LENGTHTYPE_PERCENTAGE = LENGTH_TYPE_PERCENTAGE;
  static SVG_LENGTHTYPE_EMS = LENGTH_TYPE_EMS;
  static SVG_LENGTHTYPE_EXS = LENGTH_TYPE_EXS;
  static SVG_LENGTHTYPE_PX = LENGTH_TYPE_PX;
  static SVG_LENGTHTYPE_CM = LENGTH_TYPE_CM;
  static SVG_LENGTHTYPE_MM = LENGTH_TYPE_MM;
  static SVG_LENGTHTYPE_IN = LENGTH_TYPE_IN;
  static SVG_LENGTHTYPE_PT = LENGTH_TYPE_PT;
  static SVG_LENGTHTYPE_PC = LENGTH_TYPE_PC;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    if (options) {
      this.readOnly = !!options.readOnly;
      this.getAttribute = options.getAttribute || null;
      this.setAttribute = options.setAttribute || null;
    } else {
      this.readOnly = false;
      this.getAttribute = null;
      this.setAttribute = null;
    }
  }

  get unitType() {
    const attributeValue = this.getAttribute ? this.getAttribute() || "" : "";
    const match = attributeValue.match(LENGTH_ATTRIBUTE_REGEXP);
    if (!match) {
      return LENGTH_TYPE_UNKNOWN;
    }
    if (Number.isNaN(parseFloat(match[1]))) {
      return LENGTH_TYPE_UNKNOWN;
    }
    switch (match[2]) {
      case "":
        return LENGTH_TYPE_NUMBER;
      case "px":
        return LENGTH_TYPE_PX;
      case "cm":
        return LENGTH_TYPE_CM;
      case "mm":
        return LENGTH_TYPE_MM;
      case "in":
        return LENGTH_TYPE_IN;
      case "pt":
        return LENGTH_TYPE_PT;
      case "pc":
        return LENGTH_TYPE_PC;
      case "em":
      case "ex":
      case "%":
        throw new TypeError("Failed to execute 'value' on 'SVGLength': Could not resolve relative length.");
      default:
        return LENGTH_TYPE_UNKNOWN;
    }
  }

  get value() {
    const attributeValue = this.getAttribute ? this.getAttribute() || "" : "";
    const match = attributeValue.match(LENGTH_ATTRIBUTE_REGEXP);
    if (!match) {
      return 0;
    }
    const parsedValue = parseFloat(match[1]);
    if (Number.isNaN(parsedValue)) {
      return 0;
    }
    switch (match[2]) {
      case "":
        return parsedValue;
      case "px":
        return parsedValue;
      case "cm":
        return (parsedValue / 2.54) * 96;
      case "mm":
        return (parsedValue / 25.4) * 96;
      case "in":
        return parsedValue * 96;
      case "pt":
        return parsedValue * 72;
      case "pc":
        return parsedValue * 6;
      case "em":
      case "ex":
      case "%":
        throw new TypeError("Failed to execute 'value' on 'SVGLength': Could not resolve relative length.");
      default:
        return 0;
    }
  }

  set value(value) {
    if (this.readOnly) {
      throw new TypeError("Failed to set the 'value' property on 'SVGLength': The object is read-only.");
    }
    value = typeof value !== "number" ? parseFloat(String(value)) : value;
    if (Number.isNaN(value)) {
      throw new TypeError("Failed to set the 'value' property on 'SVGLength': The provided float value is non-finite.");
    }
    let unitType = "";
    let valueInSpecifiedUnits = value;
    switch (this.unitType) {
      case LENGTH_TYPE_NUMBER:
        valueInSpecifiedUnits = value;
        unitType = "";
        break;
      case LENGTH_TYPE_PX:
        valueInSpecifiedUnits = value;
        unitType = "px";
        break;
      case LENGTH_TYPE_CM:
        valueInSpecifiedUnits = (value / 96) * 2.54;
        unitType = "cm";
        break;
      case LENGTH_TYPE_MM:
        valueInSpecifiedUnits = (value / 96) * 25.4;
        unitType = "mm";
        break;
      case LENGTH_TYPE_IN:
        valueInSpecifiedUnits = value / 96;
        unitType = "in";
        break;
      case LENGTH_TYPE_PT:
        valueInSpecifiedUnits = value / 72;
        unitType = "pt";
        break;
      case LENGTH_TYPE_PC:
        valueInSpecifiedUnits = value / 6;
        unitType = "pc";
        break;
      case LENGTH_TYPE_PERCENTAGE:
      case LENGTH_TYPE_EMS:
      case LENGTH_TYPE_EXS:
        throw new TypeError("Failed to set the 'value' property on 'SVGLength': Could not resolve relative length.");
      default:
        break;
    }
    if (this.setAttribute) {
      this.setAttribute(String(valueInSpecifiedUnits) + unitType);
    }
  }

  get valueAsString() {
    return this.getAttribute ? this.getAttribute() || "0" : "0";
  }

  get valueInSpecifiedUnits() {
    const attributeValue = this.valueAsString;
    return parseFloat(attributeValue) || 0;
  }

  newValueSpecifiedUnits(unitType, value) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'newValueSpecifiedUnits' on 'SVGLength': The object is read-only.");
    }
    if (typeof unitType !== "number") {
      throw new TypeError("Failed to execute 'newValueSpecifiedUnits' on 'SVGLength': parameter 1 ('unitType') is not of type 'number'.");
    }
    value = typeof value !== "number" ? parseFloat(String(value)) : value;
    if (Number.isNaN(value)) {
      throw new TypeError("Failed to execute 'newValueSpecifiedUnits' on 'SVGLength': The provided float value is non-finite.");
    }
    let unit = "";
    switch (unitType) {
      case LENGTH_TYPE_NUMBER:
        unit = "";
        break;
      case LENGTH_TYPE_PX:
        unit = "px";
        break;
      case LENGTH_TYPE_CM:
        unit = "cm";
        break;
      case LENGTH_TYPE_MM:
        unit = "mm";
        break;
      case LENGTH_TYPE_IN:
        unit = "in";
        break;
      case LENGTH_TYPE_PT:
        unit = "pt";
        break;
      case LENGTH_TYPE_PC:
        unit = "pc";
        break;
      case LENGTH_TYPE_EMS:
      case LENGTH_TYPE_EXS:
      case LENGTH_TYPE_PERCENTAGE:
        throw new TypeError("Failed to execute 'newValueSpecifiedUnits' on 'SVGLength': Could not resolve relative length.");
      default:
        break;
    }
    if (this.setAttribute) {
      this.setAttribute(String(value) + unit);
    }
  }

  convertToSpecifiedUnits(unitType) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'convertToSpecifiedUnits' on 'SVGLength': The object is read-only.");
    }
    if (typeof unitType !== "number") {
      throw new TypeError("Failed to execute 'convertToSpecifiedUnits' on 'SVGLength': parameter 1 ('unitType') is not of type 'number'.");
    }
    let value = this.value;
    let unit = "";
    switch (unitType) {
      case LENGTH_TYPE_NUMBER:
        unit = "";
        break;
      case LENGTH_TYPE_PX:
        unit = "px";
        break;
      case LENGTH_TYPE_CM:
        value = (value / 96) * 2.54;
        unit = "cm";
        break;
      case LENGTH_TYPE_MM:
        value = (value / 96) * 25.4;
        unit = "mm";
        break;
      case LENGTH_TYPE_IN:
        value = value / 96;
        unit = "in";
        break;
      case LENGTH_TYPE_PT:
        value = value / 72;
        unit = "pt";
        break;
      case LENGTH_TYPE_PC:
        value = value / 6;
        unit = "pc";
        break;
      case LENGTH_TYPE_PERCENTAGE:
      case LENGTH_TYPE_EMS:
      case LENGTH_TYPE_EXS:
        throw new TypeError("Failed to execute 'convertToSpecifiedUnits' on 'SVGLength': Could not resolve relative length.");
      default:
        break;
    }
    if (this.setAttribute) {
      this.setAttribute(String(value) + unit);
    }
  }
}

class SVGAnimatedLength {
  #baseVal = null;
  #animVal = null;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    if (this.#animVal === null) {
      this.#animVal = new SVGLength(MINT, {
        readOnly: true,
        getAttribute: this.getAttribute,
      });
    }
    return this.#animVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    if (this.#baseVal === null) {
      this.#baseVal = new SVGLength(MINT, {
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
    }
    return this.#baseVal;
  }

  set baseVal(_value) {
    // Do nothing
  }
}

class SVGAnimatedString {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    return this.baseVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    const attributeValue = this.getAttribute();
    if (!attributeValue) {
      return "";
    }
    return attributeValue;
  }

  set baseVal(value) {
    this.setAttribute(String(value));
  }
}

class SVGAnimatedNumber {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
    this.defaultValue = options.defaultValue || 0;
  }

  get animVal() {
    return this.baseVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    const attributeValue = this.getAttribute();
    if (!attributeValue) {
      return this.defaultValue;
    }
    const value = parseFloat(attributeValue);
    if (Number.isNaN(value)) {
      return this.defaultValue;
    }
    return value;
  }

  set baseVal(value) {
    const parsedValue = typeof value !== "number" ? parseFloat(value) : value;
    if (Number.isNaN(parsedValue)) {
      throw new TypeError("TypeError: Failed to set the 'baseVal' property on 'SVGAnimatedNumber': The provided float value is non-finite.");
    }
    this.setAttribute(String(parsedValue));
  }
}

class SVGAnimatedInteger {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    return this.baseVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    const attributeValue = this.getAttribute();
    if (!attributeValue) {
      return 0;
    }
    const value = parseInt(attributeValue);
    if (Number.isNaN(value)) {
      return 0;
    }
    return value;
  }

  set baseVal(value) {
    const parsedValue = parseInt(String(value));
    if (Number.isNaN(parsedValue)) {
      throw new TypeError("TypeError: Failed to set the 'baseVal' property on 'SVGAnimatedInteger': The provided float value is non-finite.");
    }
    this.setAttribute(String(parsedValue));
  }
}

class SVGAnimatedBoolean {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    return this.baseVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    const attributeValue = this.getAttribute();
    return attributeValue === "true";
  }

  set baseVal(value) {
    this.setAttribute(typeof value !== "boolean" ? String(Boolean(value)) : String(value));
  }
}

class SVGAnimatedEnumeration {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
    this.values = options.values;
    this.defaultValue = options.defaultValue;
  }

  get animVal() {
    return this.baseVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    const value = this.getAttribute();
    if (!value) {
      return this.values.indexOf(this.defaultValue) + 1;
    }
    const index = this.values.indexOf(value);
    if (index === -1) {
      const anyValueIndex = this.values.indexOf(null);
      return anyValueIndex !== -1 ? anyValueIndex + 1 : 0;
    }
    return index + 1;
  }

  set baseVal(value) {
    let parsedValue = Number(value);
    if (Number.isNaN(parsedValue)) {
      parsedValue = 0;
    }
    if (parsedValue < 1) {
      throw new TypeError(`Failed to set the 'baseVal' property on 'SVGAnimatedEnumeration': The enumeration value provided is ${parsedValue}, which is not settable.`);
    }
    if (parsedValue > this.values.length) {
      throw new TypeError(`Failed to set the 'baseVal' property on 'SVGAnimatedEnumeration': The enumeration value provided (${parsedValue}) is larger than the largest allowed value (${this.values.length}).`);
    }
    const currentValue = this.getAttribute();
    const isAnyValue = this.values[parsedValue - 1] === null;
    const newValue = isAnyValue ? "0" : this.values[parsedValue - 1];
    if (
      !currentValue ||
      (isAnyValue && this.values.includes(currentValue)) ||
      (!isAnyValue && currentValue !== newValue)
    ) {
      this.setAttribute(newValue || "");
    }
  }
}

const NUMBER_LIST_SEPARATOR_REGEXP = /[\t\f\n\r, ]+/;

class SVGNumber {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    if (options) {
      this.readOnly = !!options.readOnly;
      this.getAttribute = options.getAttribute || null;
      this.setAttribute = options.setAttribute || null;
    } else {
      this.readOnly = false;
      this.getAttribute = null;
      this.setAttribute = null;
    }
    this.attributeValue = null;
  }

  get value() {
    const attributeValue = this.getAttribute ? this.getAttribute() : this.attributeValue;
    return parseFloat(attributeValue || "0");
  }

  set value(value) {
    if (this.readOnly) {
      throw new TypeError("Failed to set the 'value' property on 'SVGNumber': The object is read-only.");
    }
    const parsedValue = typeof value !== "number" ? parseFloat(String(value)) : value;
    if (Number.isNaN(parsedValue)) {
      throw new TypeError("Failed to set the 'value' property on 'SVGNumber': The provided value is not a number.");
    }
    this.attributeValue = String(value);
    if (this.setAttribute) {
      this.setAttribute(this.attributeValue || "");
    }
  }
}

function makeListProxy(target, getItems) {
  return new Proxy(target, {
    get(obj, property) {
      if (property === "length" || property === "numberOfItems") {
        return getItems().length;
      }
      if (property in obj || typeof property === "symbol") {
        const value = obj[property];
        return typeof value === "function" ? value.bind(obj) : value;
      }
      const index = Number(property);
      if (!Number.isNaN(index)) {
        return getItems()[index];
      }
    },
    set(obj, property, newValue) {
      if (typeof property === "symbol") {
        obj[property] = newValue;
        return true;
      }
      const index = Number(property);
      if (Number.isNaN(index)) {
        obj[property] = newValue;
      }
      return true;
    },
    deleteProperty(obj, property) {
      if (typeof property === "symbol") {
        delete obj[property];
        return true;
      }
      const index = Number(property);
      if (Number.isNaN(index)) {
        delete obj[property];
      }
      return true;
    },
    has(obj, property) {
      if (property in obj) {
        return true;
      }
      if (typeof property === "symbol") {
        return false;
      }
      const index = Number(property);
      return !Number.isNaN(index) && index >= 0 && index < getItems().length;
    },
  });
}

class SVGNumberList {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.readOnly = !!options.readOnly;
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
    this.cache = { items: [], attributeValue: "" };
    return makeListProxy(this, () => this.getItemList());
  }

  get length() {
    return this.getItemList().length;
  }

  get numberOfItems() {
    return this.getItemList().length;
  }

  [Symbol.iterator]() {
    return this.getItemList().values();
  }

  clear() {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'clear' on 'SVGNumberList': The object is read-only.");
    }
    this.cache.items = [];
    this.cache.attributeValue = "";
    this.setAttribute("");
  }

  getItem(index) {
    const items = this.getItemList();
    if (typeof index === "number") {
      return items[index] ? items[index] : null;
    }
    index = Number(index);
    index = Number.isNaN(index) ? 0 : index;
    return items[index] ? items[index] : null;
  }

  appendItem(newItem) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'appendItem' on 'SVGNumberList': The object is read-only.");
    }
    if (!(newItem instanceof SVGNumber)) {
      throw new TypeError("Failed to execute 'appendItem' on 'SVGNumberList': parameter 1 is not of type 'SVGNumber'.");
    }
    const items = this.getItemList();
    const existingIndex = items.indexOf(newItem);
    if (existingIndex !== -1) {
      items.splice(existingIndex, 1);
    }
    items.push(newItem);
    newItem.getAttribute = () => newItem.attributeValue;
    newItem.setAttribute = () => {
      this.cache.attributeValue = this.getItemList()
        .map((item) => item.attributeValue || "0")
        .join(" ");
      this.setAttribute(this.cache.attributeValue);
    };
    this.cache.attributeValue = items
      .map((item) => item.attributeValue || "0")
      .join(" ");
    this.setAttribute(this.cache.attributeValue);
    return newItem;
  }

  getItemList() {
    const attributeValue = this.getAttribute() ?? "";
    const cache = this.cache;
    if (cache.attributeValue === attributeValue) {
      return cache.items;
    }
    const items = [];
    const trimmed = attributeValue.trim();
    if (trimmed) {
      const parts = trimmed.split(NUMBER_LIST_SEPARATOR_REGEXP);
      for (const part of parts) {
        const item = new SVGNumber(MINT, { readOnly: this.readOnly });
        item.attributeValue = String(parseFloat(part));
        // Wire each parsed item's write-back to the whole list (happy-dom
        // `rotate.baseVal[0].value = 100` re-serializes the attribute).
        item.setAttribute = () => {
          const serialized = this.getItemList()
            .map((entry) => entry.attributeValue || "0")
            .join(" ");
          this.cache.attributeValue = serialized;
          this.setAttribute(serialized);
        };
        items.push(item);
      }
    }
    cache.attributeValue = attributeValue;
    cache.items = items;
    return items;
  }
}

class SVGAnimatedNumberList {
  #baseVal = null;
  #animVal = null;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    if (this.#animVal === null) {
      this.#animVal = new SVGNumberList(MINT, {
        readOnly: true,
        getAttribute: this.getAttribute,
        setAttribute: () => {},
      });
    }
    return this.#animVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    if (this.#baseVal === null) {
      this.#baseVal = new SVGNumberList(MINT, {
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
    }
    return this.#baseVal;
  }

  set baseVal(_value) {
    // Do nothing
  }
}

const STRING_LIST_SEPARATOR_REGEXP = /[\t\f\n\r ,]+/;

class SVGStringList {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.readOnly = !!options.readOnly;
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
    this.cache = { items: [], attributeValue: "" };
    return makeListProxy(this, () => this.getItemList());
  }

  get length() {
    return this.getItemList().length;
  }

  get numberOfItems() {
    return this.getItemList().length;
  }

  [Symbol.iterator]() {
    return this.getItemList().values();
  }

  clear() {
    this.cache.attributeValue = "";
    this.cache.items = [];
    this.setAttribute("");
  }

  getItem(index) {
    const items = this.getItemList();
    if (typeof index === "number") {
      return items[index] ? items[index] : null;
    }
    index = Number(index);
    index = Number.isNaN(index) ? 0 : index;
    return items[index] ? items[index] : null;
  }

  appendItem(newItem) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'appendItem' on 'SVGStringList': The object is read-only.");
    }
    newItem = String(newItem);
    if (!newItem) {
      return newItem;
    }
    const items = this.getItemList();
    const existingIndex = items.indexOf(newItem);
    if (existingIndex !== -1) {
      items.splice(existingIndex, 1);
    }
    items.push(newItem);
    this.setAttribute(items.join(" "));
    return newItem;
  }

  removeItem(index) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'removeItem' on 'SVGStringList': The object is read-only.");
    }
    const items = this.getItemList();
    index = Number(index);
    if (Number.isNaN(index)) {
      index = 0;
    }
    if (index >= items.length) {
      throw new TypeError("Failed to execute 'removeItem' on 'SVGStringList':  The index provided is greater than the maximum bound.");
    }
    if (index < 0) {
      throw new TypeError("Failed to execute 'removeItem' on 'SVGStringList':  The index provided is negative.");
    }
    const removedItem = items[index];
    items.splice(index, 1);
    this.setAttribute(items.join(" "));
    return removedItem;
  }

  getItemList() {
    const attributeValue = this.getAttribute() ?? "";
    const cache = this.cache;
    if (cache.attributeValue === attributeValue) {
      return cache.items;
    }
    const items = [];
    const trimmed = attributeValue.trim();
    if (trimmed) {
      for (const item of trimmed.split(STRING_LIST_SEPARATOR_REGEXP)) {
        if (!items.includes(item)) {
          items.push(item);
        }
      }
    }
    cache.attributeValue = attributeValue;
    cache.items = items;
    return items;
  }
}

class SVGUnitTypes {
  static SVG_UNIT_TYPE_UNKNOWN = 0;
  static SVG_UNIT_TYPE_USERSPACEONUSE = 1;
  static SVG_UNIT_TYPE_OBJECTBOUNDINGBOX = 2;

  constructor(mint) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
  }
}

const PRESERVE_ASPECT_RATIO_ALIGN = [
  "xMinYMin",
  "xMidYMin",
  "xMaxYMin",
  "xMinYMid",
  "xMidYMid",
  "xMaxYMid",
  "xMinYMax",
  "xMidYMax",
  "xMaxYMax",
];
const PRESERVE_ASPECT_RATIO_MEET_OR_SLICE = ["meet", "slice"];

class SVGPreserveAspectRatio {
  static SVG_MEETORSLICE_UNKNOWN = 0;
  static SVG_MEETORSLICE_MEET = 1;
  static SVG_MEETORSLICE_SLICE = 2;
  static SVG_PRESERVEASPECTRATIO_UNKNOWN = 0;
  static SVG_PRESERVEASPECTRATIO_NONE = 1;
  static SVG_PRESERVEASPECTRATIO_XMINYMIN = 2;
  static SVG_PRESERVEASPECTRATIO_XMIDYMIN = 3;
  static SVG_PRESERVEASPECTRATIO_XMAXYMIN = 4;
  static SVG_PRESERVEASPECTRATIO_XMINYMID = 5;
  static SVG_PRESERVEASPECTRATIO_XMIDYMID = 6;
  static SVG_PRESERVEASPECTRATIO_XMAXYMID = 7;
  static SVG_PRESERVEASPECTRATIO_XMINYMAX = 8;
  static SVG_PRESERVEASPECTRATIO_XMIDYMAX = 9;
  static SVG_PRESERVEASPECTRATIO_XMAXYMAX = 10;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    if (options) {
      this.readOnly = !!options.readOnly;
      this.getAttribute = options.getAttribute || null;
      this.setAttribute = options.setAttribute || null;
    } else {
      this.readOnly = false;
      this.getAttribute = null;
      this.setAttribute = null;
    }
    this.attributeValue = null;
  }

  get align() {
    const attributeValue = this.getAttribute ? this.getAttribute() : this.attributeValue;
    if (!attributeValue) {
      return 6;
    }
    const align = attributeValue.split(/\s+/)[0];
    const index = PRESERVE_ASPECT_RATIO_ALIGN.indexOf(align);
    if (index === -1) {
      return 6;
    }
    return index + 2;
  }

  set align(value) {
    if (this.readOnly) {
      throw new TypeError("Failed to set the 'align' property on 'SVGPreserveAspectRatio': The object is read-only.");
    }
    const parsedValue = Number(value);
    if (Number.isNaN(parsedValue) || parsedValue < 1 || parsedValue > PRESERVE_ASPECT_RATIO_ALIGN.length + 1) {
      throw new TypeError("Failed to set the 'align' property on 'SVGPreserveAspectRatio': The alignment provided is invalid.");
    }
    this.attributeValue = `${parsedValue === 1 ? "none" : PRESERVE_ASPECT_RATIO_ALIGN[parsedValue - 2]} ${this.meetOrSlice === 2 ? "slice" : "meet"}`;
    if (this.setAttribute) {
      this.setAttribute(this.attributeValue);
    }
  }

  get meetOrSlice() {
    const attributeValue = this.getAttribute ? this.getAttribute() : this.attributeValue;
    if (!attributeValue) {
      return 1;
    }
    const meetOrSlice = attributeValue.split(/\s+/)[1];
    if (!meetOrSlice || meetOrSlice !== "slice") {
      return 1;
    }
    return 2;
  }

  set meetOrSlice(value) {
    if (this.readOnly) {
      throw new TypeError("Failed to set the 'meetOrSlice' property on 'SVGPreserveAspectRatio': The object is read-only.");
    }
    const parsedValue = Number(value);
    if (Number.isNaN(parsedValue) || parsedValue < 1 || parsedValue > 2) {
      throw new TypeError("Failed to set the 'meetOrSlice' property on 'SVGPreserveAspectRatio': The meetOrSlice provided is invalid.");
    }
    const currentAlign = this.align;
    this.attributeValue = `${currentAlign === 1 ? "none" : PRESERVE_ASPECT_RATIO_ALIGN[currentAlign - 2]} ${parsedValue === 2 ? "slice" : "meet"}`;
    if (this.setAttribute) {
      this.setAttribute(this.attributeValue);
    }
  }
}

class SVGAnimatedPreserveAspectRatio {
  #baseVal = null;
  #animVal = null;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    if (this.#animVal === null) {
      this.#animVal = new SVGPreserveAspectRatio(MINT, {
        readOnly: true,
        getAttribute: this.getAttribute,
      });
    }
    return this.#animVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    if (this.#baseVal === null) {
      this.#baseVal = new SVGPreserveAspectRatio(MINT, {
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
    }
    return this.#baseVal;
  }

  set baseVal(_value) {
    // Do nothing
  }
}

// ── SVGMatrix ───────────────────────────────────────────────────────────────

// The SVG matrix value class (identity defaults, a…f reflectors). happy-dom
// exposes it as the plain `window.SVGMatrix` global; `SVGTransform.matrix` and
// `createSVGMatrix()` return instances of it.
class SVGMatrix {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.a = options?.a ?? 1;
    this.b = options?.b ?? 0;
    this.c = options?.c ?? 0;
    this.d = options?.d ?? 1;
    this.e = options?.e ?? 0;
    this.f = options?.f ?? 0;
  }
}

// ── SVGPoint / SVGPointList ─────────────────────────────────────────────────

// The SVG point value class. A list item carries the owning list and its own
// index; reads parse the whole list attribute and writes re-serialize it. A
// standalone point (from `createSVGPoint()`) keeps plain `_x` / `_y` state.
class SVGPoint {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    if (options) {
      this.readOnly = !!options.readOnly;
      this.getAttribute = options.getAttribute || null;
      this.setAttribute = options.setAttribute || null;
    } else {
      this.readOnly = false;
      this.getAttribute = null;
      this.setAttribute = null;
    }
    this._list = null;
    this._index = 0;
    this._x = 0;
    this._y = 0;
  }

  get x() {
    if (this.getAttribute) {
      const numbers = parsePointListNumbers(this.getAttribute());
      return numbers[this._index * 2] ?? 0;
    }
    return this._x;
  }

  set x(value) {
    if (this.readOnly) {
      throw new TypeError("Failed to set the 'x' property on 'SVGPoint': The object is read-only.");
    }
    if (this.setAttribute) {
      const numbers = parsePointListNumbers(this.getAttribute());
      numbers[this._index * 2] = Number(value);
      this.setAttribute(serializePointListNumbers(numbers));
    } else {
      this._x = Number(value);
    }
  }

  get y() {
    if (this.getAttribute) {
      const numbers = parsePointListNumbers(this.getAttribute());
      return numbers[this._index * 2 + 1] ?? 0;
    }
    return this._y;
  }

  set y(value) {
    if (this.readOnly) {
      throw new TypeError("Failed to set the 'y' property on 'SVGPoint': The object is read-only.");
    }
    if (this.setAttribute) {
      const numbers = parsePointListNumbers(this.getAttribute());
      numbers[this._index * 2 + 1] = Number(value);
      this.setAttribute(serializePointListNumbers(numbers));
    } else {
      this._y = Number(value);
    }
  }
}

const POINT_LIST_SEPARATOR_REGEXP = /[\t\f\n\r, ]+/;

function parsePointListNumbers(attributeValue) {
  const trimmed = (attributeValue ?? "").trim();
  if (!trimmed) return [];
  return trimmed.split(POINT_LIST_SEPARATOR_REGEXP).map(Number);
}

function serializePointListNumbers(numbers) {
  return numbers.join(" ");
}

class SVGPointList {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.readOnly = !!options.readOnly;
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
    this.cache = { items: [], attributeValue: "" };
    return makeListProxy(this, () => this.getItemList());
  }

  get length() {
    return this.getItemList().length;
  }

  get numberOfItems() {
    return this.getItemList().length;
  }

  [Symbol.iterator]() {
    return this.getItemList().values();
  }

  clear() {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'clear' on 'SVGPointList': The object is read-only.");
    }
    this.cache.items = [];
    this.cache.attributeValue = "";
    this.setAttribute("");
  }

  getItem(index) {
    const items = this.getItemList();
    index = Number(index);
    index = Number.isNaN(index) ? 0 : index;
    return items[index] ? items[index] : null;
  }

  appendItem(newItem) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'appendItem' on 'SVGPointList': The object is read-only.");
    }
    if (!(newItem instanceof SVGPoint)) {
      throw new TypeError("Failed to execute 'appendItem' on 'SVGPointList': parameter 1 is not of type 'SVGPoint'.");
    }
    const numbers = parsePointListNumbers(this.getAttribute());
    numbers.push(Number(newItem.x), Number(newItem.y));
    this.cache.attributeValue = "";
    this.setAttribute(serializePointListNumbers(numbers));
    return newItem;
  }

  removeItem(index) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'removeItem' on 'SVGPointList': The object is read-only.");
    }
    index = Number(index);
    if (Number.isNaN(index)) {
      index = 0;
    }
    const numbers = parsePointListNumbers(this.getAttribute());
    const itemIndex = index * 2;
    if (itemIndex >= numbers.length) {
      throw new TypeError("Failed to execute 'removeItem' on 'SVGPointList':  The index provided is greater than the maximum bound.");
    }
    if (index < 0) {
      throw new TypeError("Failed to execute 'removeItem' on 'SVGPointList':  The index provided is negative.");
    }
    const removed = numbers.splice(itemIndex, 2);
    this.cache.attributeValue = "";
    this.setAttribute(serializePointListNumbers(numbers));
    const item = new SVGPoint(MINT, {});
    item._x = removed[0] ?? 0;
    item._y = removed[1] ?? 0;
    return item;
  }

  getItemList() {
    const attributeValue = this.getAttribute() ?? "";
    const cache = this.cache;
    if (cache.attributeValue === attributeValue) {
      return cache.items;
    }
    const numbers = parsePointListNumbers(attributeValue);
    const items = [];
    for (let index = 0; index * 2 < numbers.length; index += 1) {
      const item = new SVGPoint(MINT, {
        readOnly: this.readOnly,
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
      item._list = this;
      item._index = index;
      items.push(item);
    }
    cache.attributeValue = attributeValue;
    cache.items = items;
    return items;
  }
}

// ── SVGTransform / SVGTransformList / SVGAnimatedTransformList ──────────────

// happy-dom SVGTransformTypeEnum values (vendor-src literal source).
const TRANSFORM_TYPE_UNKNOWN = 0;
const TRANSFORM_TYPE_MATRIX = 1;
const TRANSFORM_TYPE_TRANSLATE = 2;
const TRANSFORM_TYPE_SCALE = 3;

function parseTransformSegment(segment) {
  const match = segment.match(/^([a-zA-Z]+)\(([^)]*)\)$/);
  if (!match) return null;
  const name = match[1];
  const args = match[2]
    .trim()
    .split(/[\t\f\n\r, ]+/)
    .filter((part) => part !== "")
    .map(Number);
  switch (name) {
    case "matrix":
      return {
        type: TRANSFORM_TYPE_MATRIX,
        a: args[0] ?? 0,
        b: args[1] ?? 0,
        c: args[2] ?? 0,
        d: args[3] ?? 0,
        e: args[4] ?? 0,
        f: args[5] ?? 0,
      };
    case "translate":
      return { type: TRANSFORM_TYPE_TRANSLATE, a: 1, b: 0, c: 0, d: 1, e: args[0] ?? 0, f: args[1] ?? 0 };
    case "scale": {
      const sx = args[0] ?? 1;
      return { type: TRANSFORM_TYPE_SCALE, a: sx, b: 0, c: 0, d: args[1] ?? sx, e: 0, f: 0 };
    }
    default:
      return null;
  }
}

function splitTransformList(text) {
  const segments = [];
  let depth = 0;
  let current = "";
  for (const ch of String(text ?? "")) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (current.trim() !== "") segments.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") segments.push(current.trim());
  return segments;
}

class SVGTransform {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    if (options) {
      this.readOnly = !!options.readOnly;
      this.getAttribute = options.getAttribute || null;
      this.setAttribute = options.setAttribute || null;
    } else {
      this.readOnly = false;
      this.getAttribute = null;
      this.setAttribute = null;
    }
    this._list = null;
    this._index = 0;
    this._type = TRANSFORM_TYPE_UNKNOWN;
    this._matrix = null;
  }

  get type() {
    if (this._list) {
      const parsed = parseTransformSegment(this._list.getSegment(this._index));
      return parsed ? parsed.type : TRANSFORM_TYPE_UNKNOWN;
    }
    return this._type;
  }

  get matrix() {
    if (this._matrix) return this._matrix;
    if (this._list) {
      const parsed = parseTransformSegment(this._list.getSegment(this._index));
      if (parsed) return new SVGMatrix(MINT, parsed);
      return new SVGMatrix(MINT, {});
    }
    return new SVGMatrix(MINT, {});
  }

  setScale(x, y) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'setScale' on 'SVGTransform': The object is read-only.");
    }
    const sx = Number(x);
    const sy = y === undefined ? sx : Number(y);
    this._type = TRANSFORM_TYPE_SCALE;
    this._matrix = new SVGMatrix(MINT, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    if (this._list) {
      this._list._updateFromTransform(this._index, serializeTransform(this));
    }
    return this;
  }

  serialize() {
    if (this._matrix) return serializeTransform(this);
    if (this._list) {
      const parsed = parseTransformSegment(this._list.getSegment(this._index));
      if (parsed) {
        return `${["unknown", "matrix", "translate", "scale"][parsed.type]}(${parsed.a} ${parsed.b} ${parsed.c} ${parsed.d} ${parsed.e} ${parsed.f})`;
      }
      return "";
    }
    return "";
  }
}

function serializeTransform(transform) {
  const matrix = transform._matrix;
  if (matrix === null) return "";
  switch (transform._type) {
    case TRANSFORM_TYPE_SCALE:
      return `scale(${matrix.a} ${matrix.d})`;
    case TRANSFORM_TYPE_TRANSLATE:
      return `translate(${matrix.e} ${matrix.f})`;
    case TRANSFORM_TYPE_MATRIX:
      return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
    default:
      return "";
  }
}

class SVGTransformList {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.readOnly = !!options.readOnly;
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
    this.cache = { items: [], attributeValue: "" };
    return makeListProxy(this, () => this.getItemList());
  }

  get length() {
    return this.getItemList().length;
  }

  get numberOfItems() {
    return this.getItemList().length;
  }

  [Symbol.iterator]() {
    return this.getItemList().values();
  }

  getItem(index) {
    const items = this.getItemList();
    index = Number(index);
    index = Number.isNaN(index) ? 0 : index;
    return items[index] ? items[index] : null;
  }

  initialize(newItem) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'initialize' on 'SVGTransformList': The object is read-only.");
    }
    if (!(newItem instanceof SVGTransform)) {
      throw new TypeError("Failed to execute 'initialize' on 'SVGTransformList': parameter 1 is not of type 'SVGTransform'.");
    }
    const serialized = serializeTransform(newItem);
    this.cache.items = [newItem];
    this.cache.attributeValue = serialized;
    this.setAttribute(serialized);
    return newItem;
  }

  getSegment(index) {
    const segments = splitTransformList(this.getAttribute() ?? "");
    return segments[index] ?? "";
  }

  _updateFromTransform(index, serialized) {
    const segments = splitTransformList(this.getAttribute() ?? "");
    segments[index] = serialized;
    this.cache.attributeValue = "";
    this.setAttribute(segments.join(" "));
  }

  getItemList() {
    const attributeValue = this.getAttribute() ?? "";
    const cache = this.cache;
    if (cache.attributeValue === attributeValue) {
      return cache.items;
    }
    const items = [];
    const segments = splitTransformList(attributeValue);
    for (let index = 0; index < segments.length; index += 1) {
      const item = new SVGTransform(MINT, {
        readOnly: this.readOnly,
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
      item._list = this;
      item._index = index;
      items.push(item);
    }
    cache.attributeValue = attributeValue;
    cache.items = items;
    return items;
  }
}

class SVGAnimatedTransformList {
  #baseVal = null;
  #animVal = null;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    if (this.#animVal === null) {
      this.#animVal = new SVGTransformList(MINT, {
        readOnly: true,
        getAttribute: this.getAttribute,
        setAttribute: () => {},
      });
    }
    return this.#animVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    if (this.#baseVal === null) {
      this.#baseVal = new SVGTransformList(MINT, {
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
    }
    return this.#baseVal;
  }

  set baseVal(_value) {
    // Do nothing
  }
}

// ── SVGRect / SVGAnimatedRect ───────────────────────────────────────────────

const RECT_ATTRIBUTE_REGEXP = /^([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s*$/;
const RECT_PROPERTY_NAMES = ["x", "y", "width", "height"];

function parseRectNumbers(attributeValue) {
  const match = String(attributeValue ?? "").match(RECT_ATTRIBUTE_REGEXP);
  if (!match) return [];
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

class SVGRect {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    if (options) {
      this.readOnly = !!options.readOnly;
      this.getAttribute = options.getAttribute || null;
      this.setAttribute = options.setAttribute || null;
    } else {
      this.readOnly = false;
      this.getAttribute = null;
      this.setAttribute = null;
    }
    this._x = 0;
    this._y = 0;
    this._width = 0;
    this._height = 0;
  }

  get x() {
    if (this.getAttribute) {
      const numbers = parseRectNumbers(this.getAttribute());
      return numbers[0] ?? 0;
    }
    return this._x;
  }

  set x(value) {
    this._setRect(0, value);
  }

  get y() {
    if (this.getAttribute) {
      const numbers = parseRectNumbers(this.getAttribute());
      return numbers[1] ?? 0;
    }
    return this._y;
  }

  set y(value) {
    this._setRect(1, value);
  }

  get width() {
    if (this.getAttribute) {
      const numbers = parseRectNumbers(this.getAttribute());
      return numbers[2] ?? 0;
    }
    return this._width;
  }

  set width(value) {
    this._setRect(2, value);
  }

  get height() {
    if (this.getAttribute) {
      const numbers = parseRectNumbers(this.getAttribute());
      return numbers[3] ?? 0;
    }
    return this._height;
  }

  set height(value) {
    this._setRect(3, value);
  }

  _setRect(index, value) {
    const propertyName = RECT_PROPERTY_NAMES[index];
    if (this.readOnly) {
      throw new TypeError(`Failed to set the '${propertyName}' property on 'SVGRect': The object is read-only.`);
    }
    if (this.setAttribute) {
      const numbers = parseRectNumbers(this.getAttribute());
      numbers[index] = Number(value);
      this.setAttribute(numbers.map(String).join(" "));
    } else {
      this[`_${propertyName}`] = Number(value);
    }
  }
}

class SVGAnimatedRect {
  #baseVal = null;
  #animVal = null;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    if (this.#animVal === null) {
      this.#animVal = new SVGRect(MINT, {
        readOnly: true,
        getAttribute: this.getAttribute,
      });
    }
    return this.#animVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    if (this.#baseVal === null) {
      this.#baseVal = new SVGRect(MINT, {
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
    }
    return this.#baseVal;
  }

  set baseVal(_value) {
    // Do nothing
  }
}

// ── SVGAngle / SVGAnimatedAngle ─────────────────────────────────────────────

// happy-dom SVGAngleTypeEnum values (vendor-src literal source).
const ANGLE_TYPE_UNKNOWN = 0;
const ANGLE_TYPE_UNSPECIFIED = 1;
const ANGLE_TYPE_DEG = 2;
const ANGLE_TYPE_RAD = 3;
const ANGLE_TYPE_GRAD = 4;

const ANGLE_ATTRIBUTE_REGEXP = /^([-+]?\d*\.?\d+)(deg|rad|grad|turn)?$/;

class SVGAngle {
  static SVG_ANGLETYPE_UNKNOWN = ANGLE_TYPE_UNKNOWN;
  static SVG_ANGLETYPE_UNSPECIFIED = ANGLE_TYPE_UNSPECIFIED;
  static SVG_ANGLETYPE_DEG = ANGLE_TYPE_DEG;
  static SVG_ANGLETYPE_RAD = ANGLE_TYPE_RAD;
  static SVG_ANGLETYPE_GRAD = ANGLE_TYPE_GRAD;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    if (options) {
      this.readOnly = !!options.readOnly;
      this.getAttribute = options.getAttribute || null;
      this.setAttribute = options.setAttribute || null;
    } else {
      this.readOnly = false;
      this.getAttribute = null;
      this.setAttribute = null;
    }
  }

  get value() {
    const attributeValue = this.getAttribute ? this.getAttribute() || "" : "";
    const match = attributeValue.match(ANGLE_ATTRIBUTE_REGEXP);
    if (!match) {
      return 0;
    }
    return parseFloat(match[1]);
  }

  set value(value) {
    if (this.readOnly) {
      throw new TypeError("Failed to set the 'value' property on 'SVGAngle': The object is read-only.");
    }
    value = typeof value !== "number" ? parseFloat(String(value)) : value;
    if (Number.isNaN(value)) {
      throw new TypeError("Failed to set the 'value' property on 'SVGAngle': The provided float value is non-finite.");
    }
    let unit = "";
    switch (this.unitType) {
      case ANGLE_TYPE_DEG:
        unit = "deg";
        break;
      case ANGLE_TYPE_RAD:
        unit = "rad";
        break;
      case ANGLE_TYPE_GRAD:
        unit = "grad";
        break;
      default:
        unit = "";
        break;
    }
    if (this.setAttribute) {
      this.setAttribute(String(value) + unit);
    }
  }

  get unitType() {
    const attributeValue = this.getAttribute ? this.getAttribute() || "" : "";
    const match = attributeValue.match(ANGLE_ATTRIBUTE_REGEXP);
    if (!match) {
      return ANGLE_TYPE_UNKNOWN;
    }
    switch (match[2]) {
      case "deg":
        return ANGLE_TYPE_DEG;
      case "rad":
        return ANGLE_TYPE_RAD;
      case "grad":
        return ANGLE_TYPE_GRAD;
      default:
        return ANGLE_TYPE_UNSPECIFIED;
    }
  }

  get valueAsString() {
    return this.getAttribute ? this.getAttribute() || "0" : "0";
  }

  newValueSpecifiedUnits(unitType, value) {
    if (this.readOnly) {
      throw new TypeError("Failed to execute 'newValueSpecifiedUnits' on 'SVGAngle': The object is read-only.");
    }
    if (typeof unitType !== "number") {
      throw new TypeError("Failed to execute 'newValueSpecifiedUnits' on 'SVGAngle': parameter 1 ('unitType') is not of type 'number'.");
    }
    value = typeof value !== "number" ? parseFloat(String(value)) : value;
    if (Number.isNaN(value)) {
      throw new TypeError("Failed to execute 'newValueSpecifiedUnits' on 'SVGAngle': The provided float value is non-finite.");
    }
    let unit = "";
    switch (unitType) {
      case ANGLE_TYPE_DEG:
        unit = "deg";
        break;
      case ANGLE_TYPE_RAD:
        unit = "rad";
        break;
      case ANGLE_TYPE_GRAD:
        unit = "grad";
        break;
      default:
        unit = "";
        break;
    }
    if (this.setAttribute) {
      this.setAttribute(String(value) + unit);
    }
  }
}

class SVGAnimatedAngle {
  #baseVal = null;
  #animVal = null;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    if (this.#animVal === null) {
      this.#animVal = new SVGAngle(MINT, {
        readOnly: true,
        getAttribute: this.getAttribute,
      });
    }
    return this.#animVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    if (this.#baseVal === null) {
      this.#baseVal = new SVGAngle(MINT, {
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
    }
    return this.#baseVal;
  }

  set baseVal(_value) {
    // Do nothing
  }
}

// ── SVGLengthList / SVGAnimatedLengthList ───────────────────────────────────

class SVGLengthList {
  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.readOnly = !!options.readOnly;
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
    this.cache = { items: [], attributeValue: "" };
    return makeListProxy(this, () => this.getItemList());
  }

  get length() {
    return this.getItemList().length;
  }

  get numberOfItems() {
    return this.getItemList().length;
  }

  [Symbol.iterator]() {
    return this.getItemList().values();
  }

  getItem(index) {
    const items = this.getItemList();
    index = Number(index);
    index = Number.isNaN(index) ? 0 : index;
    return items[index] ? items[index] : null;
  }

  getItemList() {
    const attributeValue = this.getAttribute() ?? "";
    const cache = this.cache;
    if (cache.attributeValue === attributeValue) {
      return cache.items;
    }
    const items = [];
    const trimmed = attributeValue.trim();
    if (trimmed) {
      const parts = trimmed.split(/\s+/);
      for (let index = 0; index < parts.length; index += 1) {
        const item = new SVGLength(MINT, {
          readOnly: this.readOnly,
          getAttribute: () => parts[index],
          setAttribute: (value) => {
            parts[index] = value;
            cache.attributeValue = parts.join(" ");
            this.setAttribute(parts.join(" "));
          },
        });
        items.push(item);
      }
    }
    cache.attributeValue = attributeValue;
    cache.items = items;
    return items;
  }
}

class SVGAnimatedLengthList {
  #baseVal = null;
  #animVal = null;

  constructor(mint, options) {
    if (mint !== MINT) {
      throw new TypeError("Illegal constructor");
    }
    this.getAttribute = options.getAttribute;
    this.setAttribute = options.setAttribute;
  }

  get animVal() {
    if (this.#animVal === null) {
      this.#animVal = new SVGLengthList(MINT, {
        readOnly: true,
        getAttribute: this.getAttribute,
        setAttribute: () => {},
      });
    }
    return this.#animVal;
  }

  set animVal(_value) {
    // Do nothing
  }

  get baseVal() {
    if (this.#baseVal === null) {
      this.#baseVal = new SVGLengthList(MINT, {
        getAttribute: this.getAttribute,
        setAttribute: this.setAttribute,
      });
    }
    return this.#baseVal;
  }

  set baseVal(_value) {
    // Do nothing
  }
}

// ── SVG element classes ─────────────────────────────────────────────────────

export class SVGElement extends Element {}

// The shared transform / string-list surface of every graphics element
// (transform as SVGAnimatedTransformList, requiredExtensions / systemLanguage
// as SVGStringList) plus the layout-free geometry stubs happy-dom returns
// (getBBox → empty DOMRect, getCTM / getScreenCTM → identity DOMMatrix).
class SVGGraphicsElement extends SVGElement {
  get transform() {
    return animatedTransformList(this, "transform");
  }
  get requiredExtensions() {
    return stringList(this, "requiredExtensions");
  }
  get systemLanguage() {
    return stringList(this, "systemLanguage");
  }
  getBBox() {
    return new DOMRect();
  }
  getCTM() {
    return new DOMMatrix();
  }
  getScreenCTM() {
    return new DOMMatrix();
  }
}

// The geometry surface (pathLength SVGAnimatedNumber + the unimplemented
// geometry probes happy-dom stubs to false / 0 / an origin SVGPoint).
class SVGGeometryElement extends SVGGraphicsElement {
  get pathLength() {
    return animatedNumber(this, "pathLength");
  }
  isPointInFill() {
    return false;
  }
  isPointInStroke() {
    return false;
  }
  getTotalLength() {
    return 0;
  }
  getPointAtLength() {
    return new SVGPoint(MINT, {});
  }
}

class SVGCircleElement extends SVGGeometryElement {
  get cx() {
    return animatedLength(this, "cx");
  }
  get cy() {
    return animatedLength(this, "cy");
  }
  get r() {
    return animatedLength(this, "r");
  }
}

class SVGEllipseElement extends SVGGeometryElement {
  get cx() {
    return animatedLength(this, "cx");
  }
  get cy() {
    return animatedLength(this, "cy");
  }
  get rx() {
    return animatedLength(this, "rx");
  }
  get ry() {
    return animatedLength(this, "ry");
  }
}

class SVGAnimationElement extends SVGElement {
  get requiredExtensions() {
    return stringList(this, "requiredExtensions");
  }
  get systemLanguage() {
    return stringList(this, "systemLanguage");
  }
}

class SVGAnimateElement extends SVGAnimationElement {}

class SVGAnimateMotionElement extends SVGAnimationElement {}

class SVGAnimateTransformElement extends SVGAnimationElement {}

class SVGClipPathElement extends SVGElement {
  get clipPathUnits() {
    return animatedEnumeration(this, "clipPathUnits", ["userSpaceOnUse", "objectBoundingBox"], "userSpaceOnUse");
  }
}

class SVGDefsElement extends SVGGraphicsElement {}

class SVGDescElement extends SVGElement {}

// ── W8 element classes (SVGFilterElement – SVGViewElement) ──────────────────

class SVGFilterElement extends SVGElement {
  get href() {
    return animatedString(this, "href");
  }
  get filterUnits() {
    return animatedEnumeration(this, "filterUnits", ["userSpaceOnUse", "objectBoundingBox"], "userSpaceOnUse");
  }
  get primitiveUnits() {
    return animatedEnumeration(this, "primitiveUnits", ["userSpaceOnUse", "objectBoundingBox"], "userSpaceOnUse");
  }
  get height() {
    return animatedLength(this, "height");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
}

class SVGForeignObjectElement extends SVGGraphicsElement {
  get height() {
    return animatedLength(this, "height");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
}

class SVGGElement extends SVGGraphicsElement {}

class SVGGradientElement extends SVGGraphicsElement {
  static SVG_SPREADMETHOD_UNKNOWN = 0;
  static SVG_SPREADMETHOD_PAD = 1;
  static SVG_SPREADMETHOD_REFLECT = 2;
  static SVG_SPREADMETHOD_REPEAT = 3;
  get href() {
    return animatedString(this, "href");
  }
  get gradientUnits() {
    return animatedEnumeration(this, "gradientUnits", ["userSpaceOnUse", "objectBoundingBox"], "objectBoundingBox");
  }
  get gradientTransform() {
    return animatedTransformList(this, "gradientTransform");
  }
  get spreadMethod() {
    return animatedEnumeration(this, "spreadMethod", ["pad", "reflect", "repeat"], "pad");
  }
}

class SVGImageElement extends SVGGraphicsElement {
  get crossOrigin() {
    return this.getAttribute("crossorigin");
  }
  set crossOrigin(value) {
    this.setAttribute("crossorigin", value);
  }
  get href() {
    return animatedString(this, "href");
  }
  get decoding() {
    const value = this.getAttribute("decoding");
    if (!value || !["sync", "async", "auto"].includes(value)) {
      return "auto";
    }
    return value;
  }
  set decoding(value) {
    this.setAttribute("decoding", value);
  }
  get preserveAspectRatio() {
    return animatedPreserveAspectRatio(this, "preserveAspectRatio");
  }
  get height() {
    return animatedLength(this, "height");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
  decode() {
    return Promise.resolve();
  }
}

class SVGLineElement extends SVGGeometryElement {
  get x1() {
    return animatedLength(this, "x1");
  }
  get y1() {
    return animatedLength(this, "y1");
  }
  get x2() {
    return animatedLength(this, "x2");
  }
  get y2() {
    return animatedLength(this, "y2");
  }
}

class SVGLinearGradientElement extends SVGGradientElement {
  get x1() {
    return animatedLength(this, "x1");
  }
  get y1() {
    return animatedLength(this, "y1");
  }
  get x2() {
    return animatedLength(this, "x2");
  }
  get y2() {
    return animatedLength(this, "y2");
  }
}

class SVGMPathElement extends SVGElement {
  get href() {
    return animatedString(this, "href");
  }
}

class SVGMarkerElement extends SVGElement {
  static SVG_MARKER_ORIENT_UNKNOWN = 0;
  static SVG_MARKER_ORIENT_AUTO = 1;
  static SVG_MARKER_ORIENT_ANGLE = 2;
  static SVG_MARKERUNITS_UNKNOWN = 0;
  static SVG_MARKERUNITS_USERSPACEONUSE = 1;
  static SVG_MARKERUNITS_STROKEWIDTH = 2;
  get markerUnits() {
    return animatedEnumeration(this, "markerUnits", ["userSpaceOnUse", "strokeWidth"], "strokeWidth");
  }
  get markerWidth() {
    return animatedLength(this, "markerWidth");
  }
  get markerHeight() {
    return animatedLength(this, "markerHeight");
  }
  get orientType() {
    return animatedEnumeration(this, "orientType", ["auto", null], "auto", "orient");
  }
  get orientAngle() {
    return animatedAngle(this, "orientAngle", "orient");
  }
  get refX() {
    return animatedLength(this, "refX");
  }
  get refY() {
    return animatedLength(this, "refY");
  }
  get viewBox() {
    return animatedRect(this, "viewBox");
  }
  get preserveAspectRatio() {
    return animatedPreserveAspectRatio(this, "preserveAspectRatio");
  }
  setOrientToAuto() {
    this.setAttribute("orient", "auto");
  }
}

class SVGMaskElement extends SVGElement {
  get maskUnits() {
    return animatedEnumeration(this, "maskUnits", ["userSpaceOnUse", "objectBoundingBox"], "userSpaceOnUse");
  }
  get maskContentUnits() {
    return animatedEnumeration(this, "maskContentUnits", ["userSpaceOnUse", "objectBoundingBox"], "userSpaceOnUse");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get height() {
    return animatedLength(this, "height");
  }
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
}

class SVGMetadataElement extends SVGElement {}

class SVGPathElement extends SVGGeometryElement {}

class SVGPatternElement extends SVGElement {
  get href() {
    return animatedString(this, "href");
  }
  get patternUnits() {
    return animatedEnumeration(this, "patternUnits", ["userSpaceOnUse", "objectBoundingBox"], "objectBoundingBox");
  }
  get patternContentUnits() {
    return animatedEnumeration(this, "patternContentUnits", ["userSpaceOnUse", "objectBoundingBox"], "userSpaceOnUse");
  }
  get patternTransform() {
    return animatedTransformList(this, "patternTransform");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get height() {
    return animatedLength(this, "height");
  }
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
}

class SVGPolygonElement extends SVGGeometryElement {
  get animatedPoints() {
    return pointList(this, "animatedPoints", "points", true);
  }
  get points() {
    return pointList(this, "points", "points");
  }
}

class SVGPolylineElement extends SVGGeometryElement {
  get animatedPoints() {
    return pointList(this, "animatedPoints", "points", true);
  }
  get points() {
    return pointList(this, "points", "points");
  }
}

class SVGRadialGradientElement extends SVGGradientElement {
  get cx() {
    return animatedLength(this, "cx");
  }
  get cy() {
    return animatedLength(this, "cy");
  }
  get r() {
    return animatedLength(this, "r");
  }
  get fx() {
    return animatedLength(this, "fx");
  }
  get fy() {
    return animatedLength(this, "fy");
  }
}

class SVGRectElement extends SVGGeometryElement {
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
  get height() {
    return animatedLength(this, "height");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get rx() {
    return animatedLength(this, "rx");
  }
  get ry() {
    return animatedLength(this, "ry");
  }
}

class SVGSVGElement extends SVGGraphicsElement {
  get currentScale() {
    return this._currentScale ?? 1;
  }
  set currentScale(value) {
    const parsedValue = typeof value !== "number" ? parseFloat(String(value)) : value;
    if (Number.isNaN(parsedValue)) {
      throw new TypeError("Failed to set the 'currentScale' property on 'SVGSVGElement': The provided float value is non-finite.");
    }
    // happy-dom ignores values below 1 (they never overwrite the current
    // scale), so the default stays 1 while a previously set scale is kept.
    if (parsedValue >= 1) {
      this._currentScale = parsedValue;
    }
  }
  get currentTranslate() {
    if (!this._currentTranslate) {
      this._currentTranslate = new SVGPoint(MINT, {});
    }
    return this._currentTranslate;
  }
  get preserveAspectRatio() {
    return animatedPreserveAspectRatio(this, "preserveAspectRatio");
  }
  get height() {
    return animatedLength(this, "height");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
  get viewBox() {
    return animatedRect(this, "viewBox");
  }
  pauseAnimations() {}
  unpauseAnimations() {}
  getCurrentTime() {
    return 0;
  }
  setCurrentTime() {}
  getIntersectionList() {
    return emptyNodeList(this);
  }
  getEnclosureList() {
    return emptyNodeList(this);
  }
  checkIntersection() {
    return false;
  }
  checkEnclosure() {
    return false;
  }
  deselectAll() {}
  createSVGNumber() {
    return new SVGNumber(MINT, {});
  }
  createSVGLength() {
    return new SVGLength(MINT, {});
  }
  createSVGAngle() {
    return new SVGAngle(MINT, {});
  }
  createSVGPoint() {
    return new SVGPoint(MINT, {});
  }
  createSVGMatrix() {
    return new SVGMatrix(MINT, {});
  }
  createSVGRect() {
    return new SVGRect(MINT, {});
  }
  createSVGTransform() {
    return new SVGTransform(MINT, {});
  }
  createSVGTransformFromMatrix(matrix) {
    const transform = new SVGTransform(MINT, {});
    transform._matrix = matrix;
    return transform;
  }
}

function emptyNodeList(element) {
  const handle = nodeHandleOf(element);
  const documentHandle = handle?.ownerDocument();
  if (!documentHandle) return [];
  const scratch = documentHandle.createElement("div");
  return new NodeList(scratch);
}

class SVGScriptElement extends SVGGraphicsElement {
  get href() {
    return animatedString(this, "href");
  }
  get type() {
    return this.getAttribute("type") ?? "";
  }
  set type(value) {
    this.setAttribute("type", value);
  }
}

class SVGSetElement extends SVGAnimationElement {}

class SVGStopElement extends SVGElement {
  get offset() {
    return animatedNumber(this, "offset");
  }
}

class SVGStyleElement extends SVGElement {
  get media() {
    return this.getAttribute("media") ?? "all";
  }
  set media(value) {
    this.setAttribute("media", value);
  }
  get type() {
    return this.getAttribute("type") ?? "text/css";
  }
  set type(value) {
    this.setAttribute("type", value);
  }
  get title() {
    return this.getAttribute("title") ?? "";
  }
  set title(value) {
    this.setAttribute("title", value);
  }
  get disabled() {
    return this._disabled === true;
  }
  set disabled(value) {
    this._disabled = !!value;
  }
}

class SVGSwitchElement extends SVGGraphicsElement {}

class SVGSymbolElement extends SVGGraphicsElement {}

class SVGTextContentElement extends SVGGraphicsElement {
  static LENGTHADJUST_UNKNOWN = 0;
  static LENGTHADJUST_SPACING = 1;
  static LENGTHADJUST_SPACINGANDGLYPHS = 2;
  get textLength() {
    return animatedLength(this, "textLength");
  }
  get lengthAdjust() {
    return animatedEnumeration(this, "lengthAdjust", ["spacing", "spacingAndGlyphs"], "spacing");
  }
  getNumberOfChars() {
    return 0;
  }
  getComputedTextLength() {
    return 0;
  }
  getSubStringLength() {
    return 0;
  }
  getStartPositionOfChar() {
    return new SVGPoint(MINT, {});
  }
  getEndPositionOfChar() {
    return new SVGPoint(MINT, {});
  }
  getExtentOfChar() {
    return new SVGRect(MINT, {});
  }
  getRotationOfChar() {
    return 0;
  }
  getCharNumAtPosition() {
    return 0;
  }
}

class SVGTextPathElement extends SVGTextContentElement {}

class SVGTextPositioningElement extends SVGTextContentElement {
  get x() {
    return animatedLengthList(this, "x");
  }
  get y() {
    return animatedLengthList(this, "y");
  }
  get dx() {
    return animatedLengthList(this, "dx");
  }
  get dy() {
    return animatedLengthList(this, "dy");
  }
  get rotate() {
    return animatedNumberList(this, "rotate");
  }
}

class SVGTextElement extends SVGTextPositioningElement {}

class SVGTSpanElement extends SVGTextPositioningElement {}

class SVGTitleElement extends SVGElement {}

class SVGUseElement extends SVGGraphicsElement {
  get href() {
    return animatedString(this, "href");
  }
  get height() {
    return animatedLength(this, "height");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
}

class SVGViewElement extends SVGElement {}

// The common filter-primitive geometry surface shared by the SVGFE* family
// (width / height / x / y as SVGAnimatedLength, in1 / result as
// SVGAnimatedString). happy-dom repeats these accessors per class; the facade
// defines them once on a shared mixin base so every SVGFE* element reports the
// same reflections.
class SVGFilterPrimitiveElement extends SVGElement {
  get height() {
    return animatedLength(this, "height");
  }
  get width() {
    return animatedLength(this, "width");
  }
  get x() {
    return animatedLength(this, "x");
  }
  get y() {
    return animatedLength(this, "y");
  }
  get in1() {
    return animatedString(this, "in");
  }
  get result() {
    return animatedString(this, "result");
  }
}

class SVGFEBlendElement extends SVGFilterPrimitiveElement {
  static SVG_FEBLEND_MODE_UNKNOWN = 0;
  static SVG_FEBLEND_MODE_NORMAL = 1;
  static SVG_FEBLEND_MODE_MULTIPLY = 2;
  static SVG_FEBLEND_MODE_SCREEN = 3;
  static SVG_FEBLEND_MODE_DARKEN = 4;
  static SVG_FEBLEND_MODE_LIGHTEN = 5;
  static SVG_FEBLEND_MODE_OVERLAY = 6;
  static SVG_FEBLEND_MODE_COLOR_DODGE = 7;
  static SVG_FEBLEND_MODE_COLOR_BURN = 8;
  static SVG_FEBLEND_MODE_HARD_LIGHT = 9;
  static SVG_FEBLEND_MODE_SOFT_LIGHT = 10;
  static SVG_FEBLEND_MODE_DIFFERENCE = 11;
  static SVG_FEBLEND_MODE_EXCLUSION = 12;
  static SVG_FEBLEND_MODE_HUE = 13;
  static SVG_FEBLEND_MODE_SATURATION = 14;
  static SVG_FEBLEND_MODE_COLOR = 15;
  static SVG_FEBLEND_MODE_LUMINOSITY = 16;
  get in2() {
    return animatedString(this, "in2");
  }
  get mode() {
    return animatedEnumeration(
      this,
      "mode",
      [
        "normal",
        "multiply",
        "screen",
        "darken",
        "lighten",
        "overlay",
        "color-dodge",
        "color-burn",
        "hard-light",
        "soft-light",
        "difference",
        "exclusion",
        "hue",
        "saturation",
        "color",
        "luminosity",
      ],
      "normal",
    );
  }
}

class SVGFEColorMatrixElement extends SVGFilterPrimitiveElement {
  static SVG_FEBLEND_TYPE_UNKNOWN = 0;
  static SVG_FEBLEND_TYPE_MATRIX = 1;
  static SVG_FEBLEND_TYPE_SATURATE = 2;
  static SVG_FEBLEND_TYPE_HUEROTATE = 3;
  static SVG_FEBLEND_TYPE_LUMINANCETOALPHA = 4;
  get in2() {
    return animatedString(this, "in2");
  }
  get type() {
    return animatedEnumeration(
      this,
      "type",
      ["matrix", "saturate", "huerotate", "luminancetoalpha"],
      "matrix",
    );
  }
  get values() {
    return animatedNumberList(this, "values");
  }
}

class SVGFEComponentTransferElement extends SVGFilterPrimitiveElement {}

class SVGFECompositeElement extends SVGFilterPrimitiveElement {
  static SVG_FECOMPOSITE_OPERATOR_UNKNOWN = 0;
  static SVG_FECOMPOSITE_OPERATOR_OVER = 1;
  static SVG_FECOMPOSITE_OPERATOR_IN = 2;
  static SVG_FECOMPOSITE_OPERATOR_OUT = 3;
  static SVG_FECOMPOSITE_OPERATOR_ATOP = 4;
  static SVG_FECOMPOSITE_OPERATOR_XOR = 5;
  static SVG_FECOMPOSITE_OPERATOR_ARITHMETIC = 6;
  get type() {
    return animatedEnumeration(
      this,
      "type",
      ["over", "in", "out", "atop", "xor", "arithmetic"],
      "over",
    );
  }
  get values() {
    return animatedNumberList(this, "values");
  }
}

class SVGFEConvolveMatrixElement extends SVGFilterPrimitiveElement {
  static SVG_EDGEMODE_UNKNOWN = 0;
  static SVG_EDGEMODE_DUPLICATE = 1;
  static SVG_EDGEMODE_WRAP = 2;
  static SVG_EDGEMODE_NONE = 3;
  get bias() {
    return animatedNumber(this, "bias");
  }
  get divisor() {
    return animatedNumber(this, "divisor");
  }
  get edgeMode() {
    return animatedEnumeration(this, "edgeMode", ["duplicate", "wrap", "none"], "duplicate");
  }
  get kernelMatrix() {
    return animatedNumberList(this, "kernelMatrix");
  }
  get kernelUnitLengthX() {
    return animatedNumber(this, "kernelUnitLengthX");
  }
  get kernelUnitLengthY() {
    return animatedNumber(this, "kernelUnitLengthY");
  }
  get orderX() {
    return animatedInteger(this, "orderX");
  }
  get orderY() {
    return animatedInteger(this, "orderY");
  }
  get preserveAlpha() {
    return animatedBoolean(this, "preserveAlpha");
  }
  get targetX() {
    return animatedInteger(this, "targetX");
  }
  get targetY() {
    return animatedInteger(this, "targetY");
  }
}

class SVGFEDiffuseLightingElement extends SVGFilterPrimitiveElement {
  get diffuseConstant() {
    return animatedNumber(this, "diffuseConstant");
  }
  get kernelUnitLengthX() {
    return animatedNumber(this, "kernelUnitLengthX");
  }
  get kernelUnitLengthY() {
    return animatedNumber(this, "kernelUnitLengthY");
  }
  get surfaceScale() {
    return animatedNumber(this, "surfaceScale");
  }
}

class SVGFEDisplacementMapElement extends SVGFilterPrimitiveElement {
  static SVG_CHANNEL_UNKNOWN = 0;
  static SVG_CHANNEL_R = 1;
  static SVG_CHANNEL_G = 2;
  static SVG_CHANNEL_B = 3;
  static SVG_CHANNEL_A = 4;
  get in2() {
    return animatedString(this, "in2");
  }
  get scale() {
    return animatedNumber(this, "scale");
  }
  get xChannelSelector() {
    return animatedEnumeration(this, "xChannelSelector", ["r", "g", "b", "a"], "r");
  }
  get yChannelSelector() {
    return animatedEnumeration(this, "yChannelSelector", ["r", "g", "b", "a"], "r");
  }
}

class SVGFEDistantLightElement extends SVGElement {
  get azimuth() {
    return animatedNumber(this, "azimuth");
  }
  get elevation() {
    return animatedNumber(this, "elevation");
  }
}

class SVGFEDropShadowElement extends SVGFilterPrimitiveElement {
  get dx() {
    return animatedNumber(this, "dx");
  }
  get dy() {
    return animatedNumber(this, "dy");
  }
  get stdDeviationX() {
    return animatedNumber(this, "stdDeviationX", 2);
  }
  get stdDeviationY() {
    return animatedNumber(this, "stdDeviationY", 2);
  }
}

class SVGFEFloodElement extends SVGFilterPrimitiveElement {}

class SVGComponentTransferFunctionElement extends SVGElement {
  static SVG_FECOMPONENTTRANSFER_TYPE_UNKNOWN = 0;
  static SVG_FECOMPONENTTRANSFER_TYPE_IDENTITY = 1;
  static SVG_FECOMPONENTTRANSFER_TYPE_TABLE = 2;
  static SVG_FECOMPONENTTRANSFER_TYPE_DISCRETE = 3;
  static SVG_FECOMPONENTTRANSFER_TYPE_LINEAR = 4;
  static SVG_FECOMPONENTTRANSFER_TYPE_GAMMA = 5;
  get type() {
    return animatedEnumeration(this, "type", ["identity", "table", "discrete", "linear", "gamma"], "identity");
  }
  get tableValues() {
    return animatedNumberList(this, "tableValues");
  }
  get slope() {
    return animatedNumber(this, "slope", 1);
  }
  get intercept() {
    return animatedNumber(this, "intercept");
  }
  get amplitude() {
    return animatedNumber(this, "amplitude", 1);
  }
  get exponent() {
    return animatedNumber(this, "exponent", 1);
  }
  get offset() {
    return animatedNumber(this, "offset");
  }
}

class SVGFEFuncAElement extends SVGComponentTransferFunctionElement {}
class SVGFEFuncBElement extends SVGComponentTransferFunctionElement {}
class SVGFEFuncGElement extends SVGComponentTransferFunctionElement {}
class SVGFEFuncRElement extends SVGComponentTransferFunctionElement {}

class SVGFEGaussianBlurElement extends SVGFilterPrimitiveElement {
  static SVG_EDGEMODE_UNKNOWN = 0;
  static SVG_EDGEMODE_DUPLICATE = 1;
  static SVG_EDGEMODE_WRAP = 2;
  static SVG_EDGEMODE_NONE = 3;
  get edgeMode() {
    return animatedEnumeration(this, "edgeMode", ["duplicate", "wrap", "none"], "duplicate");
  }
  get stdDeviationX() {
    return animatedNumberWithFallback(this, "stdDeviationX", "2");
  }
  get stdDeviationY() {
    return animatedNumberWithFallback(this, "stdDeviationY", "2");
  }
  setStdDeviation(stdDeviationX, stdDeviationY) {
    this.setAttribute("stdDeviationX", String(stdDeviationX));
    this.setAttribute("stdDeviationY", String(stdDeviationY));
  }
}

class SVGFEImageElement extends SVGFilterPrimitiveElement {
  get crossOrigin() {
    return this.getAttribute("crossorigin");
  }
  set crossOrigin(value) {
    this.setAttribute("crossorigin", value);
  }
  get href() {
    return animatedString(this, "href");
  }
  get preserveAspectRatio() {
    return animatedPreserveAspectRatio(this, "preserveAspectRatio");
  }
}

class SVGFEMergeElement extends SVGFilterPrimitiveElement {}

class SVGFEMergeNodeElement extends SVGElement {
  get in1() {
    return animatedString(this, "in");
  }
}

class SVGFEMorphologyElement extends SVGFilterPrimitiveElement {
  static SVG_MORPHOLOGY_OPERATOR_UNKNOWN = 0;
  static SVG_MORPHOLOGY_OPERATOR_ERODE = 1;
  static SVG_MORPHOLOGY_OPERATOR_DILATE = 2;
  get operator() {
    return animatedEnumeration(this, "operator", ["erode", "dilate"], "erode");
  }
  get radiusX() {
    return animatedNumber(this, "radiusX");
  }
  get radiusY() {
    return animatedNumber(this, "radiusY");
  }
}

class SVGFEOffsetElement extends SVGFilterPrimitiveElement {
  get dx() {
    return animatedNumber(this, "dx");
  }
  get dy() {
    return animatedNumber(this, "dy");
  }
}

class SVGFEPointLightElement extends SVGElement {
  get x() {
    return animatedNumber(this, "x");
  }
  get y() {
    return animatedNumber(this, "y");
  }
  get z() {
    return animatedNumber(this, "z");
  }
}

class SVGFESpecularLightingElement extends SVGFilterPrimitiveElement {
  get kernelUnitLengthX() {
    return animatedNumber(this, "kernelUnitLengthX");
  }
  get kernelUnitLengthY() {
    return animatedNumber(this, "kernelUnitLengthY");
  }
  get specularConstant() {
    return animatedNumber(this, "specularConstant", 1);
  }
  get specularExponent() {
    return animatedNumber(this, "specularExponent", 1);
  }
  get surfaceScale() {
    return animatedNumber(this, "surfaceScale", 1);
  }
}

class SVGFESpotLightElement extends SVGElement {
  get x() {
    return animatedNumber(this, "x");
  }
  get y() {
    return animatedNumber(this, "y");
  }
  get z() {
    return animatedNumber(this, "z");
  }
  get pointsAtX() {
    return animatedNumber(this, "pointsAtX");
  }
  get pointsAtY() {
    return animatedNumber(this, "pointsAtY");
  }
  get pointsAtZ() {
    return animatedNumber(this, "pointsAtZ");
  }
  get specularExponent() {
    return animatedNumber(this, "specularExponent", 1);
  }
  get limitingConeAngle() {
    return animatedNumber(this, "limitingConeAngle");
  }
}

class SVGFETileElement extends SVGFilterPrimitiveElement {}

class SVGFETurbulenceElement extends SVGFilterPrimitiveElement {
  static SVG_TURBULENCE_TYPE_UNKNOWN = 0;
  static SVG_TURBULENCE_TYPE_FRACTALNOISE = 1;
  static SVG_TURBULENCE_TYPE_TURBULENCE = 2;
  static SVG_STITCHTYPE_UNKNOWN = 0;
  static SVG_STITCHTYPE_STITCH = 1;
  static SVG_STITCHTYPE_NOSTITCH = 2;
  get baseFrequencyX() {
    return animatedNumber(this, "baseFrequencyX");
  }
  get baseFrequencyY() {
    return animatedNumber(this, "baseFrequencyY");
  }
  get numOctaves() {
    return animatedInteger(this, "numOctaves");
  }
  get seed() {
    return animatedNumber(this, "seed");
  }
  get stitchTiles() {
    return animatedEnumeration(this, "stitchTiles", ["stitch", "noStitch"], "stitch");
  }
  get type() {
    return animatedEnumeration(this, "type", ["fractalNoise", "turbulence"], "turbulence");
  }
}

// ── install ─────────────────────────────────────────────────────────────────

const SVG_ELEMENT_EVENTS = [
  "abort",
  "animationend",
  "animationiteration",
  "animationstart",
  "blur",
  "canplay",
  "canplaythrough",
  "change",
  "click",
  "close",
  "contextmenu",
  "copy",
  "cuechange",
  "cut",
  "dblclick",
  "drag",
  "dragend",
  "dragenter",
  "dragleave",
  "dragover",
  "dragstart",
  "drop",
  "durationchange",
  "emptied",
  "ended",
  "error",
  "focus",
  "formdata",
  "gotpointercapture",
  "input",
  "invalid",
  "keydown",
  "keypress",
  "keyup",
  "load",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "lostpointercapture",
  "mousedown",
  "mouseenter",
  "mouseleave",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "mousewheel",
  "paste",
  "pause",
  "play",
  "playing",
  "pointercancel",
  "pointerdown",
  "pointerenter",
  "pointerleave",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerrawupdate",
  "pointerup",
  "progress",
  "ratechange",
  "reset",
  "resize",
  "scroll",
  "scrollend",
  "scrollsnapchange",
  "scrollsnapchanging",
  "securitypolicyviolation",
  "seeked",
  "seeking",
  "select",
  "selectionchange",
  "selectstart",
  "slotchange",
  "stalled",
  "submit",
  "suspend",
  "timeupdate",
  "toggle",
  "transitioncancel",
  "transitionend",
  "transitionrun",
  "transitionstart",
  "volumechange",
  "waiting",
  "wheel",
];

// The window-level event names happy-dom registers as on<event> handler
// attributes on SVGSVGElement (upstream svg-svg-element test).
const SVG_ROOT_ELEMENT_EVENTS = [
  "afterprint",
  "beforeprint",
  "beforeunload",
  "gamepadconnected",
  "gamepaddisconnected",
  "hashchange",
  "languagechange",
  "message",
  "messageerror",
  "offline",
  "online",
  "pagehide",
  "pageshow",
  "popstate",
  "rejectionhandled",
  "storage",
  "unhandledrejection",
  "unload",
];

function ownerSvgElement(ctx, element) {
  let parent = nodeHandleOf(element)?.parentNode();
  while (parent !== null && parent !== undefined) {
    const wrapper = ctx.wrap(parent);
    if (wrapper?.localName === "svg") {
      return wrapper;
    }
    parent = nodeHandleOf(wrapper)?.parentNode();
  }
  return null;
}

// happy-dom exposes the SVG classes as plain window globals (the same classes
// the scenarios `instanceof` against), and the element classes as the per-tag
// classes selected by `createElementNS`.
const SVG_ELEMENT_CLASSES = [
  [SVGElement, "SVGElement"],
  [SVGGraphicsElement, "SVGGraphicsElement"],
  [SVGGeometryElement, "SVGGeometryElement"],
  [SVGCircleElement, "SVGCircleElement"],
  [SVGEllipseElement, "SVGEllipseElement"],
  [SVGAnimationElement, "SVGAnimationElement"],
  [SVGAnimateElement, "SVGAnimateElement"],
  [SVGAnimateMotionElement, "SVGAnimateMotionElement"],
  [SVGAnimateTransformElement, "SVGAnimateTransformElement"],
  [SVGClipPathElement, "SVGClipPathElement"],
  [SVGDefsElement, "SVGDefsElement"],
  [SVGDescElement, "SVGDescElement"],
  [SVGComponentTransferFunctionElement, "SVGComponentTransferFunctionElement"],
  [SVGFEBlendElement, "SVGFEBlendElement"],
  [SVGFEColorMatrixElement, "SVGFEColorMatrixElement"],
  [SVGFEComponentTransferElement, "SVGFEComponentTransferElement"],
  [SVGFECompositeElement, "SVGFECompositeElement"],
  [SVGFEConvolveMatrixElement, "SVGFEConvolveMatrixElement"],
  [SVGFEDiffuseLightingElement, "SVGFEDiffuseLightingElement"],
  [SVGFEDisplacementMapElement, "SVGFEDisplacementMapElement"],
  [SVGFEDistantLightElement, "SVGFEDistantLightElement"],
  [SVGFEDropShadowElement, "SVGFEDropShadowElement"],
  [SVGFEFloodElement, "SVGFEFloodElement"],
  [SVGFEFuncAElement, "SVGFEFuncAElement"],
  [SVGFEFuncBElement, "SVGFEFuncBElement"],
  [SVGFEFuncGElement, "SVGFEFuncGElement"],
  [SVGFEFuncRElement, "SVGFEFuncRElement"],
  [SVGFEGaussianBlurElement, "SVGFEGaussianBlurElement"],
  [SVGFEImageElement, "SVGFEImageElement"],
  [SVGFEMergeElement, "SVGFEMergeElement"],
  [SVGFEMergeNodeElement, "SVGFEMergeNodeElement"],
  [SVGFEMorphologyElement, "SVGFEMorphologyElement"],
  [SVGFEOffsetElement, "SVGFEOffsetElement"],
  [SVGFEPointLightElement, "SVGFEPointLightElement"],
  [SVGFESpecularLightingElement, "SVGFESpecularLightingElement"],
  [SVGFESpotLightElement, "SVGFESpotLightElement"],
  [SVGFETileElement, "SVGFETileElement"],
  [SVGFETurbulenceElement, "SVGFETurbulenceElement"],
  [SVGFilterElement, "SVGFilterElement"],
  [SVGForeignObjectElement, "SVGForeignObjectElement"],
  [SVGGElement, "SVGGElement"],
  [SVGGradientElement, "SVGGradientElement"],
  [SVGImageElement, "SVGImageElement"],
  [SVGLineElement, "SVGLineElement"],
  [SVGLinearGradientElement, "SVGLinearGradientElement"],
  [SVGMPathElement, "SVGMPathElement"],
  [SVGMarkerElement, "SVGMarkerElement"],
  [SVGMaskElement, "SVGMaskElement"],
  [SVGMetadataElement, "SVGMetadataElement"],
  [SVGPathElement, "SVGPathElement"],
  [SVGPatternElement, "SVGPatternElement"],
  [SVGPolygonElement, "SVGPolygonElement"],
  [SVGPolylineElement, "SVGPolylineElement"],
  [SVGRadialGradientElement, "SVGRadialGradientElement"],
  [SVGRectElement, "SVGRectElement"],
  [SVGSVGElement, "SVGSVGElement"],
  [SVGScriptElement, "SVGScriptElement"],
  [SVGSetElement, "SVGSetElement"],
  [SVGStopElement, "SVGStopElement"],
  [SVGStyleElement, "SVGStyleElement"],
  [SVGSwitchElement, "SVGSwitchElement"],
  [SVGSymbolElement, "SVGSymbolElement"],
  [SVGTextContentElement, "SVGTextContentElement"],
  [SVGTextPathElement, "SVGTextPathElement"],
  [SVGTextElement, "SVGTextElement"],
  [SVGTextPositioningElement, "SVGTextPositioningElement"],
  [SVGTSpanElement, "SVGTSpanElement"],
  [SVGTitleElement, "SVGTitleElement"],
  [SVGUseElement, "SVGUseElement"],
  [SVGViewElement, "SVGViewElement"],
];

const SVG_VALUE_CLASSES = [
  [SVGAnimatedLength, "SVGAnimatedLength"],
  [SVGAnimatedString, "SVGAnimatedString"],
  [SVGAnimatedNumber, "SVGAnimatedNumber"],
  [SVGAnimatedNumberList, "SVGAnimatedNumberList"],
  [SVGAnimatedInteger, "SVGAnimatedInteger"],
  [SVGAnimatedBoolean, "SVGAnimatedBoolean"],
  [SVGAnimatedEnumeration, "SVGAnimatedEnumeration"],
  [SVGLength, "SVGLength"],
  [SVGNumber, "SVGNumber"],
  [SVGNumberList, "SVGNumberList"],
  [SVGStringList, "SVGStringList"],
  [SVGUnitTypes, "SVGUnitTypes"],
  [SVGAnimatedPreserveAspectRatio, "SVGAnimatedPreserveAspectRatio"],
  [SVGPreserveAspectRatio, "SVGPreserveAspectRatio"],
  [SVGMatrix, "SVGMatrix"],
  [SVGPoint, "SVGPoint"],
  [SVGPointList, "SVGPointList"],
  [SVGTransform, "SVGTransform"],
  [SVGTransformList, "SVGTransformList"],
  [SVGAnimatedTransformList, "SVGAnimatedTransformList"],
  [SVGRect, "SVGRect"],
  [SVGAnimatedRect, "SVGAnimatedRect"],
  [SVGAngle, "SVGAngle"],
  [SVGAnimatedAngle, "SVGAnimatedAngle"],
  [SVGLengthList, "SVGLengthList"],
  [SVGAnimatedLengthList, "SVGAnimatedLengthList"],
];

// The SVG tag → class mapping (happy-dom SVGElementConfig localNames).
const SVG_TAG_CLASSES = [
  ["animate", SVGAnimateElement],
  ["animateMotion", SVGAnimateMotionElement],
  ["animateTransform", SVGAnimateTransformElement],
  ["circle", SVGCircleElement],
  ["clipPath", SVGClipPathElement],
  ["defs", SVGDefsElement],
  ["desc", SVGDescElement],
  ["ellipse", SVGEllipseElement],
  ["feBlend", SVGFEBlendElement],
  ["feColorMatrix", SVGFEColorMatrixElement],
  ["feComponentTransfer", SVGFEComponentTransferElement],
  ["feComposite", SVGFECompositeElement],
  ["feConvolveMatrix", SVGFEConvolveMatrixElement],
  ["feDiffuseLighting", SVGFEDiffuseLightingElement],
  ["feDisplacementMap", SVGFEDisplacementMapElement],
  ["feDistantLight", SVGFEDistantLightElement],
  ["feDropShadow", SVGFEDropShadowElement],
  ["feFlood", SVGFEFloodElement],
  ["feFuncA", SVGFEFuncAElement],
  ["feFuncB", SVGFEFuncBElement],
  ["feFuncG", SVGFEFuncGElement],
  ["feFuncR", SVGFEFuncRElement],
  ["feGaussianBlur", SVGFEGaussianBlurElement],
  ["feImage", SVGFEImageElement],
  ["feMerge", SVGFEMergeElement],
  ["feMergeNode", SVGFEMergeNodeElement],
  ["feMorphology", SVGFEMorphologyElement],
  ["feOffset", SVGFEOffsetElement],
  ["fePointLight", SVGFEPointLightElement],
  ["feSpecularLighting", SVGFESpecularLightingElement],
  ["feSpotLight", SVGFESpotLightElement],
  ["feTile", SVGFETileElement],
  ["feTurbulence", SVGFETurbulenceElement],
  ["filter", SVGFilterElement],
  ["foreignObject", SVGForeignObjectElement],
  ["g", SVGGElement],
  ["image", SVGImageElement],
  ["line", SVGLineElement],
  ["linearGradient", SVGLinearGradientElement],
  ["mpath", SVGMPathElement],
  ["marker", SVGMarkerElement],
  ["mask", SVGMaskElement],
  ["metadata", SVGMetadataElement],
  ["path", SVGPathElement],
  ["pattern", SVGPatternElement],
  ["polygon", SVGPolygonElement],
  ["polyline", SVGPolylineElement],
  ["radialGradient", SVGRadialGradientElement],
  ["rect", SVGRectElement],
  ["svg", SVGSVGElement],
  ["script", SVGScriptElement],
  ["set", SVGSetElement],
  ["stop", SVGStopElement],
  ["style", SVGStyleElement],
  ["switch", SVGSwitchElement],
  ["symbol", SVGSymbolElement],
  ["text", SVGTextElement],
  ["textPath", SVGTextPathElement],
  ["tspan", SVGTSpanElement],
  ["title", SVGTitleElement],
  ["use", SVGUseElement],
  ["view", SVGViewElement],
];

export function install(ctx) {
  // SVGElement base surface (happy-dom SVGElement): the `ownerSVGElement` /
  // `viewportElement` ancestry reads, the live `dataset`, `tabIndex`
  // reflection and the `on<event>` handler-attribute accessors. `style` is
  // already provided on `Node.prototype` by the cssom extension, and `focus` /
  // `blur` delegate to the same interaction helpers `HTMLElement` uses (the
  // upstream spyOn-`HTMLElementUtility` assertions are internal and dropped).
  ctx.defineAccessor(SVGElement.prototype, "ownerSVGElement", function ownerSVGElement() {
    return ownerSvgElement(ctx, this);
  }, undefined);
  ctx.defineAccessor(SVGElement.prototype, "viewportElement", function viewportElement() {
    return ownerSvgElement(ctx, this);
  }, undefined);
  ctx.defineAccessor(SVGElement.prototype, "dataset", function dataset() {
    return datasetFor(ctx, this);
  }, undefined);
  ctx.defineAccessor(SVGElement.prototype, "tabIndex", function tabIndex() {
    const raw = nodeHandleOf(this).getAttribute("tabindex");
    return raw !== null ? Number(raw) : -1;
  }, function tabIndex(value) {
    const handle = nodeHandleOf(this);
    if (value === -1) {
      handle.removeAttribute("tabindex");
    } else {
      handle.setAttribute("tabindex", String(value));
    }
  });
  ctx.defineMethod(SVGElement.prototype, "focus", function focus() {
    this.dispatchEvent(new Event("focus", { bubbles: false, composed: true }));
  });
  ctx.defineMethod(SVGElement.prototype, "blur", function blur() {
    this.dispatchEvent(new Event("blur", { bubbles: false, composed: true, cancelable: true }));
  });
  for (const eventName of SVG_ELEMENT_EVENTS) {
    const property = `on${eventName}`;
    ctx.defineAccessor(SVGElement.prototype, property, function svgEventHandler() {
      return eventHandlerGetter(ctx, this, eventName);
    }, function svgEventHandler(value) {
      eventHandlerSetter(ctx, this, eventName, value);
    });
  }

  // SVGAnimationElement: the begin / end / repeat event handlers.
  for (const eventName of ["begin", "end", "repeat"]) {
    const property = `on${eventName}`;
    ctx.defineAccessor(SVGAnimationElement.prototype, property, function svgAnimationHandler() {
      return eventHandlerGetter(ctx, this, eventName);
    }, function svgAnimationHandler(value) {
      eventHandlerSetter(ctx, this, eventName, value);
    });
  }

  // SVGSVGElement: the window-level on<event> handler-attribute accessors
  // happy-dom exposes on the root svg element (upstream svg-svg-element test).
  for (const eventName of SVG_ROOT_ELEMENT_EVENTS) {
    const property = `on${eventName}`;
    ctx.defineAccessor(SVGSVGElement.prototype, property, function svgRootEventHandler() {
      return eventHandlerGetter(ctx, this, eventName);
    }, function svgRootEventHandler(value) {
      eventHandlerSetter(ctx, this, eventName, value);
    });
  }

  // Window globals (happy-dom BrowserWindow exposes the SVG classes directly,
  // plus the shared NodeList class as a plain global).
  ctx.defineAccessor(Window.prototype, "NodeList", function getNodeListClass() {
    return NodeList;
  }, undefined);
  for (const [Class, name] of SVG_VALUE_CLASSES) {
    ctx.defineAccessor(Window.prototype, name, function getSvgValueClass() {
      return Class;
    }, undefined);
  }
  for (const [Class, name] of SVG_ELEMENT_CLASSES) {
    ctx.defineAccessor(Window.prototype, name, function getSvgElementClass() {
      return Class;
    }, undefined);
  }

  // Tag → class selection and the unknown-SVG-tag fallback.
  setSvgElementFallbackClass(SVGElement);
  for (const [tag, Class] of SVG_TAG_CLASSES) {
    registerSvgElementClass(tag, Class);
  }

  // `document.createElementNS` (WHATWG): mints a node in the requested
  // namespace through the native binding; the SVG namespace resolves to the
  // per-tag classes above, any other namespace returns a plain Element (the
  // node keeps its namespace, so `namespaceURI` / `nodeName` report it).
  ctx.defineMethod(Document.prototype, "createElementNS", function createElementNS(namespaceURI, qualifiedName) {
    const documentHandle = ctx.documentContext.handleOf(this);
    let element;
    try {
      element = ctx.wrap(documentHandle.createElementNs(String(namespaceURI), String(qualifiedName)));
    } catch (error) {
      const message =
        error?.code === "ERR_MAD_DOM_INVALID_CHARACTER"
          ? `Uncaught InvalidCharacterError: Failed to execute 'createElementNS' on 'Document': '${String(qualifiedName)}' is not a valid element name.`
          : webidlMessage(error, "createElementNS", "Document");
      rethrowDomError(error, message);
    }
    return element;
  });
}
