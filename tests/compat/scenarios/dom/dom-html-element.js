// Real differential scenario (T39): the HTMLElement base surface.
//
// Scope is exactly the T39 slice — the `window.HTMLElement` prototype-hierarchy
// membership of a `createElement` wrapper, the reflected attribute accessors
// (`id` / `className` / `title` / `dir` / `lang` / `hidden` / `inert` /
// `tabIndex` / `contentEditable` / `isContentEditable`) with their two-way
// attribute sync and the `contentEditable` enum `SyntaxError`, the live
// `dataset` `DOMStringMap` over `data-*` attributes, and the base interaction
// (`click` bubbling a cancelable composed event, `focus`/`blur` with the
// `document.activeElement` transitions and the focusin/focus/blur/focusout
// event order, plus the detached and inert no-op rules).
//
// The scenario deliberately avoids the frozen T39 deviations (pinned by the
// Bun tests instead): per-instance `constructor.name` and `Object.prototype
// .toString` differ (MAD DOM wraps every node in one `Node` class while
// happy-dom mints per-tag classes); descriptor `configurable` differs
// (MAD DOM's facade surface is non-configurable, happy-dom's class surface is
// configurable); and non-element access reaches the inherited HTMLElement
// surface in MAD DOM (throwing the Core element check) while happy-dom lacks
// the members on text/comment nodes. All probes below stay on element
// wrappers and record observable state, so both sides agree observation for
// observation.
export const id = "dom-html-element";
export const description = "real differential: HTMLElement prototype membership, reflected attributes, dataset DOMStringMap, click/focus/blur interaction";
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
    // --- prototype-hierarchy membership ---
    const div = document.createElement("div");
    api.record.value("prototype-html-element-membership", div instanceof window.HTMLElement);
    api.record.value("prototype-surface-html-element", typeof window.HTMLElement);
    api.record.value("prototype-own-keys-element", Object.keys(div));
    api.record.value("prototype-own-keys-html-element", Object.keys(window.HTMLElement.prototype));

    // --- string reflection (two-way with the attribute) ---
    div.setAttribute("id", "from-attr");
    api.record.value("string-id-read", div.id);
    div.id = "from-property";
    api.record.value("string-id-attr", div.getAttribute("id"));
    div.id = 42;
    api.record.value("string-id-number", div.id);

    div.setAttribute("class", "a b");
    api.record.value("string-class-name", div.className);
    div.className = "c d";
    api.record.value("string-class-name-attr", div.getAttribute("class"));

    div.setAttribute("title", "t");
    api.record.value("string-title", div.title);
    div.title = "new";
    api.record.value("string-title-attr", div.getAttribute("title"));
    div.title = null;
    api.record.value("string-title-null", div.title);
    api.record.value("string-title-null-attr", div.getAttribute("title"));

    div.setAttribute("dir", "rtl");
    api.record.value("string-dir", div.dir);
    div.dir = "ltr";
    api.record.value("string-dir-attr", div.getAttribute("dir"));
    api.record.value("string-dir-missing", document.createElement("span").dir);

    div.setAttribute("lang", "en");
    api.record.value("string-lang", div.lang);
    div.lang = "fr";
    api.record.value("string-lang-attr", div.getAttribute("lang"));

    // --- boolean reflection ---
    div.setAttribute("hidden", "");
    api.record.value("bool-hidden-present", div.hidden);
    div.hidden = false;
    api.record.value("bool-hidden-cleared", div.hidden);
    api.record.value("bool-hidden-attr-gone", div.hasAttribute("hidden"));
    div.hidden = true;
    api.record.value("bool-hidden-set", div.hidden);
    api.record.value("bool-hidden-attr-value", div.getAttribute("hidden"));

    div.setAttribute("inert", "");
    api.record.value("bool-inert-present", div.inert);
    div.inert = false;
    api.record.value("bool-inert-cleared", div.inert);
    api.record.value("bool-inert-attr-gone", div.hasAttribute("inert"));

    // --- number reflection (long rules) ---
    div.tabIndex = 5;
    api.record.value("num-tab-index", div.tabIndex);
    api.record.value("num-tab-index-attr", div.getAttribute("tabindex"));
    div.tabIndex = "7";
    api.record.value("num-tab-index-string", div.tabIndex);
    div.setAttribute("tabindex", "abc");
    api.record.value("num-tab-index-invalid-attr", div.tabIndex);
    div.tabIndex = "abc";
    api.record.value("num-tab-index-nan-setter", div.tabIndex);
    api.record.value("num-tab-index-nan-attr", div.getAttribute("tabindex"));
    api.record.value("num-tab-index-missing", document.createElement("p").tabIndex);

    // --- contentEditable enum + isContentEditable ---
    api.record.value("ce-default", document.createElement("div").contentEditable);
    div.contentEditable = "true";
    api.record.value("ce-true", div.contentEditable);
    api.record.value("ce-true-attr", div.getAttribute("contentEditable"));
    api.record.value("ce-is-editable", div.isContentEditable);
    div.contentEditable = "inherit";
    api.record.value("ce-inherit", div.contentEditable);
    api.record.value("ce-inherit-not-editable", div.isContentEditable);
    try {
      div.contentEditable = "bogus";
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    api.record.value("ce-after-error-attr", div.getAttribute("contentEditable"));

    // --- dataset: live DOMStringMap over data-* attributes ---
    const data = document.createElement("span");
    data.setAttribute("data-foo-bar", "1");
    data.setAttribute("data-plain", "2");
    data.dataset.newKey = "v";
    api.record.value("dataset-foo-bar", data.dataset.fooBar);
    api.record.value("dataset-plain", data.dataset.plain);
    api.record.value("dataset-new-key", data.dataset.newKey);
    api.record.value("dataset-new-key-attr", data.getAttribute("data-new-key"));
    api.record.value("dataset-keys", Object.keys(data.dataset));
    api.record.value("dataset-has", "fooBar" in data.dataset);
    api.record.value("dataset-missing", "nope" in data.dataset);
    data.dataset.fooBar = "changed";
    api.record.value("dataset-write-attr", data.getAttribute("data-foo-bar"));
    delete data.dataset.plain;
    api.record.value("dataset-delete-gone", data.hasAttribute("data-plain"));
    data.setAttribute("data-external", "x");
    api.record.value("dataset-live-after-set", data.dataset.external);
    api.record.identity("dataset-identity", data.dataset, data.dataset);
    api.record.identity("dataset-per-element", div.dataset === data.dataset ? "same" : "distinct");
    api.record.value("dataset-own-keys-element", Object.keys(data));

    // --- click: bubbling cancelable composed event ---
    document.body.innerHTML = '<button id="b">x</button>';
    const button = document.getElementById("b");
    button.addEventListener("click", (event) =>
      api.record.event("click", {
        target: "button",
        bubbles: event.bubbles,
        cancelable: event.cancelable,
        composed: event.composed,
        defaultPrevented: event.defaultPrevented,
      }),
    );
    document.body.addEventListener("click", (event) =>
      api.record.event("click", { target: "body", defaultPrevented: event.defaultPrevented }),
    );
    button.addEventListener("click", (event) => event.preventDefault());
    const dispatched = button.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    api.record.value("click-dispatch-return", dispatched);
    const detachedButton = document.createElement("button");
    let detachedEvents = [];
    detachedButton.addEventListener("click", () => detachedEvents.push("click"));
    detachedButton.click();
    api.record.value("click-detached-events", detachedEvents);

    // --- focus / blur: activeElement transitions and event order ---
    const focusTarget = document.createElement("div");
    document.body.appendChild(focusTarget);
    api.record.value("focus-active-before", document.activeElement === document.body ? "body" : "other");
    const focusEvents = [];
    focusTarget.addEventListener("focus", () => focusEvents.push("focus"));
    focusTarget.addEventListener("focusin", () => focusEvents.push("focusin"));
    focusTarget.addEventListener("blur", () => focusEvents.push("blur"));
    focusTarget.addEventListener("focusout", () => focusEvents.push("focusout"));
    focusTarget.focus();
    api.record.value("focus-active-target", document.activeElement === focusTarget);
    api.record.value("focus-events", focusEvents);
    focusTarget.blur();
    api.record.value("blur-active-target", document.activeElement === focusTarget);
    api.record.value("blur-active-fallback", document.activeElement === document.body ? "body" : "other");
    api.record.value("blur-events", focusEvents);

    // focus on the already-focused element is a no-op
    const already = document.createElement("div");
    document.body.appendChild(already);
    already.focus();
    const alreadyCount = focusEvents.length;
    already.focus();
    api.record.value("focus-already-noop", focusEvents.length === alreadyCount);

    // focusing a second element blurs the first
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.appendChild(first);
    document.body.appendChild(second);
    const switchEvents = [];
    first.addEventListener("focus", () => switchEvents.push("first-focus"));
    first.addEventListener("blur", () => switchEvents.push("first-blur"));
    first.addEventListener("focusout", () => switchEvents.push("first-focusout"));
    second.addEventListener("focus", () => switchEvents.push("second-focus"));
    first.focus();
    second.focus();
    api.record.value("focus-switch-active", document.activeElement === second);
    api.record.value("focus-switch-events", switchEvents);

    // detached focus is a no-op
    const detached = document.createElement("div");
    let detachedFocusEvents = [];
    detached.addEventListener("focus", () => detachedFocusEvents.push("focus"));
    detached.focus();
    api.record.value("focus-detached-active", document.activeElement === detached);
    api.record.value("focus-detached-events", detachedFocusEvents);

    // inert element focus is a no-op
    const inertElement = document.createElement("div");
    inertElement.inert = true;
    document.body.appendChild(inertElement);
    let inertEvents = [];
    inertElement.addEventListener("focus", () => inertEvents.push("focus"));
    inertElement.focus();
    api.record.value("focus-inert-active", document.activeElement === inertElement);
    api.record.value("focus-inert-events", inertEvents);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
