// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-form-element/HTMLFormElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLFormElement surface — the
// attribute reflections (name/encoding/enctype/acceptCharset/autocomplete),
// the URL-resolved action getter with the raw-attribute setter, method and
// noValidate, the live elements collection (length / indexed reads /
// namedItem), the sibling navigation, reset() restoring control defaults,
// requestSubmit() with the submit event and submitter, constraint validation
// (checkValidity/reportValidity incl. the "invalid" events) and
// dispatchEvent target identity. The submit-navigation tests are dropped
// (Fetch/browser-frame network dependency), as are the `form[name]` named
// access, the `form`-attribute external-form association, the RadioNodeList
// radio/checkbox-group reads and the `target` reflection (frozen facade
// deviations / not-implemented surface).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-form-element";
export const description = "real differential: public HTMLFormElement reflections, action, elements collection, reset, requestSubmit, validation";
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
    const element = document.createElement("form");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // Attribute reflections. The attribute names are written lowercase
    // (happy-dom normalizes attribute names on write; mad-dom keeps them
    // as-given), so the acceptCharset case uses "acceptcharset".
    for (const [property, attribute] of [
      ["name", "name"],
      ["encoding", "encoding"],
      ["enctype", "enctype"],
      ["acceptCharset", "acceptcharset"],
      ["autocomplete", "autocomplete"],
    ]) {
      api.record.value(`get-${property}-default`, element[property]);
      element.setAttribute(attribute, "value");
      api.record.value(`get-${property}`, element[property]);
      element[property] = "value";
      api.record.value(`set-${property}`, element.getAttribute(attribute));
    }

    // action getter (defaults to the document location; setURL re-bases).
    api.record.value("action-default", element.action);
    element.setAttribute("action", "/test/");
    api.record.value("action-relative-about-blank", element.action);
    window.happyDOM.setURL("https://localhost/path/");
    api.record.value("action-relative-after-seturl", element.action);
    element.setAttribute("action", "https://example.com");
    api.record.value("action-absolute", element.action);
    element.action = "/test/";
    api.record.value("action-set-attr", element.getAttribute("action"));

    // noValidate / method.
    api.record.value("noValidate-default", element.noValidate);
    element.setAttribute("novalidate", "");
    api.record.value("noValidate-attr", element.noValidate);
    element.noValidate = true;
    api.record.value("noValidate-set", element.getAttribute("novalidate"));
    api.record.value("method-default", element.method);
    element.setAttribute("method", "post");
    api.record.value("method-get", element.method);
    element.method = "post";
    api.record.value("method-set", element.getAttribute("method"));

    // elements collection (single-name controls only).
    element.innerHTML =
      '<div>' +
      '<input type="text" name="text1" value="value1">' +
      '<button name="button1" value="value1"></button>' +
      '<input type="hidden" name="1" value="value1">' +
      "</div>";
    const root = element.children[0];
    api.record.value("form-length", element.length);
    api.record.value("elements-length", element.elements.length);
    api.record.identity("elements-0", element.elements[0], root.children[0]);
    api.record.identity("elements-item-1", element.elements.item(1), root.children[1]);
    api.record.identity("elements-named-text1", element.elements.namedItem("text1"), root.children[0]);
    api.record.identity("elements-named-1", element.elements.namedItem("1"), root.children[2]);
    api.record.value("elements-named-missing", element.elements.namedItem("missing"));
    const elements = element.elements;
    const another = document.createElement("div");
    another.innerHTML = "<span><input type=\"text\" name=\"anotherText1\" value=\"value1\"></span>";
    root.appendChild(another);
    api.record.value("elements-length-after-append", elements.length);
    api.record.value("form-length-after-append", element.length);
    root.removeChild(another);
    api.record.value("elements-length-after-remove", elements.length);

    // previousSibling / nextSibling.
    const form = document.createElement("form");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    document.body.appendChild(span1);
    document.body.appendChild(form);
    document.body.appendChild(span2);
    api.record.identity("previous-sibling", form.previousSibling, span1);
    api.record.identity("next-sibling", form.nextSibling, span2);

    // reset() restores control defaults.
    const resetForm = document.createElement("form");
    resetForm.innerHTML =
      '<input type="text" name="text1" value="Default value">' +
      '<input type="checkbox" name="checkbox1" value="value1">' +
      '<input type="checkbox" name="checkbox1" value="value2" checked>';
    document.body.appendChild(resetForm);
    const resetRootChildren = Array.from(resetForm.children);
    const textInput = resetRootChildren[0];
    const cb1 = resetRootChildren[1];
    const cb2 = resetRootChildren[2];
    textInput.value = "New value";
    cb1.click();
    cb2.click();
    let resetEvent = null;
    resetForm.addEventListener("reset", (event) => (resetEvent = event.type));
    resetForm.reset();
    api.record.value("reset-event", resetEvent);
    api.record.value("reset-text", textInput.value);
    api.record.value("reset-cb1", cb1.checked);
    api.record.value("reset-cb2", cb2.checked);

    // requestSubmit fires the submit event with the submitter.
    const submitForm = document.createElement("form");
    const submitButton = document.createElement("button");
    submitForm.appendChild(submitButton);
    document.body.appendChild(submitForm);
    let submitEventType = null;
    let submitSubmitter = null;
    submitForm.addEventListener("submit", (event) => {
      submitEventType = event.type;
      submitSubmitter = event.submitter === submitButton;
    });
    submitForm.requestSubmit(submitButton);
    api.record.value("requestSubmit-event", submitEventType);
    api.record.value("requestSubmit-submitter", submitSubmitter);

    // checkValidity / reportValidity with invalid events.
    const validateForm = document.createElement("form");
    validateForm.innerHTML =
      '<input type="text" name="text1" required>' +
      '<input type="checkbox" name="checkbox1" value="value1" required>';
    document.body.appendChild(validateForm);
    const vChildren = Array.from(validateForm.children);
    const requiredText = vChildren[0];
    const requiredCheckbox = vChildren[1];
    let invalidEvents = 0;
    validateForm.addEventListener("invalid", () => invalidEvents++);
    api.record.value("checkValidity-invalid", validateForm.checkValidity());
    api.record.value("invalid-events-count", invalidEvents);
    invalidEvents = 0;
    requiredText.value = "value";
    requiredCheckbox.click();
    api.record.value("reportValidity-valid", validateForm.reportValidity());
    api.record.value("invalid-events-valid", invalidEvents);

    // dispatchEvent uses the proxy as target.
    const dispatchForm = document.createElement("form");
    const event = new window.Event("test");
    let target = null;
    let currentTarget = null;
    dispatchForm.addEventListener("test", (e) => {
      target = e.target;
      currentTarget = e.currentTarget;
    });
    dispatchForm.dispatchEvent(event);
    api.record.identity("dispatch-target", target, dispatchForm);
    api.record.identity("dispatch-current-target", currentTarget, dispatchForm);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
