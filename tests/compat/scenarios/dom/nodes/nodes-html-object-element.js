// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-object-element/HTMLObjectElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLObjectElement surface — the
// URL-resolved data getter with the raw-attribute setter, the name/height/
// width/type attribute reflections, the parent-form association, constraint
// validation (validity/validationMessage/willValidate/setCustomValidity/
// checkValidity/reportValidity) and tabIndex. The contentDocument/
// contentWindow reads (happy-dom null constant) and the `form="id"` external
// association are dropped (subframe surface / frozen facade deviation).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-object-element";
export const description = "real differential: public HTMLObjectElement data reflection, form association, validation, tabIndex";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window({ url: "https://localhost:8080/test/path/" });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const element = document.createElement("object");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // data getter resolves against the window location; setter writes raw.
    element.setAttribute("data", "test");
    api.record.value("data-relative", element.data);
    element.setAttribute("data", "https://example.com/file");
    api.record.value("data-absolute", element.data);
    element.removeAttribute("data");
    api.record.value("data-empty", element.data);
    element.data = "test";
    api.record.value("data-set-attr", element.getAttribute("data"));

    // name / height / width / type reflections.
    for (const property of ["name", "height", "width", "type"]) {
      element.setAttribute(property, "value");
      api.record.value(`get-${property}`, element[property]);
      element[property] = "value";
      api.record.value(`set-${property}`, element.getAttribute(property));
    }

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

    // tabIndex.
    const fresh = document.createElement("object");
    api.record.value("tabindex-default", fresh.tabIndex);
    fresh.setAttribute("tabindex", "5");
    api.record.value("tabindex-attr", fresh.tabIndex);
    fresh.setAttribute("tabindex", "invalid");
    api.record.value("tabindex-nan", fresh.tabIndex);
    fresh.tabIndex = 5;
    api.record.value("tabindex-set-5", fresh.getAttribute("tabindex"));
    fresh.tabIndex = -1;
    api.record.value("tabindex-set-neg", fresh.getAttribute("tabindex"));
    fresh.tabIndex = "invalid";
    api.record.value("tabindex-set-invalid", fresh.getAttribute("tabindex"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}
