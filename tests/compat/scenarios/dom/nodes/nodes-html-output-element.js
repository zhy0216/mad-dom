// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-output-element/HTMLOutputElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLOutputElement surface — the
// defaultValue slot, the textContent-backed value getter/setter, the htmlFor /
// name attribute reflections, the constant "output" type, the parent-form
// association and constraint validation (validity/validationMessage/
// willValidate/setCustomValidity/checkValidity/reportValidity). The labels
// reads and the `form="id"` external association are dropped (label
// association surface not implemented / frozen facade deviation).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-output-element";
export const description = "real differential: public HTMLOutputElement defaultValue/value/htmlFor/name/type, form, validation";
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
    const element = document.createElement("output");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // defaultValue slot.
    api.record.value("defaultValue-default", element.defaultValue);
    element.defaultValue = "Test";
    api.record.value("defaultValue-set", element.defaultValue);

    // value / textContent round-trip.
    api.record.value("value-default", element.value);
    element.textContent = "test";
    api.record.value("value-textContent", element.value);
    element.value = "test";
    api.record.value("value-set-textContent", element.textContent);

    // htmlFor / name.
    api.record.value("htmlFor-default", element.htmlFor);
    element.setAttribute("for", "test1 test2");
    api.record.value("htmlFor-attr", element.htmlFor);
    element.htmlFor = "test";
    api.record.value("htmlFor-set", element.getAttribute("for"));
    api.record.value("name-default", element.name);
    element.setAttribute("name", "test");
    api.record.value("name-attr", element.name);
    element.name = "test";
    api.record.value("name-set", element.getAttribute("name"));

    // type constant.
    api.record.value("type", element.type);

    // form association (parent form only).
    api.record.value("form-none", element.form);
    const form = document.createElement("form");
    const div = document.createElement("div");
    div.appendChild(element);
    form.appendChild(div);
    api.record.identity("form-parent", element.form, form);

    // validation (never fails).
    api.record.value("validationMessage-default", element.validationMessage);
    element.setCustomValidity("Test message");
    api.record.value("validationMessage-custom", element.validationMessage);
    api.record.value("validity-valid", element.validity.valid);
    api.record.value("willValidate", element.willValidate);
    api.record.value("checkValidity", element.checkValidity());
    api.record.value("reportValidity", element.reportValidity());
  } catch (error) {
    api.record.error(error, "facade");
  }
}
