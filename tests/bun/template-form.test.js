// T40 HTMLTemplateElement.content and first-batch form-control integration tests.
//
// Drives the complete T40 slice through the official package entry
// (index.js → js/entry.js) and pins the acceptance criteria:
//
//   - template content is an independent template-contents DocumentFragment:
//     not exposed as ordinary children, `template.content` has stable identity,
//     `innerHTML` reads/writes the fragment, the serializer round-trips it and
//     `cloneNode(deep)` / `importNode` / `adoptNode` carry it with the element;
//   - the first-batch form contract: input/button/select/option/textarea
//     value/name/disabled/checked/selected basics with the dirty
//     value/checked cells in Core (a text input's dirty `value` does not touch
//     the attribute, a textarea's dirty value does not touch the text content),
//     the radio-group exclusivity, the select/option selection model and the
//     `option.value`/`index`/`text` reads;
//   - `form.elements` is a live collection (an existing collection reflects
//     later tree changes) and `form.reset()` restores every control to its
//     default value;
//   - submit/reset event order: `form.requestSubmit()` dispatches a
//     `SubmitEvent('submit')` with the `submitter`, a submit button click
//     dispatches click then submit, a reset button click dispatches click then
//     the form `reset`, and a checkbox click toggles checked and dispatches
//     `input` then `change` (restoring the checkedness when the click is
//     default-prevented).
//
// The structural block needs no native artifact; the runtime blocks skip
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

import { afterAll, describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import { Node } from "../../js/facade/extensions/node.js";
import { HTMLTemplateElement } from "../../js/facade/extensions/template.js";
import { SubmitEvent } from "../../js/facade/extensions/forms.js";

const nativeAvailable = isNativeAvailable();

const createdWindows = [];

function freshWindow() {
  const win = new Window();
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) {
    win.destroy();
  }
});

describe("T40 template facade surface", () => {
  test("template/content accessors are fixed members", () => {
    for (const name of ["content"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be an accessor on Node.prototype`).toBeDefined();
      expect(typeof descriptor.get).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
    for (const name of ["getInnerHTML", "getHTML"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be a method on Node.prototype`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
    }
  });
});

describe.skipIf(!nativeAvailable)("T40 template content", () => {
  test("template content is a separate DocumentFragment, not an ordinary child", () => {
    const document = freshWindow().document;
    document.body.innerHTML = "<template><p>in</p></template>";
    const template = document.body.firstChild;

    expect(template.content.nodeType).toBe(11);
    expect(template.childNodes.length).toBe(0);
    expect(template.content.childNodes.length).toBe(1);
    expect(template.content.firstChild.nodeName).toBe("P");
    expect(template.content).toBe(template.content);
    expect(document.body.innerHTML).toBe("<template><p>in</p></template>");
  });

  test("template.innerHTML reads and writes the content fragment", () => {
    const document = freshWindow().document;
    document.body.innerHTML = "<template></template>";
    const template = document.body.firstChild;

    expect(template.innerHTML).toBe("");
    template.innerHTML = "<span>a</span><b>b</b>";
    expect(template.innerHTML).toBe("<span>a</span><b>b</b>");
    expect(template.content.childNodes.length).toBe(2);
    expect(template.childNodes.length).toBe(0);
    expect(document.body.innerHTML).toBe(
      "<template><span>a</span><b>b</b></template>",
    );
  });

  test("a createElement template has content from creation and serializes empty", () => {
    const document = freshWindow().document;
    const template = document.createElement("template");
    expect(template.content.nodeType).toBe(11);
    expect(template.content.childNodes.length).toBe(0);
    expect(template.outerHTML).toBe("<template></template>");
  });

  test("deep clone copies the content fragment; import/adopt carry it", () => {
    const document = freshWindow().document;
    document.body.innerHTML = "<template><p>in</p></template>";
    const template = document.body.firstChild;

    const clone = template.cloneNode(true);
    expect(clone.innerHTML).toBe("<p>in</p>");
    expect(clone.outerHTML).toBe("<template><p>in</p></template>");
    expect(clone.content).not.toBe(template.content);

    const imported = document.importNode(template, true);
    expect(imported.outerHTML).toBe("<template><p>in</p></template>");

    const other = freshWindow().document;
    const adopted = other.adoptNode(template);
    expect(adopted.outerHTML).toBe("<template><p>in</p></template>");
    expect(adopted.content.firstChild.nodeName).toBe("P");
  });
});

describe.skipIf(!nativeAvailable)("T40 input basics", () => {
  test("value/name/type/disabled reflections and the dirty value cell", () => {
    const document = freshWindow().document;
    document.body.innerHTML = '<input id="i" name="n" value="v">';
    const input = document.getElementById("i");

    expect(input.value).toBe("v");
    expect(input.name).toBe("n");
    expect(input.type).toBe("text");
    expect(input.disabled).toBe(false);

    input.value = "typed";
    expect(input.value).toBe("typed");
    expect(input.getAttribute("value")).toBe("v");

    input.value = "a\nb";
    expect(input.value).toBe("ab");
    input.disabled = true;
    expect(input.disabled).toBe(true);
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  test("checkbox/radio checked uses the dirty cell and the radio group is exclusive", () => {
    const document = freshWindow().document;
    document.body.innerHTML =
      '<input type="radio" name="g" id="r1" checked><input type="radio" name="g" id="r2">';
    const r1 = document.getElementById("r1");
    const r2 = document.getElementById("r2");

    expect(r1.checked).toBe(true);
    expect(r1.defaultChecked).toBe(true);
    expect(r2.checked).toBe(false);

    r2.checked = true;
    expect(r1.checked).toBe(false);
    expect(r2.checked).toBe(true);
    expect(r1.hasAttribute("checked")).toBe(true);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(checkbox.value).toBe("on");
    checkbox.value = "x";
    expect(checkbox.getAttribute("value")).toBe("x");
  });
});

describe.skipIf(!nativeAvailable)("T40 select/option/textarea basics", () => {
  test("select value/selectedIndex/options/selectedOptions and the selection model", () => {
    const document = freshWindow().document;
    document.body.innerHTML =
      '<select id="s"><option value="a">A</option><option value="b" selected>B</option><option>C</option></select>';
    const select = document.getElementById("s");

    expect(select.value).toBe("b");
    expect(select.selectedIndex).toBe(1);
    expect(select.options.length).toBe(3);
    expect(select.options[2].value).toBe("C");
    expect(select.selectedOptions.length).toBe(1);
    expect(select.type).toBe("select-one");

    select.value = "a";
    expect(select.value).toBe("a");
    expect(select.selectedIndex).toBe(0);

    select.selectedIndex = 2;
    expect(select.value).toBe("C");
    expect(select.selectedIndex).toBe(2);
  });

  test("option.selected/index/text and live options identity", () => {
    const document = freshWindow().document;
    document.body.innerHTML = '<select id="s"><option value="a">A</option><option>B</option></select>';
    const select = document.getElementById("s");
    const options = select.options;

    expect(options).toBe(select.options);
    expect(options[1].text).toBe("B");
    expect(options[1].value).toBe("B");
    expect(options[1].index).toBe(1);
    expect(options[0].selected).toBe(true);

    options[1].selected = true;
    expect(options[0].selected).toBe(false);
    expect(select.value).toBe("B");
    expect(select.selectedIndex).toBe(1);
  });

  test("textarea value/defaultValue and the dirty cell", () => {
    const document = freshWindow().document;
    document.body.innerHTML = "<textarea id=\"t\">default</textarea>";
    const textarea = document.getElementById("t");

    expect(textarea.value).toBe("default");
    expect(textarea.defaultValue).toBe("default");
    textarea.value = "typed";
    expect(textarea.value).toBe("typed");
    expect(textarea.textContent).toBe("default");
  });
});

describe.skipIf(!nativeAvailable)("T40 form.elements and reset", () => {
  test("form.elements is a live collection and namedItem works", () => {
    const document = freshWindow().document;
    document.body.innerHTML =
      '<form id="f"><input name="a"><select><option>o</option></select><button name="b"></button></form>';
    const form = document.getElementById("f");
    const elements = form.elements;

    expect(elements).toBe(form.elements);
    expect(elements.length).toBe(3);
    expect(elements.namedItem("a").nodeName).toBe("INPUT");
    expect(elements[0].nodeName).toBe("INPUT");
    expect(form.length).toBe(3);

    const extra = document.createElement("textarea");
    form.appendChild(extra);
    expect(elements.length).toBe(4);
    expect(form.length).toBe(4);
  });

  test("form.reset restores every control to its default", () => {
    const document = freshWindow().document;
    document.body.innerHTML =
      '<form id="f">' +
      '<input id="t" value="v">' +
      '<input id="c" type="checkbox" checked>' +
      '<textarea id="ta">d</textarea>' +
      '<select id="s"><option value="a">A</option><option value="b" selected>B</option></select>' +
      "</form>";
    const form = document.getElementById("f");
    const input = document.getElementById("t");
    const checkbox = document.getElementById("c");
    const textarea = document.getElementById("ta");
    const select = document.getElementById("s");

    input.value = "x";
    checkbox.checked = false;
    textarea.value = "y";
    select.value = "a";

    const resetEvents = [];
    form.addEventListener("reset", () => resetEvents.push("reset"));
    form.reset();

    expect(input.value).toBe("v");
    expect(checkbox.checked).toBe(true);
    expect(textarea.value).toBe("d");
    expect(select.value).toBe("b");
    expect(resetEvents).toEqual(["reset"]);
  });
});

describe.skipIf(!nativeAvailable)("T40 submit/reset event order", () => {
  test("requestSubmit dispatches a cancelable SubmitEvent with the submitter", () => {
    const document = freshWindow().document;
    document.body.innerHTML = '<form id="f"><button id="b" type="submit">Go</button></form>';
    const form = document.getElementById("f");
    const button = document.getElementById("b");

    const seen = [];
    form.addEventListener("submit", (event) => {
      seen.push(["submit", event.submitter === button, event.bubbles, event.cancelable]);
    });

    form.requestSubmit(button);
    expect(seen).toEqual([["submit", true, true, true]]);
  });

  test("a submit button click dispatches click then form submit", () => {
    const document = freshWindow().document;
    document.body.innerHTML = '<form id="f"><button id="b" type="submit">Go</button></form>';
    const form = document.getElementById("f");
    const button = document.getElementById("b");

    const seen = [];
    button.addEventListener("click", () => seen.push("click"));
    form.addEventListener("submit", () => seen.push("submit"));

    button.click();
    expect(seen).toEqual(["click", "submit"]);

    // preventDefault on the submit event stops the (unimplemented) navigation.
    seen.length = 0;
    form.addEventListener("submit", (event) => event.preventDefault());
    button.click();
    expect(seen).toEqual(["click", "submit"]);
  });

  test("a reset button click dispatches click then form reset", () => {
    const document = freshWindow().document;
    document.body.innerHTML = '<form id="f"><input id="i" value="v"><button id="b" type="reset">R</button></form>';
    const form = document.getElementById("f");
    const button = document.getElementById("b");
    const input = document.getElementById("i");

    input.value = "changed";
    const seen = [];
    button.addEventListener("click", () => seen.push("click"));
    form.addEventListener("reset", () => seen.push("reset"));

    button.click();
    expect(seen).toEqual(["click", "reset"]);
    expect(input.value).toBe("v");
  });

  test("a checkbox click toggles checked and dispatches input then change", () => {
    const document = freshWindow().document;
    document.body.innerHTML = '<form id="f"><input id="c" type="checkbox"></form>';
    const form = document.getElementById("f");
    const checkbox = document.getElementById("c");

    const seen = [];
    checkbox.addEventListener("click", () => seen.push("click"));
    checkbox.addEventListener("input", () => seen.push("input"));
    checkbox.addEventListener("change", () => seen.push("change"));

    checkbox.click();
    expect(checkbox.checked).toBe(true);
    expect(seen).toEqual(["click", "input", "change"]);

    // A default-prevented click restores the checkedness.
    const guarded = document.createElement("input");
    guarded.type = "checkbox";
    form.appendChild(guarded);
    guarded.addEventListener("click", (event) => event.preventDefault());
    guarded.click();
    expect(guarded.checked).toBe(false);
  });

  test("a disconnected submit button does not submit", () => {
    const document = freshWindow().document;
    const button = document.createElement("button");
    button.type = "submit";
    const seen = [];
    button.addEventListener("click", () => seen.push("click"));
    button.click();
    expect(seen).toEqual(["click"]);
  });
});

describe.skipIf(!nativeAvailable)("T40 window surface", () => {
  test("the form/template constructor accessors are exposed", () => {
    const win = freshWindow();
    for (const name of [
      "HTMLTemplateElement",
      "HTMLFormElement",
      "HTMLInputElement",
      "HTMLButtonElement",
      "HTMLSelectElement",
      "HTMLOptionElement",
      "HTMLTextAreaElement",
      "HTMLFormControlsCollection",
      "HTMLOptionsCollection",
      "SubmitEvent",
    ]) {
      expect(typeof win[name], `${name} must be exposed on the window`).toBe("function");
    }
  });

  test("SubmitEvent carries the submitter and the control.form reads the ancestor", () => {
    const win = freshWindow();
    const document = win.document;
    document.body.innerHTML = '<form id="f"><input id="i"><button id="b">x</button></form>';
    const form = document.getElementById("f");
    const input = document.getElementById("i");
    const button = document.getElementById("b");

    expect(input.form).toBe(form);
    expect(button.form).toBe(form);

    const event = new win.SubmitEvent("submit", { bubbles: true, submitter: button });
    expect(event instanceof win.SubmitEvent).toBe(true);
    expect(event.submitter).toBe(button);
    expect(event.bubbles).toBe(true);
  });
});
