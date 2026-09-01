// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-input-element/HTMLInputElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLInputElement surface — the
// type/checked/defaultChecked/dirty-value cells (text-like newline removal,
// checkbox/radio "on" default, button-like attribute reflection, the null/
// undefined value coercion), the boolean and string reflections
// (disabled/required/readOnly/multiple/autofocus, name/alt/accept/allowdirs/
// autocomplete/min/max/pattern/placeholder/step/inputMode/src), the
// height/width slots (default 0, not attribute-reflected), size/minLength/
// maxLength, indeterminate, the parent-form association, list (datalist),
// the form-action family, constraint validation
// (validity/validationMessage/willValidate/setCustomValidity/checkValidity/
// reportValidity incl. the "invalid" event), the popover target reflections,
// tabIndex, and the checkbox/radio click default actions (toggle + input/
// change order + preventDefault restore) and the submit/reset button clicks.
// The value sanitizers for email/number/range/date/time/color, the
// valueAsNumber/valueAsDate cells, selectionStart/End/Direction,
// select/setSelectionRange/setRangeText, stepUp/stepDown, labels and the
// `form`-attribute association are dropped (frozen facade deviations /
// not-implemented surface, noted in the file header).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-input-element";
export const description = "real differential: public HTMLInputElement value/checked cells, reflections, list, validation, popover targets, click actions";
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
    const element = document.createElement("input");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // type getter / setter (invalid falls back to "text", raw attribute kept).
    api.record.value("type-default", element.type);
    element.setAttribute("type", "date");
    api.record.value("type-attr", element.type);
    element.setAttribute("type", "123");
    api.record.value("type-invalid", element.type);
    api.record.value("type-invalid-raw-attr", element.getAttribute("type"));
    element.type = "date";
    api.record.value("type-set-attr", element.getAttribute("type"));

    // value reflection per type.
    for (const type of ["hidden", "submit", "image", "reset", "button"]) {
      element.type = type;
      element.setAttribute("value", "VALUE");
      api.record.value(`value-${type}`, element.value);
    }
    for (const type of ["checkbox", "radio"]) {
      element.type = type;
      element.removeAttribute("value");
      api.record.value(`value-${type}-default`, element.value);
      element.setAttribute("value", "VALUE");
      api.record.value(`value-${type}-attr`, element.value);
    }
    element.type = "text";
    element.setAttribute("value", "VALUE");
    api.record.value("value-text-attr", element.value);
    element.value = "\n\rVALUE\n\r";
    api.record.value("value-text-dirty", element.value);
    api.record.value("value-text-attr-untouched", element.getAttribute("value"));
    element.value = null;
    api.record.value("value-text-null", element.value);
    element.value = undefined;
    api.record.value("value-text-undefined", element.value);

    // boolean reflections (the readOnly attribute name is written lowercase —
    // happy-dom normalizes attribute names on write, mad-dom keeps them
    // as-given).
    for (const [property, attribute] of [
      ["disabled", "disabled"],
      ["autofocus", "autofocus"],
      ["required", "required"],
      ["multiple", "multiple"],
      ["readOnly", "readonly"],
    ]) {
      const el = document.createElement("input");
      api.record.value(`bool-${property}-default`, el[property]);
      el.setAttribute(attribute, "");
      api.record.value(`bool-${property}-attr`, el[property]);
      el[property] = true;
      api.record.value(`bool-${property}-set`, el.getAttribute(attribute));
    }

    // string reflections.
    for (const property of ["name", "alt", "src", "accept", "allowdirs", "autocomplete", "min", "max", "pattern", "placeholder", "step", "inputMode"]) {
      const el = document.createElement("input");
      api.record.value(`str-${property}-default`, el[property]);
      el.setAttribute(property, "value");
      api.record.value(`str-${property}-attr`, el[property]);
      el[property] = "value";
      api.record.value(`str-${property}-set`, el.getAttribute(property));
    }

    // height / width slots (default 0, not attribute-reflected) and size.
    api.record.value("height-default", element.height);
    element.height = 20;
    api.record.value("height-set", element.height);
    api.record.value("height-attr", element.getAttribute("height"));
    element.setAttribute("height", "50");
    api.record.value("height-attr-ignored", element.height);
    api.record.value("width-default", element.width);
    element.width = 20;
    api.record.value("width-set", element.width);
    api.record.value("size-default", element.size);
    element.size = 50;
    api.record.value("size-set", element.size);
    api.record.value("size-attr", element.getAttribute("size"));

    // minLength / maxLength.
    api.record.value("minLength-default", element.minLength);
    element.minLength = 50;
    api.record.value("minLength-set", element.minLength);
    api.record.value("minLength-attr", element.getAttribute("minlength"));
    api.record.value("maxLength-default", element.maxLength);
    element.maxLength = 50;
    api.record.value("maxLength-set", element.maxLength);
    api.record.value("maxLength-attr", element.getAttribute("maxlength"));

    // checked / defaultChecked + radio group exclusivity.
    const checkedEl = document.createElement("input");
    checkedEl.setAttribute("checked", "");
    api.record.value("checked-attr", checkedEl.checked);
    checkedEl.checked = false;
    api.record.value("checked-after-set", checkedEl.checked);
    api.record.value("defaultChecked-default", checkedEl.defaultChecked);
    checkedEl.defaultChecked = true;
    api.record.value("defaultChecked-set-attr", checkedEl.getAttribute("checked"));
    checkedEl.defaultChecked = false;
    api.record.value("defaultChecked-set-false-attr", checkedEl.getAttribute("checked"));
    const form = document.createElement("form");
    const radio1 = document.createElement("input");
    const radio2 = document.createElement("input");
    const radio3 = document.createElement("input");
    radio1.type = "radio";
    radio2.type = "radio";
    radio3.type = "radio";
    radio1.name = "radio";
    radio2.name = "radio";
    radio3.name = "radio";
    form.appendChild(radio1);
    form.appendChild(radio2);
    form.appendChild(radio3);
    radio1.checked = true;
    api.record.value("radio1-checked", radio1.checked);
    api.record.value("radio2-checked", radio2.checked);
    radio2.checked = true;
    api.record.value("radio1-after-group", radio1.checked);
    api.record.value("radio2-after-group", radio2.checked);

    // indeterminate (property slot, no attribute).
    const indet = document.createElement("input");
    indet.type = "checkbox";
    api.record.value("indeterminate-default", indet.indeterminate);
    api.record.value("indeterminate-no-attr", indet.hasAttribute("indeterminate"));
    indet.indeterminate = true;
    api.record.value("indeterminate-set", indet.indeterminate);
    api.record.value("indeterminate-attr-untouched", indet.hasAttribute("indeterminate"));

    // form association (parent form only).
    const parentForm = document.createElement("form");
    const div = document.createElement("div");
    div.appendChild(element);
    parentForm.appendChild(div);
    api.record.identity("form-parent", element.form, parentForm);

    // list (datalist).
    api.record.value("list-none", element.list);
    const datalist = document.createElement("datalist");
    datalist.id = "list_id";
    document.body.appendChild(datalist);
    const listed = document.createElement("input");
    listed.setAttribute("list", "list_id");
    api.record.identity("list-associated", listed.list, datalist);
    listed.setAttribute("list", "missing");
    api.record.value("list-missing", listed.list);

    // form-action family.
    api.record.value("formAction-default", element.formAction);
    element.setAttribute("formaction", "/test/");
    api.record.value("formAction-relative", element.formAction);
    window.happyDOM.setURL("https://localhost/path/");
    api.record.value("formAction-relative-after-seturl", element.formAction);
    element.setAttribute("formaction", "https://example.com");
    api.record.value("formAction-absolute", element.formAction);
    element.formAction = "/test/";
    api.record.value("formAction-set-attr", element.getAttribute("formaction"));
    api.record.value("formEnctype-default", element.formEnctype);
    element.formEnctype = "value";
    api.record.value("formEnctype-set", element.getAttribute("formenctype"));
    api.record.value("formMethod-default", element.formMethod);
    element.formMethod = "value";
    api.record.value("formMethod-set", element.getAttribute("formmethod"));
    api.record.value("formNoValidate-default", element.formNoValidate);
    element.formNoValidate = true;
    api.record.value("formNoValidate-set", element.getAttribute("formnovalidate"));
    api.record.value("formTarget-default", element.formTarget);
    element.formTarget = "value";
    api.record.value("formTarget-set", element.getAttribute("formtarget"));

    // validation.
    const req = document.createElement("input");
    req.required = true;
    api.record.value("validationMessage-required-empty", req.validationMessage);
    req.value = "test";
    api.record.value("validationMessage-required-filled", req.validationMessage);
    req.value = "";
    req.setCustomValidity("Custom error");
    api.record.value("validationMessage-custom", req.validationMessage);
    req.disabled = true;
    api.record.value("validationMessage-disabled", req.validationMessage);
    const enabled = document.createElement("input");
    api.record.value("willValidate-enabled", enabled.willValidate);
    enabled.disabled = true;
    api.record.value("willValidate-disabled", enabled.willValidate);
    const readOnly = document.createElement("input");
    readOnly.readOnly = true;
    api.record.value("willValidate-readonly", readOnly.willValidate);
    const hiddenType = document.createElement("input");
    hiddenType.type = "hidden";
    api.record.value("willValidate-hidden", hiddenType.willValidate);
    api.record.value("validity-valid", enabled.validity.valid);

    // setCustomValidity null / empty.
    const scv = document.createElement("input");
    scv.setCustomValidity("Error message");
    scv.setCustomValidity(null);
    api.record.value("setCustomValidity-null", scv.validationMessage);
    scv.setCustomValidity("");
    api.record.value("setCustomValidity-empty", scv.validationMessage);

    // checkValidity / reportValidity + invalid event.
    const inv = document.createElement("input");
    inv.required = true;
    let invalidEvent = null;
    inv.addEventListener("invalid", (event) => (invalidEvent = event.type));
    api.record.value("checkValidity-invalid", inv.checkValidity());
    api.record.value("invalid-event-type", invalidEvent);
    inv.required = false;
    api.record.value("reportValidity-valid", inv.reportValidity());

    // popover target reflections.
    api.record.value("popoverTargetElement-default", element.popoverTargetElement);
    const target = document.createElement("div");
    element.popoverTargetElement = target;
    api.record.identity("popoverTargetElement-set", element.popoverTargetElement, target);
    let popoverTypeError = null;
    try {
      element.popoverTargetElement = "test";
    } catch (error) {
      popoverTypeError = `${error.name}: ${error.message}`;
    }
    api.record.value("popoverTargetElement-typeerror", popoverTypeError);
    api.record.value("popoverTargetAction-default", element.popoverTargetAction);
    element.setAttribute("popovertargetaction", "hide");
    api.record.value("popoverTargetAction-hide", element.popoverTargetAction);
    element.setAttribute("popovertargetaction", "invalid");
    api.record.value("popoverTargetAction-invalid", element.popoverTargetAction);

    // tabIndex.
    const fresh = document.createElement("input");
    api.record.value("tabindex-default", fresh.tabIndex);
    fresh.setAttribute("tabindex", "5");
    api.record.value("tabindex-attr", fresh.tabIndex);
    fresh.setAttribute("tabindex", "invalid");
    api.record.value("tabindex-nan", fresh.tabIndex);
    fresh.tabIndex = 5;
    api.record.value("tabindex-set-5", fresh.getAttribute("tabindex"));
    fresh.tabIndex = "invalid";
    api.record.value("tabindex-set-invalid", fresh.getAttribute("tabindex"));

    // checkbox click toggle + input/change order + preventDefault restore.
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.appendChild(checkbox);
    const checkboxOrder = [];
    checkbox.addEventListener("click", () => checkboxOrder.push("click"));
    checkbox.addEventListener("input", () => checkboxOrder.push("input"));
    checkbox.addEventListener("change", () => checkboxOrder.push("change"));
    checkbox.click();
    api.record.value("checkbox-click-order", checkboxOrder);
    api.record.value("checkbox-clicked-checked", checkbox.checked);
    const guarded = document.createElement("input");
    guarded.type = "checkbox";
    document.body.appendChild(guarded);
    guarded.addEventListener("click", (event) => event.preventDefault());
    guarded.click();
    api.record.value("checkbox-prevented-checked", guarded.checked);
    const radio = document.createElement("input");
    radio.type = "radio";
    document.body.appendChild(radio);
    radio.click();
    api.record.value("radio-clicked-checked", radio.checked);

    // submit / reset button clicks.
    const submitForm = document.createElement("form");
    const submitButton = document.createElement("input");
    submitButton.type = "submit";
    submitForm.appendChild(submitButton);
    document.body.appendChild(submitForm);
    let submitTriggered = 0;
    let submitterIsButton = null;
    submitForm.addEventListener("submit", (event) => {
      submitTriggered++;
      submitterIsButton = event.submitter === submitButton;
    });
    submitButton.click();
    api.record.value("submit-triggered", submitTriggered);
    api.record.value("submit-submitter", submitterIsButton);

    const resetForm = document.createElement("form");
    const resetButton = document.createElement("input");
    resetButton.type = "reset";
    resetForm.appendChild(resetButton);
    document.body.appendChild(resetForm);
    let resetTriggered = 0;
    resetForm.addEventListener("reset", () => resetTriggered++);
    resetButton.click();
    api.record.value("reset-triggered", resetTriggered);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
