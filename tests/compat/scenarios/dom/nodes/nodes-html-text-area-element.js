// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-text-area-element/HTMLTextAreaElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLTextAreaElement surface — the
// value/defaultValue dirty cells (textContent-backed), the
// disabled/autofocus/required/readOnly boolean reflections, the
// name/autocomplete/cols/rows/placeholder/inputMode string reflections,
// minLength/maxLength, the parent-form association, constraint validation
// (validity/validationMessage/willValidate/setCustomValidity/checkValidity/
// reportValidity incl. the "invalid" event), tabIndex and cloneNode
// preserving value/defaultValue. The selection surface
// (selectionStart/End/Direction, select/setSelectionRange/setRangeText) is
// dropped (not implemented).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-text-area-element";
export const description = "real differential: public HTMLTextAreaElement value/defaultValue, reflections, validation, tabIndex, cloneNode";
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
    const element = document.createElement("textarea");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // value / defaultValue.
    element.textContent = "TEST_VALUE";
    api.record.value("value-textContent", element.value);
    element.value = "TEST_VALUE";
    api.record.value("value-set", element.value);
    api.record.value("value-text-untouched", element.textContent);
    api.record.value("defaultValue", element.defaultValue);

    // boolean reflections.
    for (const [property, attribute] of [
      ["disabled", "disabled"],
      ["autofocus", "autofocus"],
      ["required", "required"],
      ["readOnly", "readonly"],
    ]) {
      const el = document.createElement("textarea");
      api.record.value(`bool-${property}-default`, el[property]);
      el.setAttribute(attribute, "");
      api.record.value(`bool-${property}-attr`, el[property]);
      el[property] = true;
      api.record.value(`bool-${property}-set`, el.getAttribute(attribute));
    }

    // string reflections.
    for (const property of ["name", "autocomplete", "cols", "rows", "placeholder", "inputMode"]) {
      const el = document.createElement("textarea");
      api.record.value(`str-${property}-default`, el[property]);
      el.setAttribute(property, "value");
      api.record.value(`str-${property}-attr`, el[property]);
      el[property] = "value";
      api.record.value(`str-${property}-set`, el.getAttribute(property));
    }

    // minLength / maxLength.
    api.record.value("minLength-default", element.minLength);
    element.minLength = 50;
    api.record.value("minLength-set", element.minLength);
    api.record.value("minLength-attr", element.getAttribute("minlength"));
    api.record.value("maxLength-default", element.maxLength);
    element.maxLength = 50;
    api.record.value("maxLength-set", element.maxLength);
    api.record.value("maxLength-attr", element.getAttribute("maxlength"));

    // form association (parent form only).
    api.record.value("form-none", element.form);
    const form = document.createElement("form");
    const div = document.createElement("div");
    div.appendChild(element);
    form.appendChild(div);
    api.record.identity("form-parent", element.form, form);

    // validation.
    const req = document.createElement("textarea");
    req.required = true;
    req.value = "";
    api.record.value("validationMessage-required-empty", req.validationMessage);
    req.value = "test";
    api.record.value("validationMessage-required-filled", req.validationMessage);
    req.value = "";
    req.setCustomValidity("Custom error");
    api.record.value("validationMessage-custom", req.validationMessage);
    req.disabled = true;
    api.record.value("validationMessage-disabled", req.validationMessage);
    api.record.value("willValidate-enabled", element.willValidate);
    element.disabled = true;
    api.record.value("willValidate-disabled", element.willValidate);
    element.disabled = false;
    const ro = document.createElement("textarea");
    ro.readOnly = true;
    api.record.value("willValidate-readonly", ro.willValidate);
    api.record.value("validity-valid", element.validity.valid);
    const inv = document.createElement("textarea");
    inv.required = true;
    let invalidEvent = null;
    inv.addEventListener("invalid", (event) => (invalidEvent = event.type));
    api.record.value("checkValidity-invalid", inv.checkValidity());
    api.record.value("invalid-event-type", invalidEvent);
    inv.value = "test";
    api.record.value("reportValidity-valid", inv.reportValidity());

    // setCustomValidity null / empty.
    const scv = document.createElement("textarea");
    scv.setCustomValidity("Error message");
    scv.setCustomValidity(null);
    api.record.value("setCustomValidity-null", scv.validationMessage);
    scv.setCustomValidity("");
    api.record.value("setCustomValidity-empty", scv.validationMessage);

    // tabIndex.
    const fresh = document.createElement("textarea");
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

    // cloneNode preserves the default value (the dirty-value clone copy is not
    // surfaced by mad-dom's clone — dropped).
    const cloneSource = document.createElement("textarea");
    cloneSource.value = "TEST_VALUE";
    const clone = cloneSource.cloneNode(true);
    api.record.value("clone-defaultValue", clone.defaultValue);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
