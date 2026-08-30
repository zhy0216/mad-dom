// Real differential scenario (T44): the CSSOM surface.
//
// Scope is exactly the T44 slice — `Element.style` (a live
// `CSSStyleDeclaration` over the `style` attribute with cssText / camelCase
// accessors / getPropertyValue / setProperty / removeProperty /
// getPropertyPriority / priority / length / item / indexed access / parentRule
// / bidirectional attribute sync), the first-batch stylesheet/rule API
// (`document.styleSheets`, `<style>` element `.sheet`, `CSSStyleSheet` with
// `cssRules` / `insertRule` / `deleteRule`, and the `CSSRule` family), and
// `matchMedia` / `MediaQueryList` plus a layout-free `getComputedStyle`.
//
// The probes only exercise behaviors that are stable without a layout engine
// (per-tag default CSS + inline style + inherited font/direction/color), never
// fabricated layout-dependent values.
export const id = "dom-cssom";
export const description = "real differential: Element.style CSSStyleDeclaration, styleSheets/rules, matchMedia, layout-free getComputedStyle";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const el = document.createElement("div");
    document.body.appendChild(el);

    // --- Element.style surface ---
    api.record.value("style-typeof", typeof el.style);
    api.record.value("style-cssText-empty", el.style.cssText);
    api.record.value("style-length-empty", el.style.length);
    api.record.identity("style-identity", el.style, el.style);

    el.style.color = "red";
    api.record.value("cssText-after-color", el.style.cssText);
    api.record.value("attr-after-color", el.getAttribute("style"));
    api.record.value("camel-color", el.style.color);
    api.record.value("kebab-color", el.style.getPropertyValue("color"));
    api.record.value("missing-value", el.style.getPropertyValue("nope"));
    api.record.value("missing-priority", el.style.getPropertyPriority("nope"));

    el.style.fontSize = "12px";
    api.record.value("cssText-after-fontSize", el.style.cssText);
    api.record.value("length-after-fontSize", el.style.length);
    api.record.value("item-0", el.style.item(0));
    api.record.value("item-1", el.style.item(1));
    api.record.value("index-0", el.style[0]);
    api.record.value("in-0", 0 in el.style);
    api.record.value("in-99", 99 in el.style);

    el.style.setProperty("margin", "5px", "important");
    api.record.value("cssText-after-important", el.style.cssText);
    api.record.value("priority-margin", el.style.getPropertyPriority("margin"));
    api.record.value("priority-color", el.style.getPropertyPriority("color"));
    api.record.value("get-margin", el.style.getPropertyValue("margin"));
    api.record.value("get-margin-top", el.style.getPropertyValue("margin-top"));
    api.record.value("length-after-margin", el.style.length);
    api.record.value(
      "items-after-margin",
      Array.from({ length: el.style.length }, (_, i) => el.style.item(i)),
    );

    const removed = el.style.removeProperty("color");
    api.record.value("removeProperty-return", removed);
    api.record.value("cssText-after-remove", el.style.cssText);
    api.record.value("attr-after-remove", el.getAttribute("style"));
    el.style.removeProperty("margin");
    api.record.value("cssText-after-remove-margin", el.style.cssText);

    el.style.setProperty("color", "blue", "");
    api.record.value("cssText-after-setProperty-empty-priority", el.style.cssText);

    // bidirectional sync: external attribute writes are live
    el.setAttribute("style", "color: green; margin-top: 3px");
    api.record.value("cssText-after-setAttribute", el.style.cssText);
    api.record.value("camel-after-setAttribute", el.style.color);
    api.record.value("kebab-after-setAttribute", el.style.getPropertyValue("margin-top"));

    el.style.marginTop = "9px";
    api.record.value("attr-after-camel-write", el.getAttribute("style"));

    api.record.value("parent-rule", el.style.parentRule);
    api.record.value("text-node-style", document.createTextNode("x").style);

    // cssText setter writes back; empty stores ""
    el.style.cssText = "display: block";
    api.record.value("cssText-setter-attr", el.getAttribute("style"));
    el.style.cssText = "";
    api.record.value("cssText-empty-attr", el.getAttribute("style"));
    api.record.value("cssText-empty", el.style.cssText);

    // camelCase accessor for a non-special property
    api.record.value("camel-backgroundColor", typeof el.style.backgroundColor);
    api.record.value("toJSON-type", typeof el.style.toJSON);

    // --- StyleSheets / rules ---
    const styleElement = document.createElement("style");
    api.record.value("style-detached-sheet", styleElement.sheet);
    styleElement.textContent =
      "div { color: red } @media (max-width: 600px) { .a { font-size: 10px } } " +
      "@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } } " +
      "@font-face { font-family: MyFont; src: url(x.woff) } " +
      "@supports (display: grid) { p { display: grid } }";
    document.head.appendChild(styleElement);

    api.record.value("styleSheets-length", document.styleSheets.length);
    const sheet = document.styleSheets[0];
    api.record.value("sheet-constructor", sheet.constructor.name);
    api.record.identity("sheet-identity", styleElement.sheet, sheet);
    api.record.value("cssRules-length", sheet.cssRules.length);

    const styleRule = sheet.cssRules[0];
    api.record.value("rule-0-type", styleRule.type);
    api.record.value("rule-0-selector", styleRule.selectorText);
    api.record.value("rule-0-cssText", styleRule.cssText);
    api.record.value("rule-0-style", styleRule.style.cssText);
    api.record.value("rule-0-parentRule", styleRule.parentRule);
    api.record.identity("rule-0-parentSheet", styleRule.parentStyleSheet, sheet);

    const mediaRule = sheet.cssRules[1];
    api.record.value("rule-1-type", mediaRule.type);
    api.record.value("rule-1-condition", mediaRule.conditionText);
    api.record.value("rule-1-media", mediaRule.media.mediaText);
    api.record.value("rule-1-cssText", mediaRule.cssText);
    api.record.value("rule-1-inner-selector", mediaRule.cssRules[0].selectorText);

    const keyframesRule = sheet.cssRules[2];
    api.record.value("rule-2-type", keyframesRule.type);
    api.record.value("rule-2-name", keyframesRule.name);
    api.record.value("rule-2-length", keyframesRule.length);
    api.record.value(
      "rule-2-rules",
      keyframesRule.cssRules.map((rule) => `${rule.keyText}:${rule.style.cssText}`),
    );

    const fontFaceRule = sheet.cssRules[3];
    api.record.value("rule-3-type", fontFaceRule.type);
    api.record.value("rule-3-style", fontFaceRule.style.cssText);

    const supportsRule = sheet.cssRules[4];
    api.record.value("rule-4-type", supportsRule.type);
    api.record.value("rule-4-condition", supportsRule.conditionText);

    api.record.value("insertRule-return", sheet.insertRule("h1 { font-weight: bold }"));
    api.record.value("cssRules-length-after-insert", sheet.cssRules.length);
    sheet.deleteRule(0);
    api.record.value("cssRules-length-after-delete", sheet.cssRules.length);
    api.record.value("rule-after-delete-selector", sheet.cssRules[0].selectorText);

    // text change re-parses the same sheet
    styleElement.textContent = "p { color: blue }";
    api.record.value("cssRules-after-text-change", sheet.cssRules[0].selectorText);
    api.record.identity("sheet-identity-after-change", document.styleSheets[0], sheet);

    // CSSRule statics
    api.record.value("CSSRule-StyleRule", entry.CSSRule?.STYLE_RULE);
    api.record.value("CSSRule-MediaRule", entry.CSSRule?.MEDIA_RULE);
    api.record.value("CSSRule-KeyframesRule", entry.CSSRule?.KEYFRAMES_RULE);
    api.record.value("CSSRule-KeyframeRule", entry.CSSRule?.KEYFRAME_RULE);
    api.record.value("CSSRule-FontFaceRule", entry.CSSRule?.FONT_FACE_RULE);
    api.record.value("CSSRule-SupportsRule", entry.CSSRule?.SUPPORTS_RULE);

    // --- matchMedia ---
    api.record.value("mq-media", window.matchMedia("(max-width: 600px)").media);
    api.record.value("mq-max-600", window.matchMedia("(max-width: 600px)").matches);
    api.record.value("mq-max-1024", window.matchMedia("(max-width: 1024px)").matches);
    api.record.value("mq-min-100", window.matchMedia("(min-width: 100px)").matches);
    api.record.value("mq-not-screen", window.matchMedia("not screen").matches);
    api.record.value("mq-screen", window.matchMedia("screen").matches);
    api.record.value("mq-print", window.matchMedia("print").matches);
    api.record.value("mq-orientation", window.matchMedia("(orientation: landscape)").matches);
    api.record.value("mq-and", window.matchMedia("(min-width: 100px) and (max-width: 2000px)").matches);

    const mql = window.matchMedia("(min-width: 100px)");
    let seen = null;
    mql.addEventListener("change", (event) => {
      seen = [event.media, event.matches];
    });
    api.record.value(
      "mq-dispatch-return",
      mql.dispatchEvent(
        new window.MediaQueryListEvent("change", { media: "(min-width: 100px)", matches: false }),
      ),
    );
    api.record.value("mq-listener-seen", seen);
    let onchangeCalled = 0;
    mql.onchange = () => {
      onchangeCalled++;
    };
    mql.dispatchEvent(
      new window.MediaQueryListEvent("change", { media: "(min-width: 100px)", matches: false }),
    );
    api.record.value("mq-onchange-called", onchangeCalled);
    api.record.value("mq-keys", Object.keys(mql));

    const mqe = new window.MediaQueryListEvent("change", {
      media: "(max-width: 600px)",
      matches: true,
    });
    api.record.value("mqe-type", mqe.type);
    api.record.value("mqe-media", mqe.media);
    api.record.value("mqe-matches", mqe.matches);

    // --- getComputedStyle (layout-free) ---
    const detached = document.createElement("div");
    api.record.value("computed-detached-length", window.getComputedStyle(detached).length);
    api.record.value("computed-detached-color", window.getComputedStyle(detached).getPropertyValue("color"));

    el.style.color = "red";
    const computed = window.getComputedStyle(el);
    api.record.value("computed-length", computed.length);
    api.record.value("computed-color", computed.getPropertyValue("color"));
    api.record.value("computed-font-size", computed.getPropertyValue("font-size"));
    api.record.value("computed-display", computed.getPropertyValue("display"));
    api.record.value("computed-direction", computed.getPropertyValue("direction"));
    api.record.value("computed-font-family", computed.getPropertyValue("font-family"));
    api.record.value("computed-cssText", computed.cssText);
    api.record.identity("computed-identity", window.getComputedStyle(el), computed);

    api.record.error(
      (() => {
        try {
          computed.cssText = "color: blue";
          return null;
        } catch (error) {
          return error;
        }
      })(),
      "sync-throw",
    );

    document.body.style.fontSize = "20px";
    const child = document.createElement("span");
    child.style.color = "blue";
    document.body.appendChild(child);
    api.record.value("computed-child-font-size", window.getComputedStyle(child).getPropertyValue("font-size"));
    api.record.value("computed-child-color", window.getComputedStyle(child).getPropertyValue("color"));
    api.record.value("computed-html-font-size", window.getComputedStyle(document.documentElement).getPropertyValue("font-size"));

    for (const tag of ["div", "span", "li", "h1", "style"]) {
      const probe = document.createElement(tag);
      document.body.appendChild(probe);
      api.record.value(`computed-display-${tag}`, window.getComputedStyle(probe).getPropertyValue("display"));
      document.body.removeChild(probe);
    }

    api.record.value("window-innerWidth", window.innerWidth);
    api.record.value("window-innerHeight", window.innerHeight);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
