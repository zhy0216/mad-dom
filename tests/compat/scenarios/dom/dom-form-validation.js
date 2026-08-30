// Real differential scenario (T40, extended by T48C): constraint validation.
//
// T40 recorded this as the advanced form-validation gap. T48C implements the
// WHATWG machinery — the live per-control `validity` (`ValidityState`),
// `validationMessage`, `willValidate`, `setCustomValidity`, the control
// `checkValidity` / `reportValidity`, the `form.checkValidity()` /
// `reportValidity()` that evaluate the `required`/`type` constraints and
// dispatch the bubbling cancelable `invalid` event, and the `noValidate` /
// `formnovalidate` gate in the `requestSubmit` path. The scenario pins the
// observation-for-observation match with happy-dom: the flags, the live-ness,
// the custom-error path, the invalid event shape and document order, and the
// submit gating.
export const id = "dom-form-validation";
export const description = "real differential: WHATWG constraint validation (ValidityState / checkValidity / invalid event / noValidate submit gate) matches happy-dom";
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
    document.body.innerHTML = '<form id="f"><input id="i" required><button id="b" type="submit">Go</button></form>';
    const form = document.getElementById("f");
    const input = document.getElementById("i");

    // The whole form is invalid on both sides, and the per-control surface is
    // present with the happy-dom types.
    api.record.value("form-check-validity", form.checkValidity());
    api.record.value("form-report-validity", form.reportValidity());
    api.record.value("control-check-validity-type", typeof input.checkValidity);
    api.record.value("control-validity-type", typeof input.validity);
    api.record.value("control-will-validate-type", typeof input.willValidate);
    api.record.value("control-validation-message-type", typeof input.validationMessage);
    api.record.value("control-set-custom-validity-type", typeof input.setCustomValidity);
    api.record.value("control-required", input.required);

    // The live ValidityState flags for the required-empty input.
    api.record.value("flag-value-missing", input.validity.valueMissing);
    api.record.value("flag-valid", input.validity.valid);
    api.record.value("validation-message", input.validationMessage);
    api.record.value("will-validate", input.willValidate);
    api.record.value("control-check-validity", input.checkValidity());

    // Live-ness: filling the value flips the flags on the same validity object.
    input.value = "filled";
    api.record.value("after-fill-value-missing", input.validity.valueMissing);
    api.record.value("after-fill-valid", input.validity.valid);
    api.record.value("after-fill-message", input.validationMessage);
    api.record.value("after-fill-check-validity", input.checkValidity());
    input.value = "";

    // setCustomValidity drives customError / validationMessage; clearing it
    // restores the constraint-derived message.
    input.setCustomValidity("custom message");
    api.record.value("custom-error", input.validity.customError);
    api.record.value("custom-message", input.validationMessage);
    api.record.value("custom-check-validity", input.checkValidity());
    input.setCustomValidity("");
    api.record.value("cleared-custom-error", input.validity.customError);
    api.record.value("cleared-message", input.validationMessage);

    // Invalid dispatch: bubbles / cancelable / target, in document order.
    document.body.innerHTML = '<form id="f2"><input id="a" required><input id="b" required><input id="c"></form>';
    const form2 = document.getElementById("f2");
    form2.addEventListener("invalid", (event) => {
      api.record.event("invalid", {
        target: event.target.id,
        bubbles: event.bubbles,
        cancelable: event.cancelable,
        defaultPrevented: event.defaultPrevented,
      });
    });
    api.record.value("multi-invalid-form-valid", form2.checkValidity());

    // Submit path: an invalid form does not dispatch submit; a valid form,
    // a `novalidate` form and a `formnovalidate` submitter all do.
    document.body.innerHTML = '<form id="f3"><input id="x" required><button id="s" type="submit">go</button></form>';
    const form3 = document.getElementById("f3");
    const submit = document.getElementById("s");
    let submitEvents = 0;
    form3.addEventListener("submit", () => {
      submitEvents += 1;
    });
    form3.requestSubmit(submit);
    api.record.value("invalid-submit-count", submitEvents);
    document.getElementById("x").value = "ok";
    form3.requestSubmit(submit);
    api.record.value("valid-submit-count", submitEvents);

    document.body.innerHTML = '<form id="f4" novalidate><input id="y" required><button id="t" type="submit">go</button></form>';
    const form4 = document.getElementById("f4");
    const t = document.getElementById("t");
    let submitEvents4 = 0;
    form4.addEventListener("submit", () => {
      submitEvents4 += 1;
    });
    form4.requestSubmit(t);
    api.record.value("novalidate-submit-count", submitEvents4);

    document.body.innerHTML = '<form id="f5"><input id="z" required><button id="u" type="submit" formnovalidate>go</button></form>';
    const form5 = document.getElementById("f5");
    const u = document.getElementById("u");
    let submitEvents5 = 0;
    form5.addEventListener("submit", () => {
      submitEvents5 += 1;
    });
    form5.requestSubmit(u);
    api.record.value("formnovalidate-submit-count", submitEvents5);

    // willValidate exclusions: disabled / hidden / readonly controls are not
    // candidates; a plain required control is.
    document.body.innerHTML = '<form id="f6"><input id="w1" disabled required><input id="w2" type="hidden" required><input id="w3" readonly required><input id="w4" required></form>';
    const form6 = document.getElementById("f6");
    for (const id of ["w1", "w2", "w3", "w4"]) {
      const element = document.getElementById(id);
      api.record.value(`will-validate-${id}`, element.willValidate);
    }
    api.record.value("excluded-form-valid", form6.checkValidity());
  } catch (error) {
    api.record.error(error, "facade");
  }
}
