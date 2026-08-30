// Real differential scenario (T40): the first-batch form-control contract.
//
// Scope is exactly the T40 form slice — input/button/select/option/textarea
// value/name/disabled/checked/selected basics (with the dirty value/checked
// cells kept out of the attribute list), the select/option selection model,
// the live `form.elements` / `select.options` / `select.selectedOptions`
// collections, `form.method`/`action`/`enctype`/`acceptCharset`/`noValidate`
// attribute reflections, `control.form`, and the submit/reset event order
// (`requestSubmit` with its `SubmitEvent.submitter`, submit/reset button
// clicks, checkbox click toggle + `input`/`change`, and `form.reset()`
// restoring the defaults).
//
// The scenario deliberately avoids the frozen T40 deviations (pinned by the
// Bun tests instead): constraint validation (`checkValidity` / `validity` /
// `setCustomValidity` — MAD DOM returns `true` with no validation), the
// `form`-attribute external association, `select.add`/`remove`,
// `form[name]` named access, per-tag `instanceof window.HTMLInputElement`,
// the date/time/color value sanitizers and `input.tabIndex` (MAD DOM keeps the
// generic `-1` default). `form.action` is always set explicitly (happy-dom
// reads `location.href` when absent, MAD DOM has no location).
export const id = "dom-form-controls";
export const description = "real differential: input/button/select/option/textarea basics, live form collections, submit/reset event order";
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
    document.body.innerHTML =
      '<form id="f" action="https://example.com/submit" method="post" enctype="multipart/form-data" acceptcharset="utf-8">' +
      '<input id="i" name="n" value="v">' +
      '<input id="c" type="checkbox" checked>' +
      '<input id="r1" type="radio" name="g" checked>' +
      '<input id="r2" type="radio" name="g">' +
      '<select id="s"><option value="a">A</option><option value="b" selected>B</option><option>C</option></select>' +
      '<textarea id="t">default</textarea>' +
      '<button id="go" type="submit" name="go" value="Go">Go</button>' +
      '<button id="rs" type="reset">R</button>' +
      "</form>";
    const form = document.getElementById("f");
    const input = document.getElementById("i");
    const checkbox = document.getElementById("c");
    const radio1 = document.getElementById("r1");
    const radio2 = document.getElementById("r2");
    const select = document.getElementById("s");
    const textarea = document.getElementById("t");
    const goButton = document.getElementById("go");
    const resetButton = document.getElementById("rs");

    // --- input value/name/type/disabled/checked reflections + dirty cell ---
    api.record.value("input-value", input.value);
    api.record.value("input-name", input.name);
    api.record.value("input-type", input.type);
    api.record.value("input-disabled", input.disabled);
    input.value = "typed";
    api.record.value("input-dirty-value", input.value);
    api.record.value("input-value-attr-untouched", input.getAttribute("value"));
    input.value = "a\nb";
    api.record.value("input-sanitized-newlines", input.value);
    input.disabled = true;
    api.record.value("input-disabled-after-set", input.disabled);
    api.record.value("input-disabled-attr", input.hasAttribute("disabled"));

    // --- checkbox / radio checked (dirty cell + radio group exclusivity) ---
    api.record.value("checkbox-checked", checkbox.checked);
    api.record.value("checkbox-default-checked", checkbox.defaultChecked);
    checkbox.checked = false;
    api.record.value("checkbox-after-set", checkbox.checked);
    api.record.value("checkbox-attr-untouched", checkbox.hasAttribute("checked"));
    checkbox.checked = true;
    api.record.value("checkbox-restored", checkbox.checked);
    radio2.checked = true;
    api.record.value("radio2-checked", radio2.checked);
    api.record.value("radio1-checked-after-group", radio1.checked);

    // --- select value/selectedIndex/options/selectedOptions + option reads ---
    api.record.value("select-value", select.value);
    api.record.value("select-selected-index", select.selectedIndex);
    api.record.value("select-type", select.type);
    api.record.value("select-options-length", select.options.length);
    api.record.value("option-b-selected", select.options[1].selected);
    api.record.value("option-b-index", select.options[1].index);
    api.record.value("option-b-value", select.options[1].value);
    api.record.value("option-c-value", select.options[2].value);
    api.record.value("option-c-text", select.options[2].text);
    api.record.value("selected-options-length", select.selectedOptions.length);
    api.record.identity("options-identity", select.options, select.options);

    select.value = "a";
    api.record.value("select-after-value-set", select.value);
    api.record.value("select-index-after-value-set", select.selectedIndex);
    select.selectedIndex = 2;
    api.record.value("select-after-index-set", select.value);
    api.record.value("select-index-after-set", select.selectedIndex);
    select.options[1].selected = true;
    api.record.value("select-after-option-set", select.value);
    api.record.value("option-a-selected-after", select.options[0].selected);

    // --- textarea value/defaultValue (dirty cell) ---
    api.record.value("textarea-value", textarea.value);
    api.record.value("textarea-default-value", textarea.defaultValue);
    textarea.value = "typed";
    api.record.value("textarea-dirty-value", textarea.value);
    api.record.value("textarea-text-untouched", textarea.textContent);

    // --- button value/name/type + control.form ---
    api.record.value("button-value", goButton.value);
    api.record.value("button-name", goButton.name);
    api.record.value("button-type", goButton.type);
    api.record.value("reset-button-type", resetButton.type);
    api.record.identity("input-form", input.form, form);
    api.record.identity("select-form", select.form, form);
    api.record.identity("button-form", goButton.form, form);

    // --- form attribute reflections + live elements collection ---
    api.record.value("form-name", form.name);
    api.record.value("form-method", form.method);
    api.record.value("form-action", form.action);
    api.record.value("form-enctype", form.enctype);
    api.record.value("form-accept-charset", form.acceptCharset);
    api.record.value("form-no-validate", form.noValidate);
    api.record.value("form-length", form.length);
    const elements = form.elements;
    api.record.identity("elements-identity", elements, form.elements);
    api.record.value("elements-length", elements.length);
    api.record.value("elements-named-type", elements.namedItem("n").nodeType);
    api.record.value("elements-indexed-type", elements[0].nodeType);
    const appended = document.createElement("textarea");
    appended.name = "extra";
    form.appendChild(appended);
    api.record.value("elements-length-after-append", elements.length);
    api.record.value("form-length-after-append", form.length);
    form.removeChild(appended);

    // --- submit event order (requestSubmit + submit button click) ---
    const submitOrder = [];
    form.addEventListener("submit", (event) =>
      submitOrder.push(`submit:${event.submitter === goButton ? "button" : "form"}`),
    );
    form.requestSubmit(goButton);
    api.record.value("request-submit-order", submitOrder.slice());
    submitOrder.length = 0;
    const clickOrder = [];
    goButton.addEventListener("click", () => clickOrder.push("click"));
    goButton.click();
    api.record.value("submit-click-order", [...clickOrder, ...submitOrder]);
    submitOrder.length = 0;
    clickOrder.length = 0;
    form.addEventListener("submit", (event) => event.preventDefault());
    goButton.click();
    api.record.value("submit-prevented-order", [...clickOrder, ...submitOrder]);

    // --- reset event order + control restoration ---
    input.value = "changed";
    checkbox.checked = false;
    textarea.value = "changed";
    select.value = "a";
    const resetOrder = [];
    resetButton.addEventListener("click", () => resetOrder.push("click"));
    form.addEventListener("reset", () => resetOrder.push("reset"));
    resetButton.click();
    api.record.value("reset-click-order", resetOrder);
    api.record.value("reset-input", input.value);
    api.record.value("reset-checkbox", checkbox.checked);
    api.record.value("reset-textarea", textarea.value);
    api.record.value("reset-select", select.value);

    // --- checkbox click toggle + input/change order ---
    const freshCheckbox = document.createElement("input");
    freshCheckbox.type = "checkbox";
    form.appendChild(freshCheckbox);
    const checkboxOrder = [];
    freshCheckbox.addEventListener("click", () => checkboxOrder.push("click"));
    freshCheckbox.addEventListener("input", () => checkboxOrder.push("input"));
    freshCheckbox.addEventListener("change", () => checkboxOrder.push("change"));
    freshCheckbox.click();
    api.record.value("checkbox-click-order", checkboxOrder);
    api.record.value("checkbox-clicked-checked", freshCheckbox.checked);

    // A default-prevented click restores the checkedness.
    const guarded = document.createElement("input");
    guarded.type = "checkbox";
    form.appendChild(guarded);
    guarded.addEventListener("click", (event) => event.preventDefault());
    guarded.click();
    api.record.value("checkbox-prevented-checked", guarded.checked);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
