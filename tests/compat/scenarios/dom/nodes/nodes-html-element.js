// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-element/HTMLElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLElement surface — accessKey, the
// always-zero offset/client box reads, contentEditable (enum reflection +
// SyntaxError on an invalid write), isContentEditable (incl. the inherit
// walk), tabIndex, the CSSStyleDeclaration `style` surface, dataset, the
// dir/hidden/inert/popover/lang/title reflections, click (event type/bubbles/
// composed/target/currentTarget), focus/blur with the inert gating and the
// setAttributeNode/removeAttributeNode style sync. The `on<event>` handler
// attributes, the rendered innerText assertions (layout-dependent) and the
// click PointerEvent width/height/instanceof assertions are dropped (handler
// surface / layout / PointerEvent internals not in the scenario surface).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-element";
export const description = "real differential: public HTMLElement accessKey/layout reads, contentEditable, style, dataset, popover, focus/blur, click";
export const targets = "real";

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
    const element = document.createElement("div");
    api.record.value("toString-tag", Object.prototype.toString.call(element));
    api.record.value("accessKey", element.accessKey);
    api.record.value("offsetHeight", element.offsetHeight);
    api.record.value("offsetWidth", element.offsetWidth);
    api.record.value("offsetLeft", element.offsetLeft);
    api.record.value("offsetTop", element.offsetTop);
    api.record.value("clientHeight", element.clientHeight);
    api.record.value("clientWidth", element.clientWidth);
    api.record.value("clientLeft", element.clientLeft);
    api.record.value("clientTop", element.clientTop);

    // contentEditable.
    api.record.value("contentEditable-default", element.contentEditable);
    for (const value of ["true", "false", "plaintext-only", "inherit", "TRUE", "FALSE", "INHERIT"]) {
      const div = document.createElement("div");
      div.setAttribute("contenteditable", value);
      api.record.value(`contentEditable-${value}`, div.contentEditable);
    }
    const invalid = document.createElement("div");
    invalid.setAttribute("contenteditable", "invalid");
    api.record.value("contentEditable-invalid", invalid.contentEditable);
    const ce = document.createElement("div");
    ce.contentEditable = "true";
    api.record.value("contentEditable-set-true", ce.getAttribute("contenteditable"));
    ce.contentEditable = "FALSE";
    api.record.value("contentEditable-set-FALSE", ce.getAttribute("contenteditable"));
    ce.contentEditable = "PLAINTEXT-ONLY";
    api.record.value("contentEditable-set-plaintext", ce.getAttribute("contenteditable"));
    ce.contentEditable = "INHERIT";
    api.record.value("contentEditable-set-inherit", ce.getAttribute("contenteditable"));
    let contentEditableError = null;
    try {
      ce.contentEditable = "invalid";
    } catch (error) {
      contentEditableError = `${error.name}: ${error.message}`;
    }
    api.record.value("contentEditable-invalid-throw", contentEditableError);

    // isContentEditable.
    const editable = document.createElement("div");
    api.record.value("isContentEditable-default", editable.isContentEditable);
    editable.setAttribute("contenteditable", "true");
    api.record.value("isContentEditable-true", editable.isContentEditable);
    editable.setAttribute("contenteditable", "plaintext-only");
    api.record.value("isContentEditable-plaintext", editable.isContentEditable);
    editable.setAttribute("contenteditable", "false");
    api.record.value("isContentEditable-false", editable.isContentEditable);
    const parent = document.createElement("div");
    parent.setAttribute("contenteditable", "true");
    const child = document.createElement("div");
    parent.appendChild(child);
    api.record.value("isContentEditable-inherit-parent", child.isContentEditable);

    // tabIndex (generic -1 default on a div).
    const div = document.createElement("div");
    api.record.value("tabindex-default", div.tabIndex);
    div.setAttribute("tabindex", "5");
    api.record.value("tabindex-attr", div.tabIndex);
    div.setAttribute("tabindex", "invalid");
    api.record.value("tabindex-nan", div.tabIndex);
    div.tabIndex = 5;
    api.record.value("tabindex-set-5", div.getAttribute("tabindex"));
    div.tabIndex = -1;
    api.record.value("tabindex-set-neg", div.getAttribute("tabindex"));
    div.tabIndex = "invalid";
    api.record.value("tabindex-set-invalid", div.getAttribute("tabindex"));

    // style (CSSStyleDeclaration).
    element.setAttribute("style", "border-radius: 2px; padding: 2px;");
    api.record.value("style-length", element.style.length);
    api.record.value("style-0", element.style[0]);
    api.record.value("style-1", element.style[1]);
    api.record.value("style-borderRadius", element.style.borderRadius);
    api.record.value("style-padding", element.style.padding);
    api.record.value("style-cssText", element.style.cssText);
    element.style.borderRadius = "4rem";
    element.style.backgroundColor = "green";
    api.record.value("style-length-after-set", element.style.length);
    api.record.value("style-cssText-after-set", element.style.cssText);
    api.record.value("style-attr-after-set", element.getAttribute("style"));
    element.style.borderRadius = "";
    api.record.value("style-cssText-after-empty", element.style.cssText);
    api.record.value("style-attr-after-empty", element.getAttribute("style"));
    element.style = "border-radius: 2px; padding: 2px;";
    api.record.value("style-set-cssText", element.style.cssText);
    api.record.value("style-set-attr", element.getAttribute("style"));
    api.record.value("style-set-outerHTML", element.outerHTML);
    element.style = "";
    api.record.value("style-set-empty-cssText", element.style.cssText);
    api.record.value("style-set-empty-attr", element.getAttribute("style"));
    element.style = null;
    api.record.value("style-set-null-cssText", element.style.cssText);

    // dataset.
    element.setAttribute("test-alpha", "value1");
    element.setAttribute("data-test-alpha", "value2");
    element.setAttribute("test-beta", "value3");
    element.setAttribute("data-test-beta", "value4");
    const dataset = element.dataset;
    api.record.identity("dataset-identity", dataset, element.dataset);
    api.record.value("dataset-keys", Object.keys(dataset));
    api.record.value("dataset-values", Object.values(dataset));
    dataset.testGamma = "value5";
    api.record.value("dataset-set-attr", element.getAttribute("data-test-gamma"));
    api.record.value("dataset-keys-after-set", Object.keys(dataset));
    element.setAttribute("data-test-delta", "value6");
    api.record.value("dataset-delta", dataset.testDelta);
    delete dataset.testDelta;
    api.record.value("dataset-delta-attr", element.getAttribute("data-test-delta"));
    api.record.value("dataset-keys-after-delete", Object.keys(dataset));

    // dir / hidden / inert / popover / lang / title.
    const rtl = document.createElement("div");
    rtl.setAttribute("dir", "rtl");
    api.record.value("dir-get", rtl.dir);
    rtl.dir = "rtl";
    api.record.value("dir-set", rtl.getAttribute("dir"));
    api.record.value("hidden-default", element.hidden);
    element.setAttribute("hidden", "");
    api.record.value("hidden-attr", element.hidden);
    element.hidden = true;
    api.record.value("hidden-set-true", element.getAttribute("hidden"));
    element.hidden = false;
    api.record.value("hidden-set-false", element.getAttribute("hidden"));
    api.record.value("inert-default", element.inert);
    element.setAttribute("inert", "");
    api.record.value("inert-attr", element.inert);
    element.inert = true;
    api.record.value("inert-set-true", element.getAttribute("inert"));
    element.inert = false;
    api.record.value("inert-set-false", element.getAttribute("inert"));
    const pop = document.createElement("div");
    api.record.value("popover-default", pop.popover);
    pop.setAttribute("popover", "auto");
    api.record.value("popover-auto", pop.popover);
    pop.setAttribute("popover", "manual");
    api.record.value("popover-manual", pop.popover);
    pop.setAttribute("popover", "");
    api.record.value("popover-empty", pop.popover);
    pop.setAttribute("popover", "invalid");
    api.record.value("popover-invalid", pop.popover);
    pop.popover = "auto";
    api.record.value("popover-set-attr", pop.getAttribute("popover"));
    pop.popover = null;
    api.record.value("popover-set-null", pop.getAttribute("popover"));
    for (const property of ["lang", "title"]) {
      const el = document.createElement("div");
      el.setAttribute(property, "value");
      api.record.value(`${property}-get`, el[property]);
      el[property] = "value";
      api.record.value(`${property}-set`, el.getAttribute(property));
    }

    // click dispatches a bubbling composed click event on the element.
    let clickEvent = null;
    let clickTarget = null;
    let clickCurrentTarget = null;
    element.addEventListener("click", (e) => {
      clickEvent = e;
      clickTarget = e.target;
      clickCurrentTarget = e.currentTarget;
    });
    element.click();
    api.record.value("click-type", clickEvent.type);
    api.record.value("click-bubbles", clickEvent.bubbles);
    api.record.value("click-composed", clickEvent.composed);
    api.record.identity("click-target", clickTarget, element);
    api.record.identity("click-current-target", clickCurrentTarget, element);

    // focus / blur with the inert gating.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    api.record.identity("focus-active", document.activeElement, input);
    input.blur();
    api.record.value("blur-active", document.activeElement === input);
    input.inert = true;
    input.focus();
    api.record.value("focus-inert-not-active", document.activeElement === input);
    input.inert = false;
    input.focus();
    api.record.identity("focus-inert-removed", document.activeElement, input);

    // setAttributeNode / removeAttributeNode keep the style declaration in sync.
    const styled = document.createElement("div");
    styled.style.background = "green";
    styled.style.color = "black";
    styled.setAttribute("style", "color: green");
    api.record.value("setAttributeNode-style-length", styled.style.length);
    api.record.value("setAttributeNode-style-0", styled.style[0]);
    api.record.value("setAttributeNode-style-color", styled.style.color);
    styled.removeAttribute("style");
    api.record.value("removeAttributeNode-style-length", styled.style.length);
    api.record.value("removeAttributeNode-style-cssText", styled.style.cssText);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
