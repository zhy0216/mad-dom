// Data-transfer facade extension (T07 hdunit event/dom/window/browser wave).
//
// Installs the drag-and-drop clipboard data classes happy-dom exposes as
// module bindings — `DataTransfer`, `DataTransferItem` and
// `DataTransferItemList` — following the baseline implementation
// observation-for-observation:
//
//   - `DataTransfer` — `dropEffect` / `effectAllowed` (own data fields with
//     the baseline defaults), a live `items` list, the derived `files` /
//     `types` reads, `clearData`, the `setData` replacement semantics
//     (a matching existing type is replaced in place, otherwise appended),
//     `getData` with the HTML-spec `text` → `text/plain` / `url` →
//     `text/uri-list` normalization, and `setDragImage` which throws
//     `'Not implemented.'` exactly like the baseline;
//   - `DataTransferItemList` — an `Array` subclass whose `add` distinguishes
//     string items (second `type` argument required, else the baseline
//     TypeError) from file items (duck-typed as non-strings; the mad-dom File
//     binding lands in the lightweight wave), plus `remove` / `clear`;
//   - `DataTransferItem` — the `kind` / `type` reads and `getAsFile` /
//     `getAsString` accessors over the stored string or file payload.
//
// These classes carry no DOM tree state and no native handle: their payload
// is plain instance data, so the facade stays state-free (ADR-0001 §6).
//
// This module is picked up by the facade registry (extensions/index.js)
// purely by exporting `install(ctx)`.

export const seam = Object.freeze({
  id: "facade/extensions/dnd",
  owner: "T07",
  gate: "T07",
  status: "implemented",
});

// --- DataTransferItem --------------------------------------------------------

/**
 * `DataTransferItem` facade: the `kind` / `type` reads and `getAsFile` /
 * `getAsString` accessors over the stored string or file payload, matching the
 * baseline (a file item's type is the file's `type`; `getAsString` still calls
 * the callback for file items).
 */
export class DataTransferItem {
  constructor(item, type = "") {
    this.kind = typeof item === "string" ? "string" : "file";
    this.type = this.kind === "string" ? type : item.type;
    this._item = item;
  }

  getAsFile() {
    if (this.kind === "string") {
      return null;
    }
    return this._item;
  }

  getAsString(callback) {
    if (this.kind === "file") {
      callback("");
    }
    callback(String(this._item));
  }
}

// --- DataTransferItemList ----------------------------------------------------

/**
 * `DataTransferItemList` facade: an `Array` subclass with the baseline `add`
 * (strings require the `type` argument; file items are duck-typed non-strings
 * — the File binding lands in the lightweight wave), `remove` and `clear`.
 */
export class DataTransferItemList extends Array {
  add(item, type) {
    if (typeof item !== "string") {
      this.push(new DataTransferItem(item));
      return;
    }
    if (type === undefined || type === null || type === "") {
      throw new TypeError(
        "Failed to execute 'add' on 'DataTransferItemList': parameter 1 is not of type 'File'.",
      );
    }
    this.push(new DataTransferItem(item, type));
  }

  remove(index) {
    this.splice(index, 1);
  }

  clear() {
    while (this.length) {
      this.pop();
    }
  }
}

// --- DataTransfer ------------------------------------------------------------

/**
 * `DataTransfer` facade: the clipboard/drag-and-drop data holder, matching the
 * baseline `items` / `files` / `types` reads, `clearData`, `setData` /
 * `getData` (with the `text`/`url` format normalization) and the throwing
 * `setDragImage`.
 */
export class DataTransfer {
  constructor() {
    this.dropEffect = "none";
    this.effectAllowed = "none";
    this.items = new DataTransferItemList();
  }

  get files() {
    const files = [];
    for (const item of this.items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    return files;
  }

  get types() {
    return this.items.map((item) => item.type);
  }

  clearData() {
    this.items.clear();
  }

  setData(format, data) {
    for (let i = 0, max = this.items.length; i < max; i++) {
      if (this.items[i].type === format) {
        this.items[i] = new DataTransferItem(data, format);
        return;
      }
    }
    this.items.add(data, format);
  }

  getData(format) {
    const normalizedFormat = this.#normalizeFormat(format);
    for (let i = 0, max = this.items.length; i < max; i++) {
      if (this.#normalizeFormat(this.items[i].type) === normalizedFormat) {
        let data = "";
        this.items[i].getAsString((s) => (data = s));
        return data;
      }
    }
    return "";
  }

  #normalizeFormat(format) {
    const lowercaseFormat = String(format).toLowerCase();
    if (lowercaseFormat === "text") {
      return "text/plain";
    }
    if (lowercaseFormat === "url") {
      return "text/uri-list";
    }
    return lowercaseFormat;
  }

  setDragImage() {
    throw new Error("Not implemented.");
  }
}

// --- install -----------------------------------------------------------------

/**
 * The data-transfer classes are module bindings (like the browser/page model)
 * rather than window members in the vendored suite; `install` exists so the
 * registry drives this module, with no additional surface to install.
 */
export function install() {}
