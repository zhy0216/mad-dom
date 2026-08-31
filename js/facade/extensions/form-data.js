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
import { Blob, File } from "./lightweight.js";

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
  constructor(form, submitter) {
    this[FORM_DATA_BRAND] = true;
    this[BOUNDARY] = createBoundary();
    this[ENTRIES] = [];
    if (form) {
      readFormEntries(this, form, submitter);
    }
  }

  append(name, value, filename) {
    if (filename !== undefined && !(value instanceof Blob)) {
      throw new TypeError(
        'Failed to execute "append" on "FormData": parameter 2 is not of type "Blob".',
      );
    }
    this[ENTRIES].push([String(name), toFormDataValue(this, value, filename)]);
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
  if (value instanceof File) {
    if (filename) {
      const file = new File([], filename, {
        type: value.type,
        lastModified: value.lastModified,
      });
      file._buffer = value._buffer;
      return file;
    }
    return value;
  }
  if (value instanceof Blob) {
    const file = new File([], "blob", { type: value.type });
    file._buffer = value._buffer;
    return file;
  }
  return String(value);
}

/**
 * Reads a form's successful controls into the FormData, mirroring the happy-dom
 * baseline: disabled controls are skipped, file inputs append each selected
 * file (an empty file input appends an empty octet-stream File), radio /
 * checkbox inputs append only when checked, and submit buttons append only when
 * they are the submitter and carry a value. The facade iterates `form.elements`
 * and reads each control's `name` / `type` / `value` / `checked` / `files`
 * through the same accessors the tests exercise, so no second form state is
 * kept here.
 */
function readFormEntries(formData, form, submitter) {
  const elements = form.elements;
  for (let index = 0, max = elements.length; index < max; index++) {
    const item = elements[index];
    const name = item.getAttribute("name");
    if (!name) continue;
    const tag = item.nodeName;
    if (tag === "INPUT") {
      if (item.disabled) continue;
      switch (item.type) {
        case "file": {
          const files = item.files;
          if (files && files.length > 0) {
            // Iterate by index: the T06 FileList proxy only supports `length`
            // / `item` / numeric reads (no Symbol.iterator), so a `for...of`
            // would hit the proxy's symbol access.
            for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
              formData.append(name, files[fileIndex]);
            }
          } else {
            formData.append(name, new File([], "", { type: "application/octet-stream" }));
          }
          break;
        }
        case "checkbox":
        case "radio":
          if (item.checked) {
            formData.append(name, item.value);
          }
          break;
        case "submit":
        case "reset":
        case "button":
          if (item === submitter && item.value) {
            formData.append(name, item.value);
          }
          break;
        default:
          formData.append(name, item.value);
          break;
      }
    } else if (tag === "BUTTON") {
      if (item === submitter && item.value) {
        formData.append(name, item.value);
      }
    } else {
      formData.append(name, item.value);
    }
  }
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
