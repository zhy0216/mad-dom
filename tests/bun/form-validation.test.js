// T48C WHATWG constraint-validation integration tests.
//
// Drives the T48C constraint-validation slice through the official package
// entry (index.js → js/entry.js) and pins the acceptance criteria:
//
//   - the per-control surface: `validity` is a live `ValidityState` (one cached
//     instance per control, `el.validity === el.validity`) whose flags
//     recompute from live reads — filling/clearing `input.value` flips
//     `valueMissing`, `setCustomValidity` drives `customError` /
//     `validationMessage` and clearing it restores the constraint message;
//   - the flag evaluation: `valueMissing` (required checkbox / text / select /
//     textarea), `typeMismatch` (email/url), `patternMismatch`, `badInput`
//     (number/range), `rangeOverflow`/`rangeUnderflow`, `stepMismatch`,
//     `tooLong`/`tooShort` and the `valid` conjunction;
//   - `willValidate` excludes disabled / readonly / hidden / reset / button
//     types; `validationMessage` is `"Constraints not satisfied"` for a
//     will-validating control that fails, `""` otherwise;
//   - `form.checkValidity()` / `reportValidity()` evaluate every will-validating
//     control and dispatch a bubbling cancelable `invalid` event per invalid
//     control in document order (radio groups evaluated once); the control
//     `checkValidity()` dispatches it on itself;
//   - the submit gate: an invalid form does not dispatch `submit` through
//     `requestSubmit`, while a valid form, a `novalidate` form and a
//     `formnovalidate` submit button all do;
//   - the window exposes the `ValidityState` constructor.
//
// The runtime blocks skip without the locally built native artifact
// (npm run dev:build, or MAD_DOM_NATIVE_PATH), exactly like the other native
// suites.

import { afterAll, describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Node } from "../../js/facade/extensions/node.js";

const nativeAvailable = isNativeAvailable();

const createdWindows = [];

function freshWindow() {
  const win = createWindow();
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) {
    win.destroy();
  }
});

describe("T48C constraint validation surface", () => {
  test("validity/willValidate/validationMessage/setCustomValidity/checkValidity are fixed members", () => {
    for (const name of ["validity", "willValidate", "validationMessage", "formNoValidate"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be an accessor on Node.prototype`).toBeDefined();
      expect(typeof descriptor.get).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
    for (const name of ["setCustomValidity", "checkValidity", "reportValidity"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be a method on Node.prototype`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
      expect(descriptor.enumerable).toBe(false);
      expect(descriptor.configurable).toBe(false);
    }
  });
});

describe.skipIf(!nativeAvailable)("T48C validity flags are live", () => {
  test("required empty input: valueMissing, message and form validity", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML = '<form id="f"><input id="i" required></form>';
    const form = document.getElementById("f");
    const input = document.getElementById("i");

    expect(input.validity).toBeInstanceOf(window.ValidityState);
    expect(input.validity.valueMissing).toBe(true);
    expect(input.validity.valid).toBe(false);
    expect(input.validity.customError).toBe(false);
    expect(input.willValidate).toBe(true);
    expect(input.validationMessage).toBe("Constraints not satisfied");
    expect(input.checkValidity()).toBe(false);
    expect(form.checkValidity()).toBe(false);
    expect(form.reportValidity()).toBe(false);

    input.value = "filled";
    expect(input.validity.valueMissing).toBe(false);
    expect(input.validity.valid).toBe(true);
    expect(input.validationMessage).toBe("");
    expect(input.checkValidity()).toBe(true);
    expect(form.checkValidity()).toBe(true);

    input.value = "";
    expect(input.validity.valueMissing).toBe(true);
  });

  test("validity identity is stable per control and not shared", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML = '<form id="f"><input id="a" required><input id="b" required></form>';
    const a = document.getElementById("a");
    const b = document.getElementById("b");
    expect(a.validity).toBe(a.validity);
    expect(b.validity).toBe(b.validity);
    expect(a.validity).not.toBe(b.validity);
  });

  test("validity flag getters are prototype accessors; only element is an own key", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML = '<input id="a" required>';
    const input = document.getElementById("a");
    expect(Object.keys(input.validity)).toEqual(["element"]);
    expect(Object.getOwnPropertyNames(input.validity)).toContain("element");
    for (const flag of [
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
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input.validity), flag);
      expect(descriptor, `${flag} must be a getter on ValidityState.prototype`).toBeDefined();
      expect(typeof descriptor.get).toBe("function");
    }
  });

  test("setCustomValidity drives customError and the message; clearing restores", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML = '<input id="a" required>';
    const input = document.getElementById("a");
    input.setCustomValidity("custom message");
    expect(input.validity.customError).toBe(true);
    expect(input.validationMessage).toBe("custom message");
    expect(input.checkValidity()).toBe(false);
    input.setCustomValidity("");
    expect(input.validity.customError).toBe(false);
    expect(input.validationMessage).toBe("Constraints not satisfied");
    expect(input.validity.valueMissing).toBe(true);
  });

  test("checkbox/radio required and radio group evaluation", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML =
      '<form id="f"><input id="c" type="checkbox" required>' +
      '<input id="r1" type="radio" name="g" required>' +
      '<input id="r2" type="radio" name="g"></form>';
    const form = document.getElementById("f");
    const checkbox = document.getElementById("c");
    const r1 = document.getElementById("r1");
    const r2 = document.getElementById("r2");

    expect(checkbox.validity.valueMissing).toBe(true);
    expect(r1.validity.valueMissing).toBe(true);
    checkbox.checked = true;
    expect(checkbox.validity.valueMissing).toBe(false);

    r1.checked = true;
    expect(r1.validity.valueMissing).toBe(false);
    expect(r2.validity.valueMissing).toBe(false);
    expect(form.checkValidity()).toBe(true);

    // Unchecked no-name radio is always value-missing.
    document.body.innerHTML = '<form id="g"><input id="n" type="radio" required></form>';
    expect(document.getElementById("n").validity.valueMissing).toBe(true);
  });
});

describe.skipIf(!nativeAvailable)("T48C flag evaluation", () => {
  test("typeMismatch for email and url", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML =
      '<form id="f"><input id="e1" type="email" value="not-an-email">' +
      '<input id="e2" type="email" value="a@b.com">' +
      '<input id="u1" type="url" value="nope">' +
      '<input id="u2" type="url" value="https://example.com"></form>';
    expect(document.getElementById("e1").validity.typeMismatch).toBe(true);
    expect(document.getElementById("e1").validity.valid).toBe(false);
    expect(document.getElementById("e2").validity.typeMismatch).toBe(false);
    expect(document.getElementById("u1").validity.typeMismatch).toBe(true);
    expect(document.getElementById("u2").validity.typeMismatch).toBe(false);
  });

  test("patternMismatch uses the first-match strip", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML =
      '<form id="f"><input id="p1" pattern="[0-9]+" value="ab12">' +
      '<input id="p2" pattern="[0-9]+" value="123"></form>';
    expect(document.getElementById("p1").validity.patternMismatch).toBe(true);
    expect(document.getElementById("p2").validity.patternMismatch).toBe(false);
  });

  test("badInput / range / step for number and range", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML =
      '<form id="f">' +
      '<input id="n1" type="number" value="abc">' +
      '<input id="n2" type="number" value="12.5">' +
      '<input id="min" type="range" min="0" max="10" value="-5">' +
      '<input id="max" type="range" min="0" max="10" value="15">' +
      '<input id="st" type="number" step="2" value="3">' +
      '<input id="st-any" type="number" step="any" value="3">' +
      '<input id="st-def" type="number" value="3.5"></form>';
    expect(document.getElementById("n1").validity.badInput).toBe(true);
    expect(document.getElementById("n2").validity.badInput).toBe(false);
    expect(document.getElementById("min").validity.rangeUnderflow).toBe(true);
    expect(document.getElementById("max").validity.rangeOverflow).toBe(true);
    expect(document.getElementById("st").validity.stepMismatch).toBe(true);
    expect(document.getElementById("st-any").validity.stepMismatch).toBe(false);
    expect(document.getElementById("st-def").validity.stepMismatch).toBe(true);
  });

  test("tooLong and tooShort for input and textarea", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML =
      '<form id="f">' +
      '<input id="l" maxlength="5" value="1234567">' +
      '<input id="s" minlength="5" value="ab">' +
      '<input id="ok" maxlength="5" minlength="2" value="abc">' +
      '<textarea id="tl" maxlength="3">12345</textarea>' +
      '<textarea id="ts" minlength="4">ab</textarea></form>';
    expect(document.getElementById("l").validity.tooLong).toBe(true);
    expect(document.getElementById("s").validity.tooShort).toBe(true);
    expect(document.getElementById("ok").validity.valid).toBe(true);
    expect(document.getElementById("tl").validity.tooLong).toBe(true);
    expect(document.getElementById("ts").validity.tooShort).toBe(true);
  });

  test("willValidate excludes disabled/readonly/hidden/reset/button types", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML =
      '<form id="f">' +
      '<input id="w1" required>' +
      '<input id="w2" required disabled>' +
      '<input id="w3" required readonly>' +
      '<input id="w4" required type="hidden">' +
      '<input id="w5" required type="reset">' +
      '<input id="w6" required type="button">' +
      '<button id="b1">x</button><button id="b2" disabled>x</button>' +
      '<textarea id="t1" required></textarea><textarea id="t2" readonly></textarea>' +
      '<select id="s1" required><option value="">x</option></select></form>';
    const get = (id) => document.getElementById(id);
    expect(get("w1").willValidate).toBe(true);
    expect(get("w2").willValidate).toBe(false);
    expect(get("w3").willValidate).toBe(false);
    expect(get("w4").willValidate).toBe(false);
    expect(get("w5").willValidate).toBe(false);
    expect(get("w6").willValidate).toBe(false);
    expect(get("b1").willValidate).toBe(true);
    expect(get("b2").willValidate).toBe(false);
    expect(get("t1").willValidate).toBe(true);
    expect(get("t2").willValidate).toBe(false);
    expect(get("s1").willValidate).toBe(true);
    // A disabled-only-invalid form is valid: non-candidates never fail.
    document.body.innerHTML =
      '<form id="g"><input id="d" required disabled><input id="r" readonly required></form>';
    expect(document.getElementById("g").checkValidity()).toBe(true);
  });

  test("select/textarea required valueMissing", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML =
      '<form id="f"><textarea id="ta" required></textarea>' +
      '<select id="s" required><option value="">none</option></select></form>';
    const textarea = document.getElementById("ta");
    const select = document.getElementById("s");
    expect(textarea.validity.valueMissing).toBe(true);
    expect(textarea.validationMessage).toBe("Constraints not satisfied");
    expect(select.validity.valueMissing).toBe(true);
    expect(select.validationMessage).toBe("Constraints not satisfied");
    textarea.value = "x";
    expect(textarea.validity.valueMissing).toBe(false);
  });
});

describe.skipIf(!nativeAvailable)("T48C invalid event and submit gate", () => {
  test("form.checkValidity dispatches a bubbling cancelable invalid event per invalid control in document order", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML = '<form id="f"><input id="a" required><input id="b" required><input id="c"></form>';
    const form = document.getElementById("f");
    const seen = [];
    form.addEventListener("invalid", (event) => {
      seen.push({
        target: event.target.id,
        bubbles: event.bubbles,
        cancelable: event.cancelable,
        defaultPrevented: event.defaultPrevented,
      });
    });
    expect(form.checkValidity()).toBe(false);
    expect(seen).toEqual([
      { target: "a", bubbles: true, cancelable: true, defaultPrevented: false },
      { target: "b", bubbles: true, cancelable: true, defaultPrevented: false },
    ]);
  });

  test("control.checkValidity dispatches invalid on itself; a valid control does not", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML = '<form id="f"><input id="a" required><input id="b"></form>';
    const a = document.getElementById("a");
    const b = document.getElementById("b");
    let count = 0;
    a.addEventListener("invalid", () => {
      count += 1;
    });
    b.addEventListener("invalid", () => {
      count += 1;
    });
    expect(a.checkValidity()).toBe(false);
    expect(b.checkValidity()).toBe(true);
    expect(count).toBe(1);
  });

  test("form.checkValidity evaluates a radio group once", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML =
      '<form id="f"><input id="r1" type="radio" name="g" required><input id="r2" type="radio" name="g" required></form>';
    const form = document.getElementById("f");
    const seen = [];
    form.addEventListener("invalid", (event) => {
      seen.push(event.target.id);
    });
    expect(form.checkValidity()).toBe(false);
    expect(seen).toEqual(["r1"]);
  });

  test("invalid submit is blocked; valid / novalidate / formnovalidate let it through", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML = '<form id="f"><input id="x" required><button id="s" type="submit">go</button></form>';
    const form = document.getElementById("f");
    const submit = document.getElementById("s");
    let submitEvents = 0;
    form.addEventListener("submit", () => {
      submitEvents += 1;
    });
    form.requestSubmit(submit);
    expect(submitEvents).toBe(0);
    document.getElementById("x").value = "ok";
    form.requestSubmit(submit);
    expect(submitEvents).toBe(1);

    document.body.innerHTML = '<form id="g" novalidate><input id="y" required><button id="t" type="submit">go</button></form>';
    const formG = document.getElementById("g");
    const t = document.getElementById("t");
    let submitEventsG = 0;
    formG.addEventListener("submit", () => {
      submitEventsG += 1;
    });
    formG.requestSubmit(t);
    expect(submitEventsG).toBe(1);

    document.body.innerHTML = '<form id="h"><input id="z" required><button id="u" type="submit" formnovalidate>go</button></form>';
    const formH = document.getElementById("h");
    const u = document.getElementById("u");
    let submitEventsH = 0;
    formH.addEventListener("submit", () => {
      submitEventsH += 1;
    });
    formH.requestSubmit(u);
    expect(submitEventsH).toBe(1);
  });

  test("button click default action submits through requestSubmit when valid", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.innerHTML = '<form id="f"><input id="x" required><button id="s" type="submit">go</button></form>';
    const form = document.getElementById("f");
    let submitEvents = 0;
    form.addEventListener("submit", () => {
      submitEvents += 1;
    });
    document.getElementById("s").click();
    expect(submitEvents).toBe(0);
    document.getElementById("x").value = "ok";
    document.getElementById("s").click();
    expect(submitEvents).toBe(1);
  });
});
