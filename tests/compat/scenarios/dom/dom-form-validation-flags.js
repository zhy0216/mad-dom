// Real differential scenario (T48C): the ValidityState flag matrix.
//
// Pins the constraint evaluation for every flag happy-dom computes — the
// `badInput` number/range value shape, the `pattern` first-match strip, the
// `email`/`url` typeMismatch, the number/range `min`/`max` overflow/underflow,
// the number/range `step` mismatch (including the default integer step), the
// input/textarea `maxlength`/`minlength` tooLong/tooShort — across inputs set
// from markup and textareas. Each observed record carries the full flag set,
// the `validationMessage` and `willValidate`, so a deviation on any flag shows
// up as a difference path.
export const id = "dom-form-validation-flags";
export const description = "real differential (T48C): the ValidityState flag matrix (badInput / patternMismatch / typeMismatch / range / step / tooLong / tooShort) matches happy-dom";
export const targets = "real";

const FLAGS = [
  "badInput",
  "customError",
  "patternMismatch",
  "rangeOverflow",
  "rangeUnderflow",
  "stepMismatch",
  "tooLong",
  "tooShort",
  "typeMismatch",
  "valueMissing",
  "valid",
];

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
    document.body.innerHTML = [
      '<form id="f">',
      '<input id="email-bad" type="email" value="not-an-email">',
      '<input id="email-good" type="email" value="a@b.com">',
      '<input id="url-bad" type="url" value="nope">',
      '<input id="url-good" type="url" value="https://example.com">',
      '<input id="pat" pattern="[0-9]+" value="ab12">',
      '<input id="pat2" pattern="[0-9]+" value="123">',
      '<input id="num" type="number" value="abc">',
      '<input id="num2" type="number" value="12.5">',
      '<input id="range-min" type="range" min="0" max="10" value="-5">',
      '<input id="range-max" type="range" min="0" max="10" value="15">',
      '<input id="range-ok" type="range" min="0" max="10" value="5">',
      '<input id="step" type="number" step="2" value="3">',
      '<input id="step-any" type="number" step="any" value="3">',
      '<input id="step-def" type="number" value="3.5">',
      '<input id="too-long" maxlength="5" value="1234567">',
      '<input id="too-short" minlength="5" value="ab">',
      '<input id="len-ok" maxlength="5" minlength="2" value="abc">',
      '<textarea id="ta-long" maxlength="3">12345</textarea>',
      '<textarea id="ta-short" minlength="4">ab</textarea>',
      "</form>",
    ].join("");
    const form = document.getElementById("f");

    for (const control of form.elements) {
      const id = control.id;
      for (const flag of FLAGS) {
        api.record.value(`${id}.${flag}`, control.validity[flag]);
      }
      api.record.value(`${id}.message`, control.validationMessage);
      api.record.value(`${id}.willValidate`, control.willValidate);
      api.record.value(`${id}.checkValidity`, control.checkValidity());
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
