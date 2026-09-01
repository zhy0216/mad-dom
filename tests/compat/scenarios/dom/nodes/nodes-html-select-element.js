// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-select-element/HTMLSelectElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLSelectElement surface — the live
// options collection (length / indexed reads / value reads), the
// value/selectedIndex/selectedOptions cells, the disabled/autofocus/required/
// multiple/name reflections, constraint validation
// (validity/validationMessage/willValidate/setCustomValidity/checkValidity/
// reportValidity incl. the "invalid" event), tabIndex, the sibling
// navigation, appendChild/insertBefore/removeChild keeping the options
// collection in sync and focus. The symbol-property reads, the labels reads
// and the `element.add`/`element.item`/`selectedOptions`-group edge cases that
// the facade does not surface are dropped where they diverge.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-select-element";
export const description = "real differential: public HTMLSelectElement options collection, value/selectedIndex, validation, tabIndex, focus";
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
    const element = document.createElement("select");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // options collection reflects DOM mutations.
    const option1 = document.createElement("option");
    option1.value = "option1";
    element.appendChild(option1);
    api.record.value("options-length-1", element.options.length);
    api.record.value("options-0-value", element.options[0].value);
    element.removeChild(option1);
    const option2 = document.createElement("option");
    const option3 = document.createElement("option");
    option2.value = "option2";
    option3.value = "option3";
    element.appendChild(option2);
    element.appendChild(option3);
    api.record.value("options-length-2", element.options.length);
    api.record.value("options-0-value", element.options[0].value);
    api.record.value("options-1-value", element.options[1].value);
    api.record.identity("options-0-identity", element.options[0], option2);

    // value getter / setter.
    api.record.value("value-empty", element.value);
    element.value = "option2";
    api.record.value("value-after-set", element.value);
    api.record.value("selectedIndex-after-value", element.selectedIndex);
    element.selectedIndex = 1;
    api.record.value("value-after-index", element.value);
    api.record.value("selectedIndex-after-index", element.selectedIndex);
    element.selectedIndex = -1;
    api.record.value("value-after-neg-index", element.value);

    // selectedIndex default and attribute-driven selection.
    const idxSelect = document.createElement("select");
    api.record.value("selectedIndex-default", idxSelect.selectedIndex);
    const o1 = document.createElement("option");
    const o2 = document.createElement("option");
    o2.setAttribute("selected", "");
    idxSelect.appendChild(o1);
    idxSelect.appendChild(o2);
    api.record.value("selectedIndex-attr", idxSelect.selectedIndex);
    o1.setAttribute("selected", "");
    api.record.value("selectedIndex-after-first", idxSelect.selectedIndex);
    o2.removeAttribute("selected");
    api.record.value("selectedIndex-after-remove", idxSelect.selectedIndex);

    // selectedOptions.
    api.record.value("selectedOptions-empty", element.selectedOptions.length);
    const mult = document.createElement("select");
    mult.setAttribute("multiple", "");
    const m1 = document.createElement("option");
    const m2 = document.createElement("option");
    m1.setAttribute("selected", "");
    m2.setAttribute("selected", "");
    mult.appendChild(m1);
    mult.appendChild(m2);
    api.record.value("selectedOptions-multiple-length", mult.selectedOptions.length);
    api.record.identity("selectedOptions-0", mult.selectedOptions[0], m1);
    m1.removeAttribute("selected");
    api.record.value("selectedOptions-after-remove", mult.selectedOptions.length);

    // boolean / name reflections.
    for (const property of ["disabled", "autofocus", "required", "multiple"]) {
      const el = document.createElement("select");
      api.record.value(`bool-${property}-default`, el[property]);
      el.setAttribute(property, "");
      api.record.value(`bool-${property}-attr`, el[property]);
      el[property] = true;
      api.record.value(`bool-${property}-set`, el.getAttribute(property));
    }
    api.record.value("name-default", element.name);
    element.setAttribute("name", "value");
    api.record.value("name-attr", element.name);
    element.name = "value";
    api.record.value("name-set", element.getAttribute("name"));

    // validation.
    const req = document.createElement("select");
    req.required = true;
    const reqOption = document.createElement("option");
    reqOption.value = "";
    req.appendChild(reqOption);
    api.record.value("validationMessage-required", req.validationMessage);
    reqOption.value = "test";
    req.value = "test";
    api.record.value("validationMessage-filled", req.validationMessage);
    req.disabled = true;
    api.record.value("validationMessage-disabled", req.validationMessage);
    api.record.value("willValidate-enabled", element.willValidate);
    element.disabled = true;
    api.record.value("willValidate-disabled", element.willValidate);
    element.disabled = false;
    api.record.value("validity-valid", element.validity.valid);
    const req2 = document.createElement("select");
    req2.required = true;
    req2.appendChild(document.createElement("option"));
    let invalidEvent = null;
    req2.addEventListener("invalid", (event) => (invalidEvent = event.type));
    api.record.value("checkValidity-invalid", req2.checkValidity());
    api.record.value("invalid-event-type", invalidEvent);
    req2.value = "test";
    api.record.value("reportValidity-valid", req2.reportValidity());

    // tabIndex.
    const fresh = document.createElement("select");
    api.record.value("tabindex-default", fresh.tabIndex);
    fresh.setAttribute("tabindex", "5");
    api.record.value("tabindex-attr", fresh.tabIndex);
    fresh.setAttribute("tabindex", "invalid");
    api.record.value("tabindex-nan", fresh.tabIndex);
    fresh.tabIndex = 5;
    api.record.value("tabindex-set-5", fresh.getAttribute("tabindex"));
    fresh.tabIndex = "invalid";
    api.record.value("tabindex-set-invalid", fresh.getAttribute("tabindex"));

    // sibling navigation.
    const select1 = document.createElement("select");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    document.body.appendChild(span1);
    document.body.appendChild(select1);
    document.body.appendChild(span2);
    api.record.identity("previous-sibling", select1.previousSibling, span1);
    api.record.identity("next-sibling", select1.nextSibling, span2);

    // appendChild / insertBefore / removeChild keep the options collection live.
    const live = document.createElement("select");
    const a1 = document.createElement("option");
    const a2 = document.createElement("option");
    const a3 = document.createElement("option");
    live.appendChild(a1);
    live.appendChild(a2);
    live.appendChild(a3);
    api.record.value("append-length", live.length);
    api.record.value("append-options-length", live.options.length);
    api.record.identity("append-0", live.options[0], a1);
    const divEl = document.createElement("div");
    live.appendChild(divEl);
    api.record.value("append-div-options-length", live.options.length);
    api.record.value("append-div-children-length", live.children.length);
    live.insertBefore(a3, a2);
    api.record.value("insert-options-length", live.options.length);
    api.record.identity("insert-0", live.options[0], a1);
    api.record.identity("insert-1", live.options[1], a3);
    live.removeChild(a2);
    api.record.value("remove-options-length", live.options.length);

    // focus.
    const focusSelect = document.createElement("select");
    document.body.appendChild(focusSelect);
    focusSelect.focus();
    api.record.identity("focus-active", document.activeElement, focusSelect);
    focusSelect.blur();
    api.record.value("blur-active", document.activeElement === focusSelect);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
