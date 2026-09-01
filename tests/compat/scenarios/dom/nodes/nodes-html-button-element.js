// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-button-element/HTMLButtonElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLButtonElement surface — value/
// name/disabled/type reflection (with the submit/reset/button/menu type
// sanitization), the form-action family (formAction/formEnctype/formMethod/
// formNoValidate/formTarget), the parent-form association, constraint
// validation (validity/validationMessage/willValidate/setCustomValidity/
// checkValidity/reportValidity incl. the "invalid" event), the popover target
// reflections, tabIndex and the submit/reset click default actions. The
// `form.elements[name]` / `children[name]` named-access and the `form="id"`
// external-form-association assertions are dropped (frozen facade deviations),
// as are the labels assertions (label association surface not implemented).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-button-element";
export const description = "real differential: public HTMLButtonElement reflections, form-action family, validation, popover targets, submit/reset";
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
    const element = document.createElement("button");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // value / name / disabled.
    element.setAttribute("value", "VALUE");
    api.record.value("value-get", element.value);
    element.value = "VALUE";
    api.record.value("value-set", element.getAttribute("value"));
    element.setAttribute("name", "VALUE");
    api.record.value("name-get", element.name);
    element.name = "VALUE";
    api.record.value("name-set", element.getAttribute("name"));
    api.record.value("disabled-default", element.disabled);
    element.setAttribute("disabled", "");
    api.record.value("disabled-attr", element.disabled);
    element.disabled = false;
    api.record.value("disabled-false-attr", element.getAttribute("disabled"));
    element.disabled = true;
    api.record.value("disabled-true-attr", element.getAttribute("disabled"));

    // type reflection + sanitization.
    api.record.value("type-default", element.type);
    element.setAttribute("type", "menu");
    api.record.value("type-menu", element.type);
    element.setAttribute("type", "reset");
    api.record.value("type-reset", element.type);
    element.setAttribute("type", "button");
    api.record.value("type-button", element.type);
    element.setAttribute("type", "MeNu");
    api.record.value("type-sanitized", element.type);
    element.setAttribute("type", "foobar");
    api.record.value("type-invalid", element.type);
    element.type = "SuBmIt";
    api.record.value("type-set-raw", element.getAttribute("type"));
    element.type = "menu";
    api.record.value("type-set-menu", element.getAttribute("type"));

    // formAction (defaults to the document location; setURL re-bases).
    api.record.value("formAction-default", element.formAction);
    element.setAttribute("formaction", "/test/");
    api.record.value("formAction-relative-about-blank", element.formAction);
    window.happyDOM.setURL("https://localhost/path/");
    api.record.value("formAction-relative-after-seturl", element.formAction);
    element.setAttribute("formaction", "https://example.com");
    api.record.value("formAction-absolute", element.formAction);
    element.formAction = "/test/";
    api.record.value("formAction-set-attr", element.getAttribute("formaction"));

    // formEnctype / formMethod / formNoValidate / formTarget.
    api.record.value("formEnctype-default", element.formEnctype);
    element.setAttribute("formenctype", "value");
    api.record.value("formEnctype-get", element.formEnctype);
    element.formEnctype = "value";
    api.record.value("formEnctype-set", element.getAttribute("formenctype"));
    api.record.value("formMethod-default", element.formMethod);
    element.setAttribute("formmethod", "value");
    api.record.value("formMethod-get", element.formMethod);
    element.formMethod = "value";
    api.record.value("formMethod-set", element.getAttribute("formmethod"));
    api.record.value("formNoValidate-default", element.formNoValidate);
    element.setAttribute("formnovalidate", "");
    api.record.value("formNoValidate-attr", element.formNoValidate);
    element.formNoValidate = true;
    api.record.value("formNoValidate-set", element.getAttribute("formnovalidate"));
    api.record.value("formTarget-default", element.formTarget);
    element.setAttribute("formtarget", "value");
    api.record.value("formTarget-get", element.formTarget);
    element.formTarget = "value";
    api.record.value("formTarget-set", element.getAttribute("formtarget"));

    // form association (parent form only).
    api.record.value("form-none", element.form);
    const form = document.createElement("form");
    const div = document.createElement("div");
    div.appendChild(element);
    form.appendChild(div);
    api.record.identity("form-parent", element.form, form);

    // validation.
    element.setCustomValidity("Error message");
    api.record.value("validationMessage-custom", element.validationMessage);
    api.record.value("validity-valid", element.validity.valid);
    api.record.value("willValidate-enabled", element.willValidate);
    element.disabled = true;
    api.record.value("willValidate-disabled", element.willValidate);
    api.record.value("validationMessage-disabled", element.validationMessage);
    element.disabled = false;

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
    element.setAttribute("popovertargetaction", "show");
    api.record.value("popoverTargetAction-show", element.popoverTargetAction);
    element.setAttribute("popovertargetaction", "toggle");
    api.record.value("popoverTargetAction-toggle", element.popoverTargetAction);
    element.setAttribute("popovertargetaction", "invalid");
    api.record.value("popoverTargetAction-invalid", element.popoverTargetAction);
    element.popoverTargetAction = "hide";
    api.record.value("popoverTargetAction-set", element.getAttribute("popovertargetaction"));

    // tabIndex.
    const fresh = document.createElement("button");
    api.record.value("tabindex-default", fresh.tabIndex);
    fresh.setAttribute("tabindex", "5");
    api.record.value("tabindex-attr", fresh.tabIndex);
    fresh.setAttribute("tabindex", "invalid");
    api.record.value("tabindex-nan", fresh.tabIndex);
    fresh.tabIndex = 5;
    api.record.value("tabindex-set-5", fresh.getAttribute("tabindex"));
    fresh.tabIndex = "invalid";
    api.record.value("tabindex-set-invalid", fresh.getAttribute("tabindex"));

    // setCustomValidity null / empty.
    element.setCustomValidity("Error message");
    element.setCustomValidity(null);
    api.record.value("setCustomValidity-null", element.validationMessage);
    element.setCustomValidity("");
    api.record.value("setCustomValidity-empty", element.validationMessage);

    // checkValidity / reportValidity.
    element.setCustomValidity("error");
    api.record.value("checkValidity-custom-error", element.checkValidity());
    const fresh2 = document.createElement("button");
    let invalidEvent = null;
    fresh2.setCustomValidity("error");
    fresh2.addEventListener("invalid", (event) => (invalidEvent = event.type));
    api.record.value("reportValidity-custom-error", fresh2.reportValidity());
    api.record.value("invalid-event-type", invalidEvent);
    fresh2.disabled = true;
    api.record.value("reportValidity-disabled", fresh2.reportValidity());

    // submit / reset click default actions.
    const submitForm = document.createElement("form");
    const submitButton = document.createElement("button");
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
    const resetButton = document.createElement("button");
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
