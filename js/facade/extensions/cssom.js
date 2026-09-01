// CSSOM facade extension (T44).
//
// Installs the happy-dom 20.11.11 public contract for the CSS Object Model —
// `Element.style` (a live `CSSStyleDeclaration` over the element's `style`
// attribute), the first batch of stylesheet/rule API (`document.styleSheets`,
// `<style>` element `.sheet`, `CSSStyleSheet` with `cssRules` /
// `insertRule` / `deleteRule`, and the `CSSRule` family), `matchMedia` /
// `MediaQueryList`, and a layout-free `getComputedStyle` — calibrated against
// the locked happy-dom observable behavior.
//
// # The `style` attribute is the single authoritative state
//
// MAD DOM stores element attributes in Core (T25B); the `style` attribute is
// just another attribute there. `CSSStyleDeclaration` is a **live facade** over
// it: every read parses `getAttribute("style")` on demand and every mutation
// serializes back through `setAttribute` / `removeAttribute`, exactly like
// `classList` / `DOMTokenList` is a live facade over the `class` attribute
// (T34). There is no second copy of the CSS text — the attribute string in Core
// is authoritative and the declaration is a derived, re-parse-on-access view.
// This satisfies "style 与属性只保留一份权威状态或有明确同步边界".
//
// # Property manager (faithful port of the happy-dom observable behavior)
//
// The CSS text ↔ property-map conversion replicates happy-dom's
// `CSSStyleDeclarationPropertyManager` + value/set/get parsers: cssText is
// split into `name: value [!important]` rules, known properties are expanded
// into their longhand sub-properties (margin → margin-top/right/bottom/left,
// border, font, background, ...), `length` / `item(i)` / indexed access count
// the *expanded* set, and serialization collapses longhands back into
// shorthands when happy-dom would. Unknown properties fall back to happy-dom's
// verbatim-trimmed storage. The value parsers replicate the happy-dom
// normalization (`0` → `0px`, known colors lowercased, `rgb(...)` comma
// spacing, url quoting, global keywords, ...) so cssText round-trips match the
// baseline observation for observation.
//
// # Stylesheets are parsed on access from the `<style>` textContent
//
// `document.styleSheets` walks connected `<style>` elements (T31
// `querySelectorAll`) and returns their `.sheet`. A `CSSStyleSheet` parses the
// element's `textContent` into `cssRules` the first time it is read and
// re-parses when the text changes (comparing a cached snapshot, so
// `insertRule` / `deleteRule` mutations stay until the text is edited, exactly
// like happy-dom). Rule mutations (`insertRule`, `deleteRule`, `replaceSync`)
// operate on the sheet's own rule list; they never rewrite the `<style>`
// element's text (happy-dom parity, verified against the baseline).
//
// # matchMedia / MediaQueryList
//
// `window.matchMedia(query)` returns a `MediaQueryList` (media / matches /
// onchange / addListener / removeListener / addEventListener /
// removeEventListener / dispatchEvent). Queries are evaluated against the
// happy-dom default viewport (1024×768) with a faithful port of the baseline
// media-query parser and item matcher (width/height ranges, `min-`/`max-`,
// orientation, media types, `not` / `and` / `or` / comma). No layout, no
// resize wiring — a stable, deterministic evaluation surface.
//
// # getComputedStyle without layout
//
// `window.getComputedStyle(element, pseudoElt)` returns a computed
// `CSSStyleDeclaration` that never fabricates layout-dependent values: it
// walks the parent chain applying the per-tag default CSS, the inline `style`
// attribute and the inherited font/direction/color properties, exactly like
// happy-dom's computed-style engine does for the cases that need no layout
// measurement. Detached elements compute to empty (length 0). Computed
// declarations are read-only (cssText / setProperty / removeProperty throw the
// happy-dom `DOMException`).
//
// # Window constructor surface
//
// `window.CSSStyleDeclaration`, `window.CSSRule`, `window.CSSStyleSheet`,
// `window.CSSStyleRule`, `window.CSSMediaRule`, `window.CSSKeyframesRule`,
// `window.CSSKeyframeRule`, `window.CSSFontFaceRule`, `window.CSSSupportsRule`,
// `window.CSSGroupingRule`, `window.CSSConditionRule`, `window.MediaList`,
// `window.MediaQueryListEvent`, `window.CSSStyleValue`,
// `window.CSSKeywordValue` and `window.CSS` are wired as window accessors, and
// the classes are exported from the package entry like the baseline.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing else in the registry changes beyond the
// import and array entry.

import { Document } from "../document.js";
import { Window } from "../window.js";
import { Node } from "./node.js";
import { Event } from "./events.js";

export const seam = Object.freeze({
  id: "facade/extensions/cssom",
  owner: "T44",
  gate: "T44",
  status: "implemented",
});

// ─── handle helpers ──────────────────────────────────────────────────────────

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function isDocumentHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.destroy === "function" &&
    typeof handle.appendChild === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

function facadeDocumentHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isDocumentHandle(handle)) {
    throw new TypeError(`Document.${role} requires a genuine Document facade wrapper`);
  }
  return handle;
}

// ─── CSS declaration value parser (happy-dom port) ───────────────────────────

const COLOR_REGEXP = /^#([0-9a-fA-F]{3,4}){1,2}$|^rgb\(([^)]*)\)$|^rgba\(([^)]*)\)$|^hsla?\(\s*(-?\d+|-?\d*.\d+)\s*,\s*(-?\d+|-?\d*.\d+)%\s*,\s*(-?\d+|-?\d*.\d+)%\s*(,\s*(-?\d+|-?\d*.\d+)\s*)?\)|(?:(rgba?|hsla?)\((var\(\s*(--[^)\s]+)\))\))/;
const LENGTH_REGEXP = /^(0|[-+]?[0-9]*\.?[0-9]+)(in|cm|em|mm|pt|pc|px|ex|rem|vh|vw|ch|vmin|vmax|Q)$/;
const PERCENTAGE_REGEXP = /^[-+]?[0-9]*\.?[0-9]+%$/;
const DEGREE_REGEXP = /^[0-9]+deg$/;
const URL_REGEXP = /^url\(\s*([^)]*)\s*\)$/;
const INTEGER_REGEXP = /^[0-9]+$/;
const FLOAT_REGEXP = /^[0-9.]+$/;
const CALC_REGEXP = /^calc\([^^)]+\)$/;
const CSS_VARIABLE_REGEXP = /^var\(\s*(--[^)\s]+)\)$/;
const FIT_CONTENT_REGEXP = /^fit-content\([^^)]+\)$/;
const GRADIENT_REGEXP = /^((repeating-linear|linear|radial|repeating-radial|conic|repeating-conic)-gradient)\(((?:[^()]|\([^()]*\))*)\)$/;
const GLOBALS = ["inherit", "initial", "unset", "revert"];
const COLORS = [
  "none", "currentcolor", "transparent", "silver", "gray", "white", "maroon", "red", "purple",
  "fuchsia", "green", "lime", "olive", "yellow", "navy", "blue", "teal", "aliceblue", "aqua",
  "antiquewhite", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond",
  "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral",
  "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod",
  "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen",
  "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue",
  "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
  "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "gainsboro",
  "ghostwhite", "gold", "goldenrod", "greenyellow", "grey", "honeydew", "hotpink", "indianred",
  "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon",
  "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen",
  "lightgrey", "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
  "lightslategrey", "lightsteelblue", "lightyellow", "limegreen", "linen", "magenta",
  "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen",
  "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue",
  "mintcream", "mistyrose", "moccasin", "navajowhite", "oldlace", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred",
  "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "rebeccapurple",
  "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell",
  "sienna", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "thistle", "tomato", "turquoise", "violet", "wheat", "whitesmoke",
  "yellowgreen",
];

function splitByComma(value) {
  const parts = [];
  let depth = 0;
  let lastIndex = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      const part = value.substring(lastIndex, i).trim();
      if (part) parts.push(part);
      lastIndex = i + 1;
    }
  }
  if (lastIndex < value.length) {
    const part = value.substring(lastIndex).trim();
    if (part) parts.push(part);
  }
  return parts;
}

function splitBySpace(value) {
  const parts = [];
  let depth = 0;
  let lastIndex = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0 && /\s/.test(char)) {
      const part = value.substring(lastIndex, i).trim();
      if (part) parts.push(part);
      lastIndex = i + 1;
    }
  }
  if (lastIndex < value.length) {
    const part = value.substring(lastIndex).trim();
    if (part) parts.push(part);
  }
  return parts;
}

const ValueParser = {
  getLength(value) {
    if (value === "0") return "0px";
    const match = value.match(LENGTH_REGEXP);
    if (match) {
      const number = parseFloat(match[1]);
      if (isNaN(number)) return null;
      return `${Math.round(number * 1000000) / 1000000}${match[2]}`;
    }
    return null;
  },
  getPercentage(value) {
    if (value === "0") return "0%";
    return PERCENTAGE_REGEXP.test(value) ? value : null;
  },
  getDegree(value) {
    if (value === "0") return "0deg";
    return DEGREE_REGEXP.test(value) ? value : null;
  },
  getCalc(value) {
    return CALC_REGEXP.test(value) ? value : null;
  },
  getFitContent(value) {
    const lower = value.toLowerCase();
    if (lower === "auto" || lower === "max-content" || lower === "min-content" || lower === "fit-content") return lower;
    return FIT_CONTENT_REGEXP.test(lower) ? lower : null;
  },
  getMeasurement(value) {
    return this.getLength(value) || this.getPercentage(value) || this.getCalc(value);
  },
  getContentMeasurement(value) {
    return this.getFitContent(value) || this.getMeasurement(value);
  },
  getAutoMeasurement(value) {
    return value.toLocaleLowerCase() === "auto" ? "auto" : this.getMeasurement(value);
  },
  getInteger(value) {
    return INTEGER_REGEXP.test(value) ? value : null;
  },
  getFloat(value) {
    if (FLOAT_REGEXP.test(value)) {
      const number = parseFloat(value);
      if (isNaN(number)) return null;
      return String(Math.round(number * 1000000) / 1000000);
    }
    return null;
  },
  getGradient(value) {
    const match = value.match(GRADIENT_REGEXP);
    if (match) return `${match[1]}(${splitByComma(match[3].trim()).join(", ")})`;
    return null;
  },
  getColor(value) {
    const lower = value.toLowerCase();
    if (COLORS.includes(lower)) return lower;
    if (COLOR_REGEXP.test(value)) return value.replace(/,([^ ])/g, ", $1");
    return null;
  },
  getURL(value) {
    if (!value) return null;
    if (value.toLowerCase() === "none") return "none";
    const result = URL_REGEXP.exec(value);
    if (!result) return null;
    let url = result[1].trim();
    if ((url[0] === '"' || url[0] === "'") && url[0] !== url[url.length - 1]) return null;
    if (url[0] === '"' || url[0] === "'") url = url.substring(1, url.length - 1);
    for (let i = 0; i < url.length; i++) {
      switch (url[i]) {
        case "(":
        case ")":
        case " ":
        case "\t":
        case "\n":
        case "'":
        case '"':
          return null;
        case "\\":
          i++;
          break;
      }
    }
    return `url("${url}")`;
  },
  getInitial(value) {
    return value.toLowerCase() === "initial" ? "initial" : null;
  },
  getVariable(value) {
    const match = value.match(CSS_VARIABLE_REGEXP);
    return match ? `var(${match[1]})` : null;
  },
  getGlobal(value) {
    const lower = value.toLowerCase();
    return GLOBALS.includes(lower) ? lower : null;
  },
  getGlobalExceptInitial(value) {
    const lower = value.toLowerCase();
    return lower !== "initial" && GLOBALS.includes(lower) ? lower : null;
  },
};

// ─── property set parsers (happy-dom port) ───────────────────────────────────

const RECT_REGEXP = /^rect\((.*)\)$/i;
const SPLIT_COMMA = /,(?=(?:(?:(?!\))[\s\S])*\()|[^\(\)]*$)/;
const SPLIT_SPACE = /\s+(?=(?:(?:(?!\))[\s\S])*\()|[^\(\)]*$)/;

const BORDER_STYLE = ["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"];
const BORDER_WIDTH = ["thin", "medium", "thick"];
const BORDER_COLLAPSE = ["separate", "collapse"];
const BACKGROUND_REPEAT = ["repeat", "repeat-x", "repeat-y", "no-repeat"];
const BACKGROUND_ORIGIN = ["border-box", "padding-box", "content-box"];
const BACKGROUND_CLIP = ["border-box", "padding-box", "content-box"];
const BACKGROUND_ATTACHMENT = ["scroll", "fixed"];
const FLEX_BASIS = ["auto", "fill", "content"];
const CLEAR = ["none", "left", "right", "both"];
const FLOAT = ["none", "left", "right", "inline-start", "inline-end"];
const SYSTEM_FONT = ["caption", "icon", "menu", "message-box", "small-caption", "status-bar"];
const FONT_WEIGHT = ["normal", "bold", "bolder", "lighter"];
const FONT_STYLE = ["normal", "italic", "oblique"];
const FONT_SIZE = ["xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large", "smaller", "larger"];
const FONT_STRETCH = ["ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "normal", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded"];
const DISPLAY = [
  "block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "flow-root",
  "none", "contents",
  "block flow", "inline flow", "inline flow-root", "block flex", "inline flex", "block grid", "inline grid", "block flow-root",
  "table", "table-row", "list-item",
];
const TEXT_TRANSFORM = ["capitalize", "uppercase", "lowercase", "none", "full-width", "full-size-kana"];
const VISIBILITY = ["visible", "hidden", "collapse"];
const BORDER_IMAGE_REPEAT = ["stretch", "repeat", "round", "space"];

function splitValue(value) {
  return value.split(SPLIT_SPACE);
}

const SetParser = {
  getBorderCollapse(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-collapse": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BORDER_COLLAPSE.includes(lower)) return { "border-collapse": { value: lower, important } };
    return null;
  },
  getDisplay(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { display: { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || DISPLAY.includes(lower)) return { display: { value: lower, important } };
    return null;
  },
  getDirection(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { direction: { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || lower === "ltr" || lower === "rtl") return { direction: { value: lower, important } };
    return null;
  },
  getLetterSpacing(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { "letter-spacing": { value: parsed, important } } : null;
  },
  getWordSpacing(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { "word-spacing": { value: parsed, important } } : null;
  },
  getTextIndent(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { "text-indent": { value: parsed, important } } : null;
  },
  getWidth(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { width: { value: parsed, important } } : null;
  },
  getHeight(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { height: { value: parsed, important } } : null;
  },
  getTop(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { top: { value: parsed, important } } : null;
  },
  getRight(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { right: { value: parsed, important } } : null;
  },
  getBottom(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { bottom: { value: parsed, important } } : null;
  },
  getLeft(value, important) {
    const parsed = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getContentMeasurement(value);
    return parsed ? { left: { value: parsed, important } } : null;
  },
  getClear(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { clear: { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || CLEAR.includes(lower)) return { clear: { value: lower, important } };
    return null;
  },
  getClip(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { clip: { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || lower === "auto") return { clip: { value: lower, important } };
    const matches = lower.match(RECT_REGEXP);
    if (!matches) return null;
    const parts = matches[1].split(/\s*,\s*/);
    if (parts.length !== 4) return null;
    for (const part of parts) if (!ValueParser.getMeasurement(part)) return null;
    return { clip: { value, important } };
  },
  getFloat(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { float: { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || FLOAT.includes(lower)) return { float: { value: lower, important } };
    return null;
  },
  getCSSFloat(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "css-float": { value: variable, important } };
    const float = this.getFloat(value, important);
    return float ? { "css-float": float.float } : null;
  },
  getOutline(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { outline: { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getOutlineColor(globalValue, important), ...this.getOutlineStyle(globalValue, important), ...this.getOutlineWidth(globalValue, important) };
    }
    const properties = {
      ...this.getOutlineColor("initial", important),
      ...this.getOutlineStyle("initial", important),
      ...this.getOutlineWidth("initial", important),
    };
    const parts = splitValue(value);
    for (const part of parts) {
      const width = this.getOutlineWidth(part, important);
      const style = this.getOutlineStyle(part, important);
      const color = this.getOutlineColor(part, important);
      if (width === null && style === null && color === null) return null;
      Object.assign(properties, width, style, color);
    }
    return properties;
  },
  getOutlineColor(value, important) {
    const color = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getColor(value);
    return color ? { "outline-color": { value: color, important } } : null;
  },
  getOutlineStyle(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "outline-style": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BORDER_STYLE.includes(lower)) return { "outline-style": { value: lower, important } };
    return null;
  },
  getOutlineWidth(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "outline-width": { value: variable, important } };
    const lower = value.toLowerCase();
    const parsed = BORDER_WIDTH.includes(lower) || ValueParser.getGlobal(lower) ? lower : ValueParser.getLength(value);
    if (parsed) return { "outline-width": { value: parsed, important } };
    return null;
  },
  getBorderImage(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-image": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return {
        ...this.getBorderImageSource(globalValue, important),
        ...this.getBorderImageSlice(globalValue, important),
        ...this.getBorderImageWidth(globalValue, important),
        ...this.getBorderImageOutset(globalValue, important),
        ...this.getBorderImageRepeat(globalValue, important),
      };
    }
    let parsedValue = value.replace(/\s\/\s/g, "/");
    const sourceMatch = parsedValue.match(/\s*([a-zA-Z-]+\([^)]*\))\s*/);
    if (sourceMatch) {
      parsedValue = parsedValue.replace(sourceMatch[0], "");
    }
    const parts = parsedValue.split(SPLIT_SPACE);
    if (sourceMatch) {
      parts.push(sourceMatch[1]);
    }
    const properties = {
      ...this.getBorderImageSource("none", important),
      ...this.getBorderImageSlice("100%", important),
      ...this.getBorderImageWidth("1", important),
      ...this.getBorderImageOutset("0", important),
      ...this.getBorderImageRepeat("stretch", important),
    };
    for (let i = 0, max = parts.length; i < max; i++) {
      const part = parts[i];
      const previousPart = i > 0 ? parts[i - 1] : "";
      if (!part.startsWith("url") && part.includes("/")) {
        const [slice, width, outset] = part.split("/");
        const borderImageSlice = this.getBorderImageSlice(`${previousPart} ${slice}`, important) ||
          this.getBorderImageSlice(slice, important);
        const borderImageWidth = this.getBorderImageWidth(width, important);
        const borderImageOutset = outset && this.getBorderImageOutset(outset, important);
        if (!borderImageSlice || !borderImageWidth || borderImageOutset === null) return null;
        Object.assign(properties, borderImageSlice, borderImageWidth, borderImageOutset);
      } else {
        const slice = this.getBorderImageSlice(`${previousPart} ${part}`, important) ||
          this.getBorderImageSlice(part, important);
        const source = this.getBorderImageSource(part, important);
        const repeat = this.getBorderImageRepeat(part, important);
        if (!slice && !source && !repeat) return null;
        Object.assign(properties, slice, source, repeat);
      }
    }
    return properties;
  },
  getBorderImageSource(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-image-source": { value: variable, important } };
    const lowerValue = value.toLowerCase();
    if (ValueParser.getGlobal(lowerValue) || lowerValue === "none") {
      return { "border-image-source": { value: lowerValue, important } };
    }
    const parsedValue = ValueParser.getURL(value) || ValueParser.getGradient(value);
    if (!parsedValue) return null;
    return { "border-image-source": { value: parsedValue, important } };
  },
  getBorderImageSlice(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-image-slice": { value: variable, important } };
    const lowerValue = value.toLowerCase();
    if (ValueParser.getGlobal(lowerValue)) {
      return { "border-image-slice": { value: lowerValue, important } };
    }
    if (lowerValue !== lowerValue.trim()) return null;
    const regexp = /(fill)|(calc\([^^)]+\))|([0-9]+%)|([0-9]+)/g;
    const values = [];
    let match;
    while ((match = regexp.exec(lowerValue))) {
      const previousCharacter = lowerValue[match.index - 1];
      const nextCharacter = lowerValue[match.index + match[0].length];
      if ((previousCharacter && previousCharacter !== " ") || (nextCharacter && nextCharacter !== " ")) return null;
      const fill = match[1] && "fill";
      const calc = match[2] && ValueParser.getCalc(match[2]);
      const percentage = match[3] && ValueParser.getPercentage(match[3]);
      const integer = match[4] && ValueParser.getInteger(match[4]);
      if (!fill && !calc && !percentage && !integer) return null;
      values.push(fill || calc || percentage || integer);
    }
    if (!values.length || values.length > 4) return null;
    return { "border-image-slice": { value: values.join(" "), important } };
  },
  getBorderImageWidth(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-image-width": { value: variable, important } };
    const lowerValue = value.toLowerCase();
    if (ValueParser.getGlobal(lowerValue)) {
      return { "border-image-width": { value: lowerValue, important } };
    }
    const parts = lowerValue.split(SPLIT_SPACE);
    if (parts.length > 4) return null;
    for (const part of parts) {
      if (!ValueParser.getInteger(part) && !ValueParser.getAutoMeasurement(part)) return null;
    }
    return { "border-image-width": { value, important } };
  },
  getBorderImageOutset(value, important) {
    if (value === "0") {
      return { "border-image-outset": { value, important } };
    }
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-image-outset": { value: variable, important } };
    const lowerValue = value.toLowerCase();
    if (ValueParser.getGlobal(lowerValue)) {
      return { "border-image-outset": { value: lowerValue, important } };
    }
    const parts = value.split(SPLIT_SPACE);
    if (parts.length > 4) return null;
    const newParts = [];
    for (const part of parts) {
      const parsedValue = ValueParser.getLength(part) || ValueParser.getFloat(part);
      if (!parsedValue) return null;
      newParts.push(parsedValue === "0px" ? "0" : parsedValue);
    }
    return { "border-image-outset": { value: newParts.join(" "), important } };
  },
  getBorderImageRepeat(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-image-repeat": { value: variable, important } };
    const lowerValue = value.toLowerCase();
    if (ValueParser.getGlobal(lowerValue)) {
      return { "border-image-repeat": { value: lowerValue, important } };
    }
    const parts = lowerValue.split(SPLIT_SPACE);
    if (parts.length > 2) return null;
    for (const part of parts) {
      if (!BORDER_IMAGE_REPEAT.includes(part)) return null;
    }
    return { "border-image-repeat": { value, important } };
  },
  getBorder(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { border: { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return {
        ...this.getBorderWidth(globalValue, important),
        ...this.getBorderStyle(globalValue, important),
        ...this.getBorderColor(globalValue, important),
        ...this.getBorderImage(globalValue, important),
      };
    }
    const properties = {
      ...this.getBorderWidth("initial", important),
      ...this.getBorderStyle("initial", important),
      ...this.getBorderColor("initial", important),
      ...this.getBorderImage("initial", important),
    };
    const parts = value.replace(/\s*,\s*/g, ",").split(SPLIT_SPACE);
    for (const part of parts) {
      const width = this.getBorderWidth(part, important);
      const style = this.getBorderStyle(part, important);
      const color = this.getBorderColor(part, important);
      if (width === null && style === null && color === null) return null;
      Object.assign(properties, width, style, color);
    }
    return properties;
  },
  getBorderWidth(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-width": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBorderTopWidth(globalValue, important), ...this.getBorderRightWidth(globalValue, important), ...this.getBorderBottomWidth(globalValue, important), ...this.getBorderLeftWidth(globalValue, important) };
    }
    const parts = splitValue(value);
    const top = this.getBorderTopWidth(parts[0], important);
    const right = this.getBorderRightWidth(parts[1] || parts[0], important);
    const bottom = this.getBorderBottomWidth(parts[2] || parts[0], important);
    const left = this.getBorderLeftWidth(parts[3] || parts[1] || parts[0], important);
    if (!top || !right || !bottom || !left) return null;
    return { ...top, ...right, ...bottom, ...left };
  },
  getBorderStyle(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-style": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBorderTopStyle(globalValue, important), ...this.getBorderRightStyle(globalValue, important), ...this.getBorderBottomStyle(globalValue, important), ...this.getBorderLeftStyle(globalValue, important) };
    }
    const parts = splitValue(value);
    const top = this.getBorderTopStyle(parts[0], important);
    const right = this.getBorderRightStyle(parts[1] || parts[0], important);
    const bottom = this.getBorderBottomStyle(parts[2] || parts[0], important);
    const left = this.getBorderLeftStyle(parts[3] || parts[1] || parts[0], important);
    if (!top || !right || !bottom || !left) return null;
    return { ...top, ...right, ...bottom, ...left };
  },
  getBorderColor(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-color": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBorderTopColor(globalValue, important), ...this.getBorderRightColor(globalValue, important), ...this.getBorderBottomColor(globalValue, important), ...this.getBorderLeftColor(globalValue, important) };
    }
    const parts = splitValue(value);
    const top = this.getBorderTopColor(parts[0], important);
    const right = this.getBorderRightColor(parts[1] || parts[0], important);
    const bottom = this.getBorderBottomColor(parts[2] || parts[0], important);
    const left = this.getBorderLeftColor(parts[3] || parts[1] || parts[0], important);
    if (!top || !right || !bottom || !left) return null;
    return { ...top, ...right, ...bottom, ...left };
  },
  getBorderTopWidth(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-top-width": { value: variable, important } };
    const lower = value.toLowerCase();
    const parsed = BORDER_WIDTH.includes(lower) || ValueParser.getGlobal(lower) ? lower : ValueParser.getLength(value);
    if (parsed) return { "border-top-width": { value: parsed, important } };
    return null;
  },
  getBorderRightWidth(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-right-width": { value: variable, important } };
    const lower = value.toLowerCase();
    const parsed = BORDER_WIDTH.includes(lower) || ValueParser.getGlobal(lower) ? lower : ValueParser.getLength(value);
    if (parsed) return { "border-right-width": { value: parsed, important } };
    return null;
  },
  getBorderBottomWidth(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-bottom-width": { value: variable, important } };
    const lower = value.toLowerCase();
    const parsed = BORDER_WIDTH.includes(lower) || ValueParser.getGlobal(lower) ? lower : ValueParser.getLength(value);
    if (parsed) return { "border-bottom-width": { value: parsed, important } };
    return null;
  },
  getBorderLeftWidth(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-left-width": { value: variable, important } };
    const lower = value.toLowerCase();
    const parsed = BORDER_WIDTH.includes(lower) || ValueParser.getGlobal(lower) ? lower : ValueParser.getLength(value);
    if (parsed) return { "border-left-width": { value: parsed, important } };
    return null;
  },
  getBorderTopStyle(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-top-style": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BORDER_STYLE.includes(lower)) return { "border-top-style": { value: lower, important } };
    return null;
  },
  getBorderRightStyle(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-right-style": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BORDER_STYLE.includes(lower)) return { "border-right-style": { value: lower, important } };
    return null;
  },
  getBorderBottomStyle(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-bottom-style": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BORDER_STYLE.includes(lower)) return { "border-bottom-style": { value: lower, important } };
    return null;
  },
  getBorderLeftStyle(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-left-style": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BORDER_STYLE.includes(lower)) return { "border-left-style": { value: lower, important } };
    return null;
  },
  getBorderTopColor(value, important) {
    const color = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getColor(value);
    return color ? { "border-top-color": { value: color, important } } : null;
  },
  getBorderRightColor(value, important) {
    const color = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getColor(value);
    return color ? { "border-right-color": { value: color, important } } : null;
  },
  getBorderBottomColor(value, important) {
    const color = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getColor(value);
    return color ? { "border-bottom-color": { value: color, important } } : null;
  },
  getBorderLeftColor(value, important) {
    const color = ValueParser.getVariable(value) || ValueParser.getGlobal(value) || ValueParser.getColor(value);
    return color ? { "border-left-color": { value: color, important } } : null;
  },
  getBorderRadius(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-radius": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBorderTopLeftRadius(globalValue, important), ...this.getBorderTopRightRadius(globalValue, important), ...this.getBorderBottomRightRadius(globalValue, important), ...this.getBorderBottomLeftRadius(globalValue, important) };
    }
    const parts = splitValue(value);
    const topLeft = this.getBorderTopLeftRadius(parts[0], important);
    const topRight = this.getBorderTopRightRadius(parts[1] || parts[0], important);
    const bottomRight = this.getBorderBottomRightRadius(parts[2] || parts[0], important);
    const bottomLeft = this.getBorderBottomLeftRadius(parts[3] || parts[1] || parts[0], important);
    if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;
    return { ...topLeft, ...topRight, ...bottomRight, ...bottomLeft };
  },
  getBorderTopLeftRadius(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-top-left-radius": { value: variable, important } };
    const radius = ValueParser.getGlobal(value) || ValueParser.getMeasurement(value);
    return radius ? { "border-top-left-radius": { value: radius, important } } : null;
  },
  getBorderTopRightRadius(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-top-right-radius": { value: variable, important } };
    const radius = ValueParser.getGlobal(value) || ValueParser.getMeasurement(value);
    return radius ? { "border-top-right-radius": { value: radius, important } } : null;
  },
  getBorderBottomRightRadius(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-bottom-right-radius": { value: variable, important } };
    const radius = ValueParser.getGlobal(value) || ValueParser.getMeasurement(value);
    return radius ? { "border-bottom-right-radius": { value: radius, important } } : null;
  },
  getBorderBottomLeftRadius(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-bottom-left-radius": { value: variable, important } };
    const radius = ValueParser.getGlobal(value) || ValueParser.getMeasurement(value);
    return radius ? { "border-bottom-left-radius": { value: radius, important } } : null;
  },
  getBorderTop(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-top": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBorderTopWidth(globalValue, important), ...this.getBorderTopStyle(globalValue, important), ...this.getBorderTopColor(globalValue, important) };
    }
    const properties = {
      ...this.getBorderTopWidth("initial", important),
      ...this.getBorderTopStyle("initial", important),
      ...this.getBorderTopColor("initial", important),
    };
    const parts = splitValue(value);
    for (const part of parts) {
      const width = this.getBorderTopWidth(part, important);
      const style = this.getBorderTopStyle(part, important);
      const color = this.getBorderTopColor(part, important);
      if (width === null && style === null && color === null) return null;
      Object.assign(properties, width, style, color);
    }
    return properties;
  },
  getBorderRight(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-right": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBorderRightWidth(globalValue, important), ...this.getBorderRightStyle(globalValue, important), ...this.getBorderRightColor(globalValue, important) };
    }
    const properties = {
      ...this.getBorderRightWidth("initial", important),
      ...this.getBorderRightStyle("initial", important),
      ...this.getBorderRightColor("initial", important),
    };
    const parts = splitValue(value);
    for (const part of parts) {
      const width = this.getBorderRightWidth(part, important);
      const style = this.getBorderRightStyle(part, important);
      const color = this.getBorderRightColor(part, important);
      if (width === null && style === null && color === null) return null;
      Object.assign(properties, width, style, color);
    }
    return properties;
  },
  getBorderBottom(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-bottom": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBorderBottomWidth(globalValue, important), ...this.getBorderBottomStyle(globalValue, important), ...this.getBorderBottomColor(globalValue, important) };
    }
    const properties = {
      ...this.getBorderBottomWidth("initial", important),
      ...this.getBorderBottomStyle("initial", important),
      ...this.getBorderBottomColor("initial", important),
    };
    const parts = splitValue(value);
    for (const part of parts) {
      const width = this.getBorderBottomWidth(part, important);
      const style = this.getBorderBottomStyle(part, important);
      const color = this.getBorderBottomColor(part, important);
      if (width === null && style === null && color === null) return null;
      Object.assign(properties, width, style, color);
    }
    return properties;
  },
  getBorderLeft(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "border-left": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBorderLeftWidth(globalValue, important), ...this.getBorderLeftStyle(globalValue, important), ...this.getBorderLeftColor(globalValue, important) };
    }
    const properties = {
      ...this.getBorderLeftWidth("initial", important),
      ...this.getBorderLeftStyle("initial", important),
      ...this.getBorderLeftColor("initial", important),
    };
    const parts = splitValue(value);
    for (const part of parts) {
      const width = this.getBorderLeftWidth(part, important);
      const style = this.getBorderLeftStyle(part, important);
      const color = this.getBorderLeftColor(part, important);
      if (width === null && style === null && color === null) return null;
      Object.assign(properties, width, style, color);
    }
    return properties;
  },
  getPadding(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { padding: { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getPaddingTop(globalValue, important), ...this.getPaddingRight(globalValue, important), ...this.getPaddingBottom(globalValue, important), ...this.getPaddingLeft(globalValue, important) };
    }
    const parts = splitValue(value);
    const top = this.getPaddingTop(parts[0], important);
    const right = this.getPaddingRight(parts[1] || parts[0], important);
    const bottom = this.getPaddingBottom(parts[2] || parts[0], important);
    const left = this.getPaddingLeft(parts[3] || parts[1] || parts[0], important);
    if (!top || !right || !bottom || !left) return null;
    return { ...top, ...right, ...bottom, ...left };
  },
  getPaddingTop(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "padding-top": { value: variable, important } };
    const padding = ValueParser.getGlobal(value) || ValueParser.getMeasurement(value);
    return padding ? { "padding-top": { value: padding, important } } : null;
  },
  getPaddingRight(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "padding-right": { value: variable, important } };
    const padding = ValueParser.getGlobal(value) || ValueParser.getMeasurement(value);
    return padding ? { "padding-right": { value: padding, important } } : null;
  },
  getPaddingBottom(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "padding-bottom": { value: variable, important } };
    const padding = ValueParser.getGlobal(value) || ValueParser.getMeasurement(value);
    return padding ? { "padding-bottom": { value: padding, important } } : null;
  },
  getPaddingLeft(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "padding-left": { value: variable, important } };
    const padding = ValueParser.getGlobal(value) || ValueParser.getMeasurement(value);
    return padding ? { "padding-left": { value: padding, important } } : null;
  },
  getMargin(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { margin: { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getMarginTop(globalValue, important), ...this.getMarginRight(globalValue, important), ...this.getMarginBottom(globalValue, important), ...this.getMarginLeft(globalValue, important) };
    }
    const parts = splitValue(value);
    const top = this.getMarginTop(parts[0], important);
    const right = this.getMarginRight(parts[1] || parts[0], important);
    const bottom = this.getMarginBottom(parts[2] || parts[0], important);
    const left = this.getMarginLeft(parts[3] || parts[1] || parts[0], important);
    if (!top || !right || !bottom || !left) return null;
    return { ...top, ...right, ...bottom, ...left };
  },
  getMarginTop(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "margin-top": { value: variable, important } };
    const margin = ValueParser.getGlobal(value) || ValueParser.getAutoMeasurement(value);
    return margin ? { "margin-top": { value: margin, important } } : null;
  },
  getMarginRight(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "margin-right": { value: variable, important } };
    const margin = ValueParser.getGlobal(value) || ValueParser.getAutoMeasurement(value);
    return margin ? { "margin-right": { value: margin, important } } : null;
  },
  getMarginBottom(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "margin-bottom": { value: variable, important } };
    const margin = ValueParser.getGlobal(value) || ValueParser.getAutoMeasurement(value);
    return margin ? { "margin-bottom": { value: margin, important } } : null;
  },
  getMarginLeft(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "margin-left": { value: variable, important } };
    const margin = ValueParser.getGlobal(value) || ValueParser.getAutoMeasurement(value);
    return margin ? { "margin-left": { value: margin, important } } : null;
  },
  getFlex(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { flex: { value: variable, important } };
    const lowerValue = value.trim().toLowerCase();
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getFlexGrow(globalValue, important), ...this.getFlexShrink(globalValue, important), ...this.getFlexBasis(globalValue, important) };
    }
    if (lowerValue === "none") {
      return { ...this.getFlexGrow("0", important), ...this.getFlexShrink("0", important), ...this.getFlexBasis("auto", important) };
    }
    if (lowerValue === "auto") {
      return { ...this.getFlexGrow("1", important), ...this.getFlexShrink("1", important), ...this.getFlexBasis("auto", important) };
    }
    const measurement = ValueParser.getContentMeasurement(lowerValue);
    if (measurement) {
      return { ...this.getFlexGrow("1", important), ...this.getFlexShrink("1", important), ...this.getFlexBasis(measurement, important) };
    }
    const parts = splitValue(value);
    const flexGrow = this.getFlexGrow(parts[0], important);
    const flexShrink = this.getFlexShrink(parts[1] || "1", important);
    const flexBasis = this.getFlexBasis(parts[2] || "0%", important);
    if (!flexGrow || !flexShrink || !flexBasis) return null;
    return { ...flexGrow, ...flexShrink, ...flexBasis };
  },
  getFlexBasis(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "flex-basis": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || FLEX_BASIS.includes(lower)) return { "flex-basis": { value: lower, important } };
    const measurement = ValueParser.getContentMeasurement(lower);
    return measurement ? { "flex-basis": { value: measurement, important } } : null;
  },
  getFlexShrink(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "flex-shrink": { value: variable, important } };
    const parsed = ValueParser.getGlobal(value) || ValueParser.getFloat(value);
    return parsed ? { "flex-shrink": { value: parsed, important } } : null;
  },
  getFlexGrow(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "flex-grow": { value: variable, important } };
    const parsed = ValueParser.getGlobal(value) || ValueParser.getFloat(value);
    return parsed ? { "flex-grow": { value: parsed, important } } : null;
  },
  getBackground(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { background: { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return {
        ...this.getBackgroundImage(globalValue, important),
        ...this.getBackgroundPosition(globalValue, important),
        ...this.getBackgroundSize(globalValue, important),
        ...this.getBackgroundRepeat(globalValue, important),
        ...this.getBackgroundAttachment(globalValue, important),
        ...this.getBackgroundOrigin(globalValue, important),
        ...this.getBackgroundClip(globalValue, important),
        ...this.getBackgroundColor(globalValue, important),
      };
    }
    const properties = {
      ...this.getBackgroundImage("initial", important),
      ...this.getBackgroundPosition("initial", important),
      ...this.getBackgroundSize("initial", important),
      ...this.getBackgroundRepeat("initial", important),
      ...this.getBackgroundAttachment("initial", important),
      ...this.getBackgroundOrigin("initial", important),
      ...this.getBackgroundClip("initial", important),
      ...this.getBackgroundColor("initial", important),
    };
    const parts = splitBySpace(value.replace(/\s+\/\s+/g, "/"));
    const backgroundPositions = [];
    for (const part of parts) {
      if (!part.startsWith("url") && part.includes("/")) {
        const [position, size] = part.split("/");
        const backgroundPositionX = this.getBackgroundPositionX(position, important);
        const backgroundPositionY = this.getBackgroundPositionY(position, important);
        const backgroundSize = this.getBackgroundSize(size, important);
        if ((!backgroundPositionX && !backgroundPositionY) || !backgroundSize) return null;
        if (backgroundPositionY) backgroundPositions.push(backgroundPositionY["background-position-y"].value);
        else if (backgroundPositionX) backgroundPositions.push(backgroundPositionX["background-position-x"].value);
        Object.assign(properties, backgroundSize);
      } else {
        const backgroundImage = this.getBackgroundImage(part, important);
        const backgroundRepeat = this.getBackgroundRepeat(part, important);
        const backgroundAttachment = this.getBackgroundAttachment(part, important);
        const backgroundPositionX = this.getBackgroundPositionX(part, important);
        const backgroundPositionY = this.getBackgroundPositionY(part, important);
        const backgroundColor = this.getBackgroundColor(part, important);
        const backgroundOrigin = this.getBackgroundOrigin(part, important);
        const backgroundClip = this.getBackgroundClip(part, important);
        if (!backgroundImage && !backgroundRepeat && !backgroundAttachment && !backgroundPositionX && !backgroundPositionY && !backgroundColor && !backgroundOrigin && !backgroundClip) return null;
        if (backgroundPositionX) backgroundPositions.push(backgroundPositionX["background-position-x"].value);
        else if (backgroundPositionY) backgroundPositions.push(backgroundPositionY["background-position-y"].value);
        Object.assign(properties, backgroundImage, backgroundRepeat, backgroundAttachment, backgroundColor, backgroundOrigin, backgroundClip);
      }
    }
    if (backgroundPositions.length) {
      Object.assign(properties, this.getBackgroundPosition(backgroundPositions.join(" "), important));
    }
    return properties;
  },
  getBackgroundImage(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-image": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || lower === "none") return { "background-image": { value: lower, important } };
    const parts = splitByComma(value);
    const parsed = [];
    for (const part of parts) {
      const parsedValue = ValueParser.getURL(part.trim()) || ValueParser.getGradient(part.trim());
      if (!parsedValue) return null;
      parsed.push(parsedValue);
    }
    if (parsed.length) return { "background-image": { value: parsed.join(", "), important } };
    return null;
  },
  getBackgroundColor(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-color": { value: variable, important } };
    const color = ValueParser.getGlobal(value) || ValueParser.getColor(value);
    return color ? { "background-color": { value: color, important } } : null;
  },
  getBackgroundRepeat(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-repeat": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BACKGROUND_REPEAT.includes(lower)) return { "background-repeat": { value: lower, important } };
    return null;
  },
  getBackgroundAttachment(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-attachment": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BACKGROUND_ATTACHMENT.includes(lower)) return { "background-attachment": { value: lower, important } };
    return null;
  },
  getBackgroundOrigin(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-origin": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BACKGROUND_ORIGIN.includes(lower)) return { "background-origin": { value: lower, important } };
    return null;
  },
  getBackgroundClip(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-clip": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || BACKGROUND_CLIP.includes(lower)) return { "background-clip": { value: lower, important } };
    return null;
  },
  getBackgroundSize(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-size": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower)) return { "background-size": { value: lower, important } };
    const imageParts = lower.split(SPLIT_COMMA);
    const parsed = [];
    for (const imagePart of imageParts) {
      const parts = imagePart.trim().split(" ");
      if (parts.length !== 1 && parts.length !== 2) return null;
      if (parts.length === 1) {
        if (parts[0] !== "cover" && parts[0] !== "contain" && !ValueParser.getAutoMeasurement(parts[0])) return null;
        parsed.push(parts[0]);
      } else {
        if (!ValueParser.getAutoMeasurement(parts[0]) || !ValueParser.getAutoMeasurement(parts[1])) return null;
        parsed.push(`${parts[0]} ${parts[1]}`);
      }
    }
    if (parsed.length === 1) return { "background-size": { value: parsed.join(", "), important } };
    return null;
  },
  getBackgroundPosition(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-position": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) {
      return { ...this.getBackgroundPositionX(globalValue, important), ...this.getBackgroundPositionY(globalValue, important) };
    }
    const imageParts = value.split(SPLIT_COMMA);
    let x = "";
    let y = "";
    for (const imagePart of imageParts) {
      const parts = imagePart.trim().split(SPLIT_SPACE);
      if (x) {
        x += ",";
        y += ",";
      }
      switch (parts.length) {
        case 1:
          if (parts[0] === "top" || parts[0] === "bottom") {
            x += "center";
            y += parts[0];
          } else if (parts[0] === "left" || parts[0] === "right") {
            x += parts[0];
            y += "center";
          } else if (parts[0] === "center") {
            x += "center";
            y += "center";
          }
          break;
        case 2:
          x += parts[0] === "top" || parts[0] === "bottom" ? parts[1] : parts[0];
          y += parts[0] === "top" || parts[0] === "bottom" ? parts[0] : parts[1];
          break;
        case 3:
          if (
            parts[0] === "top" ||
            parts[0] === "bottom" ||
            parts[1] === "left" ||
            parts[1] === "right" ||
            parts[2] === "left" ||
            parts[2] === "right"
          ) {
            if (ValueParser.getMeasurement(parts[1])) {
              x += parts[2];
              y += `${parts[0]} ${parts[1]}`;
            } else {
              x += `${parts[1]} ${parts[2]}`;
              y += parts[0];
            }
          } else {
            if (ValueParser.getMeasurement(parts[1])) {
              x += `${parts[0]} ${parts[1]}`;
              y += parts[2];
            } else {
              x += parts[0];
              y += `${parts[1]} ${parts[2]}`;
            }
          }
          break;
        case 4:
          x +=
            parts[0] === "top" ||
            parts[0] === "bottom" ||
            parts[1] === "top" ||
            parts[1] === "bottom"
              ? `${parts[2]} ${parts[3]}`
              : `${parts[0]} ${parts[1]}`;
          y +=
            parts[0] === "top" ||
            parts[0] === "bottom" ||
            parts[1] === "top" ||
            parts[1] === "bottom"
              ? `${parts[0]} ${parts[1]}`
              : `${parts[2]} ${parts[3]}`;
          break;
        default:
          return null;
      }
    }
    const xValue = this.getBackgroundPositionX(x, important);
    const yValue = this.getBackgroundPositionY(y, important);
    if (xValue && yValue) return { ...xValue, ...yValue };
    return null;
  },
  getBackgroundPositionX(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-position-x": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower)) return { "background-position-x": { value: lower, important } };
    const imageParts = lower.split(SPLIT_COMMA);
    let parsedValue = "";
    for (const imagePart of imageParts) {
      const parts = imagePart.trim().split(SPLIT_SPACE);
      if (parsedValue) parsedValue += ",";
      for (const part of parts) {
        const measurement = ValueParser.getMeasurement(part);
        if (!measurement && part !== "left" && part !== "right" && part !== "center") return null;
        if (parsedValue) parsedValue += " ";
        parsedValue += measurement || part;
      }
    }
    return { "background-position-x": { value: parsedValue, important } };
  },
  getBackgroundPositionY(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "background-position-y": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower)) return { "background-position-y": { value: lower, important } };
    const imageParts = lower.split(SPLIT_COMMA);
    let parsedValue = "";
    for (const imagePart of imageParts) {
      const parts = imagePart.trim().split(SPLIT_SPACE);
      if (parsedValue) parsedValue += ",";
      for (const part of parts) {
        const measurement = ValueParser.getMeasurement(part);
        if (!measurement && part !== "top" && part !== "bottom" && part !== "center") return null;
        if (parsedValue) parsedValue += " ";
        parsedValue += measurement || part;
      }
    }
    return { "background-position-y": { value: parsedValue, important } };
  },
  getColor(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { color: { value: variable, important } };
    const color = ValueParser.getGlobal(value) || ValueParser.getColor(value);
    return color ? { color: { value: color, important } } : null;
  },
  getFloodColor(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "flood-color": { value: variable, important } };
    const color = ValueParser.getGlobal(value) || ValueParser.getColor(value);
    return color ? { "flood-color": { value: color, important } } : null;
  },
  getFont(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { font: { value: variable, important } };
    const lowerValue = value.toLowerCase();
    if (ValueParser.getGlobal(lowerValue)) {
      return {
        ...this.getFontStyle(lowerValue, important),
        ...this.getFontVariant(lowerValue, important),
        ...this.getFontWeight(lowerValue, important),
        ...this.getFontStretch(lowerValue, important),
        ...this.getFontSize(lowerValue, important),
        ...this.getLineHeight(lowerValue, important),
        ...this.getFontFamily(lowerValue, important),
      };
    }
    if (SYSTEM_FONT.includes(lowerValue)) return { font: { value: lowerValue, important } };
    const properties = {
      ...this.getFontStyle("normal", important),
      ...this.getFontVariant("normal", important),
      ...this.getFontWeight("normal", important),
      ...this.getFontStretch("normal", important),
      ...this.getLineHeight("normal", important),
    };
    const parts = value.replace(/\s*\/\s*/g, "/").split(SPLIT_SPACE);
    for (let i = 0, max = parts.length; i < max; i++) {
      const part = parts[i];
      if (part.includes("/")) {
        const [size, height] = part.split("/");
        const fontSize = this.getFontSize(size, important);
        const lineHeight = this.getLineHeight(height, important);
        if (!fontSize || !lineHeight) return null;
        Object.assign(properties, fontSize, lineHeight);
      } else {
        const fontStyle = this.getFontStyle(part, important);
        const fontVariant = this.getFontVariant(part, important);
        const fontWeight = this.getFontWeight(part, important);
        const fontSize = this.getFontSize(part, important);
        const fontStretch = this.getFontStretch(part, important);
        if (fontStyle) Object.assign(properties, fontStyle);
        else if (fontVariant) Object.assign(properties, fontVariant);
        else if (fontWeight) Object.assign(properties, fontWeight);
        else if (fontSize) Object.assign(properties, fontSize);
        else if (fontStretch) Object.assign(properties, fontStretch);
        else {
          const fontFamilyValue = parts.slice(i).join(" ");
          const fontFamily = this.getFontFamily(fontFamilyValue, important);
          if (!fontFamily) return null;
          Object.assign(properties, fontFamily);
          break;
        }
      }
    }
    return properties;
  },
  getFontStyle(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "font-style": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || FONT_STYLE.includes(lower)) return { "font-style": { value: lower, important } };
    const parts = splitValue(value);
    if (parts.length === 2 && parts[0] === "oblique") {
      return ValueParser.getDegree(parts[1]) ? { "font-style": { value: lower, important } } : null;
    }
    return null;
  },
  getFontVariant(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "font-variant": { value: variable, important } };
    const lower = value.toLowerCase();
    return ValueParser.getGlobal(lower) || lower === "normal" || lower === "small-caps"
      ? { "font-variant": { value: lower, important } }
      : null;
  },
  getFontStretch(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "font-stretch": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || FONT_STRETCH.includes(lower)) return { "font-stretch": { value: lower, important } };
    const percentage = ValueParser.getPercentage(value);
    return percentage ? { "font-stretch": { value: percentage, important } } : null;
  },
  getFontWeight(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "font-weight": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || FONT_WEIGHT.includes(lower)) return { "font-weight": { value: lower, important } };
    const integer = ValueParser.getInteger(value);
    return integer ? { "font-weight": { value: integer, important } } : null;
  },
  getFontSize(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "font-size": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || FONT_SIZE.includes(lower)) return { "font-size": { value: lower, important } };
    const measurement = ValueParser.getMeasurement(value);
    return measurement ? { "font-size": { value: measurement, important } } : null;
  },
  getLineHeight(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "line-height": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower) || lower === "normal") return { "line-height": { value: lower, important } };
    const lineHeight = ValueParser.getFloat(value) || ValueParser.getMeasurement(value);
    return lineHeight ? { "line-height": { value: lineHeight, important } } : null;
  },
  getFontFamily(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "font-family": { value: variable, important } };
    const globalValue = ValueParser.getGlobal(value);
    if (globalValue) return { "font-family": { value: globalValue, important } };
    const parts = value.split(",");
    let parsedValue = "";
    let endWithApostroph = false;
    for (let i = 0, max = parts.length; i < max; i++) {
      let trimmedPart = parts[i].trim().replace(/'/g, '"');
      if (!trimmedPart) return null;
      if (trimmedPart.includes(" ")) {
        const apostrophCount = (trimmedPart.match(/"/g) || []).length;
        if ((trimmedPart[0] !== '"' || i !== 0) && apostrophCount !== 2 && apostrophCount !== 0) return null;
        if (trimmedPart[0] === '"' && trimmedPart[trimmedPart.length - 1] !== '"') endWithApostroph = true;
        else if (trimmedPart[0] !== '"' && trimmedPart[trimmedPart.length - 1] !== '"') trimmedPart = `"${trimmedPart}"`;
      } else {
        trimmedPart = trimmedPart.replace(/"/g, "");
      }
      if (i > 0) parsedValue += ", ";
      parsedValue += trimmedPart;
    }
    if (endWithApostroph) parsedValue += '"';
    if (!parsedValue) return null;
    return { "font-family": { value: parsedValue, important } };
  },
  getTextTransform(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "text-transform": { value: variable, important } };
    const lower = value.toLowerCase();
    const parsed = ValueParser.getGlobal(lower) || (TEXT_TRANSFORM.includes(lower) && lower);
    if (parsed) return { "text-transform": { value: parsed, important } };
    return null;
  },
  getVisibility(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { visibility: { value: variable, important } };
    const lower = value.toLowerCase();
    const parsed = ValueParser.getGlobal(lower) || (VISIBILITY.includes(lower) && lower);
    if (parsed) return { visibility: { value: parsed, important } };
    return null;
  },
  getAspectRatio(value, important) {
    const variable = ValueParser.getVariable(value);
    if (variable) return { "aspect-ratio": { value: variable, important } };
    const lower = value.toLowerCase();
    if (ValueParser.getGlobal(lower)) return { "aspect-ratio": { value: lower, important } };
    let parsedValue = value;
    const hasAuto = parsedValue.includes("auto");
    if (hasAuto) parsedValue = parsedValue.replace("auto", "");
    parsedValue = parsedValue.replace(/\s+/gm, "");
    if (!parsedValue) return { "aspect-ratio": { value: "auto", important } };
    const aspectRatio = parsedValue.split("/");
    if (aspectRatio.length > 3) return null;
    const width = Number(aspectRatio[0]);
    const height = aspectRatio[1] ? Number(aspectRatio[1]) : 1;
    if (isNaN(width) || isNaN(height)) return null;
    if (hasAuto) return { "aspect-ratio": { value: `auto ${width} / ${height}`, important } };
    return { "aspect-ratio": { value: `${width} / ${height}`, important } };
  },
};

// ─── property get parsers (shorthand collapse, happy-dom port) ───────────────

const GetParser = {
  getPaddingLikeProperty(propertyNames, properties) {
    if (!properties[propertyNames[0]]?.value || !properties[propertyNames[1]]?.value || !properties[propertyNames[2]]?.value || !properties[propertyNames[3]]?.value) return null;
    const important = properties[propertyNames[0]].important && properties[propertyNames[1]].important && properties[propertyNames[2]].important && properties[propertyNames[3]].important;
    if (ValueParser.getGlobal(properties[propertyNames[0]].value) || ValueParser.getGlobal(properties[propertyNames[1]].value) || ValueParser.getGlobal(properties[propertyNames[2]].value) || ValueParser.getGlobal(properties[propertyNames[3]].value)) {
      if (properties[propertyNames[0]].value !== properties[propertyNames[1]].value || properties[propertyNames[0]].value !== properties[propertyNames[2]].value || properties[propertyNames[0]].value !== properties[propertyNames[3]].value) return null;
      return { important, value: properties[propertyNames[0]].value };
    }
    const values = [properties[propertyNames[0]].value];
    if (properties[propertyNames[1]].value !== properties[propertyNames[0]].value || properties[propertyNames[2]].value !== properties[propertyNames[0]].value || properties[propertyNames[3]].value !== properties[propertyNames[1]].value) values.push(properties[propertyNames[1]].value);
    if (properties[propertyNames[2]].value !== properties[propertyNames[0]].value || properties[propertyNames[3]].value !== properties[propertyNames[1]].value) values.push(properties[propertyNames[2]].value);
    if (properties[propertyNames[3]].value !== properties[propertyNames[1]].value) values.push(properties[propertyNames[3]].value);
    return { important, value: values.join(" ") };
  },
  getMargin(properties) {
    return this.getPaddingLikeProperty(["margin-top", "margin-right", "margin-bottom", "margin-left"], properties);
  },
  getPadding(properties) {
    return this.getPaddingLikeProperty(["padding-top", "padding-right", "padding-bottom", "padding-left"], properties);
  },
  getOutline(properties) {
    if (!properties["outline-color"]?.value || !properties["outline-style"]?.value || !properties["outline-width"]?.value) return null;
    const important = properties["outline-color"].important && properties["outline-style"].important && properties["outline-width"].important;
    if (ValueParser.getGlobalExceptInitial(properties["outline-width"].value) && properties["outline-width"].value === properties["outline-style"].value && properties["outline-width"].value === properties["outline-color"].value) {
      return { important, value: properties["outline-width"].value };
    }
    const values = [];
    if (!ValueParser.getInitial(properties["outline-color"]?.value)) values.push(properties["outline-color"].value);
    if (!ValueParser.getInitial(properties["outline-style"]?.value)) values.push(properties["outline-style"].value);
    if (!ValueParser.getInitial(properties["outline-width"].value)) values.push(properties["outline-width"].value);
    return { important, value: values.join(" ") };
  },
  getBorder(properties) {
    if (!properties["border-top-width"]?.value ||
      properties["border-top-width"]?.value !== properties["border-right-width"]?.value ||
      properties["border-top-width"]?.value !== properties["border-bottom-width"]?.value ||
      properties["border-top-width"]?.value !== properties["border-left-width"]?.value ||
      !properties["border-top-style"]?.value ||
      properties["border-top-style"]?.value !== properties["border-right-style"]?.value ||
      properties["border-top-style"]?.value !== properties["border-bottom-style"]?.value ||
      properties["border-top-style"]?.value !== properties["border-left-style"]?.value ||
      !properties["border-top-color"]?.value ||
      properties["border-top-color"]?.value !== properties["border-right-color"]?.value ||
      properties["border-top-color"]?.value !== properties["border-bottom-color"]?.value ||
      properties["border-top-color"]?.value !== properties["border-left-color"]?.value) {
      return null;
    }
    const important = properties["border-top-width"].important && properties["border-right-width"].important && properties["border-bottom-width"].important && properties["border-left-width"].important && properties["border-top-style"].important && properties["border-right-style"].important && properties["border-bottom-style"].important && properties["border-left-style"].important && properties["border-top-color"].important && properties["border-right-color"].important && properties["border-bottom-color"].important && properties["border-left-color"].important;
    if (ValueParser.getGlobalExceptInitial(properties["border-top-width"].value) || ValueParser.getGlobalExceptInitial(properties["border-top-style"].value) || ValueParser.getGlobalExceptInitial(properties["border-top-color"].value)) {
      if (properties["border-top-width"].value !== properties["border-top-style"].value || properties["border-top-width"].value !== properties["border-top-color"].value) return null;
      return { important, value: properties["border-top-width"].value };
    }
    const values = [];
    if (!ValueParser.getInitial(properties["border-top-width"].value)) values.push(properties["border-top-width"].value);
    if (!ValueParser.getInitial(properties["border-top-style"].value)) values.push(properties["border-top-style"].value);
    if (!ValueParser.getInitial(properties["border-top-color"].value)) values.push(properties["border-top-color"].value);
    return { important, value: values.join(" ") };
  },
  getBorderImage(properties) {
    if (
      !properties["border-image-source"]?.value ||
      !properties["border-image-slice"]?.value ||
      !properties["border-image-width"]?.value ||
      !properties["border-image-outset"]?.value ||
      !properties["border-image-repeat"]?.value
    ) {
      return null;
    }
    const important =
      properties["border-image-source"].important &&
      properties["border-image-slice"].important &&
      properties["border-image-width"].important &&
      properties["border-image-outset"].important &&
      properties["border-image-repeat"].important;
    if (
      ValueParser.getGlobal(properties["border-image-source"].value) ||
      ValueParser.getGlobal(properties["border-image-slice"].value) ||
      ValueParser.getGlobal(properties["border-image-width"].value) ||
      ValueParser.getGlobal(properties["border-image-outset"].value) ||
      ValueParser.getGlobal(properties["border-image-repeat"].value)
    ) {
      if (
        properties["border-image-source"].value !== properties["border-image-slice"].value ||
        properties["border-image-source"].value !== properties["border-image-width"].value ||
        properties["border-image-source"].value !== properties["border-image-outset"].value ||
        properties["border-image-source"].value !== properties["border-image-repeat"].value
      ) {
        return null;
      }
      return { important, value: properties["border-image-source"].value };
    }
    return {
      important,
      value: `${properties["border-image-source"].value} ${properties["border-image-slice"].value} / ${properties["border-image-width"].value} / ${properties["border-image-outset"].value} ${properties["border-image-repeat"].value}`,
    };
  },
  getBorderTop(properties) {
    return this.getBorderTopRightBottomLeft("top", properties);
  },
  getBorderRight(properties) {
    return this.getBorderTopRightBottomLeft("right", properties);
  },
  getBorderBottom(properties) {
    return this.getBorderTopRightBottomLeft("bottom", properties);
  },
  getBorderLeft(properties) {
    return this.getBorderTopRightBottomLeft("left", properties);
  },
  getBorderTopRightBottomLeft(position, properties) {
    if (!properties[`border-${position}-width`]?.value || !properties[`border-${position}-style`]?.value || !properties[`border-${position}-color`]?.value) return null;
    const important = properties[`border-${position}-width`].important && properties[`border-${position}-style`].important && properties[`border-${position}-color`].important;
    if (ValueParser.getGlobalExceptInitial(properties[`border-${position}-width`].value) && properties[`border-${position}-width`].value === properties[`border-${position}-style`].value && properties[`border-${position}-width`].value === properties[`border-${position}-color`].value) {
      return { important, value: properties[`border-${position}-width`].value };
    }
    const values = [];
    if (!ValueParser.getInitial(properties[`border-${position}-width`].value)) values.push(properties[`border-${position}-width`].value);
    if (!ValueParser.getInitial(properties[`border-${position}-style`]?.value)) values.push(properties[`border-${position}-style`].value);
    if (!ValueParser.getInitial(properties[`border-${position}-color`]?.value)) values.push(properties[`border-${position}-color`].value);
    return { important, value: values.join(" ") };
  },
  getBorderColor(properties) {
    return this.getPaddingLikeProperty(["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"], properties);
  },
  getBorderWidth(properties) {
    return this.getPaddingLikeProperty(["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"], properties);
  },
  getBorderStyle(properties) {
    return this.getPaddingLikeProperty(["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"], properties);
  },
  getBorderRadius(properties) {
    return this.getPaddingLikeProperty(["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"], properties);
  },
  getBackground(properties) {
    if (!properties["background-image"]?.value || !properties["background-repeat"]?.value || !properties["background-attachment"]?.value || !properties["background-position-x"]?.value || !properties["background-position-y"]?.value || !properties["background-color"]?.value || !properties["background-size"]?.value || !properties["background-origin"]?.value || !properties["background-clip"]?.value) return null;
    const important = properties["background-image"].important && properties["background-repeat"].important && properties["background-attachment"].important && properties["background-position-x"].important && properties["background-position-y"].important && properties["background-color"].important && properties["background-size"].important && properties["background-origin"].important && properties["background-clip"].important;
    if (ValueParser.getGlobalExceptInitial(properties["background-image"].value) || ValueParser.getGlobalExceptInitial(properties["background-repeat"].value) || ValueParser.getGlobalExceptInitial(properties["background-attachment"].value) || ValueParser.getGlobalExceptInitial(properties["background-position-x"].value) || ValueParser.getGlobalExceptInitial(properties["background-position-y"].value) || ValueParser.getGlobalExceptInitial(properties["background-color"].value) || ValueParser.getGlobalExceptInitial(properties["background-size"].value) || ValueParser.getGlobalExceptInitial(properties["background-origin"].value) || ValueParser.getGlobalExceptInitial(properties["background-clip"].value)) {
      if (properties["background-image"].value !== properties["background-repeat"].value || properties["background-image"].value !== properties["background-attachment"].value || properties["background-image"].value !== properties["background-position-x"].value || properties["background-image"].value !== properties["background-position-y"].value || properties["background-image"].value !== properties["background-color"].value || properties["background-image"].value !== properties["background-size"].value || properties["background-image"].value !== properties["background-origin"].value || properties["background-image"].value !== properties["background-clip"].value) return null;
      return { important, value: properties["background-image"].value };
    }
    const values = [];
    if (!ValueParser.getInitial(properties["background-image"].value)) values.push(properties["background-image"].value);
    if (!ValueParser.getInitial(properties["background-position-x"].value) && !ValueParser.getInitial(properties["background-position-y"].value) && !ValueParser.getInitial(properties["background-size"].value)) {
      values.push(`${properties["background-position-x"].value} ${properties["background-position-y"].value} / ${properties["background-size"].value}`);
    } else if (!ValueParser.getInitial(properties["background-position-x"].value) && !ValueParser.getInitial(properties["background-position-y"].value)) {
      values.push(`${properties["background-position-x"].value} ${properties["background-position-y"].value}`);
    }
    if (!ValueParser.getInitial(properties["background-repeat"].value)) values.push(properties["background-repeat"].value);
    if (!ValueParser.getInitial(properties["background-attachment"].value)) values.push(properties["background-attachment"].value);
    if (!ValueParser.getInitial(properties["background-origin"].value)) values.push(properties["background-origin"].value);
    if (!ValueParser.getInitial(properties["background-clip"].value)) values.push(properties["background-clip"].value);
    if (!ValueParser.getInitial(properties["background-color"].value)) values.push(properties["background-color"].value);
    return { important, value: values.join(" ") };
  },
  getBackgroundPosition(properties) {
    if (!properties["background-position-x"]?.value || !properties["background-position-y"]?.value) return null;
    const important = properties["background-position-x"].important && properties["background-position-y"].important;
    if (ValueParser.getGlobal(properties["background-position-x"].value) || ValueParser.getGlobal(properties["background-position-y"].value)) {
      if (properties["background-position-x"].value !== properties["background-position-y"].value) return null;
      return { important, value: properties["background-position-x"].value };
    }
    const positionX = properties["background-position-x"].value.replace(/ *, */g, ",").split(",");
    const positionY = properties["background-position-y"].value.replace(/ *, */g, ",").split(",");
    const parts = [];
    for (let i = 0; i < positionX.length; i++) parts.push(`${positionX[i]} ${positionY[i]}`);
    return { important, value: parts.join(", ") };
  },
  getFlex(properties) {
    if (!properties["flex-grow"]?.value || !properties["flex-shrink"]?.value || !properties["flex-basis"]?.value) return null;
    const important = properties["flex-grow"].important && properties["flex-shrink"].important && properties["flex-basis"].important;
    if (ValueParser.getGlobal(properties["flex-grow"].value) || ValueParser.getGlobal(properties["flex-shrink"].value) || ValueParser.getGlobal(properties["flex-basis"].value)) {
      if (properties["flex-grow"].value !== properties["flex-shrink"].value || properties["flex-grow"].value !== properties["flex-basis"].value) return null;
      return { important, value: properties["flex-grow"].value };
    }
    return { important, value: `${properties["flex-grow"].value} ${properties["flex-shrink"].value} ${properties["flex-basis"].value}` };
  },
  getFont(properties) {
    if (!properties["font-size"]?.value || !properties["font-family"]?.value || !properties["font-weight"]?.value || !properties["font-style"]?.value || !properties["font-variant"]?.value || !properties["font-stretch"]?.value || !properties["line-height"]?.value) return null;
    const important = properties["font-size"].important && properties["font-family"].important && properties["font-weight"].important && properties["font-style"].important && properties["font-variant"].important && properties["font-stretch"].important && properties["line-height"].important;
    if (ValueParser.getGlobal(properties["font-size"].value) || ValueParser.getGlobal(properties["font-family"].value) || ValueParser.getGlobal(properties["font-weight"].value) || ValueParser.getGlobal(properties["font-style"].value) || ValueParser.getGlobal(properties["font-variant"].value) || ValueParser.getGlobal(properties["font-stretch"].value) || ValueParser.getGlobal(properties["line-height"].value)) {
      if (properties["font-size"].value !== properties["font-family"].value || properties["font-size"].value !== properties["font-weight"].value || properties["font-size"].value !== properties["font-style"].value || properties["font-size"].value !== properties["font-variant"].value || properties["font-size"].value !== properties["font-stretch"].value || properties["font-size"].value !== properties["line-height"].value) return null;
      return { important, value: properties["font-size"].value };
    }
    const values = [];
    if (properties["font-style"].value !== "normal") values.push(properties["font-style"].value);
    if (properties["font-variant"].value !== "normal") values.push(properties["font-variant"].value);
    if (properties["font-weight"].value !== "normal") values.push(properties["font-weight"].value);
    if (properties["font-stretch"].value !== "normal") values.push(properties["font-stretch"].value);
    if (properties["line-height"].value !== "normal") values.push(`${properties["font-size"].value} / ${properties["line-height"].value}`);
    else values.push(properties["font-size"].value);
    values.push(properties["font-family"].value);
    return { important, value: values.join(" ") };
  },
};

// ─── property manager (happy-dom port) ───────────────────────────────────────

const TO_STRING_SHORTHAND_PROPERTIES = [
  ["margin"],
  ["padding"],
  ["border", ["border-width", "border-style", "border-color", "border-image"]],
  ["border-radius"],
  ["background", "background-position"],
  ["font"],
];

const SPLIT_RULES_REGEXP = /\s*([^:;]+?)\s*:\s*((?:[^(;]*?(?:\([^)]*\))?)*?)\s*(!important)?\s*(?:$|;)/g;

function parseCssText(cssText) {
  const properties = {};
  const rules = [];
  const regexp = new RegExp(SPLIT_RULES_REGEXP);
  let match;
  while ((match = regexp.exec(cssText))) {
    const name = (match[1] ?? "").trim();
    const value = (match[2] ?? "").trim();
    const important = match[3] ? true : false;
    if (name && value) {
      if (name.startsWith("--")) properties[name] = value;
      rules.push({ name, value, important });
    }
  }
  return { rules, properties };
}

class PropertyManager {
  constructor(options) {
    this.properties = {};
    this.definedPropertyNames = {};
    if (options?.cssText) {
      const { rules } = parseCssText(options.cssText);
      for (const rule of rules) {
        if (rule.important || !this.get(rule.name)?.important) {
          this.set(rule.name, rule.value, rule.important);
        }
      }
    }
  }

  get(name) {
    if (this.properties[name]) return this.properties[name];
    switch (name) {
      case "margin": return GetParser.getMargin(this.properties);
      case "padding": return GetParser.getPadding(this.properties);
      case "border": return GetParser.getBorder(this.properties);
      case "border-image": return GetParser.getBorderImage(this.properties);
      case "border-top": return GetParser.getBorderTop(this.properties);
      case "border-right": return GetParser.getBorderRight(this.properties);
      case "border-bottom": return GetParser.getBorderBottom(this.properties);
      case "border-left": return GetParser.getBorderLeft(this.properties);
      case "border-color": return GetParser.getBorderColor(this.properties);
      case "border-style": return GetParser.getBorderStyle(this.properties);
      case "border-width": return GetParser.getBorderWidth(this.properties);
      case "border-radius": return GetParser.getBorderRadius(this.properties);
      case "outline": return GetParser.getOutline(this.properties);
      case "background": return GetParser.getBackground(this.properties);
      case "background-position": return GetParser.getBackgroundPosition(this.properties);
      case "flex": return GetParser.getFlex(this.properties);
      case "font": return GetParser.getFont(this.properties);
    }
    return this.properties[name] || null;
  }

  set(name, value, important) {
    if (value === null) {
      this.remove(name);
      return;
    }
    let properties = null;
    switch (name) {
      case "border": properties = SetParser.getBorder(value, important); break;
      case "border-top": properties = SetParser.getBorderTop(value, important); break;
      case "border-right": properties = SetParser.getBorderRight(value, important); break;
      case "border-bottom": properties = SetParser.getBorderBottom(value, important); break;
      case "border-left": properties = SetParser.getBorderLeft(value, important); break;
      case "border-width": properties = SetParser.getBorderWidth(value, important); break;
      case "border-style": properties = SetParser.getBorderStyle(value, important); break;
      case "border-color": properties = SetParser.getBorderColor(value, important); break;
      case "border-top-width": properties = SetParser.getBorderTopWidth(value, important); break;
      case "border-right-width": properties = SetParser.getBorderRightWidth(value, important); break;
      case "border-bottom-width": properties = SetParser.getBorderBottomWidth(value, important); break;
      case "border-left-width": properties = SetParser.getBorderLeftWidth(value, important); break;
      case "border-top-color": properties = SetParser.getBorderTopColor(value, important); break;
      case "border-right-color": properties = SetParser.getBorderRightColor(value, important); break;
      case "border-bottom-color": properties = SetParser.getBorderBottomColor(value, important); break;
      case "border-left-color": properties = SetParser.getBorderLeftColor(value, important); break;
      case "border-top-style": properties = SetParser.getBorderTopStyle(value, important); break;
      case "border-right-style": properties = SetParser.getBorderRightStyle(value, important); break;
      case "border-bottom-style": properties = SetParser.getBorderBottomStyle(value, important); break;
      case "border-left-style": properties = SetParser.getBorderLeftStyle(value, important); break;
      case "border-image": properties = SetParser.getBorderImage(value, important); break;
      case "border-image-source": properties = SetParser.getBorderImageSource(value, important); break;
      case "border-image-slice": properties = SetParser.getBorderImageSlice(value, important); break;
      case "border-image-width": properties = SetParser.getBorderImageWidth(value, important); break;
      case "border-image-outset": properties = SetParser.getBorderImageOutset(value, important); break;
      case "border-image-repeat": properties = SetParser.getBorderImageRepeat(value, important); break;
      case "border-radius": properties = SetParser.getBorderRadius(value, important); break;
      case "border-top-left-radius": properties = SetParser.getBorderTopLeftRadius(value, important); break;
      case "border-top-right-radius": properties = SetParser.getBorderTopRightRadius(value, important); break;
      case "border-bottom-right-radius": properties = SetParser.getBorderBottomRightRadius(value, important); break;
      case "border-bottom-left-radius": properties = SetParser.getBorderBottomLeftRadius(value, important); break;
      case "border-collapse": properties = SetParser.getBorderCollapse(value, important); break;
      case "outline": properties = SetParser.getOutline(value, important); break;
      case "outline-width": properties = SetParser.getOutlineWidth(value, important); break;
      case "outline-style": properties = SetParser.getOutlineStyle(value, important); break;
      case "outline-color": properties = SetParser.getOutlineColor(value, important); break;
      case "letter-spacing": properties = SetParser.getLetterSpacing(value, important); break;
      case "word-spacing": properties = SetParser.getWordSpacing(value, important); break;
      case "clear": properties = SetParser.getClear(value, important); break;
      case "clip": properties = SetParser.getClip(value, important); break;
      case "css-float": properties = SetParser.getCSSFloat(value, important); break;
      case "float": properties = SetParser.getFloat(value, important); break;
      case "display": properties = SetParser.getDisplay(value, important); break;
      case "direction": properties = SetParser.getDirection(value, important); break;
      case "flex": properties = SetParser.getFlex(value, important); break;
      case "flex-shrink": properties = SetParser.getFlexShrink(value, important); break;
      case "flex-grow": properties = SetParser.getFlexGrow(value, important); break;
      case "flex-basis": properties = SetParser.getFlexBasis(value, important); break;
      case "padding": properties = SetParser.getPadding(value, important); break;
      case "padding-top": properties = SetParser.getPaddingTop(value, important); break;
      case "padding-right": properties = SetParser.getPaddingRight(value, important); break;
      case "padding-bottom": properties = SetParser.getPaddingBottom(value, important); break;
      case "padding-left": properties = SetParser.getPaddingLeft(value, important); break;
      case "margin": properties = SetParser.getMargin(value, important); break;
      case "margin-top": properties = SetParser.getMarginTop(value, important); break;
      case "margin-right": properties = SetParser.getMarginRight(value, important); break;
      case "margin-bottom": properties = SetParser.getMarginBottom(value, important); break;
      case "margin-left": properties = SetParser.getMarginLeft(value, important); break;
      case "background": properties = SetParser.getBackground(value, important); break;
      case "background-image": properties = SetParser.getBackgroundImage(value, important); break;
      case "background-color": properties = SetParser.getBackgroundColor(value, important); break;
      case "background-repeat": properties = SetParser.getBackgroundRepeat(value, important); break;
      case "background-attachment": properties = SetParser.getBackgroundAttachment(value, important); break;
      case "background-position": properties = SetParser.getBackgroundPosition(value, important); break;
      case "width": properties = SetParser.getWidth(value, important); break;
      case "height": properties = SetParser.getHeight(value, important); break;
      case "top": properties = SetParser.getTop(value, important); break;
      case "right": properties = SetParser.getRight(value, important); break;
      case "bottom": properties = SetParser.getBottom(value, important); break;
      case "left": properties = SetParser.getLeft(value, important); break;
      case "font": properties = SetParser.getFont(value, important); break;
      case "font-style": properties = SetParser.getFontStyle(value, important); break;
      case "font-variant": properties = SetParser.getFontVariant(value, important); break;
      case "font-weight": properties = SetParser.getFontWeight(value, important); break;
      case "font-stretch": properties = SetParser.getFontStretch(value, important); break;
      case "font-size": properties = SetParser.getFontSize(value, important); break;
      case "line-height": properties = SetParser.getLineHeight(value, important); break;
      case "text-indent": properties = SetParser.getTextIndent(value, important); break;
      case "font-family": properties = SetParser.getFontFamily(value, important); break;
      case "color": properties = SetParser.getColor(value, important); break;
      case "flood-color": properties = SetParser.getFloodColor(value, important); break;
      case "text-transform": properties = SetParser.getTextTransform(value, important); break;
      case "visibility": properties = SetParser.getVisibility(value, important); break;
      case "aspect-ratio": properties = SetParser.getAspectRatio(value, important); break;
      default:
        const trimmedValue = value.trim();
        if (trimmedValue) {
          const globalValue = ValueParser.getGlobal(trimmedValue);
          properties = { [name]: { value: globalValue || trimmedValue, important } };
        }
        break;
    }
    if (properties !== null && Object.keys(properties).length > 0) {
      this.definedPropertyNames[name] = true;
      Object.assign(this.properties, properties);
    }
  }

  remove(name) {
    delete this.properties[name];
    delete this.definedPropertyNames[name];
    switch (name) {
      case "border":
        for (const prop of ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-image-source", "border-image-slice", "border-image-width", "border-image-outset", "border-image-repeat"]) delete this.properties[prop];
        break;
      case "border-top":
        for (const prop of ["border-top-width", "border-top-style", "border-top-color"]) delete this.properties[prop];
        break;
      case "border-right":
        for (const prop of ["border-right-width", "border-right-style", "border-right-color"]) delete this.properties[prop];
        break;
      case "border-bottom":
        for (const prop of ["border-bottom-width", "border-bottom-style", "border-bottom-color"]) delete this.properties[prop];
        break;
      case "border-left":
        for (const prop of ["border-left-width", "border-left-style", "border-left-color"]) delete this.properties[prop];
        break;
      case "border-width":
        for (const prop of ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]) delete this.properties[prop];
        break;
      case "border-style":
        for (const prop of ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"]) delete this.properties[prop];
        break;
      case "border-color":
        for (const prop of ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"]) delete this.properties[prop];
        break;
      case "border-image":
        for (const prop of ["border-image-source", "border-image-slice", "border-image-width", "border-image-outset", "border-image-repeat"]) delete this.properties[prop];
        break;
      case "border-radius":
        for (const prop of ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"]) delete this.properties[prop];
        break;
      case "outline":
        for (const prop of ["outline-color", "outline-style", "outline-width"]) delete this.properties[prop];
        break;
      case "background":
        for (const prop of ["background-color", "background-image", "background-repeat", "background-attachment", "background-position-x", "background-position-y", "background-size", "background-origin", "background-clip"]) delete this.properties[prop];
        break;
      case "background-position":
        delete this.properties["background-position-x"];
        delete this.properties["background-position-y"];
        break;
      case "flex":
        for (const prop of ["flex-grow", "flex-shrink", "flex-basis"]) delete this.properties[prop];
        break;
      case "font":
        for (const prop of ["font-style", "font-variant", "font-weight", "font-stretch", "font-size", "line-height", "font-family"]) delete this.properties[prop];
        break;
      case "padding":
        for (const prop of ["padding-top", "padding-right", "padding-bottom", "padding-left"]) delete this.properties[prop];
        break;
      case "margin":
        for (const prop of ["margin-top", "margin-right", "margin-bottom", "margin-left"]) delete this.properties[prop];
        break;
    }
  }

  clone() {
    const clone = new PropertyManager();
    clone.properties = JSON.parse(JSON.stringify(this.properties));
    clone.definedPropertyNames = Object.assign({}, this.definedPropertyNames);
    return clone;
  }

  size() {
    return Object.keys(this.properties).length;
  }

  item(index) {
    return Object.keys(this.properties)[index] || "";
  }

  toString() {
    const result = [];
    const clone = this.clone();
    const properties = {};
    for (const shorthandPropertyGroup of TO_STRING_SHORTHAND_PROPERTIES) {
      for (const shorthandProperty of shorthandPropertyGroup) {
        if (Array.isArray(shorthandProperty)) {
          let isMatch = false;
          for (const childShorthandProperty of shorthandProperty) {
            const property = clone.get(childShorthandProperty);
            if (property) {
              properties[childShorthandProperty] = property;
              clone.remove(childShorthandProperty);
              isMatch = true;
            }
          }
          if (isMatch) break;
        } else {
          const property = clone.get(shorthandProperty);
          if (property) {
            properties[shorthandProperty] = property;
            clone.remove(shorthandProperty);
            break;
          }
        }
      }
    }
    for (const name of Object.keys(clone.properties)) {
      properties[name] = clone.get(name);
    }
    for (const definedPropertyName of Object.keys(this.definedPropertyNames)) {
      const property = properties[definedPropertyName];
      if (property) {
        result.push(`${definedPropertyName}: ${property.value}${property.important ? " !important" : ""};`);
        delete properties[definedPropertyName];
      }
    }
    for (const propertyName of Object.keys(properties)) {
      const property = properties[propertyName];
      if (property) {
        result.push(`${propertyName}: ${property.value}${property.important ? " !important" : ""};`);
      }
    }
    return result.join(" ");
  }
}

// ─── CSSStyleDeclaration ─────────────────────────────────────────────────────

const DECL_STATE = new WeakMap();

/**
 * `CSSStyleDeclaration` facade (T44).
 *
 * Element-backed (`el.style`) or standalone (rule.style / getComputedStyle
 * result). The element-backed form is a live view over the element's `style`
 * attribute: `#getPropertyManager` re-parses whenever the attribute string
 * changes, and every mutation writes the serialized manager back through
 * `setAttribute` / `removeAttribute`, so the Core attribute stays the single
 * authoritative state.
 */
export class CSSStyleDeclaration {
  constructor(elementHandle, { computed = false, cssText = null } = {}) {
    if (elementHandle !== null && !isNodeHandle(elementHandle)) {
      throw new TypeError("CSSStyleDeclaration can only be constructed from a genuine native node handle or null");
    }
    DECL_STATE.set(this, {
      elementHandle,
      computed,
      cache: { attributeValue: null, propertyManager: null },
    });
    this.parentRule = null;
    if (!computed && cssText !== null) {
      this.cssText = cssText;
    }
  }
}

function declarationState(declaration) {
  return DECL_STATE.get(declaration);
}

function getPropertyManager(declaration) {
  const state = declarationState(declaration);
  const { elementHandle, computed, cache } = state;
  if (computed && elementHandle) {
    return getComputedPropertyManager(declaration, elementHandle);
  }
  if (!elementHandle) {
    if (!cache.propertyManager) cache.propertyManager = new PropertyManager();
    return cache.propertyManager;
  }
  const attributeValue = elementHandle.getAttribute("style") || "";
  if (cache.attributeValue !== attributeValue) {
    cache.propertyManager = new PropertyManager({ cssText: attributeValue });
    cache.attributeValue = attributeValue;
  }
  return cache.propertyManager;
}

function writeBack(declaration) {
  const state = declarationState(declaration);
  const { elementHandle, cache } = state;
  if (!elementHandle) return;
  const manager = cache.propertyManager;
  const serialized = manager.toString();
  cache.attributeValue = serialized;
  if (serialized) elementHandle.setAttribute("style", serialized);
  else elementHandle.removeAttribute("style");
}

// ─── Window constructor / CSS surface ────────────────────────────────────────

class CSSUnitValue {
  constructor(value, unit) {
    this.value = value;
    this.unit = unit;
  }

  toString() {
    return `${this.value}${this.unit === "number" ? "" : this.unit}`;
  }
}

const CSS_NAMESPACE = {
  supports() {
    return true;
  },
  // CSSOM §2.4 "Escaping" (the CSSOM `CSS.escape` algorithm). Ported from the
  // happy-dom oracle so the differential surface matches byte-for-byte.
  escape(value) {
    if (arguments.length === 0) {
      throw new TypeError("`CSS.escape` requires an argument.");
    }
    const returnValue = String(value);
    const length = returnValue.length;
    let result = "";
    const firstCodeUnit = returnValue.charCodeAt(0);
    if (length === 1 && firstCodeUnit === 0x002d) {
      return "\\" + returnValue;
    }
    for (let index = 0; index < length; index++) {
      const codeUnit = returnValue.charCodeAt(index);
      if (codeUnit === 0x0000) {
        result += "\ufffd";
        continue;
      }
      if (
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
      ) {
        result += "\\" + codeUnit.toString(16) + " ";
        continue;
      }
      if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        result += returnValue.charAt(index);
        continue;
      }
      result += "\\" + returnValue.charAt(index);
    }
    return result;
  },
};

for (const unit of ["Hz", "Q", "ch", "cm", "deg", "dpcm", "dpi", "dppx", "em", "ex", "fr", "grad", "in", "kHz", "mm", "ms", "number", "pc", "percent", "pt", "px", "rad", "rem", "s", "turn", "vh", "vmax", "vmin", "vw"]) {
  CSS_NAMESPACE[unit] = (value) => new CSSUnitValue(value, unit);
}

export class CSSStyleValue {
  constructor(style = null, property = "") {
    this._style = style;
    this._property = property;
  }

  toString() {
    if (this._style) return this._style.getPropertyValue(this._property);
    return this.value?.toString() ?? "";
  }
}

// ─── StylePropertyMap family (T12) ──────────────────────────────────────────
//
// happy-dom's `StylePropertyMapReadOnly` / `StylePropertyMap` (CSS typed-OM
// map view over a CSSStyleDeclaration). The facade classes take the internal
// constructor shape `(style)`; the upstream "Illegal constructor" marker check
// lives in the shim wrapper (tests/happy-dom/shim/adapters/property-symbol-classes.ts),
// which is where the `PropertySymbol.illegalConstructor` marker is interpreted.

export class StylePropertyMapReadOnly {
  constructor(style = null) {
    this._style = style;
  }

  get size() {
    return this._style ? this._style.length : 0;
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  entries() {
    const style = this._style;
    const length = style ? style.length : 0;
    const array = new Array(length);
    for (let i = 0; i < length; i++) {
      const property = style.item(i);
      array[i] = [property, [new CSSKeywordValue(style.getPropertyValue(property))]];
    }
    return array.values();
  }

  values() {
    const style = this._style;
    const length = style ? style.length : 0;
    const array = new Array(length);
    for (let i = 0; i < length; i++) {
      const property = style.item(i);
      array[i] = [new CSSKeywordValue(style.getPropertyValue(property))];
    }
    return array.values();
  }

  keys() {
    const style = this._style;
    const length = style ? style.length : 0;
    const array = new Array(length);
    for (let i = 0; i < length; i++) {
      array[i] = style.item(i);
    }
    return array.values();
  }

  get(property) {
    return new CSSStyleValue(this._style, property);
  }

  getAll(property) {
    return [new CSSStyleValue(this._style, property)];
  }

  has(property) {
    return !!(this._style && this._style.getPropertyValue(property));
  }
}

export class StylePropertyMap extends StylePropertyMapReadOnly {
  append(property, value) {
    this._style.setProperty(property, value);
  }

  clear() {
    this._style.cssText = "";
  }

  delete(property) {
    this._style.removeProperty(property);
  }

  set(property, value) {
    this._style.setProperty(property, value);
  }
}

export class CSSKeywordValue {
  constructor(value) {
    this._value = value;
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
  }
}

// ─── install(ctx) ────────────────────────────────────────────────────────────

function installCssStyleDeclarationSurface(ctx) {
  ctx.defineAccessor(CSSStyleDeclaration.prototype, "cssText", function cssText() {
    const state = declarationState(this);
    if (state.elementHandle && state.computed) return "";
    return getPropertyManager(this).toString();
  }, function cssText(cssText) {
    const state = declarationState(this);
    if (state.computed) {
      throw new DOMException(
        "Failed to execute 'cssText' on 'CSSStyleDeclaration': These styles are computed, and the properties are therefore read-only.",
        "DOMException",
      );
    }
    const manager = new PropertyManager({ cssText });
    state.cache.propertyManager = manager;
    if (state.elementHandle) {
      // happy-dom's cssText setter always writes the serialized text back to
      // the style attribute, even when it is empty (a `setAttribute("style",
      // "")` is stored, not removed).
      state.cache.attributeValue = manager.toString();
      state.elementHandle.setAttribute("style", state.cache.attributeValue);
    }
  });

  ctx.defineAccessor(CSSStyleDeclaration.prototype, "length", function length() {
    return getPropertyManager(this).size();
  }, undefined);

  ctx.defineMethod(CSSStyleDeclaration.prototype, "item", function item(index) {
    return getPropertyManager(this).item(index);
  });

  ctx.defineMethod(CSSStyleDeclaration.prototype, "setProperty", function setProperty(name, value, priority) {
    const state = declarationState(this);
    if (state.computed) {
      throw new DOMException(
        `Failed to execute 'setProperty' on 'CSSStyleDeclaration': These styles are computed, and therefore the '${name}' property is read-only.`,
        "DOMException",
      );
    }
    if (priority !== "" && priority !== undefined && priority !== "important") return;
    const stringValue = String(value).trim();
    const propertyManager = getPropertyManager(this);
    if (stringValue) propertyManager.set(name, stringValue, !!priority);
    else propertyManager.remove(name);
    writeBack(this);
  });

  ctx.defineMethod(CSSStyleDeclaration.prototype, "removeProperty", function removeProperty(name) {
    const state = declarationState(this);
    if (state.computed) {
      throw new DOMException(
        `Failed to execute 'removeProperty' on 'CSSStyleDeclaration': These styles are computed, and therefore the '${name}' property is read-only.`,
        "DOMException",
      );
    }
    const propertyManager = getPropertyManager(this);
    propertyManager.remove(name);
    writeBack(this);
  });

  ctx.defineMethod(CSSStyleDeclaration.prototype, "getPropertyValue", function getPropertyValue(name) {
    return getPropertyManager(this).get(name)?.value || "";
  });

  ctx.defineMethod(CSSStyleDeclaration.prototype, "getPropertyPriority", function getPropertyPriority(name) {
    return getPropertyManager(this).get(name)?.important ? "important" : "";
  });

  // camelCase accessors for every property in the happy-dom list. Each closes
  // over its kebab name, so `el.style.color` maps to getPropertyValue("color").
  for (const [camel, kebab] of Object.entries(CSS_PROPERTY_ACCESSORS)) {
    const kebabName = kebab;
    ctx.defineAccessor(CSSStyleDeclaration.prototype, camel, function getCamelCase() {
      return getPropertyManager(this).get(kebabName)?.value || "";
    }, function setCamelCase(value) {
      setPropertyOn(this, kebabName, String(value));
    });
  }

  // Numeric index accessors (0..393), matching the happy-dom prototype surface
  // (`el.style[0]` → `item(0) || undefined`).
  for (let i = 0; i <= 393; i++) {
    const indexFor = i;
    ctx.defineAccessor(CSSStyleDeclaration.prototype, String(i), function indexedAccessor() {
      return getPropertyManager(this).item(indexFor) || undefined;
    }, undefined);
  }
}

function setPropertyOn(declaration, name, value) {
  const state = declarationState(declaration);
  if (state.computed) {
    throw new DOMException(
      `Failed to execute 'setProperty' on 'CSSStyleDeclaration': These styles are computed, and therefore the '${name}' property is read-only.`,
      "DOMException",
    );
  }
  const stringValue = String(value).trim();
  const propertyManager = getPropertyManager(declaration);
  if (stringValue) propertyManager.set(name, stringValue, false);
  else propertyManager.remove(name);
  writeBack(declaration);
}

// Per-element style declarations (stable identity, live reads).
const ELEMENT_STYLE = new WeakMap();

function styleOf(ctx, handle) {
  let declaration = ELEMENT_STYLE.get(handle);
  if (!declaration) {
    declaration = new CSSStyleDeclaration(handle);
    ELEMENT_STYLE.set(handle, declaration);
  }
  return declaration;
}

// Per-style-element CSSStyleSheet (stable identity, re-parse on text change).
const ELEMENT_SHEETS = new WeakMap();

function sheetOf(ctx, handle) {
  let sheet = ELEMENT_SHEETS.get(handle);
  if (!sheet) {
    sheet = new CSSStyleSheet(handle);
    ELEMENT_SHEETS.set(handle, sheet);
  }
  return sheet;
}

// ─── CSSStyleSheet + rules ───────────────────────────────────────────────────

const SHEET_STATE = new WeakMap();

export class CSSStyleSheet {
  constructor(elementHandle = null) {
    SHEET_STATE.set(this, { elementHandle, cssRules: [], lastText: null });
    this.media = "";
    this.title = "";
    this.alternate = false;
    this.disabled = false;
  }

  _ensureParsed() {
    const state = SHEET_STATE.get(this);
    if (state.elementHandle === null) return;
    const text = state.elementHandle.textContent() ?? "";
    if (state.lastText !== text) {
      state.lastText = text;
      state.cssRules = parseCssRules(text, this);
    }
  }

  get cssRules() {
    this._ensureParsed();
    return SHEET_STATE.get(this).cssRules;
  }

  insertRule(rule, index) {
    this._ensureParsed();
    const state = SHEET_STATE.get(this);
    const rules = parseCssRules(rule, this);
    if (rules.length === 0 || rules.length > 1) {
      throw new DOMException(
        `Failed to execute 'insertRule' on 'CSSStyleSheet': Failed to parse the rule '${rule}'.`,
        "SyntaxError",
      );
    }
    if (index !== undefined) {
      index = Number(index);
      if (index > state.cssRules.length) {
        throw new DOMException(
          `Failed to execute 'insertRule' on 'CSSStyleSheet': The index provided (${index}) is larger than the maximum index (${state.cssRules.length - 1}).`,
          "IndexSizeError",
        );
      }
      state.cssRules.splice(index, 0, rules[0]);
      return index;
    }
    const newIndex = state.cssRules.length;
    state.cssRules.push(rules[0]);
    return newIndex;
  }

  deleteRule(index) {
    this._ensureParsed();
    const state = SHEET_STATE.get(this);
    state.cssRules.splice(Number(index), 1);
  }

  replaceSync(text) {
    const state = SHEET_STATE.get(this);
    state.lastText = String(text);
    state.cssRules = parseCssRules(state.lastText, this);
  }

  async replace(text) {
    this.replaceSync(text);
  }
}

// ─── CSSRule family ──────────────────────────────────────────────────────────

export class CSSRule {
  constructor() {
    if (new.target === CSSRule) {
      throw new TypeError("Illegal constructor");
    }
  }

  get parentRule() {
    return RULE_STATE.get(this)?.parentRule ?? null;
  }

  get parentStyleSheet() {
    return RULE_STATE.get(this)?.parentStyleSheet ?? null;
  }
}

CSSRule.CONTAINER_RULE = 0;
CSSRule.STYLE_RULE = 1;
CSSRule.IMPORT_RULE = 3;
CSSRule.MEDIA_RULE = 4;
CSSRule.FONT_FACE_RULE = 5;
CSSRule.PAGE_RULE = 6;
CSSRule.KEYFRAMES_RULE = 7;
CSSRule.KEYFRAME_RULE = 8;
CSSRule.NAMESPACE_RULE = 10;
CSSRule.COUNTER_STYLE_RULE = 11;
CSSRule.SUPPORTS_RULE = 12;
CSSRule.DOCUMENT_RULE = 13;
CSSRule.FONT_FEATURE_VALUES_RULE = 14;
CSSRule.REGION_STYLE_RULE = 16;

const RULE_STATE = new WeakMap();

function createRuleState(rule, { parentRule = null, parentStyleSheet = null } = {}) {
  RULE_STATE.set(rule, { parentRule, parentStyleSheet });
}

export class CSSStyleRule extends CSSRule {
  constructor(selectorText = "", cssText = "", parentStyleSheet = null, parentRule = null) {
    super();
    createRuleState(this, { parentRule, parentStyleSheet });
    this._selectorText = selectorText;
    this._cssText = cssText;
  }

  get type() { return 1; }

  get cssText() {
    return `${this._selectorText} { ${this.style.cssText} }`;
  }

  get selectorText() {
    return this._selectorText;
  }

  get style() {
    if (!this._style) {
      this._style = new CSSStyleDeclaration(null, { cssText: this._cssText });
      this._style.parentRule = this;
    }
    return this._style;
  }

  get styleMap() {
    if (!this._styleMap) {
      this._styleMap = new StylePropertyMap(this.style);
    }
    return this._styleMap;
  }
}

export class CSSGroupingRule extends CSSRule {
  constructor(parentStyleSheet = null, parentRule = null) {
    super();
    createRuleState(this, { parentRule, parentStyleSheet });
    this._cssRules = [];
  }

  get cssRules() {
    return this._cssRules;
  }

  insertRule(rule, index) {
    if (arguments.length === 0) {
      throw new TypeError(
        `Failed to execute 'insertRule' on '${this.constructor.name}': 1 argument required, but only 0 present.`,
      );
    }
    const rules = parseCssRules(rule, this);
    if (rules.length === 0 || rules.length > 1) {
      throw new DOMException(
        `Failed to execute 'insertRule' on '${this.constructor.name}': Failed to parse the rule '${rule}'.`,
        "SyntaxError",
      );
    }
    if (index !== undefined) {
      index = Number(index);
      if (isNaN(index) || index > this._cssRules.length) {
        throw new DOMException(
          `Failed to execute 'insertRule' on '${this.constructor.name}': The index provided (${index}) is larger than the maximum index (${this._cssRules.length}).`,
          "IndexSizeError",
        );
      }
      this._cssRules.splice(index, 0, rules[0]);
      return index;
    }
    this._cssRules.unshift(rules[0]);
    return 0;
  }

  deleteRule(index) {
    if (arguments.length === 0) {
      throw new TypeError(
        `Failed to execute 'deleteRule' on '${this.constructor.name}': 1 argument required, but only 0 present.`,
      );
    }
    index = Number(index);
    if (isNaN(index) || index < 0 || index >= this._cssRules.length) {
      throw new DOMException(
        `Failed to execute 'deleteRule' on '${this.constructor.name}': the index (${index}) is greater than the length of the rule list.`,
        "IndexSizeError",
      );
    }
    this._cssRules.splice(index, 1);
  }
}

export class CSSConditionRule extends CSSGroupingRule {
  constructor(conditionText = "", parentStyleSheet = null, parentRule = null) {
    super(parentStyleSheet, parentRule);
    this._conditionText = conditionText;
  }

  get conditionText() {
    return this._conditionText;
  }
}

export class CSSMediaRule extends CSSConditionRule {
  constructor(conditionText = "", parentStyleSheet = null, parentRule = null) {
    super(conditionText, parentStyleSheet, parentRule);
    this._media = new MediaList(this);
  }

  get type() { return 4; }

  get cssText() {
    let cssText = "";
    for (const cssRule of this._cssRules) cssText += "\n  " + cssRule.cssText;
    cssText += cssText ? "\n" : "  ";
    return `@media ${this.conditionText} {${cssText}}`;
  }

  get media() {
    return this._media;
  }
}

export class CSSSupportsRule extends CSSConditionRule {
  constructor(conditionText = "", parentStyleSheet = null, parentRule = null) {
    super(conditionText, parentStyleSheet, parentRule);
  }

  get type() { return 12; }

  get cssText() {
    let cssText = "";
    for (const cssRule of this._cssRules) cssText += "\n  " + cssRule.cssText;
    cssText += "\n";
    return `@supports ${this.conditionText} {${cssText}}`;
  }
}

export class CSSContainerRule extends CSSConditionRule {
  constructor(conditionText = "", parentStyleSheet = null, parentRule = null) {
    super(conditionText, parentStyleSheet, parentRule);
  }

  get type() { return 0; }

  get cssText() {
    let cssText = "";
    for (const cssRule of this._cssRules) cssText += "\n  " + cssRule.cssText;
    cssText += "\n";
    return `@container ${this.conditionText} {${cssText}}`;
  }
}

export class CSSScopeRule extends CSSGroupingRule {
  constructor(start = "", end = "", parentStyleSheet = null, parentRule = null) {
    super(parentStyleSheet, parentRule);
    this._start = start;
    this._end = end;
  }

  get type() { return 0; }

  get cssText() {
    let cssText = "";
    for (const cssRule of this._cssRules) cssText += "\n  " + cssRule.cssText;
    cssText += "\n";
    return `@scope${this._start ? ` (${this._start})` : ""}${this._end ? ` to (${this._end})` : ""} {${cssText}}`;
  }

  get start() { return this._start; }

  get end() { return this._end; }
}

export class CSSKeyframesRule extends CSSRule {
  constructor(name = "", parentStyleSheet = null, parentRule = null) {
    super();
    createRuleState(this, { parentRule, parentStyleSheet });
    this._name = name;
    this._rulePrefix = "";
    this._cssRules = [];
  }

  get type() { return 7; }

  get cssText() {
    let cssText = "";
    for (const cssRule of this._cssRules) cssText += "\n  " + cssRule.cssText;
    cssText += "\n";
    return `@${this._rulePrefix}keyframes ${this._name} { ${cssText}}`;
  }

  get cssRules() { return this._cssRules; }

  get name() { return this._name; }

  get length() { return this._cssRules.length; }

  appendRule(rule) {
    if (arguments.length === 0) {
      throw new TypeError(
        `Failed to execute 'appendRule' on 'CSSKeyframesRule': 1 argument required, but only 0 present.`,
      );
    }
    const match = String(rule).trim().match(/^(from|to|[0-9]{1,3}%)\s*{([^}]*)}$/);
    if (!match) {
      throw new DOMException(`Invalid or unexpected token`, "SyntaxError");
    }
    const cssRule = new CSSKeyframeRule(null, this);
    let keyText = match[1].trim();
    if (keyText === "from") keyText = "0%";
    else if (keyText === "to") keyText = "100%";
    cssRule._keyText = keyText;
    cssRule._cssText = match[2].trim();
    this._cssRules.push(cssRule);
  }

  deleteRule(rule) {
    if (arguments.length === 0) {
      throw new TypeError(
        `Failed to execute 'deleteRule' on 'CSSKeyframesRule': 1 argument required, but only 0 present.`,
      );
    }
    for (let i = 0, max = this._cssRules.length; i < max; i++) {
      if (this._cssRules[i].keyText === rule) {
        this._cssRules.splice(i, 1);
        return;
      }
    }
  }

  findRule(rule) {
    if (arguments.length === 0) {
      throw new TypeError(
        `Failed to execute 'findRule' on 'CSSKeyframesRule': 1 argument required, but only 0 present.`,
      );
    }
    for (let i = 0, max = this._cssRules.length; i < max; i++) {
      if (this._cssRules[i].keyText === rule) return this._cssRules[i];
    }
    return null;
  }
}

export class CSSKeyframeRule extends CSSRule {
  constructor(parentKeyframesRule = null, parentRule = null) {
    super();
    createRuleState(this, { parentRule, parentStyleSheet: null });
    this._keyText = "";
    this._cssText = "";
  }

  get type() { return 8; }

  get cssText() {
    return `${this._keyText} { ${this.style.cssText} }`;
  }

  get style() {
    if (!this._style) {
      this._style = new CSSStyleDeclaration(null, { cssText: this._cssText });
      this._style.parentRule = this;
    }
    return this._style;
  }

  get keyText() {
    return this._keyText;
  }
}

export class CSSFontFaceRule extends CSSRule {
  constructor(cssText = "", parentStyleSheet = null, parentRule = null) {
    super();
    createRuleState(this, { parentRule, parentStyleSheet });
    this._cssText = cssText;
  }

  get type() { return 5; }

  get cssText() {
    return `@font-face { ${this.style.cssText} }`;
  }

  get style() {
    if (!this._style) {
      this._style = new CSSStyleDeclaration(null, { cssText: this._cssText });
      this._style.parentRule = this;
    }
    return this._style;
  }
}

// ─── MediaList ───────────────────────────────────────────────────────────────

const MEDIA_LIST_STATE = new WeakMap();

export class MediaList {
  constructor(cssRule) {
    MEDIA_LIST_STATE.set(this, { cssRule });
  }

  get length() {
    return this._items().length;
  }

  get mediaText() {
    return MEDIA_LIST_STATE.get(this).cssRule._conditionText;
  }

  set mediaText(mediaText) {
    MEDIA_LIST_STATE.get(this).cssRule._conditionText = mediaText === null ? "" : String(mediaText).split(/\s*,\s*/).join(", ");
  }

  item(index) {
    return this._items()[Number(index)] || null;
  }

  appendMedium(medium) {
    const items = this._items();
    if (items.indexOf(medium) === -1) {
      items.push(medium);
      MEDIA_LIST_STATE.get(this).cssRule._conditionText = items.join(", ");
    }
  }

  deleteMedium(medium) {
    const items = this._items();
    const index = items.indexOf(medium);
    if (index !== -1) {
      items.splice(index, 1);
      MEDIA_LIST_STATE.get(this).cssRule._conditionText = items.join(", ");
    }
  }

  _items() {
    const { cssRule } = MEDIA_LIST_STATE.get(this);
    const text = (cssRule._conditionText ?? "").trim();
    return text ? cssRule._conditionText.split(/\s*,\s*/) : [];
  }
}

// Numeric index accessors (`mediaList[0]` → `item(0)`), matching the
// happy-dom MediaList array-like surface (its Proxy-based `get` trap returns
// the item at the numeric index, `undefined` out of range).
for (let i = 0; i <= 99; i++) {
  const indexFor = i;
  Object.defineProperty(MediaList.prototype, String(i), {
    configurable: true,
    enumerable: false,
    get() {
      return this._items()[indexFor];
    },
  });
}

// ─── CSS rules parser (happy-dom CSSParser port) ─────────────────────────────

const COMMENT_REGEXP = /\/\*[\s\S]*?\*\//gm;

// happy-dom's CSSParser validates every style-rule selector with its
// SelectorParser before creating the rule; an empty selector or one that opens
// with an unbalanced `;` yields no selector groups and the rule is dropped.
// The facade port keeps the observable subset of that validation.
function isValidStyleSelector(selectorText) {
  return selectorText !== "" && !selectorText.startsWith(";");
}

function parseCssRules(cssText, parentStyleSheet) {
  const css = cssText.replace(COMMENT_REGEXP, "");
  const cssRules = [];
  const regExp = /{|}/gm;
  const stack = [];
  let parentRule = null;
  let lastIndex = 0;
  let match;
  while ((match = regExp.exec(css))) {
    if (match[0] === "{") {
      const selectorText = css.substring(lastIndex, match.index).trim();
      if (selectorText[0] === "@") {
        const ruleParts = selectorText.split(" ");
        const ruleType = ruleParts[0];
        const ruleParameters = ruleParts.slice(1).join(" ").trim();
        switch (ruleType) {
          case "@keyframes":
          case "@-webkit-keyframes": {
            const keyframesRule = new CSSKeyframesRule(ruleParameters, parentStyleSheet, parentRule);
            keyframesRule._rulePrefix = ruleType === "@-webkit-keyframes" ? "-webkit-" : "";
            if (parentRule) {
              if (parentRule.type === 4 || parentRule.type === 0 || parentRule.type === 12) parentRule.cssRules.push(keyframesRule);
            } else {
              cssRules.push(keyframesRule);
            }
            parentRule = keyframesRule;
            break;
          }
          case "@media": {
            const mediums = ruleParameters.split(",");
            const mediaRule = new CSSMediaRule("", parentStyleSheet, parentRule);
            for (const medium of mediums) mediaRule.media.appendMedium(medium.trim());
            mediaRule._conditionText = mediaRule.media.mediaText;
            if (parentRule) {
              if (parentRule.type === 4 || parentRule.type === 0 || parentRule.type === 12) parentRule.cssRules.push(mediaRule);
            } else {
              cssRules.push(mediaRule);
            }
            parentRule = mediaRule;
            break;
          }
          case "@container":
          case "@-webkit-container": {
            const containerRule = new CSSContainerRule(ruleParameters, parentStyleSheet, parentRule);
            if (parentRule) {
              if (parentRule.type === 4 || parentRule.type === 0 || parentRule.type === 12) parentRule.cssRules.push(containerRule);
            } else {
              cssRules.push(containerRule);
            }
            parentRule = containerRule;
            break;
          }
          case "@supports":
          case "@-webkit-supports": {
            const supportsRule = new CSSSupportsRule(ruleParameters, parentStyleSheet, parentRule);
            if (parentRule) {
              if (parentRule.type === 4 || parentRule.type === 0 || parentRule.type === 12) parentRule.cssRules.push(supportsRule);
            } else {
              cssRules.push(supportsRule);
            }
            parentRule = supportsRule;
            break;
          }
          case "@font-face": {
            const fontFaceRule = new CSSFontFaceRule(ruleParameters, parentStyleSheet, parentRule);
            if (parentRule) {
              if (parentRule.type === 4 || parentRule.type === 0 || parentRule.type === 12) parentRule.cssRules.push(fontFaceRule);
            } else {
              cssRules.push(fontFaceRule);
            }
            parentRule = fontFaceRule;
            break;
          }
          case "@scope":
          case "@-webkit-scope": {
            const scopeRule = new CSSScopeRule("", "", parentStyleSheet, parentRule);
            if (ruleParameters) {
              const scopeRuleParts = ruleParameters.split(/\s+to\s+/);
              if (scopeRuleParts[0] && scopeRuleParts[0][0] === "(" && scopeRuleParts[0][scopeRuleParts[0].length - 1] === ")") scopeRule._start = scopeRuleParts[0].slice(1, -1);
              if (scopeRuleParts[1] && scopeRuleParts[1][0] === "(" && scopeRuleParts[1][scopeRuleParts[1].length - 1] === ")") scopeRule._end = scopeRuleParts[1].slice(1, -1);
            }
            if (parentRule) {
              if (parentRule.type === 4 || parentRule.type === 0 || parentRule.type === 12) parentRule.cssRules.push(scopeRule);
            } else {
              cssRules.push(scopeRule);
            }
            parentRule = scopeRule;
            break;
          }
          default: {
            const newRule = new CSSStyleRule("", "", parentStyleSheet, parentRule);
            parentRule = newRule;
            break;
          }
        }
      } else if (parentRule && parentRule.type === 7) {
        const newRule = new CSSKeyframeRule(parentRule, parentRule);
        let keyText = selectorText.trim();
        if (keyText === "from") keyText = "0%";
        else if (keyText === "to") keyText = "100%";
        newRule._keyText = keyText;
        parentRule.cssRules.push(newRule);
        parentRule = newRule;
      } else if (parentRule && (parentRule.type === 4 || parentRule.type === 0 || parentRule.type === 12)) {
        if (isValidStyleSelector(selectorText)) {
          const newRule = new CSSStyleRule(selectorText, "", parentStyleSheet, parentRule);
          parentRule.cssRules.push(newRule);
          parentRule = newRule;
        }
      } else {
        if (isValidStyleSelector(selectorText)) {
          const newRule = new CSSStyleRule(selectorText, "", parentStyleSheet, parentRule);
          if (!parentRule) cssRules.push(newRule);
          parentRule = newRule;
        }
      }
      if (parentRule) stack.push(parentRule);
    } else {
      if (parentRule) {
        const cssTextBlock = css.substring(lastIndex, match.index).trim().replace(/([^;])$/, "$1;");
        if (parentRule.type === 5 || parentRule.type === 8 || parentRule.type === 1) {
          parentRule._cssText = cssTextBlock;
        }
      }
      stack.pop();
      parentRule = stack[stack.length - 1] || null;
    }
    lastIndex = match.index + 1;
  }
  return cssRules;
}

// ─── matchMedia / MediaQueryList ─────────────────────────────────────────────

const MEDIA_QUERY_REGEXP = /(not|only|all|screen|print)|\(([^\)]+)(\)){0,1}|(,)| +(or|and) +/g;
const IS_RESOLUTION_REGEXP = /[<>]/;
const RESOLUTION_REGEXP = /(?:([0-9]+[a-z]+) *(<|<=|>|>=)){0,1} *(width|height) *(?:(<|<=|>|>=) *([0-9]+[a-z]+)){0,1}/;

class MediaQueryItem {
  constructor(options) {
    this.window = options.window;
    this.rootFontSize = options.rootFontSize || null;
    this.mediaTypes = options.mediaTypes || [];
    this.not = options.not || false;
    this.rules = options.rules || [];
    this.ranges = options.ranges || [];
  }

  toString() {
    return `${this.not ? "not " : ""}${this.mediaTypes.join(", ")}${(this.not || this.mediaTypes.length > 0) && !!this.ranges.length ? " and " : ""}${this.ranges
      .map((range) => `(${range.before ? `${range.before.value} ${range.before.operator} ` : ""}${range.type}${range.after ? ` ${range.after.operator} ${range.after.value}` : ""})`)
      .join(" and ")}${(this.not || this.mediaTypes.length > 0) && !!this.rules.length ? " and " : ""}${this.rules
      .map((rule) => (rule.value ? `(${rule.name}: ${rule.value})` : `(${rule.name})`))
      .join(" and ")}`;
  }

  matches() {
    return this.not ? !this.matchesAll() : this.matchesAll();
  }

  matchesAll() {
    if (!!this.mediaTypes.length) {
      let isMediaTypeMatch = false;
      for (const mediaType of this.mediaTypes) {
        if (mediaType === "all" || mediaType === "screen") {
          isMediaTypeMatch = true;
          break;
        }
      }
      if (!isMediaTypeMatch) return false;
    }
    for (const rule of this.rules) {
      if (!this.matchesRule(rule)) return false;
    }
    for (const range of this.ranges) {
      if (!this.matchesRange(range)) return false;
    }
    return true;
  }

  matchesRange(range) {
    const windowSize = range.type === "width" ? this.window.innerWidth : this.window.innerHeight;
    if (range.before) {
      const beforeValue = this.toPixels(range.before.value);
      if (beforeValue === null) return false;
      switch (range.before.operator) {
        case "<":
          if (beforeValue >= windowSize) return false;
          break;
        case "<=":
          if (beforeValue > windowSize) return false;
          break;
        case ">":
          if (beforeValue <= windowSize) return false;
          break;
        case ">=":
          if (beforeValue < windowSize) return false;
          break;
      }
    }
    if (range.after) {
      const afterValue = this.toPixels(range.after.value);
      if (afterValue === null) return false;
      switch (range.after.operator) {
        case "<":
          if (windowSize >= afterValue) return false;
          break;
        case "<=":
          if (windowSize > afterValue) return false;
          break;
        case ">":
          if (windowSize <= afterValue) return false;
          break;
        case ">=":
          if (windowSize < afterValue) return false;
          break;
      }
    }
    return true;
  }

  matchesRule(rule) {
    if (!rule.value) {
      switch (rule.name) {
        case "min-width":
        case "max-width":
        case "min-height":
        case "max-height":
        case "width":
        case "height":
        case "orientation":
        case "prefers-color-scheme":
        case "hover":
        case "any-hover":
        case "any-pointer":
        case "pointer":
        case "display-mode":
        case "min-aspect-ratio":
        case "max-aspect-ratio":
        case "aspect-ratio":
          return true;
        case "prefers-reduced-motion":
          return false;
        case "forced-colors":
          return false;
      }
      return false;
    }
    switch (rule.name) {
      case "min-width":
        return this.window.innerWidth >= this.toPixels(rule.value);
      case "max-width":
        return this.window.innerWidth <= this.toPixels(rule.value);
      case "min-height":
        return this.window.innerHeight >= this.toPixels(rule.value);
      case "max-height":
        return this.window.innerHeight <= this.toPixels(rule.value);
      case "width":
        return this.window.innerWidth === this.toPixels(rule.value);
      case "height":
        return this.window.innerHeight === this.toPixels(rule.value);
      case "orientation":
        return rule.value === "landscape" ? this.window.innerWidth > this.window.innerHeight : this.window.innerWidth < this.window.innerHeight;
      case "prefers-color-scheme":
        return rule.value === "light";
      case "prefers-reduced-motion":
        return rule.value === "no-preference";
      case "forced-colors":
        return rule.value === "none";
      case "hover":
      case "any-hover":
        if (rule.value === "none") return false;
        if (rule.value === "hover") return true;
        return false;
      case "pointer":
      case "any-pointer":
        if (rule.value === "none") return false;
        if (rule.value === "coarse") return false;
        if (rule.value === "fine") return true;
        return false;
      case "display-mode":
        return rule.value === "browser";
      case "min-aspect-ratio":
      case "max-aspect-ratio":
      case "aspect-ratio": {
        const aspectRatio = rule.value.split("/");
        const aspectRatioWidth = parseInt(aspectRatio[0], 10);
        const aspectRatioHeight = parseInt(aspectRatio[1], 10);
        if (isNaN(aspectRatioWidth) || isNaN(aspectRatioHeight)) return false;
        const currentRatio = this.window.innerWidth / this.window.innerHeight;
        const targetRatio = aspectRatioWidth / aspectRatioHeight;
        if (rule.name === "min-aspect-ratio") return targetRatio <= currentRatio;
        if (rule.name === "max-aspect-ratio") return targetRatio >= currentRatio;
        return targetRatio === currentRatio;
      }
    }
    return false;
  }

  toPixels(value) {
    const parsed = parseFloat(value);
    const unit = value.replace(parsed.toString(), "");
    if (isNaN(parsed)) return null;
    switch (unit) {
      case "px": return parsed;
      case "rem": return Math.round(parsed * 16 * 10000) / 10000;
      case "em": return Math.round(parsed * (this.rootFontSize ?? 16) * 10000) / 10000;
      case "vw": return Math.round((parsed * this.window.innerWidth) / 100 * 10000) / 10000;
      case "vh": return Math.round((parsed * this.window.innerHeight) / 100 * 10000) / 10000;
      case "%": return null;
      case "vmin": return Math.round((parsed * Math.min(this.window.innerWidth, this.window.innerHeight)) / 100 * 10000) / 10000;
      case "vmax": return (parsed * Math.max(this.window.innerWidth, this.window.innerHeight)) / 100;
      case "cm": return Math.round(parsed * 37.7812 * 10000) / 10000;
      case "mm": return Math.round(parsed * 3.7781 * 10000) / 10000;
      case "in": return Math.round(parsed * 96 * 10000) / 10000;
      case "pt": return Math.round(parsed * 1.3281 * 10000) / 10000;
      case "pc": return Math.round(parsed * 16 * 10000) / 10000;
      case "Q": return Math.round(parsed * 0.945 * 10000) / 10000;
      default: return null;
    }
  }
}

// A minimal EventTarget for MediaQueryList (addEventListener /
// removeEventListener / dispatchEvent), matching the happy-dom onchange dispatch
// behavior for the `change` event.
const MQL_LISTENERS = new WeakMap();

class EventTargetLike {
  addEventListener(type, listener) {
    let byType = MQL_LISTENERS.get(this);
    if (!byType) {
      byType = new Map();
      MQL_LISTENERS.set(this, byType);
    }
    let listeners = byType.get(type);
    if (!listeners) {
      listeners = new Set();
      byType.set(type, listeners);
    }
    if (typeof listener === "function" || (listener && typeof listener.handleEvent === "function")) {
      listeners.add(listener);
    }
  }

  removeEventListener(type, listener) {
    const byType = MQL_LISTENERS.get(this);
    const listeners = byType?.get(type);
    if (listeners) listeners.delete(listener);
  }

  dispatchEvent(event) {
    const byType = MQL_LISTENERS.get(this);
    const listeners = byType?.get(event.type);
    if (listeners) {
      for (const listener of [...listeners]) {
        if (typeof listener === "function") listener.call(this, event);
        else if (listener && typeof listener.handleEvent === "function") listener.handleEvent.call(listener, event);
      }
    }
    // happy-dom also calls the class-defined on<type> handler (MediaQueryList
    // defines `onchange` as an own property).
    const onEventName = "on" + event.type.toLowerCase();
    if (Object.hasOwn(this, onEventName) && typeof this[onEventName] === "function") {
      this[onEventName](event);
    }
    return true;
  }
}

export class MediaQueryList extends EventTargetLike {
  constructor(options) {
    super();
    this.onchange = null;
    // Internal state is stored in symbols so `Object.keys` / iteration see
    // only `onchange` (happy-dom keeps these in private fields).
    this[MQL_STATE] = {
      window: options.window,
      media: options.media,
      rootFontSize: options.rootFontSize || null,
      items: null,
    };
  }

  get media() {
    const state = this[MQL_STATE];
    state.items = state.items || parseMediaQuery(state.window, state.media, state.rootFontSize);
    return state.items.map((item) => item.toString()).join(", ");
  }

  get matches() {
    const state = this[MQL_STATE];
    state.items = state.items || parseMediaQuery(state.window, state.media, state.rootFontSize);
    for (const item of state.items) {
      if (!item.matches()) return false;
    }
    return true;
  }

  addListener(callback) {
    this.addEventListener("change", callback);
  }

  removeListener(callback) {
    this.removeEventListener("change", callback);
  }
}

const MQL_STATE = Symbol("mad-dom-mql-state");

function parseMediaQuery(window, mediaQuery, rootFontSize) {
  let currentMediaQueryItem = new MediaQueryItem({ window, rootFontSize });
  const mediaQueryItems = [currentMediaQueryItem];
  const regexp = new RegExp(MEDIA_QUERY_REGEXP);
  let match = null;
  while ((match = regexp.exec(mediaQuery.toLowerCase()))) {
    if (match[4] === "," || match[5] === "or") {
      currentMediaQueryItem = new MediaQueryItem({ window, rootFontSize });
      mediaQueryItems.push(currentMediaQueryItem);
    } else if (match[1] === "all" || match[1] === "screen" || match[1] === "print") {
      currentMediaQueryItem.mediaTypes.push(match[1]);
    } else if (match[1] === "not") {
      currentMediaQueryItem.not = true;
    } else if (match[2]) {
      const resolutionMatch = IS_RESOLUTION_REGEXP.test(match[2]) ? match[2].match(RESOLUTION_REGEXP) : null;
      if (resolutionMatch && (resolutionMatch[1] || resolutionMatch[5])) {
        currentMediaQueryItem.ranges.push({
          before: resolutionMatch[1] ? { value: resolutionMatch[1], operator: resolutionMatch[2] } : null,
          type: resolutionMatch[3],
          after: resolutionMatch[5] ? { value: resolutionMatch[5], operator: resolutionMatch[4] } : null,
        });
      } else {
        const [name, value] = match[2].split(":");
        const trimmedValue = value ? value.trim() : null;
        if (!trimmedValue && !match[3]) {
          return [new MediaQueryItem({ window, rootFontSize, not: true, mediaTypes: ["all"] })];
        }
        currentMediaQueryItem.rules.push({ name: name.trim(), value: trimmedValue });
      }
    }
  }
  return mediaQueryItems;
}

export class MediaQueryListEvent extends Event {
  constructor(type, eventInit = {}) {
    super(type, eventInit);
    this.media = eventInit.media ?? "";
    this.matches = eventInit.matches ?? false;
  }
}

// ─── getComputedStyle (layout-free, stable subset) ───────────────────────────

const DEFAULT_CSS = {
  "default": "display: inline;",
  "A": "", "ABBR": "", "ADDRESS": "display: block;", "AREA": "", "ARTICLE": "display: block;",
  "ASIDE": "display: block;", "AUDIO": "display: none;", "B": "", "BASE": "display: none;",
  "BDI": "", "BDO": "", "BODY": "display: block;", "TEMPLATE": "display: none;",
  "FORM": "display: block;", "INPUT": "display: inline-block;", "TEXTAREA": "display: inline-block;",
  "SCRIPT": "display: none;", "IMG": "", "LINK": "display: none;", "STYLE": "display: none;",
  "LABEL": "", "SLOT": "display: contents;", "SVG": "", "CIRCLE": "", "ELLIPSE": "", "LINE": "",
  "PATH": "", "POLYGON": "", "POLYLINE": "", "RECT": "", "STOP": "", "USE": "", "META": "display: none;",
  "BLOCKQUOTE": "display: block;", "BR": "", "BUTTON": "display: inline-block;", "CANVAS": "",
  "CAPTION": "display: table-caption;", "CITE": "", "CODE": "", "COL": "display: table-column;",
  "COLGROUP": "display: table-column-group;", "DATA": "", "DATALIST": "display: none;",
  "DD": "display: block;", "DEL": "", "DETAILS": "display: block;", "DFN": "", "DIV": "display: block;",
  "DL": "display: block;", "DT": "display: block;", "EM": "", "EMBED": "",
  "FIELDSET": "display: block;", "FIGCAPTION": "display: block;", "FIGURE": "display: block;",
  "FOOTER": "display: block;", "H1": "display: block;", "H2": "display: block;", "H3": "display: block;",
  "H4": "display: block;", "H5": "display: block;", "H6": "display: block;", "HEAD": "display: none;",
  "HEADER": "display: block;", "HGROUP": "display: block;", "HR": "display: block;",
  "HTML": "display: block;direction: ltr;font: 16px \"Times New Roman\";", "I": "", "IFRAME": "",
  "INS": "", "KBD": "", "LEGEND": "display: block;", "LI": "display: list-item;", "MAIN": "display: block;",
  "MAP": "", "MARK": "", "MATH": "", "MENU": "display: block;", "MENUITEM": "",
  "METER": "display: inline-block;", "NAV": "display: block;", "NOSCRIPT": "", "OBJECT": "",
  "OL": "display: block;", "OPTGROUP": "display: block;", "OPTION": "display: block;",
  "OUTPUT": "unicode-bidi: isolate;", "P": "display: block;", "PARAM": "display: none;",
  "PICTURE": "", "PRE": "display: block;", "PROGRESS": "display: inline-block;", "Q": "", "RB": "",
  "RP": "display: none;", "RT": "", "RTC": "", "RUBY": "", "S": "", "SAMP": "",
  "SECTION": "display: block;", "SELECT": "display: inline-block;", "SLOT": "display: contents;",
  "SMALL": "", "SOURCE": "display: none;", "SPAN": "", "STRONG": "", "STYLE": "display: none;",
  "SUB": "", "SUMMARY": "display: list-item;", "SUP": "", "TABLE": "display: table;",
  "TBODY": "display: table-row-group;", "TD": "display: table-cell;",
  "TEXTAREA": "display: inline-block;", "TFOOT": "display: table-footer-group;",
  "TH": "display: table-cell;", "THEAD": "display: table-header-group;", "TIME": "",
  "TITLE": "display: none;", "TR": "display: table-row;", "TRACK": "display: none;",
  "U": "", "UL": "display: block;", "VAR": "", "VIDEO": "", "WBR": "",
  "DIALOG": { "default": "display: none;", "open": "display: block;" },
};

const INHERITED_PROPERTIES = new Set([
  "border-collapse", "border-spacing", "caption-side", "color", "cursor", "direction",
  "empty-cells", "font-family", "font-size", "font-style", "font-variant", "font-weight",
  "font-size-adjust", "font-stretch", "font", "letter-spacing", "line-height",
  "list-style-image", "list-style-position", "list-style-type", "list-style", "orphans",
  "quotes", "tab-size", "text-align", "text-align-last", "text-decoration-color",
  "text-indent", "text-justify", "text-shadow", "text-transform", "visibility",
  "white-space", "widows", "word-break", "word-spacing", "word-wrap",
]);

const MEASUREMENT_PROPERTIES = new Set([
  "background-position-x", "background-position-y", "background-size", "border-image-outset",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius",
  "border-bottom-left-radius", "border-image-width", "clip", "font-size", "padding-top",
  "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right",
  "margin-bottom", "margin-left", "width", "height", "min-width", "min-height",
  "max-width", "max-height", "top", "right", "bottom", "left", "outline-width",
  "outline-offset", "letter-spacing", "word-spacing", "text-indent", "line-height",
]);

const COMPUTED_CACHE = new WeakMap();

// happy-dom resolves `var(--name[, fallback])` references in computed values
// against the custom properties accumulated along the element chain (parent
// first). The no-fallback pass runs before the fallback pass, mirroring the
// oracle's `parseCSSVariablesInValue`.
const SINGLE_CSS_VARIABLE_REGEXP = /var\( *(--[^), ]+)\)/;
const CSS_VARIABLE_FALLBACK_REGEXP = /var\( *(--[^), ]+), *([^), ]+)\)/;

function parseCssVariablesInValue(value, cssProperties) {
  let newValue = value;
  let match;
  while ((match = newValue.match(SINGLE_CSS_VARIABLE_REGEXP)) != null) {
    newValue = newValue.replace(match[0], cssProperties[match[1]] || "");
  }
  while ((match = newValue.match(CSS_VARIABLE_FALLBACK_REGEXP)) !== null) {
    newValue = newValue.replace(match[0], cssProperties[match[1]] || match[2]);
  }
  return newValue;
}

function computedStyleFor(ctx, window, element) {
  const handle = facadeNodeHandle(ctx, element, "getComputedStyle");
  if (handle.nodeType() !== 1) {
    throw new TypeError("Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.");
  }
  let computed = COMPUTED_CACHE.get(handle);
  if (computed === undefined) {
    computed = new CSSStyleDeclaration(handle, { computed: true });
    COMPUTED_CACHE.set(handle, computed);
  }
  return computed;
}

// The layout-free computed-style engine: walks the element's parent chain
// applying the per-tag default CSS, the inline `style` attribute and the
// inherited font/direction/color properties. It never fabricates
// layout-dependent values (no measurement of widths/heights) — only the stable
// defaults happy-dom computes without a layout engine are produced.
function getComputedPropertyManager(declaration, elementHandle) {
  // happy-dom returns an empty computed style for detached elements.
  if (!elementHandle.isConnected()) return new PropertyManager();

  // Walk up from the element to the document root, collecting element handles
  // in html-first order (happy-dom processes parents from the root down, so a
  // closer ancestor's non-important value overrides a farther one's).
  const chain = [];
  let current = elementHandle;
  while (current !== null && current !== undefined) {
    if (current.nodeType() === 1) chain.unshift(current);
    current = current.parentNode();
  }

  const propertyManager = new PropertyManager();
  const cssProperties = {};
  let rootFontSize = 16;
  let parentFontSize = 16;
  const targetElement = elementHandle;

  for (const element of chain) {
    const tagName = String(element.nodeName()).toUpperCase();
    let elementCSSText = "";
    const defaultCSS = DEFAULT_CSS[tagName] ?? DEFAULT_CSS.default;
    if (defaultCSS) {
      if (typeof defaultCSS === "string") {
        elementCSSText += defaultCSS;
      } else {
        for (const key of Object.keys(defaultCSS)) {
          if (key === "default" || element.getAttribute(key.toLowerCase()) !== null) {
            elementCSSText += defaultCSS[key];
          }
        }
      }
    }
    const styleAttribute = element.getAttribute("style");
    if (styleAttribute) elementCSSText += styleAttribute;

    const { rules, properties } = parseCssText(elementCSSText);
    Object.assign(cssProperties, properties);
    for (const { name, value, important } of rules) {
      if (INHERITED_PROPERTIES.has(name) || element === targetElement) {
        const parsedValue = parseCssVariablesInValue(value.trim(), cssProperties);
        if (parsedValue && (!propertyManager.get(name)?.important || important)) {
          propertyManager.set(name, parsedValue, important);
          if (name === "font" || name === "font-size") {
            const fontSize = propertyManager.properties["font-size"];
            if (fontSize !== null) {
              if (tagName === "HTML") {
                rootFontSize = measurementToNumber(fontSize.value, rootFontSize);
              } else if (element !== targetElement) {
                parentFontSize = measurementToNumber(fontSize.value, rootFontSize);
              }
            }
          }
        }
      }
    }
  }

  // Resolve measurement properties to px where a stable conversion exists
  // (font-size against the root/parent font size; px stays verbatim).
  for (const name of MEASUREMENT_PROPERTIES) {
    const property = propertyManager.properties[name];
    if (property) {
      const converted = parseMeasurementsInValue(property.value, rootFontSize, parentFontSize, name === "font-size" ? parentFontSize : null);
      if (converted !== null) property.value = converted;
    }
  }
  return propertyManager;
}

function measurementToNumber(value, rootFontSize) {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return rootFontSize;
  const unit = value.replace(parsed.toString(), "");
  switch (unit) {
    case "px": return parsed;
    case "em": return Math.round(parsed * rootFontSize * 10000) / 10000;
    case "rem": return Math.round(parsed * 16 * 10000) / 10000;
    case "pt": return Math.round(parsed * 1.3281 * 10000) / 10000;
    case "pc": return Math.round(parsed * 16 * 10000) / 10000;
    case "in": return Math.round(parsed * 96 * 10000) / 10000;
    case "cm": return Math.round(parsed * 37.7812 * 10000) / 10000;
    case "mm": return Math.round(parsed * 3.7781 * 10000) / 10000;
    case "Q": return Math.round(parsed * 0.945 * 10000) / 10000;
    case "vw": return Math.round((parsed * 1024) / 100 * 10000) / 10000;
    case "vh": return Math.round((parsed * 768) / 100 * 10000) / 10000;
    case "vmin": return Math.round((parsed * Math.min(1024, 768)) / 100 * 10000) / 10000;
    case "vmax": return (parsed * Math.max(1024, 768)) / 100;
    default: return rootFontSize;
  }
}

function parseMeasurementsInValue(value, rootFontSize, parentFontSize, parentSize) {
  const regexp = /[0-9.]+(px|rem|em|vw|vh|%|vmin|vmax|cm|mm|in|pt|pc|Q)/g;
  let newValue = value;
  let match;
  while ((match = regexp.exec(value)) !== null) {
    if (match[1] !== "px") {
      const valueInPixels = toPixelsValue(match[0], rootFontSize, parentFontSize, parentSize);
      if (valueInPixels !== null) {
        newValue = newValue.replace(match[0], valueInPixels + "px");
      }
    }
  }
  return newValue;
}

function toPixelsValue(value, rootFontSize, parentFontSize, parentSize) {
  const parsed = parseFloat(value);
  const unit = value.replace(parsed.toString(), "");
  if (isNaN(parsed)) return null;
  switch (unit) {
    case "px": return parsed;
    case "rem": return Math.round(parsed * rootFontSize * 10000) / 10000;
    case "em": return Math.round(parsed * parentFontSize * 10000) / 10000;
    case "vw": return Math.round((parsed * 1024) / 100 * 10000) / 10000;
    case "vh": return Math.round((parsed * 768) / 100 * 10000) / 10000;
    case "%": return parentSize !== undefined && parentSize !== null ? Math.round((parsed * parseFloat(parentSize)) / 100 * 10000) / 10000 : null;
    case "vmin": return Math.round((parsed * Math.min(1024, 768)) / 100 * 10000) / 10000;
    case "vmax": return (parsed * Math.max(1024, 768)) / 100;
    case "cm": return Math.round(parsed * 37.7812 * 10000) / 10000;
    case "mm": return Math.round(parsed * 3.7781 * 10000) / 10000;
    case "in": return Math.round(parsed * 96 * 10000) / 10000;
    case "pt": return Math.round(parsed * 1.3281 * 10000) / 10000;
    case "pc": return Math.round(parsed * 16 * 10000) / 10000;
    case "Q": return Math.round(parsed * 0.945 * 10000) / 10000;
    default: return null;
  }
}

// ─── camelCase property accessor list (happy-dom port) ───────────────────────

const CSS_PROPERTY_ACCESSORS = {
  "accentColor": "accent-color", "appRegion": "app-region", "alignContent": "align-content",
  "alignItems": "align-items", "alignSelf": "align-self", "alignmentBaseline": "alignment-baseline",
  "all": "all", "animation": "animation", "animationDelay": "animation-delay",
  "animationDirection": "animation-direction", "animationDuration": "animation-duration",
  "animationFillMode": "animation-fill-mode", "animationIterationCount": "animation-iteration-count",
  "animationName": "animation-name", "animationPlayState": "animation-play-state",
  "animationTimingFunction": "animation-timing-function", "appearance": "appearance",
  "aspectRatio": "aspect-ratio",
  "backdropFilter": "backdrop-filter", "backfaceVisibility": "backface-visibility",
  "background": "background", "backgroundAttachment": "background-attachment",
  "backgroundBlendMode": "background-blend-mode", "backgroundClip": "background-clip",
  "backgroundColor": "background-color", "backgroundImage": "background-image",
  "backgroundOrigin": "background-origin", "backgroundPosition": "background-position",
  "backgroundPositionX": "background-position-x", "backgroundPositionY": "background-position-y",
  "backgroundRepeat": "background-repeat", "backgroundRepeatX": "background-repeat-x",
  "backgroundRepeatY": "background-repeat-y", "backgroundSize": "background-size",
  "baselineShift": "baseline-shift", "blockSize": "block-size", "border": "border",
  "borderBlockEnd": "border-block-end", "borderBlockEndColor": "border-block-end-color",
  "borderBlockEndStyle": "border-block-end-style", "borderBlockEndWidth": "border-block-end-width",
  "borderBlockStart": "border-block-start", "borderBlockStartColor": "border-block-start-color",
  "borderBlockStartStyle": "border-block-start-style", "borderBlockStartWidth": "border-block-start-width",
  "borderBottom": "border-bottom", "borderBottomColor": "border-bottom-color",
  "borderBottomLeftRadius": "border-bottom-left-radius", "borderBottomRightRadius": "border-bottom-right-radius",
  "borderBottomStyle": "border-bottom-style", "borderBottomWidth": "border-bottom-width",
  "borderCollapse": "border-collapse", "borderColor": "border-color", "borderImage": "border-image",
  "borderImageOutset": "border-image-outset", "borderImageRepeat": "border-image-repeat",
  "borderImageSlice": "border-image-slice", "borderImageSource": "border-image-source",
  "borderImageWidth": "border-image-width", "borderInlineEnd": "border-inline-end",
  "borderInlineEndColor": "border-inline-end-color", "borderInlineEndStyle": "border-inline-end-style",
  "borderInlineEndWidth": "border-inline-end-width", "borderInlineStart": "border-inline-start",
  "borderInlineStartColor": "border-inline-start-color", "borderInlineStartStyle": "border-inline-start-style",
  "borderInlineStartWidth": "border-inline-start-width", "borderLeft": "border-left",
  "borderLeftColor": "border-left-color", "borderLeftStyle": "border-left-style",
  "borderLeftWidth": "border-left-width", "borderRadius": "border-radius", "borderRight": "border-right",
  "borderRightColor": "border-right-color", "borderRightStyle": "border-right-style",
  "borderRightWidth": "border-right-width", "borderSpacing": "border-spacing", "borderStyle": "border-style",
  "borderTop": "border-top", "borderTopColor": "border-top-color", "borderTopLeftRadius": "border-top-left-radius",
  "borderTopRightRadius": "border-top-right-radius", "borderTopStyle": "border-top-style",
  "borderTopWidth": "border-top-width", "borderWidth": "border-width", "bottom": "bottom",
  "boxShadow": "box-shadow", "boxSizing": "box-sizing", "breakAfter": "break-after",
  "breakBefore": "break-before", "breakInside": "break-inside", "bufferedRendering": "buffered-rendering",
  "captionSide": "caption-side", "caretColor": "caret-color", "clear": "clear", "clip": "clip",
  "clipPath": "clip-path", "clipRule": "clip-rule", "color": "color",
  "colorInterpolation": "color-interpolation", "colorInterpolationFilters": "color-interpolation-filters",
  "colorRendering": "color-rendering", "colorScheme": "color-scheme", "columnCount": "column-count",
  "columnFill": "column-fill", "columnGap": "column-gap", "columnRule": "column-rule",
  "columnRuleColor": "column-rule-color", "columnRuleStyle": "column-rule-style",
  "columnRuleWidth": "column-rule-width", "columnSpan": "column-span", "columnWidth": "column-width",
  "columns": "columns", "contain": "contain", "containIntrinsicSize": "contain-intrinsic-size",
  "content": "content", "contentVisibility": "content-visibility", "counterIncrement": "counter-increment",
  "counterReset": "counter-reset", "counterSet": "counter-set", "cssFloat": "css-float",
  "cursor": "cursor", "cx": "cx", "cy": "cy", "d": "d", "direction": "direction",
  "display": "display", "dominantBaseline": "dominant-baseline", "emptyCells": "empty-cells",
  "fill": "fill", "fillOpacity": "fill-opacity", "fillRule": "fill-rule", "filter": "filter",
  "flex": "flex", "flexBasis": "flex-basis", "flexDirection": "flex-direction",
  "flexFlow": "flex-flow", "flexGrow": "flex-grow", "flexShrink": "flex-shrink",
  "flexWrap": "flex-wrap", "float": "float", "floodColor": "flood-color",
  "floodOpacity": "flood-opacity", "font": "font", "fontDisplay": "font-display",
  "fontFamily": "font-family", "fontFeatureSettings": "font-feature-settings",
  "fontKerning": "font-kerning", "fontOpticalSizing": "font-optical-sizing", "fontSize": "font-size",
  "fontStretch": "font-stretch", "fontStyle": "font-style", "fontVariant": "font-variant",
  "fontVariantCaps": "font-variant-caps", "fontVariantEastAsian": "font-variant-east-asian",
  "fontVariantLigatures": "font-variant-ligatures", "fontVariantNumeric": "font-variant-numeric",
  "fontVariationSettings": "font-variation-settings", "fontWeight": "font-weight", "gap": "gap",
  "grid": "grid", "gridArea": "grid-area", "gridAutoColumns": "grid-auto-columns",
  "gridAutoFlow": "grid-auto-flow", "gridAutoRows": "grid-auto-rows", "gridColumn": "grid-column",
  "gridColumnEnd": "grid-column-end", "gridColumnGap": "grid-column-gap", "gridColumnStart": "grid-column-start",
  "gridGap": "grid-gap", "gridRow": "grid-row", "gridRowEnd": "grid-row-end", "gridRowGap": "grid-row-gap",
  "gridRowStart": "grid-row-start", "gridTemplate": "grid-template", "gridTemplateAreas": "grid-template-areas",
  "gridTemplateColumns": "grid-template-columns", "gridTemplateRows": "grid-template-rows",
  "height": "height", "hyphens": "hyphens", "imageOrientation": "image-orientation",
  "imageRendering": "image-rendering", "inlineSize": "inline-size", "isolation": "isolation",
  "justifyContent": "justify-content", "justifyItems": "justify-items", "justifySelf": "justify-self",
  "left": "left", "letterSpacing": "letter-spacing", "lightingColor": "lighting-color",
  "lineBreak": "line-break", "lineHeight": "line-height", "listStyle": "list-style",
  "listStyleImage": "list-style-image", "listStylePosition": "list-style-position",
  "listStyleType": "list-style-type", "margin": "margin", "marginBlockEnd": "margin-block-end",
  "marginBlockStart": "margin-block-start", "marginBottom": "margin-bottom",
  "marginInlineEnd": "margin-inline-end", "marginInlineStart": "margin-inline-start",
  "marginLeft": "margin-left", "marginRight": "margin-right", "marginTop": "margin-top",
  "marker": "marker", "markerEnd": "marker-end", "markerMid": "marker-mid",
  "markerStart": "marker-start", "mask": "mask", "maskType": "mask-type",
  "maxBlockSize": "max-block-size", "maxHeight": "max-height", "maxInlineSize": "max-inline-size",
  "maxWidth": "max-width", "minBlockSize": "min-block-size", "minHeight": "min-height",
  "minInlineSize": "min-inline-size", "minWidth": "min-width", "mixBlendMode": "mix-blend-mode",
  "objectFit": "object-fit", "objectPosition": "object-position", "opacity": "opacity",
  "order": "order", "orientation": "orientation", "orphans": "orphans", "outline": "outline",
  "outlineColor": "outline-color", "outlineOffset": "outline-offset", "outlineStyle": "outline-style",
  "outlineWidth": "outline-width", "overflow": "overflow", "overflowAnchor": "overflow-anchor",
  "overflowWrap": "overflow-wrap", "overflowX": "overflow-x", "overflowY": "overflow-y",
  "overscrollBehavior": "overscroll-behavior", "padding": "padding", "paddingBlockEnd": "padding-block-end",
  "paddingBlockStart": "padding-block-start", "paddingBottom": "padding-bottom",
  "paddingInlineEnd": "padding-inline-end", "paddingInlineStart": "padding-inline-start",
  "paddingLeft": "padding-left", "paddingRight": "padding-right", "paddingTop": "padding-top",
  "pageBreakAfter": "page-break-after", "pageBreakBefore": "page-break-before",
  "pageBreakInside": "page-break-inside", "paintOrder": "paint-order", "perspective": "perspective",
  "perspectiveOrigin": "perspective-origin", "placeContent": "place-content",
  "placeItems": "place-items", "placeSelf": "place-self", "pointerEvents": "pointer-events",
  "position": "position", "quotes": "quotes", "r": "r", "resize": "resize", "right": "right",
  "rowGap": "row-gap", "rubyPosition": "ruby-position", "rx": "rx", "ry": "ry",
  "scrollBehavior": "scroll-behavior", "scrollMargin": "scroll-margin", "scrollMarginBlock": "scroll-margin-block",
  "scrollMarginBottom": "scroll-margin-bottom", "scrollMarginInline": "scroll-margin-inline",
  "scrollMarginLeft": "scroll-margin-left", "scrollMarginRight": "scroll-margin-right",
  "scrollMarginTop": "scroll-margin-top", "scrollPadding": "scroll-padding",
  "scrollPaddingBlock": "scroll-padding-block", "scrollPaddingBottom": "scroll-padding-bottom",
  "scrollPaddingInline": "scroll-padding-inline", "scrollPaddingLeft": "scroll-padding-left",
  "scrollPaddingRight": "scroll-padding-right", "scrollPaddingTop": "scroll-padding-top",
  "scrollSnapAlign": "scroll-snap-align", "scrollSnapStop": "scroll-snap-stop",
  "scrollSnapType": "scroll-snap-type", "shapeImageThreshold": "shape-image-threshold",
  "shapeMargin": "shape-margin", "shapeOutside": "shape-outside", "shapeRendering": "shape-rendering",
  "speak": "speak", "stopColor": "stop-color", "stopOpacity": "stop-opacity",
  "stroke": "stroke", "strokeDasharray": "stroke-dasharray", "strokeDashoffset": "stroke-dashoffset",
  "strokeLinecap": "stroke-linecap", "strokeLinejoin": "stroke-linejoin",
  "strokeMiterlimit": "stroke-miterlimit", "strokeOpacity": "stroke-opacity",
  "strokeWidth": "stroke-width", "src": "src", "tabSize": "tab-size", "tableLayout": "table-layout",
  "textAlign": "text-align", "textAlignLast": "text-align-last", "textAnchor": "text-anchor",
  "textCombineUpright": "text-combine-upright", "textDecoration": "text-decoration",
  "textDecorationColor": "text-decoration-color", "textDecorationLine": "text-decoration-line",
  "textDecorationSkipInk": "text-decoration-skip-ink", "textDecorationStyle": "text-decoration-style",
  "textIndent": "text-indent", "textOrientation": "text-orientation", "textOverflow": "text-overflow",
  "textRendering": "text-rendering", "textShadow": "text-shadow", "textSizeAdjust": "text-size-adjust",
  "textTransform": "text-transform", "textUnderlinePosition": "text-underline-position",
  "top": "top", "touchAction": "touch-action", "transform": "transform",
  "transformBox": "transform-box", "transformOrigin": "transform-origin",
  "transformStyle": "transform-style", "transition": "transition", "transitionDelay": "transition-delay",
  "transitionDuration": "transition-duration", "transitionProperty": "transition-property",
  "transitionTimingFunction": "transition-timing-function", "unicodeBidi": "unicode-bidi",
  "userSelect": "user-select", "vectorEffect": "vector-effect", "verticalAlign": "vertical-align",
  "visibility": "visibility", "whiteSpace": "white-space", "widows": "widows",
  "width": "width", "willChange": "will-change", "wordBreak": "word-break",
  "wordSpacing": "word-spacing", "wordWrap": "word-wrap", "writingMode": "writing-mode",
  "x": "x", "y": "y", "zIndex": "z-index", "zoom": "zoom",
};

// ─── install(ctx) entry point ────────────────────────────────────────────────

export function install(ctx) {
  // Window constructor accessors (the baseline `window.CSSStyleDeclaration`
  // etc.) and the `CSS` unit namespace with `supports`.
  const WINDOW_CSS_CONSTRUCTORS = {
    CSSStyleDeclaration,
    CSSRule,
    CSSStyleSheet,
    CSSStyleRule,
    CSSMediaRule,
    CSSKeyframesRule,
    CSSKeyframeRule,
    CSSFontFaceRule,
    CSSSupportsRule,
    CSSGroupingRule,
    CSSConditionRule,
    CSSContainerRule,
    CSSScopeRule,
    CSSStyleValue,
    CSSKeywordValue,
    MediaList,
    MediaQueryListEvent,
  };
  for (const [name, value] of Object.entries(WINDOW_CSS_CONSTRUCTORS)) {
    ctx.defineAccessor(Window.prototype, name, function getCssConstructor() {
      return value;
    }, undefined);
  }

  ctx.defineAccessor(Window.prototype, "CSS", function getCSS() {
    return CSS_NAMESPACE;
  }, undefined);

  ctx.defineMethod(Window.prototype, "matchMedia", function matchMedia(mediaQueryString) {
    return new MediaQueryList({ window: this, media: mediaQueryString });
  });

  ctx.defineMethod(Window.prototype, "getComputedStyle", function getComputedStyle(element) {
    return computedStyleFor(ctx, this, element);
  });

  // `Element.style` — the live declaration over the style attribute. Accessors
  // are on `Node.prototype` (the element class in the single-class model); a
  // text node reaches it and returns undefined (happy-dom parity).
  ctx.defineAccessor(Node.prototype, "style", function style() {
    const handle = facadeNodeHandle(ctx, this, "style");
    if (handle.nodeType() !== 1) return undefined;
    return styleOf(ctx, handle);
  }, undefined);

  // Document surface: `styleSheets` walks connected `<style>` elements and
  // `adoptedStyleSheets` is a plain settable array of CSSStyleSheet objects.
  ctx.defineAccessor(Document.prototype, "styleSheets", function styleSheets() {
    const handle = facadeDocumentHandle(ctx, this, "styleSheets");
    const sheets = [];
    for (const child of handle.querySelectorAll("style")) {
      const element = ctx.wrap(child);
      const sheet = element.sheet;
      if (sheet !== null) sheets.push(sheet);
    }
    return sheets;
  }, undefined);

  const adopted = new WeakMap();
  ctx.defineAccessor(Document.prototype, "adoptedStyleSheets", function adoptedStyleSheets() {
    const handle = facadeDocumentHandle(ctx, this, "adoptedStyleSheets");
    let list = adopted.get(handle);
    if (!list) {
      list = [];
      adopted.set(handle, list);
    }
    return list;
  }, function adoptedStyleSheets(value) {
    const handle = facadeDocumentHandle(ctx, this, "adoptedStyleSheets");
    const list = [];
    for (const item of value ?? []) {
      if (!(item instanceof CSSStyleSheet)) {
        throw new TypeError(`Failed to set the 'adoptedStyleSheets' property on 'Document': Failed to convert value to 'CSSStyleSheet'.`);
      }
      list.push(item);
    }
    adopted.set(handle, list);
  });

  // `<style>` element `.sheet` — parses textContent into a CSSStyleSheet (null
  // when disconnected), re-parsing when the text changes. Non-`<style>`
  // elements read `undefined` (happy-dom has no `sheet` property on them).
  ctx.defineAccessor(Node.prototype, "sheet", function sheet() {
    const handle = facadeNodeHandle(ctx, this, "sheet");
    if (handle.nodeType() !== 1) return undefined;
    if (String(handle.nodeName()).toLowerCase() !== "style") return undefined;
    if (!handle.isConnected()) return null;
    return sheetOf(ctx, handle);
  }, undefined);

  installCssStyleDeclarationSurface(ctx);
}
