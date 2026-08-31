// First-batch form-control facade extension (T40, constraint validation T48C).
//
// Installs the basic form surface on `Node.prototype` (the single-class model):
// `input` / `button` / `select` / `option` / `textarea` value/name/type/
// disabled/checked/selected reads and writes, the `form` element's
// `elements` / `length` / `submit` / `requestSubmit` / `reset` and the live
// collections behind `form.elements`, `select.options` and
// `select.selectedOptions` — plus, since T48C, the WHATWG constraint-validation
// surface: the live `validity` `ValidityState`, `validationMessage`,
// `willValidate`, `setCustomValidity` and the control `checkValidity` /
// `reportValidity`, and the `form.checkValidity()` / `reportValidity()` that
// evaluate the `required`/`type`/`pattern`/range/step/length constraints and
// dispatch the bubbling cancelable `invalid` event on every invalid control
// (with the `noValidate` / `formnovalidate` gate in the submit path).
//
// # No second form state
//
// The stateful reads/writes delegate to the native T40 form contract
// (crates/mad-dom-bun/src/extensions/form_api.rs) and through it to Core's
// per-document `form_state` (mad_dom_core::dom::form): the dirty input value /
// textarea value, the dirty checkedness, the option/select selection model, the
// custom validation message and the reset algorithm all live in Core. The
// attribute-only reflections (`name` / `disabled` / `required` / `readOnly` /
// `multiple` / `method` / `action` / `target` / `enctype` / ...) are pure
// reads/writes over the T25E attribute contract, exactly like the T39 reflected
// accessors — so the facade keeps **no second authoritative state** and the
// arena + Core's form state are the single source of truth.
//
// # Constraint validation is a live derived read (T48C)
//
// The `validity` flags, `willValidate` and the constraint half of
// `validationMessage` are **not** stored anywhere: every access recomputes them
// from the live attribute/value/checkedness/selection reads of the native
// contract (exactly like the T40 live collections), so a change through
// `input.value`, `input.checked` or `setAttribute` is visible on the next flag
// read. The only stored validation state is the `setCustomValidity` payload,
// which lives in Core's `form_state` (`custom_validity`); the `customError`
// flag reads it through the native `customValidity()` entry. The rule
// evaluation mirrors happy-dom's `ValidityState` observation-for-observation:
// the same `badInput` number/range value regex, the same `pattern` first-match
// strip, the same email/url type regexes, the same `Number` range/step
// comparisons and the same "Constraints not satisfied" message.
//
// # Submit / reset event order
//
// `requestSubmit` dispatches a bubbling cancelable `SubmitEvent('submit')`
// (with `submitter`) and runs the (unimplemented) navigation when it is not
// default-prevented; `reset` resets every control through Core, then dispatches
// a bubbling cancelable `Event('reset')`. Clicking a `submit` / `reset`
// `input` or `button` dispatches the click event first and then triggers the
// form's `requestSubmit` / `reset` (the happy-dom `dispatchEvent` default
// action), with the checkbox/radio click toggle + `input`/`change` sequence.
// Since T48C the invalid path is real: `form.checkValidity()` /
// `reportValidity()` and the control `checkValidity()` dispatch a bubbling
// cancelable `Event('invalid')` on each invalid control, and `requestSubmit`
// (through `form.checkValidity()` unless the form has `noValidate` or the
// submitter has `formnovalidate`) refuses to fire `submit` while the form is
// invalid. Real navigation on `submit()` is out of scope (T40 boundary) and is
// a no-op.
//
// # Recorded gaps (advanced form behavior)
//
// Still unimplemented and explicit gaps: `input` selection ranges,
// `valueAsNumber` / `valueAsDate`, `FileList`, the `form` attribute's
// external-form association, `select.add` / `select.remove`, `form[name]`
// named access and the per-tag `instanceof window.HTMLInputElement` split (the
// single-class deviation). The date/time/color `input` value sanitizers store
// the raw string (see Core `form.rs`).
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing else in the registry changes beyond the
// import and array entry.

import { Node } from "./node.js";
import { HTMLInputElement, HTMLButtonElement } from "./html-element.js";
import { Window } from "../window.js";
import { Event, MouseEvent } from "./events.js";

export const seam = Object.freeze({
  id: "facade/extensions/forms",
  owner: "T40",
  gate: "T40",
  status: "implemented",
});

// --- constructor accessor classes (single-class model) ----------------------

/** `HTMLFormControlsCollection` facade base class (T40). */
export class HTMLFormControlsCollection {}
/** `HTMLOptionsCollection` facade base class (T40). */
export class HTMLOptionsCollection {}

/**
 * `SubmitEvent` facade (T40): the `submit` event happy-dom dispatches on form
 * submission, carrying the `submitter` button/input (or the form itself).
 */
export class SubmitEvent extends Event {
  constructor(type, eventInit = null) {
    super(type, eventInit);
    this.submitter = eventInit?.submitter ?? null;
  }
}

/**
 * Live `ValidityState` facade (T48C).
 *
 * One cached instance per control wrapper; its flag getters recompute the
 * constraint evaluation from the live attribute/value/checkedness/selection
 * reads of the native contract on every access, so the state is live by
 * construction (a later `input.value` / `input.checked` / `setAttribute`
 * change is visible on the next flag read) and `el.validity === el.validity`
 * holds. The `element` own property mirrors happy-dom's instance shape; the
 * flag getters are non-enumerable, non-configurable prototype accessors, so an
 * own-key probe reports only `element` exactly like the baseline.
 */
export class ValidityState {
  constructor(owner) {
    VALIDITY_OWNERS.set(this, owner);
    this.element = owner;
  }
}

// --- helpers ----------------------------------------------------------------

const BUTTON_TYPES = ["submit", "reset", "button", "menu"];

// One cached live collection per owner wrapper: form -> elements, select ->
// options / selectedOptions (happy-dom caches these identities).
const FORM_ELEMENTS = new WeakMap();
const SELECT_OPTIONS = new WeakMap();
const SELECTED_OPTIONS = new WeakMap();
// Reverse map: `select.options` collection → the owning `select` wrapper, so
// the `selectedIndex` accessor on the collection can delegate to the select's
// native selection surface (happy-dom HTMLOptionsCollection.selectedIndex).
const OPTIONS_OWNER_SELECT = new WeakMap();

// Per-collection live read (a fresh array of node wrappers each access),
// keyed by the live collection proxy (its prototype methods receive the proxy
// as `this`).
const LIVE_READS = new WeakMap();

function isNodeHandle(handle) {
  return (
    handle !== null &&
    typeof handle === "object" &&
    typeof handle.nodeType === "function" &&
    typeof handle.nodeName === "function" &&
    typeof handle.childNodes === "function"
  );
}

function facadeNodeHandle(ctx, value, role) {
  const handle = ctx.documentContext.handleOf(value);
  if (!isNodeHandle(handle)) {
    throw new TypeError(`Node.${role} requires a genuine Node facade wrapper`);
  }
  return handle;
}

function tagOf(handle) {
  return String(handle.nodeName());
}

function isOneOf(handle, tags) {
  return tags.includes(tagOf(handle));
}

function namedItemOf(items, name) {
  name = String(name);
  for (const item of items) {
    if (item.getAttribute("id") === name || item.getAttribute("name") === name) {
      return item;
    }
  }
  return null;
}

function readItems(collection) {
  return LIVE_READS.get(collection)();
}

/**
 * Builds a live collection Proxy over `readItems` (a fresh array of node
 * wrappers each access), backed by `CollectionClass.prototype` so
 * `collection instanceof window.HTMLFormControlsCollection` (and friends)
 * holds. The shape mirrors the T32 `HTMLCollection` proxy observation for
 * observation; the prototype surface (`length` / `item` / `namedItem` /
 * iteration) is defined once per class in `install`.
 */
function liveCollectionProxy(CollectionClass, read) {
  const target = Object.create(CollectionClass.prototype);
  const proxy = new Proxy(target, {
    get(target, property, receiver) {
      if (property === "length") return read().length;
      if (property in target || typeof property === "symbol") {
        return Reflect.get(target, property, receiver);
      }
      const index = Number(property);
      if (!Number.isNaN(index)) return read()[index];
      return namedItemOf(read(), property) ?? undefined;
    },
    has(target, property) {
      if (property in target) return true;
      const items = read();
      const index = Number(property);
      if (!Number.isNaN(index) && index >= 0 && index < items.length) return true;
      property = String(property);
      return items.some((item) => {
        const name = item.getAttribute("id") || item.getAttribute("name");
        return name === property;
      });
    },
    getOwnPropertyDescriptor(target, property) {
      if (property in target || typeof property === "symbol") return undefined;
      const items = read();
      const index = Number(property);
      if (!Number.isNaN(index) && index >= 0 && index < items.length) {
        return { value: items[index], writable: false, enumerable: true, configurable: true };
      }
      const named = namedItemOf(items, property);
      if (named) {
        return { value: named, writable: false, enumerable: true, configurable: true };
      }
      return undefined;
    },
    ownKeys() {
      const keys = [];
      for (const item of read()) {
        const name = item.getAttribute("id") || item.getAttribute("name");
        keys.push(String(keys.length));
        if (name) keys.push(name);
      }
      return keys;
    },
  });
  LIVE_READS.set(proxy, read);
  return proxy;
}

function formElementsOf(ctx, form) {
  const cached = FORM_ELEMENTS.get(form);
  if (cached !== undefined) return cached;
  const handle = facadeNodeHandle(ctx, form, "elements");
  const collection = liveCollectionProxy(HTMLFormControlsCollection, () =>
    handle.formElements().map((item) => ctx.wrap(item)),
  );
  FORM_ELEMENTS.set(form, collection);
  return collection;
}

function selectOptionsOf(ctx, select) {
  const cached = SELECT_OPTIONS.get(select);
  if (cached !== undefined) return cached;
  const handle = facadeNodeHandle(ctx, select, "options");
  const collection = liveCollectionProxy(HTMLOptionsCollection, () =>
    handle.getElementsByTagName("option").map((item) => ctx.wrap(item)),
  );
  SELECT_OPTIONS.set(select, collection);
  OPTIONS_OWNER_SELECT.set(collection, select);
  return collection;
}

function selectedOptionsOf(ctx, select) {
  const cached = SELECTED_OPTIONS.get(select);
  if (cached !== undefined) return cached;
  const handle = facadeNodeHandle(ctx, select, "selectedOptions");
  const collection = liveCollectionProxy(HTMLFormControlsCollection, () =>
    handle.selectSelectedOptions().map((item) => ctx.wrap(item)),
  );
  SELECTED_OPTIONS.set(select, collection);
  return collection;
}

// Shared live-collection prototype surface for the form collections. The read
// is per-collection (`LIVE_READS`), so a single definition serves every
// instance; numeric `length` and indexed reads are handled by the Proxy traps.
function installCollectionPrototype(ctx, CollectionClass) {
  ctx.defineMethod(CollectionClass.prototype, "item", function item(index) {
    const items = readItems(this);
    return index >= 0 && items[index] ? items[index] : null;
  });

  ctx.defineMethod(CollectionClass.prototype, "namedItem", function namedItem(name) {
    return namedItemOf(readItems(this), name);
  });

  ctx.defineMethod(CollectionClass.prototype, Symbol.iterator, function values() {
    return readItems(this)[Symbol.iterator]();
  });

  ctx.defineAccessor(CollectionClass.prototype, Symbol.toStringTag, function toStringTag() {
    return CollectionClass.name;
  }, undefined);
}

// --- constraint validation (T48C) -------------------------------------------
//
// The `validity` flags, `willValidate` and the constraint half of
// `validationMessage` are live derived reads: every access recomputes them from
// the native attribute/value/checkedness/selection contract, so they never
// store a second copy of the form state. Only the `setCustomValidity` payload
// is stored, in Core's `form_state.custom_validity`; the `customError` flag
// reads it through the native `customValidity()` entry. The evaluation mirrors
// happy-dom's `ValidityState` (node_modules/happy-dom/lib/validity-state)
// observation-for-observation, including the exact email/url regexes.

// The happy-dom `badInput` value shape: an optional sign followed by either
// digits or a decimal-comma/point number (European and US decimal separators).
const BAD_INPUT_REGEXP = /^[-+]?(?:\d+|\d*[.,]\d+)$/;
// The happy-dom `typeMismatch` email address regex (an RFC-style local part,
// dot-joined labels, an `@`, a domain part with optional dotted labels).
const EMAIL_REGEXP =
  /^([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x22([^\x0d\x22\x5c\x80-\xff]|\x5c[\x00-\x7f])*\x22)(\x2e([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x22([^\x0d\x22\x5c\x80-\xff]|\x5c[\x00-\x7f])*\x22))*\x40([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x5b([^\x0d\x5b-\x5d\x80-\xff]|\x5c[\x00-\x7f])*\x5d)(\x2e([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x5b([^\x0d\x5b-\x5d\x80-\xff]|\x5c[\x00-\x7f])*\x5d))*$/;
// The happy-dom `typeMismatch` url regex (http/https/ftp with a host, optional
// port / path / query / fragment).
const URL_REGEXP =
  /^(?:(?:https?|HTTPS?|ftp|FTP):\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-zA-Z\u00a1-\uffff0-9]-*)*[a-zA-Z\u00a1-\uffff0-9]+)(?:\.(?:[a-zA-Z\u00a1-\uffff0-9]-*)*[a-zA-Z\u00a1-\uffff0-9]+)*)(?::\d{2,5})?(?:[\/?#]\S*)?$/;

// The tags exposing the full validation surface (validity / willValidate /
// validationMessage / setCustomValidity / checkValidity). `fieldset` exposes
// every member *except* `validity` (happy-dom), so it lives in the surface set
// but not the `validity` set.
const VALIDITY_TAGS = ["input", "select", "textarea", "button", "output", "object"];
const VALIDATION_SURFACE_TAGS = [...VALIDITY_TAGS, "fieldset"];

// One cached `ValidityState` per control wrapper (stable identity, live reads).
const CONTROL_VALIDITY = new WeakMap();
// Reverse map: `ValidityState` instance -> the control wrapper it observes.
const VALIDITY_OWNERS = new WeakMap();

function isValidationSurface(handle) {
  return VALIDATION_SURFACE_TAGS.includes(tagOf(handle));
}

function isValidityControl(handle) {
  return VALIDITY_TAGS.includes(tagOf(handle));
}

/**
 * The computed `type` of a control as happy-dom's `ValidityState` observes it:
 * the input type state, the button type (defaulting to `submit`), or the
 * select multiple/one state. `""` for tags that expose no computed type.
 */
function computedTypeOf(ctx, wrapper) {
  const handle = ctx.documentContext.handleOf(wrapper);
  const tag = tagOf(handle);
  if (tag === "input") return handle.inputType();
  if (tag === "button") {
    const value = handle.getAttribute("type");
    return value !== null && BUTTON_TYPES.includes(value) ? value : "submit";
  }
  if (tag === "select") {
    return handle.hasAttribute("multiple") ? "select-multiple" : "select-one";
  }
  return "";
}

/**
 * The value happy-dom's `ValidityState` evaluates: the type-dependent
 * input/textarea/select value and the button's `value` attribute.
 */
function validationValueOf(ctx, wrapper) {
  const handle = ctx.documentContext.handleOf(wrapper);
  switch (tagOf(handle)) {
    case "input":
      return handle.inputValue();
    case "textarea":
      return handle.textareaValue();
    case "select":
      return handle.selectValue();
    case "button":
      return handle.getAttribute("value") || "";
    default:
      return "";
  }
}

/**
 * Returns whether any `input` of the radio group named `name` is checked in
 * the scope happy-dom uses (the owning form, or — for a connected radio — the
 * document root reached through the parent chain). Detached radios have no
 * scope, so an unchecked required radio stays value-missing.
 */
function radioGroupHasChecked(ctx, wrapper, name) {
  const handle = ctx.documentContext.handleOf(wrapper);
  let scope = handle.ownerForm();
  if (scope === null && handle.isConnected()) {
    let cursor = handle;
    while (cursor !== null) {
      scope = cursor;
      cursor = cursor.parentNode();
    }
  }
  if (scope === null) return false;
  for (const candidate of scope.querySelectorAll(`input[name="${name}"]`)) {
    if (candidate.inputChecked()) return true;
  }
  return false;
}

/**
 * Recomputes every happy-dom `ValidityState` flag for `wrapper` from the live
 * native contract. `valid` is the conjunction of all ten flags exactly like
 * happy-dom (so `customError` alone flips `valid` to false, while a
 * `setCustomValidity("")` clear restores it).
 */
function validityFlagsOf(ctx, wrapper) {
  const handle = ctx.documentContext.handleOf(wrapper);
  const tag = tagOf(handle);
  const type = computedTypeOf(ctx, wrapper);
  const value = validationValueOf(ctx, wrapper);
  const required =
    (tag === "input" || tag === "select" || tag === "textarea") &&
    handle.getAttribute("required") !== null;
  const flags = {
    badInput: false,
    customError: false,
    patternMismatch: false,
    rangeOverflow: false,
    rangeUnderflow: false,
    stepMismatch: false,
    tooLong: false,
    tooShort: false,
    typeMismatch: false,
    valueMissing: false,
    valid: false,
  };
  if (tag === "input") {
    if (
      (type === "number" || type === "range") &&
      value.length > 0 &&
      !BAD_INPUT_REGEXP.test(value)
    ) {
      flags.badInput = true;
    }
    const pattern = handle.getAttribute("pattern");
    if (pattern !== null && value.length > 0 && value.replace(new RegExp(pattern), "").length > 0) {
      flags.patternMismatch = true;
    }
    if (type === "number" || type === "range") {
      const max = handle.getAttribute("max");
      if (max !== null && value.length > 0 && Number(value) > Number(max)) {
        flags.rangeOverflow = true;
      }
      const min = handle.getAttribute("min");
      if (min !== null && value.length > 0 && Number(value) < Number(min)) {
        flags.rangeUnderflow = true;
      }
      const step = handle.getAttribute("step");
      if (
        (step !== null && step !== "any" && Number(value) % Number(step) !== 0) ||
        (step === null && Number(value) % 1 !== 0)
      ) {
        flags.stepMismatch = true;
      }
    }
    if (value.length > 0) {
      if (
        (type === "email" && !EMAIL_REGEXP.test(value)) ||
        (type === "url" && !URL_REGEXP.test(value))
      ) {
        flags.typeMismatch = true;
      }
    }
    if (required) {
      if (type === "checkbox") {
        flags.valueMissing = !handle.inputChecked();
      } else if (type === "radio") {
        if (!handle.inputChecked()) {
          const name = handle.getAttribute("name");
          flags.valueMissing = !name || !radioGroupHasChecked(ctx, wrapper, name);
        }
      } else {
        flags.valueMissing = value.length === 0;
      }
    }
  } else if (required) {
    flags.valueMissing = value.length === 0;
  }
  if (tag === "input" || tag === "textarea") {
    const maxLength = parseInt(handle.getAttribute("maxlength"), 10);
    if (maxLength > 0 && value.length > maxLength) flags.tooLong = true;
    const minLength = parseInt(handle.getAttribute("minlength"), 10);
    if (minLength > 0 && value.length > 0 && value.length < minLength) flags.tooShort = true;
  }
  flags.customError = handle.customValidity().length > 0;
  flags.valid =
    !flags.badInput &&
    !flags.customError &&
    !flags.patternMismatch &&
    !flags.rangeOverflow &&
    !flags.rangeUnderflow &&
    !flags.stepMismatch &&
    !flags.tooLong &&
    !flags.tooShort &&
    !flags.typeMismatch &&
    !flags.valueMissing;
  return flags;
}

/**
 * The happy-dom `control.willValidate`: whether the control is a candidate for
 * constraint validation. `undefined` for tags outside the validation surface.
 */
function controlWillValidate(ctx, wrapper) {
  const handle = ctx.documentContext.handleOf(wrapper);
  const tag = tagOf(handle);
  if (tag === "output" || tag === "object" || tag === "fieldset") return false;
  const disabled = handle.getAttribute("disabled") !== null;
  if (tag === "select" || tag === "button") return !disabled;
  if (tag === "textarea") {
    return !disabled && handle.getAttribute("readonly") === null;
  }
  if (tag === "input") {
    const type = handle.inputType();
    return (
      type !== "hidden" &&
      type !== "reset" &&
      type !== "button" &&
      !disabled &&
      handle.getAttribute("readonly") === null
    );
  }
  return undefined;
}

/**
 * The happy-dom `control.checkValidity()` validity: the control's own
 * exemption (disabled / readonly / barred type) OR the live `validity.valid`.
 * `fieldset` / `output` / `object` never fail.
 */
function controlValid(ctx, wrapper) {
  const handle = ctx.documentContext.handleOf(wrapper);
  const tag = tagOf(handle);
  if (tag === "fieldset" || tag === "output" || tag === "object") return true;
  const disabled = handle.getAttribute("disabled") !== null;
  if (tag === "select") return disabled || validityFlagsOf(ctx, wrapper).valid;
  const readOnly =
    (tag === "input" || tag === "textarea") && handle.getAttribute("readonly") !== null;
  let barred = false;
  if (tag === "input") {
    const type = handle.inputType();
    barred = type === "hidden" || type === "reset" || type === "button";
  } else if (tag === "button") {
    const type = computedTypeOf(ctx, wrapper);
    barred = type === "reset" || type === "button";
  }
  return disabled || readOnly || barred || validityFlagsOf(ctx, wrapper).valid;
}

/**
 * The happy-dom `control.validationMessage`: the `setCustomValidity` payload
 * first; otherwise `"Constraints not satisfied"` for a will-validating control
 * that fails a constraint; otherwise `""`. `fieldset` is always `""`;
 * `output` / `object` report only the custom payload.
 */
function validationMessageOf(ctx, wrapper) {
  const handle = ctx.documentContext.handleOf(wrapper);
  const tag = tagOf(handle);
  const custom = handle.customValidity();
  if (tag === "fieldset") return "";
  if (tag === "output" || tag === "object") return custom;
  if (custom) return custom;
  if (controlWillValidate(ctx, wrapper) && !validityFlagsOf(ctx, wrapper).valid) {
    return "Constraints not satisfied";
  }
  return "";
}

/**
 * The invalid controls of a form, in document order, with the happy-dom
 * radio-group dedup (only the first radio of a named group is evaluated).
 */
function formInvalidControls(ctx, form) {
  const handle = facadeNodeHandle(ctx, form, "checkValidity");
  const invalid = [];
  const radioSeen = new Set();
  for (const item of handle.formElements()) {
    const wrapper = ctx.wrap(item);
    const control = ctx.documentContext.handleOf(wrapper);
    const tag = tagOf(control);
    if (tag === "input" && control.inputType() === "radio" && control.getAttribute("name")) {
      const name = control.getAttribute("name");
      if (radioSeen.has(name)) continue;
      radioSeen.add(name);
    }
    if (!controlValid(ctx, wrapper)) invalid.push(wrapper);
  }
  return invalid;
}

/**
 * The `form.checkValidity()` evaluation: every invalid control gets a bubbling
 * cancelable `invalid` event (in document order), and the method reports
 * whether the form is valid.
 */
function formCheckValidity(ctx, form) {
  const invalid = formInvalidControls(ctx, form);
  for (const control of invalid) {
    control.dispatchEvent(new Event("invalid", { bubbles: true, cancelable: true }));
  }
  return invalid.length === 0;
}

/** The `form.reportValidity()` / control `reportValidity()` result. */
function reportValidityResult(ctx, wrapper) {
  const handle = facadeNodeHandle(ctx, wrapper, "reportValidity");
  if (tagOf(handle) === "form") return formCheckValidity(ctx, wrapper);
  if (!isValidationSurface(handle)) return undefined;
  return wrapper.checkValidity();
}

/**
 * Installs the T40 form surface.
 *
 * `ctx.defineAccessor` / `ctx.defineMethod` are the only property-definition
 * paths used here; their default descriptors are fixed, non-enumerable and
 * non-configurable, matching the rest of the facade surface.
 */
export function install(ctx) {
  // The shared live-collection prototype surface for the form collections.
  installCollectionPrototype(ctx, HTMLFormControlsCollection);
  installCollectionPrototype(ctx, HTMLOptionsCollection);

  // `select.options.selectedIndex` (happy-dom HTMLOptionsCollection): delegates
  // to the owning select's native selection surface.
  ctx.defineAccessor(HTMLOptionsCollection.prototype, "selectedIndex", function selectedIndex() {
    const select = OPTIONS_OWNER_SELECT.get(this);
    if (select === undefined) return -1;
    return select.selectedIndex;
  }, function selectedIndex(v) {
    const select = OPTIONS_OWNER_SELECT.get(this);
    if (select === undefined) return;
    select.selectedIndex = v;
  });

  // `select.options.add(option, before?)` — append or insert an option;
  // `before` may be an index or an element. A `before` element that is not in
  // the collection throws a NotFoundError DOMException (happy-dom parity).
  ctx.defineMethod(HTMLOptionsCollection.prototype, "add", function add(option, before) {
    const select = OPTIONS_OWNER_SELECT.get(this);
    if (select === undefined) return;
    const items = readItems(this);
    let beforeNode;
    if (typeof before === "number") {
      beforeNode = items[Number(before)];
    } else if (before !== undefined && before !== null) {
      beforeNode = before;
      if (!items.includes(beforeNode)) {
        throw new DOMException(
          "Failed to execute 'add' on 'HTMLOptionsCollection': The node before which the new node is to be inserted is not a child of this node.",
          "NotFoundError",
        );
      }
    }
    if (beforeNode === undefined) {
      select.appendChild(option);
    } else {
      select.insertBefore(option, beforeNode);
    }
  });

  // `select.options.remove(index)` — remove the option at `index`. When the
  // removed option was the selected one, the select re-selects the first
  // remaining option (happy-dom parity).
  ctx.defineMethod(HTMLOptionsCollection.prototype, "remove", function remove(index) {
    const select = OPTIONS_OWNER_SELECT.get(this);
    if (select === undefined) return;
    const items = readItems(this);
    const item = items[Number(index)];
    if (item === undefined) return;
    item.remove();
    if (select.selectedIndex === -1 && readItems(this).length > 0) {
      select.selectedIndex = 0;
    }
  });

  // `Node.isConnected` — the native T39 read behind the checkbox/radio
  // input/change rule and general DOM usage.
  ctx.defineAccessor(Node.prototype, "isConnected", function isConnected() {
    return facadeNodeHandle(ctx, this, "isConnected").isConnected();
  }, undefined);

  // --- value ---------------------------------------------------------------

  ctx.defineAccessor(Node.prototype, "value", function value() {
    const handle = facadeNodeHandle(ctx, this, "value");
    switch (tagOf(handle)) {
      case "input":
        return handle.inputValue();
      case "select":
        return handle.selectValue();
      case "textarea":
        return handle.textareaValue();
      case "button":
        return handle.getAttribute("value") || "";
      case "option":
        return handle.optionValue();
      default:
        return undefined;
    }
  }, function value(v) {
    const handle = facadeNodeHandle(ctx, this, "value");
    switch (tagOf(handle)) {
      case "input":
        handle.setInputValue(v === null ? "" : String(v));
        break;
      case "select":
        handle.setSelectValue(String(v));
        break;
      case "textarea":
        handle.setTextareaValue(String(v));
        break;
      case "button":
      case "option":
        handle.setAttribute("value", String(v));
        break;
      default:
        break;
    }
  });

  // --- name / type / disabled / required / readOnly / multiple ---------------

  // `name` redefines the T33 `Node.prototype.name` accessor (made configurable
  // for this seam): the T33 DocumentType read (`handle.name()`) is preserved
  // for non-form nodes, while form controls / forms reflect the `name`
  // attribute two-way.
  ctx.defineAccessor(Node.prototype, "name", function name() {
    const handle = facadeNodeHandle(ctx, this, "name");
    if (isOneOf(handle, ["input", "button", "select", "textarea", "form"])) {
      return handle.getAttribute("name") || "";
    }
    return handle.name() ?? undefined;
  }, function name(v) {
    const handle = facadeNodeHandle(ctx, this, "name");
    if (isOneOf(handle, ["input", "button", "select", "textarea", "form"])) {
      handle.setAttribute("name", String(v));
    }
  });

  ctx.defineAccessor(Node.prototype, "type", function type() {
    const handle = facadeNodeHandle(ctx, this, "type");
    const tag = tagOf(handle);
    if (tag === "input") return handle.inputType();
    if (tag === "button") {
      const value = handle.getAttribute("type");
      return value !== null && BUTTON_TYPES.includes(value) ? value : "submit";
    }
    if (tag === "select") {
      return handle.hasAttribute("multiple") ? "select-multiple" : "select-one";
    }
    return undefined;
  }, function type(v) {
    const handle = facadeNodeHandle(ctx, this, "type");
    const tag = tagOf(handle);
    if (tag === "input") {
      handle.setAttribute("type", String(v).toLowerCase());
    } else if (tag === "button") {
      handle.setAttribute("type", String(v));
    }
  });

  ctx.defineAccessor(Node.prototype, "disabled", function disabled() {
    const handle = facadeNodeHandle(ctx, this, "disabled");
    if (!isOneOf(handle, ["input", "button", "select", "textarea", "option"])) {
      return undefined;
    }
    return handle.getAttribute("disabled") !== null;
  }, function disabled(v) {
    const handle = facadeNodeHandle(ctx, this, "disabled");
    if (!isOneOf(handle, ["input", "button", "select", "textarea", "option"])) return;
    if (v) {
      handle.setAttribute("disabled", "");
    } else {
      handle.removeAttribute("disabled");
    }
  });

  ctx.defineAccessor(Node.prototype, "required", function required() {
    const handle = facadeNodeHandle(ctx, this, "required");
    if (!isOneOf(handle, ["input", "select", "textarea"])) return undefined;
    return handle.getAttribute("required") !== null;
  }, function required(v) {
    const handle = facadeNodeHandle(ctx, this, "required");
    if (!isOneOf(handle, ["input", "select", "textarea"])) return;
    if (v) {
      handle.setAttribute("required", "");
    } else {
      handle.removeAttribute("required");
    }
  });

  ctx.defineAccessor(Node.prototype, "readOnly", function readOnly() {
    const handle = facadeNodeHandle(ctx, this, "readOnly");
    if (!isOneOf(handle, ["input", "textarea"])) return undefined;
    return handle.getAttribute("readonly") !== null;
  }, function readOnly(v) {
    const handle = facadeNodeHandle(ctx, this, "readOnly");
    if (!isOneOf(handle, ["input", "textarea"])) return;
    if (v) {
      handle.setAttribute("readonly", "");
    } else {
      handle.removeAttribute("readonly");
    }
  });

  ctx.defineAccessor(Node.prototype, "multiple", function multiple() {
    const handle = facadeNodeHandle(ctx, this, "multiple");
    if (!isOneOf(handle, ["input", "select"])) return undefined;
    return handle.getAttribute("multiple") !== null;
  }, function multiple(v) {
    const handle = facadeNodeHandle(ctx, this, "multiple");
    if (!isOneOf(handle, ["input", "select"])) return;
    if (v) {
      handle.setAttribute("multiple", "");
    } else {
      handle.removeAttribute("multiple");
    }
  });

  // --- checked / defaultChecked / defaultValue ------------------------------

  ctx.defineAccessor(Node.prototype, "checked", function checked() {
    const handle = facadeNodeHandle(ctx, this, "checked");
    if (tagOf(handle) !== "input") return undefined;
    return handle.inputChecked();
  }, function checked(v) {
    const handle = facadeNodeHandle(ctx, this, "checked");
    if (tagOf(handle) !== "input") return;
    handle.setInputChecked(Boolean(v));
  });

  ctx.defineAccessor(Node.prototype, "defaultChecked", function defaultChecked() {
    const handle = facadeNodeHandle(ctx, this, "defaultChecked");
    if (tagOf(handle) !== "input") return undefined;
    return handle.hasAttribute("checked");
  }, function defaultChecked(v) {
    const handle = facadeNodeHandle(ctx, this, "defaultChecked");
    if (tagOf(handle) !== "input") return;
    if (v) {
      handle.setAttribute("checked", "");
    } else {
      handle.removeAttribute("checked");
    }
  });

  ctx.defineAccessor(Node.prototype, "defaultValue", function defaultValue() {
    const handle = facadeNodeHandle(ctx, this, "defaultValue");
    const tag = tagOf(handle);
    if (tag === "input") return handle.getAttribute("value") || "";
    if (tag === "textarea") return handle.textContent();
    return undefined;
  }, function defaultValue(v) {
    const handle = facadeNodeHandle(ctx, this, "defaultValue");
    const tag = tagOf(handle);
    if (tag === "input") {
      handle.setAttribute("value", String(v));
    } else if (tag === "textarea") {
      handle.setTextContent(String(v));
    }
  });

  // --- option.selected / option.index / option.text --------------------------

  ctx.defineAccessor(Node.prototype, "selected", function selected() {
    const handle = facadeNodeHandle(ctx, this, "selected");
    if (tagOf(handle) !== "option") return undefined;
    return handle.optionSelected();
  }, function selected(v) {
    const handle = facadeNodeHandle(ctx, this, "selected");
    if (tagOf(handle) !== "option") return;
    handle.setOptionSelected(Boolean(v));
  });

  ctx.defineAccessor(Node.prototype, "index", function index() {
    const handle = facadeNodeHandle(ctx, this, "index");
    if (tagOf(handle) !== "option") return undefined;
    return handle.optionIndex();
  }, undefined);

  // `option.text`: the rendered text of an option — its text content in the
  // current model (happy-dom's `innerText`; layout is out of scope).
  ctx.defineAccessor(Node.prototype, "text", function text() {
    const handle = facadeNodeHandle(ctx, this, "text");
    if (tagOf(handle) !== "option") return undefined;
    return handle.textContent() ?? "";
  }, function text(v) {
    const handle = facadeNodeHandle(ctx, this, "text");
    if (tagOf(handle) !== "option") return;
    handle.setTextContent(String(v));
  });

  // --- select: options / selectedOptions / item / length --------------------

  ctx.defineAccessor(Node.prototype, "options", function options() {
    const handle = facadeNodeHandle(ctx, this, "options");
    if (tagOf(handle) !== "select") return undefined;
    return selectOptionsOf(ctx, this);
  }, undefined);

  ctx.defineAccessor(Node.prototype, "selectedIndex", function selectedIndex() {
    const handle = facadeNodeHandle(ctx, this, "selectedIndex");
    if (tagOf(handle) !== "select") return undefined;
    return handle.selectSelectedIndex();
  }, function selectedIndex(v) {
    const handle = facadeNodeHandle(ctx, this, "selectedIndex");
    if (tagOf(handle) !== "select") return;
    const n = Number(v);
    if (Number.isNaN(n)) return;
    handle.setSelectSelectedIndex(n);
  });

  ctx.defineAccessor(Node.prototype, "selectedOptions", function selectedOptions() {
    const handle = facadeNodeHandle(ctx, this, "selectedOptions");
    if (tagOf(handle) !== "select") return undefined;
    return selectedOptionsOf(ctx, this);
  }, undefined);

  ctx.defineMethod(Node.prototype, "item", function item(index) {
    const handle = facadeNodeHandle(ctx, this, "item");
    if (tagOf(handle) !== "select") return undefined;
    const options = selectOptionsOf(ctx, this);
    return index >= 0 && options[index] ? options[index] : null;
  });

  // `length` redefines the T33 `Node.prototype.length` accessor (made
  // configurable for this seam): a `select` / `form` reports its live option /
  // control count, while every other node keeps the T33 CharacterData read.
  ctx.defineAccessor(Node.prototype, "length", function length() {
    const handle = facadeNodeHandle(ctx, this, "length");
    const tag = tagOf(handle);
    if (tag === "select") return selectOptionsOf(ctx, this).length;
    if (tag === "form") return formElementsOf(ctx, this).length;
    return handle.dataLength() ?? undefined;
  }, undefined);

  // --- form: elements / name / method / action / target / enctype / ... -----

  ctx.defineAccessor(Node.prototype, "elements", function elements() {
    const handle = facadeNodeHandle(ctx, this, "elements");
    if (tagOf(handle) !== "form") return undefined;
    return formElementsOf(ctx, this);
  }, undefined);

  ctx.defineAccessor(Node.prototype, "method", function method() {
    const handle = facadeNodeHandle(ctx, this, "method");
    if (tagOf(handle) !== "form") return undefined;
    return handle.getAttribute("method") || "get";
  }, function method(v) {
    const handle = facadeNodeHandle(ctx, this, "method");
    if (tagOf(handle) === "form") handle.setAttribute("method", String(v));
  });

  ctx.defineAccessor(Node.prototype, "action", function action() {
    const handle = facadeNodeHandle(ctx, this, "action");
    if (tagOf(handle) !== "form") return undefined;
    return handle.getAttribute("action") || "";
  }, function action(v) {
    const handle = facadeNodeHandle(ctx, this, "action");
    if (tagOf(handle) === "form") handle.setAttribute("action", String(v));
  });

  // `form.target` reads the `target` attribute; it stays a recorded gap (the
  // T33 `Node.prototype.target` accessor is read-only and shared by the
  // single-class model).

  ctx.defineAccessor(Node.prototype, "enctype", function enctype() {
    const handle = facadeNodeHandle(ctx, this, "enctype");
    if (tagOf(handle) !== "form") return undefined;
    return handle.getAttribute("enctype") || "";
  }, function enctype(v) {
    const handle = facadeNodeHandle(ctx, this, "enctype");
    if (tagOf(handle) === "form") handle.setAttribute("enctype", String(v));
  });

  ctx.defineAccessor(Node.prototype, "acceptCharset", function acceptCharset() {
    const handle = facadeNodeHandle(ctx, this, "acceptCharset");
    if (tagOf(handle) !== "form") return undefined;
    return handle.getAttribute("acceptcharset") || "";
  }, function acceptCharset(v) {
    const handle = facadeNodeHandle(ctx, this, "acceptCharset");
    if (tagOf(handle) === "form") handle.setAttribute("acceptcharset", String(v));
  });

  ctx.defineAccessor(Node.prototype, "noValidate", function noValidate() {
    const handle = facadeNodeHandle(ctx, this, "noValidate");
    if (tagOf(handle) !== "form") return undefined;
    return handle.getAttribute("novalidate") !== null;
  }, function noValidate(v) {
    const handle = facadeNodeHandle(ctx, this, "noValidate");
    if (tagOf(handle) !== "form") return;
    if (v) {
      handle.setAttribute("novalidate", "");
    } else {
      handle.removeAttribute("novalidate");
    }
  });

  // --- control.form ---------------------------------------------------------

  ctx.defineAccessor(Node.prototype, "form", function form() {
    const handle = facadeNodeHandle(ctx, this, "form");
    if (!isOneOf(handle, ["input", "button", "select", "textarea", "option"])) {
      return undefined;
    }
    return ctx.wrap(handle.ownerForm());
  }, undefined);

  // --- submit / reset / validity --------------------------------------------

  ctx.defineMethod(Node.prototype, "submit", function submit() {
    const handle = facadeNodeHandle(ctx, this, "submit");
    if (tagOf(handle) !== "form") return;
    // WHATWG: `submit()` performs the navigation without dispatching a
    // `submit` event. Real navigation is out of the T40 boundary, so this is a
    // no-op (recorded gap).
  });

  ctx.defineMethod(Node.prototype, "requestSubmit", function requestSubmit(submitter) {
    const handle = facadeNodeHandle(ctx, this, "requestSubmit");
    if (tagOf(handle) !== "form") return;
    const noValidate = Boolean(submitter && submitter.formNoValidate) || this.noValidate;
    if (noValidate || this.checkValidity()) {
      const event = new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: submitter ?? this,
      });
      this.dispatchEvent(event);
      if (!event.defaultPrevented) {
        this.submit();
      }
    }
  });

  ctx.defineMethod(Node.prototype, "reset", function reset() {
    const handle = facadeNodeHandle(ctx, this, "reset");
    if (tagOf(handle) !== "form") return;
    handle.formReset();
    this.dispatchEvent(new Event("reset", { bubbles: true, cancelable: true }));
  });

  ctx.defineMethod(Node.prototype, "checkValidity", function checkValidity() {
    const handle = facadeNodeHandle(ctx, this, "checkValidity");
    const tag = tagOf(handle);
    if (tag === "form") return formCheckValidity(ctx, this);
    if (!isValidationSurface(handle)) return undefined;
    const valid = controlValid(ctx, this);
    if (!valid) {
      this.dispatchEvent(new Event("invalid", { bubbles: true, cancelable: true }));
    }
    return valid;
  });

  ctx.defineMethod(Node.prototype, "reportValidity", function reportValidity() {
    return reportValidityResult(ctx, this);
  });

  // --- constraint validation (T48C) -----------------------------------------

  ctx.defineAccessor(Node.prototype, "validity", function validity() {
    const handle = facadeNodeHandle(ctx, this, "validity");
    if (!isValidityControl(handle)) return undefined;
    let state = CONTROL_VALIDITY.get(this);
    if (state === undefined) {
      state = new ValidityState(this);
      CONTROL_VALIDITY.set(this, state);
    }
    return state;
  }, undefined);

  ctx.defineAccessor(Node.prototype, "willValidate", function willValidate() {
    const handle = facadeNodeHandle(ctx, this, "willValidate");
    if (!isValidationSurface(handle)) return undefined;
    return controlWillValidate(ctx, this);
  }, undefined);

  ctx.defineAccessor(Node.prototype, "validationMessage", function validationMessage() {
    const handle = facadeNodeHandle(ctx, this, "validationMessage");
    if (!isValidationSurface(handle)) return undefined;
    return validationMessageOf(ctx, this);
  }, undefined);

  ctx.defineMethod(Node.prototype, "setCustomValidity", function setCustomValidity(message) {
    const handle = facadeNodeHandle(ctx, this, "setCustomValidity");
    if (tagOf(handle) === "fieldset") return;
    if (!isValidationSurface(handle)) return;
    handle.setCustomValidity(String(message));
  });

  // `formNoValidate` (T48C): the submitter-side `formnovalidate` reflection
  // that lets a single submit button bypass the form's validation gate.
  ctx.defineAccessor(Node.prototype, "formNoValidate", function formNoValidate() {
    const handle = facadeNodeHandle(ctx, this, "formNoValidate");
    if (!isOneOf(handle, ["input", "button"])) return undefined;
    return handle.getAttribute("formnovalidate") !== null;
  }, function formNoValidate(v) {
    const handle = facadeNodeHandle(ctx, this, "formNoValidate");
    if (!isOneOf(handle, ["input", "button"])) return;
    if (v) {
      handle.setAttribute("formnovalidate", "");
    } else {
      handle.removeAttribute("formnovalidate");
    }
  });

  // The `ValidityState` flag getters: live recomputations over the native
  // contract, non-enumerable prototype accessors (the happy-dom instance shape
  // keeps only the `element` own property).
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
    const flagName = flag;
    ctx.defineAccessor(ValidityState.prototype, flag, function flagGetter() {
      return validityFlagsOf(ctx, VALIDITY_OWNERS.get(this))[flagName];
    }, undefined);
  }

  // --- click (input / button default actions) -------------------------------
  //
  // Since T48A the per-tag classes sit *above* `HTMLElement`, so the T39 base
  // `HTMLElement.prototype.click` would shadow any `Node.prototype` override.
  // The form default actions therefore live on the `HTMLInputElement` /
  // `HTMLButtonElement` prototypes: `click()` runs the happy-dom
  // `dispatchEvent` default action — the checkbox/radio toggle before dispatch
  // (restored on `preventDefault`) followed by the `input`/`change` sequence,
  // and the submit/reset trigger for a `submit`/`reset` type. Every other
  // element resolves the base `HTMLElement.prototype.click`.
  const clickWithDefaultAction = function click() {
    const handle = facadeNodeHandle(ctx, this, "click");
    if (this.disabled) return;
    const type = this.type;
    let previousChecked = null;
    if (type === "checkbox" || type === "radio") {
      previousChecked = this.checked;
      handle.setInputChecked(type === "checkbox" ? !previousChecked : true);
    }
    const event = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
    this.dispatchEvent(event);
    if (event.defaultPrevented) {
      if (previousChecked !== null) handle.setInputChecked(previousChecked);
      return;
    }
    if (type === "checkbox" || type === "radio") {
      const changed = type === "checkbox" || !previousChecked;
      if (changed && handle.isConnected()) {
        this.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        this.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      }
    } else if (type === "submit" || type === "reset") {
      const form = this.form;
      if (form) {
        if (type === "submit" && handle.isConnected()) {
          form.requestSubmit(this);
        } else if (type === "reset") {
          form.reset();
        }
      }
    }
  };
  ctx.defineMethod(HTMLInputElement.prototype, "click", clickWithDefaultAction);
  ctx.defineMethod(HTMLButtonElement.prototype, "click", clickWithDefaultAction);

  // --- window constructor accessors ------------------------------------------
  //
  // The per-tag element classes (`window.HTMLFormElement`, `window.HTMLInput
  // Element`, ...) are owned by the html-element extension (T48A); this module
  // only exposes the collection and event classes.

  ctx.defineAccessor(Window.prototype, "HTMLFormControlsCollection", function getFormControlsCollection() {
    return HTMLFormControlsCollection;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "HTMLOptionsCollection", function getOptionsCollection() {
    return HTMLOptionsCollection;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "SubmitEvent", function getSubmitEvent() {
    return SubmitEvent;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "ValidityState", function getValidityState() {
    return ValidityState;
  }, undefined);
}
