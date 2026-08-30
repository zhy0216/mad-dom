// T44 positive type fixture: the CSSOM surface. Both happy-dom and mad-dom
// must type-check this file cleanly. "dom-under-test" is the virtual module
// resolving to happy-dom on one target and mad-dom (index.d.ts) on the other.
// The fixture reaches the surface through the window constructor accessors,
// the document members and the `Element.style` live declaration.

import {
  CSSConditionRule,
  CSSGroupingRule,
  CSSKeyframeRule,
  CSSKeyframesRule,
  CSSMediaRule,
  CSSRule,
  CSSStyleDeclaration,
  CSSStyleRule,
  CSSStyleSheet,
  CSSSupportsRule,
  Event,
  MediaQueryListEvent,
  Window,
} from "dom-under-test";

export function exercise(window: Window, doc: import("dom-under-test").Document): string {
  // Package-entry classes and the enum constants.
  const styleRule: number = CSSRule.STYLE_RULE;
  const mediaRule: number = CSSRule.MEDIA_RULE;
  const keyframesRule: number = CSSRule.KEYFRAMES_RULE;
  const keyframeRule: number = CSSRule.KEYFRAME_RULE;
  void mediaRule;
  void keyframesRule;
  void keyframeRule;

  // Window constructor accessors.
  const declCtor: typeof CSSStyleDeclaration = window.CSSStyleDeclaration;
  const ruleCtor: typeof CSSRule = window.CSSRule;
  const sheetCtor: typeof CSSStyleSheet = window.CSSStyleSheet;
  const styleRuleCtor: typeof CSSStyleRule = window.CSSStyleRule;
  const mediaRuleCtor: typeof CSSMediaRule = window.CSSMediaRule;
  const keyframesCtor: typeof CSSKeyframesRule = window.CSSKeyframesRule;
  const keyframeCtor: typeof CSSKeyframeRule = window.CSSKeyframeRule;
  const supportsCtor: typeof CSSSupportsRule = window.CSSSupportsRule;
  const conditionCtor: typeof CSSConditionRule = window.CSSConditionRule;
  const groupingCtor: typeof CSSGroupingRule = window.CSSGroupingRule;
  void declCtor;
  void ruleCtor;
  void sheetCtor;
  void styleRuleCtor;
  void mediaRuleCtor;
  void keyframesCtor;
  void keyframeCtor;
  void supportsCtor;
  void conditionCtor;
  void groupingCtor;

  // matchMedia / MediaQueryList / MediaQueryListEvent (the MediaQueryList type
  // itself is window-only in happy-dom, so its shape is inferred from the
  // window accessor; the exported `MediaQueryListEvent` class is used below).
  const mql = window.matchMedia("(max-width: 1024px)");
  const media: string = mql.media;
  const matches: boolean = mql.matches;
  mql.onchange = (event) => {
    // The happy-dom accessor types the callback parameter as `Event`; the
    // `MediaQueryListEvent` shape is reached through the exported class.
    const eventType: string = event.type;
    void eventType;
  };
  mql.addListener(() => {});
  mql.removeListener(() => {});
  mql.addEventListener("change", () => {});
  mql.removeEventListener("change", () => {});
  const dispatched: boolean = mql.dispatchEvent(new MediaQueryListEvent("change", { media: mql.media, matches: true }));
  void media;
  void matches;
  void dispatched;

  // getComputedStyle and Element.style.
  const el = doc.createElement("div");
  const style: CSSStyleDeclaration = el.style;
  const computed: CSSStyleDeclaration = window.getComputedStyle(el);
  style.cssText = "color: red";
  const color: string = style.color;
  const len: number = style.length;
  const item0: string = style.item(0);
  const value: string = style.getPropertyValue("color");
  const priority: string = style.getPropertyPriority("color");
  style.setProperty("margin", "5px", "important");
  style.removeProperty("color");
  const parentRule: CSSRule | null = style.parentRule;
  const computedText: string = computed.cssText;
  void color;
  void len;
  void item0;
  void value;
  void priority;
  void parentRule;
  void computedText;

  // document.styleSheets + <style> element sheet.
  const sheets: CSSStyleSheet[] = doc.styleSheets;
  const styleEl = doc.createElement("style");
  const sheet: CSSStyleSheet | null = styleEl.sheet;
  void sheets;
  void sheet;

  // The `Event` base of MediaQueryListEvent (baseline type shape).
  const ev: Event = new MediaQueryListEvent("change", { media: "(min-width: 0px)", matches: true });
  const evType: string = ev.type;
  void evType;

  return `${styleRule}`;
}
