// T44 CSSOM integration tests.
//
// Drives the complete T44 slice through the official package entry
// (index.js → js/entry.js) and pins the acceptance criteria:
//
//   - `Element.style` is a live `CSSStyleDeclaration` over the element's
//     `style` attribute: cssText / camelCase accessors / getPropertyValue /
//     setProperty / removeProperty / getPropertyPriority, `!important`
//     priority, `length`/`item`/indexed access, and bidirectional attribute
//     sync (a `setAttribute("style", ...)` write is visible on the next read
//     and a `style` mutation is visible on the next `getAttribute` read);
//   - the property manager round-trips the happy-dom observable cssText
//     serialization (shorthand expansion + collapse, value normalization)
//     for the common longhands and shorthands;
//   - the first-batch stylesheet/rule API: `document.styleSheets`, the
//     `<style>` element `.sheet` (null when disconnected, re-parse on text
//     change, stable identity), `CSSStyleSheet` with `cssRules` /
//     `insertRule` / `deleteRule`, and the `CSSRule` family
//     (`CSSStyleRule`, `CSSMediaRule`, `CSSKeyframesRule`, `CSSKeyframeRule`,
//     `CSSFontFaceRule`, `CSSSupportsRule`) with `selectorText`/`style`/
//     `cssText`/`type`/`parentRule`/`parentStyleSheet`;
//   - `matchMedia` / `MediaQueryList` (media / matches / onchange /
//     addListener / removeListener / addEventListener / dispatchEvent) and
//     `MediaQueryListEvent`, evaluated against the default viewport;
//   - `getComputedStyle`: layout-free — detached elements compute to empty,
//     connected elements get the per-tag default CSS + inline style +
//     inherited font/direction/color properties, and computed declarations are
//     read-only (the happy-dom DOMException on mutation).

import { afterAll, describe, expect, test } from "bun:test";
import {
  Window,
  CSSRule,
  CSSStyleDeclaration,
  CSSStyleSheet,
  isNativeAvailable,
} from "../../index.js";
import { StylePropertyMap, StylePropertyMapReadOnly } from "../../js/facade/extensions/cssom.js";
import { nodeHandleOf } from "../../js/facade/extensions/classes.js";

const nativeAvailable = isNativeAvailable();

const createdWindows = [];

function freshWindow() {
  const win = new Window();
  createdWindows.push(win);
  return win;
}

function freshWindowWith(options) {
  const win = new Window(options);
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) win.destroy();
});

// ─── Element.style surface ───────────────────────────────────────────────────

describe("Element.style / CSSStyleDeclaration (T44)", () => {
  test("style is a live CSSStyleDeclaration over the style attribute", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    expect(typeof el.style).toBe("object");
    expect(el.style).toBeInstanceOf(CSSStyleDeclaration);
    expect(el.style.cssText).toBe("");
    expect(el.style.length).toBe(0);
    expect(el.style.parentRule).toBeNull();

    el.style.color = "red";
    expect(el.style.cssText).toBe("color: red;");
    expect(el.getAttribute("style")).toBe("color: red;");
    expect(el.style.color).toBe("red");

    el.style.fontSize = "12px";
    expect(el.style.cssText).toBe("color: red; font-size: 12px;");
    expect(el.style.length).toBe(2);
    expect(el.style.item(0)).toBe("color");
    expect(el.style.item(1)).toBe("font-size");
    expect(el.style[0]).toBe("color");
    expect(0 in el.style).toBe(true);
  });

  test("getPropertyValue / setProperty / removeProperty / getPropertyPriority", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");

    el.style.setProperty("color", "blue", "important");
    expect(el.style.getPropertyValue("color")).toBe("blue");
    expect(el.style.getPropertyPriority("color")).toBe("important");
    expect(el.style.cssText).toBe("color: blue !important;");

    el.style.setProperty("margin", "5px");
    expect(el.style.getPropertyValue("margin")).toBe("5px");
    expect(el.style.getPropertyValue("margin-top")).toBe("5px");
    expect(el.style.length).toBe(5); // color + 4 expanded margin longhands

    const removed = el.style.removeProperty("color");
    expect(removed).toBeUndefined();
    expect(el.style.getPropertyValue("color")).toBe("");
    expect(el.style.cssText).toBe("margin: 5px;");

    // Removing one expanded longhand stops the shorthand from collapsing back
    // (happy-dom parity: the surviving longhands serialize individually).
    el.style.setProperty("margin-top", "");
    expect(el.style.cssText).toBe("margin-right: 5px; margin-bottom: 5px; margin-left: 5px;");
  });

  test("bidirectional sync with the style attribute is live", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");

    // external attribute write → next style read re-parses
    el.setAttribute("style", "color: green; margin-top: 3px");
    expect(el.style.cssText).toBe("color: green; margin-top: 3px;");
    expect(el.style.color).toBe("green");
    expect(el.style.marginTop).toBe("3px");

    // style write → attribute reflects
    el.style.marginTop = "9px";
    expect(el.getAttribute("style")).toBe("color: green; margin-top: 9px;");

    // cssText setter writes back; empty cssText stores "" (happy-dom parity)
    el.style.cssText = "display: block";
    expect(el.getAttribute("style")).toBe("display: block;");
    el.style.cssText = "";
    expect(el.getAttribute("style")).toBe("");
  });

  test("cssText round-trips the happy-dom serialization for common values", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    const cases = [
      "color: red",
      "background-color: yellow",
      "font-size: 12px",
      "margin-top: 5px",
      "margin: 1px 2px 3px 4px",
      "display: block",
      "opacity: 0.5",
      "--custom: 5",
      "font-family: Arial, sans-serif",
      "font-weight: bold",
      "text-align: center",
      "position: absolute",
      "padding: 1px 2px",
      "border: 1px solid red",
      "width: 100px",
      "top: 0",
      "visibility: hidden",
      "float: left",
      "line-height: 1.5",
      "background: red url(x.png) no-repeat",
      "border-radius: 4px",
    ];
    for (const cssText of cases) {
      el.style.cssText = cssText;
      // happy-dom normalizes a bare `0` length to `0px` and reorders the
      // `background` shorthand (`url(...)` first).
      const normalized = {
        "top: 0": "top: 0px;",
        "background: red url(x.png) no-repeat": 'background: url("x.png") no-repeat red;',
      }[cssText];
      const expected = normalized ?? `${cssText};`;
      expect(el.style.cssText, cssText).toBe(expected);
    }
  });

  test("a text node reads style as undefined (happy-dom parity)", () => {
    const win = freshWindow();
    const document = win.document;
    expect(document.createTextNode("x").style).toBeUndefined();
  });

  test("shorthand border-image getter reassembles sub-properties (T12)", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    document.body.appendChild(el);

    el.setAttribute("style", "border-image: inherit");
    expect(el.style.borderImage).toBe("inherit");
    expect(el.style.borderImageSource).toBe("inherit");
    expect(el.style.length).toBe(5);

    el.setAttribute("style", "border-image: var(--test-variable)");
    expect(el.style.borderImage).toBe("var(--test-variable)");

    el.setAttribute("style", "border-image: linear-gradient(#f6b73c, #4d9f0c) 30");
    expect(el.style.borderImage).toBe("linear-gradient(#f6b73c, #4d9f0c) 30 / 1 / 0 stretch");
  });

  test("border shorthand serializes border-image as one group (T12)", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    document.body.appendChild(el);

    el.setAttribute("style", "border: 2px solid green");
    el.style.borderRight = "1px dotted red";
    expect(el.getAttribute("style")).toBe(
      "border-width: 2px 1px 2px 2px; border-style: solid dotted solid solid; border-color: green red green green; border-image: initial;",
    );
  });

  test("background-position parses two-part keyword+length positions (T12)", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    document.body.appendChild(el);

    el.setAttribute("style", "background-position: bottom 10px right 20px");
    expect(el.style.backgroundPosition).toBe("right 20px bottom 10px");
    expect(el.style.backgroundPositionX).toBe("right 20px");
    expect(el.style.backgroundPositionY).toBe("bottom 10px");

    el.setAttribute("style", "background-position: 10px 20px, 30px 40px");
    expect(el.style.backgroundPosition).toBe("10px 20px, 30px 40px");
  });

  test("aspect-ratio camelCase accessor round-trips values (T12)", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    document.body.appendChild(el);

    for (const value of ["var(--test-variable)", "inherit", "auto", "1 / 1", "16 / 9", "4 / 3"]) {
      el.setAttribute("style", `aspect-ratio: ${value}`);
      expect(el.style.aspectRatio).toBe(value);
    }
    el.setAttribute("style", "aspect-ratio: 2");
    expect(el.style.aspectRatio).toBe("2 / 1");
    el.setAttribute("style", "aspect-ratio: 16/9 auto");
    expect(el.style.aspectRatio).toBe("auto 16 / 9");
  });

  test("StylePropertyMap set/get/append/delete over a declaration (T12)", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const style = el.style;

    const map = new StylePropertyMap(style);
    map.append("color", "red");
    map.append("width", "100px");
    map.set("z-index", "2");
    expect(map.get("color").toString()).toBe("red");
    expect(map.get("width") + "").toBe("100px");
    expect(map.size).toBe(3);
    expect(map.has("color")).toBe(true);
    map.delete("color");
    expect(map.has("color")).toBe(false);
    expect([...map.keys()]).toEqual(["width", "z-index"]);
  });

  test("StylePropertyMapReadOnly iterates live declaration state (T12)", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const style = el.style;
    style.color = "red";
    style.zIndex = "2";
    style.width = "100px";

    const map = new StylePropertyMapReadOnly(style);
    expect(map.size).toBe(3);
    expect([...map.keys()]).toEqual(["color", "z-index", "width"]);
    expect(map.get("color").toString()).toBe("red");
    expect(map.getAll("width").map((value) => value.toString())).toEqual(["100px"]);
    expect(map.has("z-index")).toBe(true);
    expect(map.has("nonexistent")).toBe(false);
  });
});

// ─── Stylesheets / rules ─────────────────────────────────────────────────────

describe("stylesheets and rules (T44)", () => {
  test("document.styleSheets walks connected <style> elements", () => {
    const win = freshWindow();
    const document = win.document;
    const style = document.createElement("style");
    expect(style.sheet).toBeNull();

    style.textContent = "div { color: red }";
    document.head.appendChild(style);
    expect(document.styleSheets.length).toBe(1);
    expect(style.sheet).toBeInstanceOf(CSSStyleSheet);
    expect(style.sheet).toBe(document.styleSheets[0]);

    document.head.removeChild(style);
    expect(document.styleSheets.length).toBe(0);
    expect(style.sheet).toBeNull();
  });

  test("CSSStyleSheet parses textContent into the CSSRule family", () => {
    const win = freshWindow();
    const document = win.document;
    const style = document.createElement("style");
    style.textContent =
      "div { color: red } @media (max-width: 600px) { .a { font-size: 10px } } " +
      "@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } } " +
      "@font-face { font-family: MyFont; src: url(x.woff) } " +
      "@supports (display: grid) { p { display: grid } }";
    document.head.appendChild(style);
    const sheet = style.sheet;

    expect(sheet.cssRules.length).toBe(5);
    const [styleRule, mediaRule, keyframesRule, fontFaceRule, supportsRule] = sheet.cssRules;

    expect(styleRule.type).toBe(1);
    expect(styleRule.selectorText).toBe("div");
    expect(styleRule.style.cssText).toBe("color: red;");
    expect(styleRule.cssText).toBe("div { color: red; }");
    expect(styleRule.parentRule).toBeNull();
    expect(styleRule.parentStyleSheet).toBe(sheet);

    expect(mediaRule.type).toBe(4);
    expect(mediaRule.conditionText).toBe("(max-width: 600px)");
    expect(mediaRule.media.mediaText).toBe("(max-width: 600px)");
    expect(mediaRule.cssRules.length).toBe(1);
    expect(mediaRule.cssRules[0].selectorText).toBe(".a");
    expect(mediaRule.cssText).toBe("@media (max-width: 600px) {\n  .a { font-size: 10px; }\n}");

    expect(keyframesRule.type).toBe(7);
    expect(keyframesRule.name).toBe("spin");
    expect(keyframesRule.length).toBe(2);
    expect(keyframesRule.cssRules.map((rule) => rule.keyText)).toEqual(["0%", "100%"]);
    expect(keyframesRule.cssRules[0].style.cssText).toBe("transform: rotate(0deg);");

    expect(fontFaceRule.type).toBe(5);
    expect(fontFaceRule.style.cssText).toBe("font-family: MyFont; src: url(x.woff);");

    expect(supportsRule.type).toBe(12);
    expect(supportsRule.conditionText).toBe("(display: grid)");
  });

  test("insertRule / deleteRule mutate the sheet rule list", () => {
    const win = freshWindow();
    const document = win.document;
    const style = document.createElement("style");
    style.textContent = "div { color: red }";
    document.head.appendChild(style);
    const sheet = style.sheet;

    const index = sheet.insertRule("h1 { font-weight: bold }");
    expect(index).toBe(1);
    expect(sheet.cssRules.length).toBe(2);
    expect(sheet.cssRules[1].selectorText).toBe("h1");

    sheet.deleteRule(0);
    expect(sheet.cssRules.length).toBe(1);
    expect(sheet.cssRules[0].selectorText).toBe("h1");

    expect(() => sheet.insertRule("")).toThrow("Failed to parse the rule");
  });

  test("textContent changes re-parse the sheet without changing identity", () => {
    const win = freshWindow();
    const document = win.document;
    const style = document.createElement("style");
    style.textContent = "div { color: red }";
    document.head.appendChild(style);
    const sheet = style.sheet;
    expect(sheet.cssRules[0].selectorText).toBe("div");

    style.textContent = "p { color: blue }";
    expect(sheet.cssRules[0].selectorText).toBe("p");
    expect(document.styleSheets[0]).toBe(sheet);
  });

  test("CSSRule static constants are exposed", () => {
    expect(CSSRule.STYLE_RULE).toBe(1);
    expect(CSSRule.MEDIA_RULE).toBe(4);
    expect(CSSRule.KEYFRAMES_RULE).toBe(7);
    expect(CSSRule.KEYFRAME_RULE).toBe(8);
    expect(CSSRule.FONT_FACE_RULE).toBe(5);
    expect(CSSRule.SUPPORTS_RULE).toBe(12);
  });
});

// ─── matchMedia / MediaQueryList ─────────────────────────────────────────────

describe("matchMedia / MediaQueryList (T44)", () => {
  test("media / matches evaluate against the default viewport", () => {
    const win = freshWindow();
    expect(win.matchMedia("(max-width: 600px)").media).toBe("(max-width: 600px)");
    expect(win.matchMedia("(max-width: 600px)").matches).toBe(false);
    expect(win.matchMedia("(max-width: 1024px)").matches).toBe(true);
    expect(win.matchMedia("(min-width: 100px)").matches).toBe(true);
    expect(win.matchMedia("not screen").matches).toBe(false);
    expect(win.matchMedia("screen").matches).toBe(true);
    expect(win.matchMedia("print").matches).toBe(false);
    expect(win.matchMedia("(orientation: landscape)").matches).toBe(true);
  });

  test("matches honors the settings.device mediaType / prefers-* options", () => {
    const printWin = freshWindowWith({ width: 1024, height: 768, settings: { device: { mediaType: "print" } } });
    expect(printWin.matchMedia("print").matches).toBe(true);
    expect(printWin.matchMedia("print and (min-width: 1024px)").matches).toBe(true);
    expect(printWin.matchMedia("screen").matches).toBe(false);

    const darkWin = freshWindowWith({ width: 1024, height: 768, settings: { device: { prefersColorScheme: "dark" } } });
    expect(darkWin.matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
    expect(darkWin.matchMedia("(prefers-color-scheme: light)").matches).toBe(false);

    const reduceWin = freshWindowWith({ width: 1024, height: 768, settings: { device: { prefersReducedMotion: "reduce" } } });
    expect(reduceWin.matchMedia("(prefers-reduced-motion)").matches).toBe(true);
    expect(reduceWin.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    expect(reduceWin.matchMedia("(prefers-reduced-motion: no-preference)").matches).toBe(false);

    const forcedWin = freshWindowWith({ settings: { device: { forcedColors: "active" } } });
    expect(forcedWin.matchMedia("(forced-colors)").matches).toBe(true);
    expect(forcedWin.matchMedia("(forced-colors: active)").matches).toBe(true);
    expect(forcedWin.matchMedia("(forced-colors: none)").matches).toBe(false);
  });

  test("percentage media values never match", () => {
    const win = freshWindow();
    expect(win.matchMedia("(min-width: 0%)").matches).toBe(false);
    expect(win.matchMedia("(min-height: 0%)").matches).toBe(false);
  });

  test("rem/em media values follow the root font-size and disableComputedStyleRendering", () => {
    const win = freshWindow();
    win.document.documentElement.style.fontSize = "10px";
    expect(win.matchMedia(`(min-width: ${1024 / 10}rem)`).matches).toBe(true);
    expect(win.matchMedia(`(min-width: ${1025 / 10}rem)`).matches).toBe(false);
    expect(win.matchMedia(`(min-width: ${1024 / 10}em)`).matches).toBe(true);
    expect(win.matchMedia(`(max-width: ${1023 / 10}rem)`).matches).toBe(false);
    expect(win.matchMedia(`(max-width: ${1024 / 10}rem)`).matches).toBe(true);

    const noCssWin = freshWindowWith({ width: 1024, height: 768, settings: { disableComputedStyleRendering: true } });
    expect(noCssWin.matchMedia(`(max-width: ${1023 / 16}rem)`).matches).toBe(false);
    expect(noCssWin.matchMedia(`(max-width: ${1024 / 16}rem)`).matches).toBe(true);
  });

  test("addEventListener / dispatchEvent and onchange", () => {
    const win = freshWindow();
    const mql = win.matchMedia("(min-width: 100px)");
    let seen = null;
    mql.addEventListener("change", (event) => {
      seen = [event.media, event.matches];
    });
    expect(
      mql.dispatchEvent(
        new win.MediaQueryListEvent("change", { media: "(min-width: 100px)", matches: false }),
      ),
    ).toBe(true);
    expect(seen).toEqual(["(min-width: 100px)", false]);

    let onchangeCalled = 0;
    mql.onchange = () => {
      onchangeCalled++;
    };
    mql.dispatchEvent(
      new win.MediaQueryListEvent("change", { media: "(min-width: 100px)", matches: false }),
    );
    expect(onchangeCalled).toBe(1);

    mql.addListener(() => {});
    mql.removeListener(() => {});
  });
});

// ─── getComputedStyle (layout-free) ──────────────────────────────────────────

describe("getComputedStyle (T44)", () => {
  test("detached elements compute to empty", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    const computed = win.getComputedStyle(el);
    expect(computed.length).toBe(0);
    expect(computed.getPropertyValue("color")).toBe("");
    expect(computed.cssText).toBe("");
  });

  test("connected elements get stable defaults + inline + inheritance", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    el.style.color = "red";
    document.body.appendChild(el);

    const computed = win.getComputedStyle(el);
    expect(computed.getPropertyValue("color")).toBe("red");
    expect(computed.getPropertyValue("font-size")).toBe("16px");
    expect(computed.getPropertyValue("display")).toBe("block");
    expect(computed.getPropertyValue("direction")).toBe("ltr");
    expect(computed.getPropertyValue("font-family")).toBe("\"Times New Roman\"");
    expect(computed.length).toBe(10);
    expect(win.getComputedStyle(el)).toBe(computed);

    // inheritance: an inline parent font-size propagates
    document.body.style.fontSize = "20px";
    const child = document.createElement("span");
    child.style.color = "blue";
    document.body.appendChild(child);
    expect(win.getComputedStyle(child).getPropertyValue("font-size")).toBe("20px");
    expect(win.getComputedStyle(child).getPropertyValue("color")).toBe("blue");
  });

  test("computed declarations are read-only", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const computed = win.getComputedStyle(el);
    expect(() => {
      computed.cssText = "color: blue";
    }).toThrow();
    expect(() => {
      computed.setProperty("color", "blue");
    }).toThrow();
    expect(() => {
      computed.removeProperty("color");
    }).toThrow();
  });

  test("cached computed declarations track inline mutations, reparenting and detachment", () => {
    const win = freshWindow();
    const { document } = win;
    document.body.innerHTML = '<section style="color:red"><button>One</button><button>Two</button></section><aside style="color:blue"></aside>';
    const [first, second] = document.querySelectorAll("button");
    const firstStyle = win.getComputedStyle(first);
    const secondStyle = win.getComputedStyle(second);
    expect(firstStyle.color).toBe("red");
    expect(secondStyle.color).toBe("red");

    document.querySelector("section").style.color = "green";
    expect(firstStyle.color).toBe("green");
    expect(secondStyle.color).toBe("green");
    nodeHandleOf(first).setAttribute("style", "display:none");
    expect(firstStyle.display).toBe("none");
    first.removeAttribute("style");
    expect(firstStyle.display).toBe("inline-block");

    document.querySelector("aside").appendChild(first);
    expect(firstStyle.color).toBe("blue");
    expect(secondStyle.color).toBe("green");
    expect(win.getComputedStyle(first)).toBe(firstStyle);
    first.remove();
    expect(firstStyle.color).toBe("");
    document.body.appendChild(first);
    expect(firstStyle.display).toBe("inline-block");
    expect(firstStyle.color).toBe("");
  });

  test("cached sheet discovery preserves live stylesheet and text-data edits", () => {
    const win = freshWindow();
    const { document } = win;
    document.body.innerHTML = '<button>Action</button>';
    const button = document.querySelector("button");
    const computed = win.getComputedStyle(button);
    expect(computed.display).toBe("inline-block");

    const style = document.createElement("style");
    style.textContent = "button { display:none; }";
    document.head.appendChild(style);
    expect(computed.display).toBe("none");
    style.sheet.cssRules[0].style.display = "block";
    expect(computed.display).toBe("block");
    style.sheet.insertRule("button { display:flex; }");
    expect(computed.display).toBe("flex");
    style.sheet.deleteRule(1);
    expect(computed.display).toBe("block");
    style.firstChild.data = "button { display:grid; }";
    expect(computed.display).toBe("grid");
    style.remove();
    expect(computed.display).toBe("inline-block");
    document.head.appendChild(style);
    expect(computed.display).toBe("grid");
    expect(win.getComputedStyle(button)).toBe(computed);
  });

  test("computed caches retain destroyed-document validation", () => {
    const win = new Window();
    const button = win.document.createElement("button");
    win.document.body.appendChild(button);
    const computed = win.getComputedStyle(button);
    expect(computed.display).toBe("inline-block");
    win.destroy();
    expect(() => computed.display).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
    expect(() => win.getComputedStyle(button)).toThrow(/ERR_MAD_DOM_DOCUMENT_DESTROYED/);
  });
});

// ─── package entry exports ───────────────────────────────────────────────────

describe("package entry CSSOM exports (T44)", () => {
  test("the CSSOM classes are exported from the entry", () => {
    expect(typeof CSSStyleDeclaration).toBe("function");
    expect(typeof CSSRule).toBe("function");
    expect(typeof CSSStyleSheet).toBe("function");
    const win = freshWindow();
    expect(typeof win.CSSStyleDeclaration).toBe("function");
    expect(typeof win.CSSRule).toBe("function");
    expect(typeof win.matchMedia).toBe("function");
    expect(typeof win.getComputedStyle).toBe("function");
    expect(win.innerWidth).toBe(1024);
    expect(win.innerHeight).toBe(768);
  });
});

// ─── W1 differential-pilot facade fixes ──────────────────────────────────────

describe("W1 css differential-pilot facade surface", () => {
  test("window.CSS escape() follows the CSSOM escaping algorithm", () => {
    const win = freshWindow();
    const css = win.CSS;
    expect(css.escape(".foo#bar")).toBe("\\.foo\\#bar");
    expect(css.escape("()[]{}")).toBe("\\(\\)\\[\\]\\{\\}");
    expect(css.escape("--a")).toBe("--a");
    expect(css.escape("0")).toBe("\\30 ");
    expect(css.escape("\0")).toBe("\ufffd");
    expect(css.escape("-")).toBe("\\-");
  });

  test("window.CSS exposes unit factories and supports()", () => {
    const win = freshWindow();
    const css = win.CSS;
    const px = css.px(100);
    expect(px.unit).toBe("px");
    expect(px.value).toBe(100);
    const em = css.em(2);
    expect(em.unit).toBe("em");
    expect(em.value).toBe(2);
    expect(css.supports("condition")).toBe(true);
    expect(css.supports("property", "value")).toBe(true);
  });

  test("MediaList supports numeric index access", () => {
    const win = freshWindow();
    const sheet = new win.CSSStyleSheet();
    sheet.insertRule("@media screen, print { }");
    const media = sheet.cssRules[0].media;
    expect(media.mediaText).toBe("screen, print");
    expect(media.length).toBe(2);
    expect(media[0]).toBe("screen");
    expect(media[1]).toBe("print");
    expect(media[2]).toBeUndefined();
    expect(media.item(0)).toBe("screen");
  });

  test("CSSGroupingRule enforces the WebIDL argument count and rejects empty selectors", () => {
    const win = freshWindow();
    const sheet = new win.CSSStyleSheet();
    sheet.insertRule("@scope { }");
    const scope = sheet.cssRules[0];
    expect(() => scope.insertRule()).toThrow(
      "Failed to execute 'insertRule' on 'CSSScopeRule': 1 argument required, but only 0 present.",
    );
    expect(() => scope.insertRule("{ color: red; }")).toThrow(
      "Failed to execute 'insertRule' on 'CSSScopeRule': Failed to parse the rule '{ color: red; }'.",
    );
    expect(() => scope.insertRule("body { color: red; } .test { color: blue; }")).toThrow(
      "Failed to execute 'insertRule' on 'CSSScopeRule': Failed to parse the rule 'body { color: red; } .test { color: blue; }'.",
    );
    expect(() => scope.deleteRule()).toThrow(
      "Failed to execute 'deleteRule' on 'CSSScopeRule': 1 argument required, but only 0 present.",
    );
    expect(() => scope.deleteRule(5)).toThrow(
      "Failed to execute 'deleteRule' on 'CSSScopeRule': the index (5) is greater than the length of the rule list.",
    );
  });

  test("CSSKeyframesRule enforces the WebIDL argument count", () => {
    const win = freshWindow();
    const sheet = new win.CSSStyleSheet();
    sheet.insertRule("@keyframes spin { 0% { transform: rotate(0deg); } }");
    const keyframes = sheet.cssRules[0];
    expect(() => keyframes.appendRule()).toThrow(
      "Failed to execute 'appendRule' on 'CSSKeyframesRule': 1 argument required, but only 0 present.",
    );
    expect(() => keyframes.deleteRule()).toThrow(
      "Failed to execute 'deleteRule' on 'CSSKeyframesRule': 1 argument required, but only 0 present.",
    );
  });

  test("CSSStyleRule.styleMap is a live StylePropertyMap over the rule style", () => {
    const win = freshWindow();
    const sheet = new win.CSSStyleSheet();
    sheet.insertRule("div { color: red; border: 1px solid black }");
    const rule = sheet.cssRules[0];
    expect(rule.styleMap).toBe(rule.styleMap);
    rule.styleMap.set("color", "red");
    rule.styleMap.set("border", "1px solid black");
    rule.styleMap.set("border-top", "2px solid red");
    expect(rule.cssText).toBe(
      "div { color: red; border-width: 2px 1px 1px; border-style: solid; border-color: red black black; border-image: initial; }",
    );
  });

  test("the parser keeps the -webkit- keyframes prefix in cssText", () => {
    const win = freshWindow();
    const sheet = new win.CSSStyleSheet();
    sheet.insertRule("@-webkit-keyframes spin { 0% { transform: rotate(0deg); } }");
    expect(sheet.cssRules[0].cssText).toBe(
      "@-webkit-keyframes spin { \n  0% { transform: rotate(0deg); }\n}",
    );
  });

  test("the parser drops a rule whose selector is empty or opens with ';'", () => {
    const win = freshWindow();
    const document = win.document;
    const style = document.createElement("style");
    style.textContent = ".foo { color: red; } ; .invalidAsThereIsASemicolon { color: red; } .validAsThereIsNoSemicolon { color: pink; }";
    document.head.appendChild(style);
    expect(style.sheet.cssRules.length).toBe(2);
    expect(style.sheet.cssRules[0].selectorText).toBe(".foo");
    expect(style.sheet.cssRules[1].selectorText).toBe(".validAsThereIsNoSemicolon");
  });

  test("getComputedStyle resolves var() references against custom properties", () => {
    const win = freshWindow();
    const document = win.document;
    const el = document.createElement("div");
    document.body.appendChild(el);

    el.setAttribute("style", "--bg-color: rgb(0 128 0 / 1); background-color: var(--bg-color);");
    expect(win.getComputedStyle(el).getPropertyValue("background-color")).toBe("rgb(0 128 0 / 1)");

    el.setAttribute(
      "style",
      "--bg-color-alpha: 1; background-color: rgb(0 128 0 / var(--bg-color-alpha, 1));",
    );
    expect(win.getComputedStyle(el).getPropertyValue("background-color")).toBe("rgb(0 128 0 / 1)");
  });
});
