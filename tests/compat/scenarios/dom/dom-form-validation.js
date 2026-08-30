// Real differential scenario (T40): the advanced form-validation gap.
//
// This scenario pins the *recorded gap*: constraint validation is **not**
// implemented in T40. happy-dom evaluates the WHATWG constraints (a `required`
// empty input makes `form.checkValidity()` return `false` and dispatches
// `invalid`; `validity` is a live `ValidityState`; `setCustomValidity` /
// `validationMessage` work), while MAD DOM returns `true` from
// `form.checkValidity()` / `form.reportValidity()` and exposes none of the
// per-control validation surface (`validity` / `validationMessage` /
// `setCustomValidity` / `willValidate` / `checkValidity` on controls).
//
// The divergence is recorded in the compatibility ledger as a known gap; the
// scenario runs in report mode (differences are non-fatal).
export const id = "dom-form-validation";
export const description = "real differential (known gap): constraint validation is not implemented in T40 — checkValidity/validity/setCustomValidity diverge";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    document.body.innerHTML = '<form id="f"><input id="i" required><button id="b" type="submit">Go</button></form>';
    const form = document.getElementById("f");
    const input = document.getElementById("i");

    // The whole form is invalid on happy-dom (required empty input); MAD DOM
    // has no constraint validation, so these diverge.
    api.record.value("form-check-validity", form.checkValidity());
    api.record.value("form-report-validity", form.reportValidity());
    api.record.value("control-check-validity-type", typeof input.checkValidity);
    api.record.value("control-validity-type", typeof input.validity);
    api.record.value("control-will-validate-type", typeof input.willValidate);
    api.record.value("control-validation-message-type", typeof input.validationMessage);
    api.record.value("control-set-custom-validity-type", typeof input.setCustomValidity);
    api.record.value("control-required", input.required);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
