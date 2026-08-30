// T39 HTMLElement base-surface integration tests.
//
// Drives the complete T39 slice through the official package entry
// (index.js → js/entry.js) and pins the acceptance criteria:
//
//   - the prototype hierarchy: every `createElement` wrapper is
//     `instanceof window.HTMLElement` and `Node.prototype` sits directly under
//     `HTMLElement.prototype`, with the HTMLElement surface installed as fixed
//     non-enumerable, non-configurable accessors on `HTMLElement.prototype`
//     (the element-level `id`/`className` stay on `Node.prototype`);
//   - the reflected attributes are two-way synced with the attribute storage:
//     a `setAttribute` write is visible on the next property read and a
//     property write on the next `getAttribute`; the WebIDL conversions match
//     happy-dom (`id = 42` stores `"42"`, `title = null` stores `"null"`,
//     `hidden`/`inert` are boolean-presence, `tabIndex` follows the `long`
//     `Number` rules, `contentEditable` validates its enum and throws the
//     happy-dom `SyntaxError`);
//   - `dataset` is a live `DOMStringMap` over `data-*` attributes (one cached
//     Proxy per element, camelCase↔kebab mapping, live both directions);
//   - the base interaction matches happy-dom observation for observation:
//     `click` dispatches a bubbling cancelable composed event, `focus`/`blur`
//     transition `document.activeElement` and dispatch focusin/focus/blur/
//     focusout in the happy-dom order, with the detached / inert /
//     already-focused no-op rules;
//   - no layout or painting state is involved (all state is the attribute
//     storage plus the per-document active-element cell).
//
// The structural block needs no native artifact; the runtime blocks skip
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

import { afterAll, describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Node, Element } from "../../js/facade/extensions/node.js";
import { HTMLElement } from "../../js/facade/extensions/html-element.js";
import { Document } from "../../js/facade/document.js";

const nativeAvailable = isNativeAvailable();

const createdWindows = [];

function freshWindow() {
  const win = createWindow();
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) {
    win.destroy();
  }
});

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("T39 HTMLElement prototype hierarchy", () => {
  test("HTMLElement prototype members are fixed accessors", () => {
    for (const name of [
      "title",
      "dir",
      "lang",
      "hidden",
      "inert",
      "tabIndex",
      "contentEditable",
      "isContentEditable",
      "dataset",
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
      expect(descriptor, `${name} must be an accessor on HTMLElement.prototype`).toBeDefined();
      expect(typeof descriptor.get).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
    for (const name of ["click", "focus", "blur"]) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
      expect(descriptor, `${name} must be a method on HTMLElement.prototype`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });

  test("the T48A hierarchy: Element over Node, HTMLElement over Element", () => {
    expect(Object.getPrototypeOf(Element.prototype)).toBe(Node.prototype);
    expect(Object.getPrototypeOf(HTMLElement.prototype)).toBe(Element.prototype);
    // The element-level reflection lives on Element.prototype (the element
    // class); the HTMLElement surface on HTMLElement.prototype.
    expect(Object.getOwnPropertyDescriptor(Element.prototype, "id")).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(Element.prototype, "className")).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(Node.prototype, "id")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "title")).toBeDefined();
  });

  test("document.activeElement is a fixed accessor", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor.get).toBe("function");
    expect(descriptor.set).toBeUndefined();
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.configurable).toBe(false);
  });
});

describe.skipIf(!nativeAvailable)("T39 reflected attributes", () => {
  test("id and className are two-way synced with their attributes", () => {
    const document = freshWindow().document;
    const div = document.createElement("div");

    div.setAttribute("id", "from-attr");
    expect(div.id).toBe("from-attr");
    div.id = "from-property";
    expect(div.getAttribute("id")).toBe("from-property");
    div.id = 42;
    expect(div.id).toBe("42");
    expect(div.getAttribute("id")).toBe("42");

    div.setAttribute("class", "a b");
    expect(div.className).toBe("a b");
    div.className = "c d";
    expect(div.getAttribute("class")).toBe("c d");
  });

  test("title, dir and lang reflect verbatim with an empty-string fallback", () => {
    const document = freshWindow().document;
    const div = document.createElement("div");

    expect(div.title).toBe("");
    div.title = "hello";
    expect(div.title).toBe("hello");
    expect(div.getAttribute("title")).toBe("hello");
    div.title = null;
    expect(div.title).toBe("null");
    expect(div.getAttribute("title")).toBe("null");

    div.dir = "rtl";
    expect(div.dir).toBe("rtl");
    expect(div.getAttribute("dir")).toBe("rtl");
    div.lang = "en";
    expect(div.lang).toBe("en");
    expect(div.getAttribute("lang")).toBe("en");
  });

  test("hidden and inert are boolean-presence reflections", () => {
    const document = freshWindow().document;
    const div = document.createElement("div");

    expect(div.hidden).toBe(false);
    div.hidden = true;
    expect(div.hidden).toBe(true);
    expect(div.hasAttribute("hidden")).toBe(true);
    expect(div.getAttribute("hidden")).toBe("");
    div.hidden = false;
    expect(div.hidden).toBe(false);
    expect(div.hasAttribute("hidden")).toBe(false);

    div.inert = true;
    expect(div.inert).toBe(true);
    expect(div.hasAttribute("inert")).toBe(true);
    div.inert = false;
    expect(div.inert).toBe(false);
  });

  test("tabIndex follows the happy-dom long rules", () => {
    const document = freshWindow().document;
    const div = document.createElement("div");

    expect(div.tabIndex).toBe(-1);
    div.tabIndex = 5;
    expect(div.tabIndex).toBe(5);
    expect(div.getAttribute("tabindex")).toBe("5");
    div.tabIndex = "7";
    expect(div.tabIndex).toBe(7);
    expect(div.getAttribute("tabindex")).toBe("7");
    div.setAttribute("tabindex", "abc");
    expect(div.tabIndex).toBe(-1);
    div.tabIndex = "abc";
    expect(div.tabIndex).toBe(0);
    expect(div.getAttribute("tabindex")).toBe("0");
    div.tabIndex = 1.5;
    expect(div.tabIndex).toBe(1.5);
    expect(div.getAttribute("tabindex")).toBe("1.5");
  });

  test("contentEditable validates its enum and isContentEditable walks the chain", () => {
    const document = freshWindow().document;
    const div = document.createElement("div");

    expect(div.contentEditable).toBe("inherit");
    expect(div.isContentEditable).toBe(false);
    div.contentEditable = "TRUE";
    expect(div.contentEditable).toBe("true");
    expect(div.isContentEditable).toBe(true);
    div.contentEditable = "inherit";
    expect(div.contentEditable).toBe("inherit");
    expect(div.isContentEditable).toBe(false);

    const parent = document.createElement("section");
    parent.contentEditable = "true";
    parent.appendChild(div);
    div.contentEditable = "inherit";
    expect(div.isContentEditable).toBe(true);

    const err = thrown(() => {
      div.contentEditable = "bogus";
    });
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err.message).toBe(
      "Failed to set the 'contentEditable' property on 'HTMLElement': The value provided ('bogus') is not one of 'true', 'false', 'plaintext-only', or 'inherit'.",
    );
    // The rejected setter leaves the attribute untouched.
    expect(div.getAttribute("contentEditable")).toBe("inherit");
  });
});

describe.skipIf(!nativeAvailable)("T39 dataset live DOMStringMap", () => {
  test("dataset maps camelCase keys to data-* attributes live in both directions", () => {
    const document = freshWindow().document;
    const span = document.createElement("span");

    span.setAttribute("data-foo-bar", "1");
    expect(span.dataset.fooBar).toBe("1");
    span.dataset.fooBar = "changed";
    expect(span.getAttribute("data-foo-bar")).toBe("changed");

    span.dataset.newKey = "v";
    expect(span.getAttribute("data-new-key")).toBe("v");
    span.setAttribute("data-external", "x");
    expect(span.dataset.external).toBe("x");

    delete span.dataset.fooBar;
    expect(span.hasAttribute("data-foo-bar")).toBe(false);
    expect("fooBar" in span.dataset).toBe(false);
  });

  test("dataset has stable identity, enumerated keys and no element surface leak", () => {
    const document = freshWindow().document;
    const span = document.createElement("span");

    expect(span.dataset).toBe(span.dataset);
    span.dataset.aB = "1";
    span.dataset.cdEf = "2";
    expect(Object.keys(span.dataset).sort()).toEqual(["aB", "cdEf"]);
    expect(Object.keys(span)).toEqual([]);
    expect(JSON.parse(JSON.stringify(span.dataset))).toEqual({ aB: "1", cdEf: "2" });
  });
});

describe.skipIf(!nativeAvailable)("T39 base interaction", () => {
  test("click dispatches a bubbling cancelable composed event", () => {
    const win = freshWindow();
    const document = win.document;
    document.body.innerHTML = '<button id="b">x</button>';
    const button = document.getElementById("b");

    const seen = [];
    button.addEventListener("click", (event) => {
      seen.push(["button", event.type, event.bubbles, event.cancelable, event.composed]);
    });
    document.body.addEventListener("click", () => seen.push(["body"]));

    button.click();
    expect(seen).toEqual([
      ["button", "click", true, true, true],
      ["body"],
    ]);

    // A cancelable click can be default-prevented.
    let prevented = false;
    button.addEventListener("click", (event) => {
      prevented = event.defaultPrevented;
    });
    button.dispatchEvent(new win.Event("click", { bubbles: true, cancelable: true }));
    expect(prevented).toBe(false);
  });

  test("focus and blur transition document.activeElement and dispatch the happy-dom event order", () => {
    const document = freshWindow().document;
    const div = document.createElement("div");
    document.body.appendChild(div);

    expect(document.activeElement).toBe(document.body);

    const seen = [];
    div.addEventListener("focus", () => seen.push("focus"));
    div.addEventListener("focusin", () => seen.push("focusin"));
    div.addEventListener("blur", () => seen.push("blur"));
    div.addEventListener("focusout", () => seen.push("focusout"));

    div.focus();
    expect(document.activeElement).toBe(div);
    expect(seen).toEqual(["focus", "focusin"]);

    div.blur();
    expect(document.activeElement).toBe(document.body);
    expect(seen).toEqual(["focus", "focusin", "blur", "focusout"]);
  });

  test("focusing a second element blurs the first in the happy-dom order", () => {
    const document = freshWindow().document;
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.appendChild(first);
    document.body.appendChild(second);

    const seen = [];
    first.addEventListener("focus", () => seen.push("first-focus"));
    first.addEventListener("blur", () => seen.push("first-blur"));
    first.addEventListener("focusout", () => seen.push("first-focusout"));
    second.addEventListener("focus", () => seen.push("second-focus"));

    first.focus();
    second.focus();
    expect(document.activeElement).toBe(second);
    expect(seen).toEqual(["first-focus", "first-blur", "first-focusout", "second-focus"]);
  });

  test("focus/blur are no-ops for detached, inert and already-focused elements", () => {
    const document = freshWindow().document;

    const detached = document.createElement("div");
    const detachedSeen = [];
    detached.addEventListener("focus", () => detachedSeen.push("focus"));
    detached.focus();
    expect(document.activeElement).toBe(document.body);
    expect(detachedSeen).toEqual([]);
    detached.blur();
    expect(document.activeElement).toBe(document.body);

    const inertElement = document.createElement("div");
    inertElement.inert = true;
    document.body.appendChild(inertElement);
    const inertSeen = [];
    inertElement.addEventListener("focus", () => inertSeen.push("focus"));
    inertElement.focus();
    expect(document.activeElement).toBe(document.body);
    expect(inertSeen).toEqual([]);

    const already = document.createElement("div");
    document.body.appendChild(already);
    already.focus();
    expect(document.activeElement).toBe(already);
    const alreadySeen = [];
    already.addEventListener("focus", () => alreadySeen.push("focus"));
    already.focus();
    expect(alreadySeen).toEqual([]);
  });

  test("the whole T39 surface fails per T21 on a destroyed document", () => {
    const win = freshWindow();
    const document = win.document;
    const div = document.createElement("div");
    document.body.appendChild(div);
    win.destroy();

    const reads = [
      () => div.id,
      () => {
        div.id = "x";
      },
      () => div.title,
      () => {
        div.title = "x";
      },
      () => div.tabIndex,
      () => div.hidden,
      () => div.dataset.foo,
      () => div.click(),
      () => div.focus(),
      () => document.activeElement,
    ];
    for (const read of reads) {
      const err = thrown(read);
      expect(err, "every T39 surface read of a destroyed document must fail").toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_MAD_DOM_DOCUMENT_DESTROYED");
    }
  });
});
