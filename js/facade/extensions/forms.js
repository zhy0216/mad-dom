// First-batch form-control facade extension (T40).
//
// Installs the basic form surface on `Node.prototype` (the single-class model):
// `input` / `button` / `select` / `option` / `textarea` value/name/type/
// disabled/checked/selected reads and writes, the `form` element's
// `elements` / `length` / `submit` / `requestSubmit` / `reset` and the live
// collections behind `form.elements`, `select.options` and
// `select.selectedOptions`.
//
// # No second form state
//
// The stateful reads/writes delegate to the native T40 form contract
// (crates/mad-dom-bun/src/extensions/form_api.rs) and through it to Core's
// per-document `form_state` (mad_dom_core::dom::form): the dirty input value /
// textarea value, the dirty checkedness, the option/select selection model and
// the reset algorithm all live in Core. The attribute-only reflections
// (`name` / `disabled` / `required` / `readOnly` / `multiple` / `method` /
// `action` / `target` / `enctype` / ...) are pure reads/writes over the T25E
// attribute contract, exactly like the T39 reflected accessors — so the facade
// keeps **no second authoritative state** and the arena + Core's form state are
// the single source of truth.
//
// # Live collections
//
// `form.elements`, `select.options` and `select.selectedOptions` are live
// collections: every access re-reads Core through the native handle
// (`formElements()` / `getElementsByTagName("option")` /
// `selectSelectedOptions()`), so an existing collection reflects any tree or
// attribute change immediately. One and the same collection object is returned
// per form / per select (cached in a WeakMap), mirroring happy-dom.
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
// Real navigation on `submit()` is out of scope (T40 boundary) and is a no-op.
//
// # Recorded gaps (advanced form behavior)
//
// Constraint validation is **not** implemented: `ValidityState`,
// `checkValidity` / `reportValidity` constraint evaluation, `setCustomValidity`
// and the `invalid` event are absent, so `checkValidity` / `reportValidity`
// return `true`. Also unimplemented and explicit gaps: `input` selection
// ranges, `valueAsNumber` / `valueAsDate`, `FileList`, the `form` attribute's
// external-form association, `select.add` / `select.remove`, `form[name]`
// named access and the per-tag `instanceof window.HTMLInputElement` split (the
// single-class deviation). The date/time/color `input` value sanitizers store
// the raw string (see Core `form.rs`).
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`; nothing else in the registry changes beyond the
// import and array entry.

import { Node } from "./node.js";
import { Window } from "../window.js";
import { Event, MouseEvent } from "./events.js";

export const seam = Object.freeze({
  id: "facade/extensions/forms",
  owner: "T40",
  gate: "T40",
  status: "implemented",
});

// --- constructor accessor classes (single-class model) ----------------------

/** `HTMLFormElement` facade base class (T40). */
export class HTMLFormElement {}
/** `HTMLInputElement` facade base class (T40). */
export class HTMLInputElement {}
/** `HTMLButtonElement` facade base class (T40). */
export class HTMLButtonElement {}
/** `HTMLSelectElement` facade base class (T40). */
export class HTMLSelectElement {}
/** `HTMLOptionElement` facade base class (T40). */
export class HTMLOptionElement {}
/** `HTMLTextAreaElement` facade base class (T40). */
export class HTMLTextAreaElement {}
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

// --- helpers ----------------------------------------------------------------

const BUTTON_TYPES = ["submit", "reset", "button", "menu"];

// One cached live collection per owner wrapper: form -> elements, select ->
// options / selectedOptions (happy-dom caches these identities).
const FORM_ELEMENTS = new WeakMap();
const SELECT_OPTIONS = new WeakMap();
const SELECTED_OPTIONS = new WeakMap();

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
    if (tagOf(handle) !== "form") return undefined;
    // Constraint validation is not implemented (T40 gap): a form without the
    // advanced validity machinery is always valid.
    return true;
  });

  ctx.defineMethod(Node.prototype, "reportValidity", function reportValidity() {
    const handle = facadeNodeHandle(ctx, this, "reportValidity");
    if (tagOf(handle) !== "form") return undefined;
    return true;
  });

  // --- click (input / button default actions) -------------------------------
  //
  // Shadows `HTMLElement.prototype.click` (T39) on `Node.prototype`: for every
  // non-form element it reproduces the T39 behavior exactly (a bubbling,
  // cancelable, composed plain `click` event), while an `input` / `button` runs
  // the happy-dom `dispatchEvent` default action — the checkbox/radio toggle
  // before dispatch (restored on `preventDefault`) followed by the
  // `input`/`change` sequence, and the submit/reset trigger for a
  // `submit`/`reset` type.
  ctx.defineMethod(Node.prototype, "click", function click() {
    const handle = facadeNodeHandle(ctx, this, "click");
    const tag = tagOf(handle);
    if (tag === "input" || tag === "button") {
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
      return;
    }
    this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true, composed: true }));
  });

  // --- window constructor accessors ------------------------------------------

  ctx.defineAccessor(Window.prototype, "HTMLFormElement", function getHTMLFormElement() {
    return HTMLFormElement;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "HTMLInputElement", function getHTMLInputElement() {
    return HTMLInputElement;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "HTMLButtonElement", function getHTMLButtonElement() {
    return HTMLButtonElement;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "HTMLSelectElement", function getHTMLSelectElement() {
    return HTMLSelectElement;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "HTMLOptionElement", function getHTMLOptionElement() {
    return HTMLOptionElement;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "HTMLTextAreaElement", function getHTMLTextAreaElement() {
    return HTMLTextAreaElement;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "HTMLFormControlsCollection", function getFormControlsCollection() {
    return HTMLFormControlsCollection;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "HTMLOptionsCollection", function getOptionsCollection() {
    return HTMLOptionsCollection;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "SubmitEvent", function getSubmitEvent() {
    return SubmitEvent;
  }, undefined);
}
