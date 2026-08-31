// FormData facade extension (integration-test surface).
//
// Installs `window.FormData` — the WHATWG multipart form-data container. The
// facade surface mirrors happy-dom's `FormData`:
//
//   - `append(name, value, filename?)`, `delete(name)`, `get(name)`,
//     `getAll(name)`, `has(name)`, `set(name, value)` and the iterator /
//     `keys()` / `values()` / `entries()` / `forEach(cb, thisArg)` surface;
//   - a stable multipart serialization (`getContentType()` / the fetch-body
//     bridge) whose wire format matches happy-dom byte-for-byte: boundary
//     `----HappyDOMFormDataBoundary0.<random alnum>`, parts framed with
//     `--<boundary>\r\nContent-Disposition: form-data; name="…"\r\n\r\n…\r\n`
//     and a `--<boundary>--\r\n` terminator (RFC 2388).
//
// The class holds no second copy of the payload for the fetch bridge: the same
// `FORM_DATA_BRAND`-tagged instance is serialized on demand by
// `serializeFormData()`, which the T46 fetch body path (fetch.js) calls to turn
// a FormData body into a multipart Buffer + `Content-Type`.

import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/form-data",
  owner: "integration",
  gate: "integration",
  status: "implemented",
});

export const FORM_DATA_BRAND = Symbol("mad-dom-form-data");

// The multipart boundary prefix + random tail. The tail is alphanumeric
// ([0-9a-z]) so the regex the happy-dom integration test uses
// (`----HappyDOMFormDataBoundary0\.[a-zA-Z0-9]+`) normalizes it.
function createBoundary() {
  return `----HappyDOMFormDataBoundary0.${Math.random().toString(36).slice(2)}`;
}

export function isFormData(value) {
  return value !== null && value !== undefined && value[FORM_DATA_BRAND] === true;
}

/**
 * Serializes a FormData instance to the happy-dom multipart wire format.
 * Returns `{ buffer, contentType, boundary }`.
 */
export function serializeFormData(formData) {
  const boundary = formData[BOUNDARY];
  const parts = [];
  for (const [name, value] of formData) {
    let part = `--${boundary}\r\n`;
    if (typeof value === "object" && value !== null) {
      part += `Content-Disposition: form-data; name="${name}"; filename="${value.name ?? "blob"}"\r\n`;
      part += "Content-Type: application/octet-stream\r\n";
    } else {
      part += `Content-Disposition: form-data; name="${name}"\r\n`;
    }
    part += `\r\n${String(value)}\r\n`;
    parts.push(part);
  }
  const buffer = Buffer.from(parts.join("") + `--${boundary}--\r\n`);
  return { buffer, contentType: `multipart/form-data; boundary=${boundary}`, boundary };
}

const BOUNDARY = Symbol("mad-dom-form-data-boundary");
const ENTRIES = Symbol("mad-dom-form-data-entries");
const WINDOW = Symbol("mad-dom-window");

export class FormData {
  constructor() {
    this[FORM_DATA_BRAND] = true;
    this[BOUNDARY] = createBoundary();
    this[ENTRIES] = [];
  }

  append(name, value, filename) {
    if (filename !== undefined) {
      this[ENTRIES].push([String(name), toFormDataValue(this, value, filename)]);
      return;
    }
    this[ENTRIES].push([String(name), value]);
  }

  delete(name) {
    const key = String(name);
    this[ENTRIES] = this[ENTRIES].filter(([entryName]) => entryName !== key);
  }

  get(name) {
    const key = String(name);
    for (const [entryName, value] of this[ENTRIES]) {
      if (entryName === key) return value;
    }
    return null;
  }

  getAll(name) {
    const key = String(name);
    return this[ENTRIES].filter(([entryName]) => entryName === key).map(([, value]) => value);
  }

  has(name) {
    const key = String(name);
    return this[ENTRIES].some(([entryName]) => entryName === key);
  }

  set(name, value, filename) {
    const key = String(name);
    this.delete(key);
    this.append(key, value, filename);
  }

  keys() {
    return this[ENTRIES].map(([name]) => name).values();
  }

  values() {
    return this[ENTRIES].map(([, value]) => value).values();
  }

  *entries() {
    yield* this[ENTRIES];
  }

  forEach(callback, thisArg) {
    for (const [name, value] of this[ENTRIES]) {
      callback.call(thisArg, value, name, this);
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  get [Symbol.toStringTag]() {
    return "FormData";
  }
}

function toFormDataValue(formData, value, filename) {
  // File-like objects (with name/type/size) pass through; anything else is
  // stored as a string, matching the multipart serialization above.
  if (value !== null && typeof value === "object" && typeof value.name === "string") {
    return value;
  }
  return String(value);
}

// Per-window subclass minted by the accessor (same pattern as fetch.js).
function createWindowFormData(windowFacade) {
  class WindowFormData extends FormData {}
  Object.defineProperty(WindowFormData.prototype, WINDOW, {
    value: windowFacade,
    configurable: true,
  });
  return WindowFormData;
}

export function install(ctx) {
  ctx.defineAccessor(
    Window.prototype,
    "FormData",
    function getFormData() {
      const handle = ctx.documentContext.handleOf(this.document);
      let constructor = FORM_DATA_SURFACE.get(handle);
      if (constructor === undefined) {
        constructor = createWindowFormData(this);
        FORM_DATA_SURFACE.set(handle, constructor);
      }
      return constructor;
    },
    undefined,
  );
}

const FORM_DATA_SURFACE = new WeakMap();
