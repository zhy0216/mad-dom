// Lightweight window-surface facade extension (T08 hdunit lightweight wave).
//
// Provides the pure-JS platform classes the happy-dom test suite reaches
// through `window.*` that mad-dom implements as plain JavaScript (no native
// handle needed): `ImageData`, `IntersectionObserver`, `Blob`, `File`,
// `FileReader`, the `URL` facade (createObjectURL), `VirtualConsole` and the
// `Clipboard` / `ClipboardItem` / `Permissions` surface. Each class keeps its
// own state in the facade (these are not DOM-tree state, so the "no second
// DOM" rule is untouched); window accessors are installed with the same fixed
// descriptor shape the rest of the facade uses.
//
// This module is picked up by the facade registry (extensions/index.js) purely
// by exporting `install(ctx)`.

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { Window } from "../window.js";

export const seam = Object.freeze({
  id: "facade/extensions/lightweight",
  owner: "T08",
  gate: "T08",
  status: "implemented",
});

// --- ImageData ---------------------------------------------------------------

export class ImageData {
  constructor(dataArray, width, height) {
    if (arguments.length < 2) {
      throw new TypeError(
        `Failed to construct 'ImageData': 2 arguments required, but only ${arguments.length} present.`,
      );
    }
    if (dataArray instanceof Uint8ClampedArray) {
      if (typeof width !== "number") {
        throw new TypeError("Failed to construct 'ImageData': The width argument must be a number.");
      }
      if (height !== undefined && typeof height !== "number") {
        throw new TypeError(
          "Failed to construct 'ImageData': The height argument must be a number.",
        );
      }
      this.data = dataArray;
      this.width = width;
      this.height = height !== undefined ? height : dataArray.length / (width * 4);
    } else {
      if (typeof width !== "number") {
        throw new TypeError(
          "Failed to construct 'ImageData': The height argument must be a number.",
        );
      }
      this.data = new Uint8ClampedArray(dataArray * width * 4);
      this.width = dataArray;
      this.height = width;
    }
  }
}

// --- IntersectionObserver ----------------------------------------------------

export class IntersectionObserver {
  constructor(callback, options) {
    this._callback = callback;
    this._options = options || {};
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

// --- Blob / File -------------------------------------------------------------

function blobBufferOf(bit) {
  if (bit instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bit));
  if (bit instanceof Blob) return bit._buffer;
  if (Buffer.isBuffer(bit)) return bit;
  if (ArrayBuffer.isView(bit)) return Buffer.from(new Uint8Array(bit.buffer, bit.byteOffset, bit.byteLength));
  return Buffer.from(typeof bit === "string" ? bit : String(bit));
}

export class Blob {
  constructor(bits, options) {
    const buffers = [];
    if (bits) {
      for (const bit of bits) buffers.push(blobBufferOf(bit));
    }
    this._buffer = Buffer.concat(buffers);
    this.type = "";
    if (options && options.type && /^[\u0020-\u007E]*$/.test(options.type)) {
      this.type = String(options.type).toLowerCase();
    }
  }
  get size() {
    return this._buffer.length;
  }
  slice(start = 0, end = null, contentType = "") {
    const size = this.size;
    let relativeStart;
    if (start === undefined) relativeStart = 0;
    else if (start < 0) relativeStart = Math.max(size + start, 0);
    else relativeStart = Math.min(start, size);
    let relativeEnd;
    if (end === null) relativeEnd = size;
    else if (end < 0) relativeEnd = Math.max(size + end, 0);
    else relativeEnd = Math.min(end, size);
    const span = Math.max(relativeEnd - relativeStart, 0);
    const blob = new Blob([], { type: contentType });
    blob._buffer = this._buffer.slice(relativeStart, relativeStart + span);
    return blob;
  }
  async arrayBuffer() {
    return new Uint8Array(this._buffer).buffer;
  }
  async text() {
    return this._buffer.toString();
  }
  stream() {
    const buffer = this._buffer;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(buffer);
        controller.close();
      },
    });
  }
  toString() {
    return "[object Blob]";
  }
}

export class File extends Blob {
  constructor(bits, name, options) {
    if (arguments.length < 2) {
      throw new TypeError(
        `Failed to construct 'File': 2 arguments required, but only ${arguments.length} present.`,
      );
    }
    super(bits, options);
    this.name = name;
    this.lastModified = options && options.lastModified ? options.lastModified : Date.now();
  }
}

// --- FileReader --------------------------------------------------------------

const FILE_READER_EMPTY = 0;
const FILE_READER_LOADING = 1;
const FILE_READER_DONE = 2;

export class FileReader {
  constructor() {
    this.error = null;
    this.result = null;
    this.readyState = FILE_READER_EMPTY;
    this.onabort = null;
    this.onerror = null;
    this.onload = null;
    this.onloadstart = null;
    this.onloadend = null;
    this.onprogress = null;
    this._listeners = {};
  }
  readAsArrayBuffer(blob) {
    this._read(blob, "arrayBuffer");
  }
  readAsBinaryString(blob) {
    this._read(blob, "binaryString");
  }
  readAsDataURL(blob) {
    this._read(blob, "dataURL");
  }
  readAsText(blob, encoding = null) {
    this._read(blob, "text");
  }
  abort() {
    this.readyState = FILE_READER_DONE;
    this.result = null;
    this._dispatch("abort");
    this._dispatch("loadend");
  }
  _read(blob, format) {
    if (!(blob instanceof Blob)) {
      throw new TypeError(
        `Failed to execute '${this._formatName(format)}' on 'FileReader': parameter 1 is not of type 'Blob'.`,
      );
    }
    this.readyState = FILE_READER_LOADING;
    this._dispatch("loadstart");
    let result;
    if (format === "arrayBuffer") {
      result = new Uint8Array(blob._buffer).buffer;
    } else if (format === "binaryString") {
      result = blob._buffer.toString("latin1");
    } else if (format === "dataURL") {
      result = `data:${blob.type || ""};base64,${blob._buffer.toString("base64")}`;
    } else {
      result = blob._buffer.toString("utf8");
    }
    this.result = result;
    this.readyState = FILE_READER_DONE;
    this._dispatch("load");
    this._dispatch("loadend");
  }
  _formatName(format) {
    switch (format) {
      case "arrayBuffer":
        return "readAsArrayBuffer";
      case "binaryString":
        return "readAsBinaryString";
      case "dataURL":
        return "readAsDataURL";
      default:
        return "readAsText";
    }
  }
  addEventListener(type, listener) {
    (this._listeners[type] = this._listeners[type] || []).push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this._listeners[type];
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index !== -1) listeners.splice(index, 1);
  }
  dispatchEvent(event) {
    this._dispatch(event.type, event);
    return true;
  }
  _dispatch(type, event) {
    const listeners = this._listeners[type];
    if (listeners) {
      for (const listener of [...listeners]) listener(event ?? { type });
    }
    const handler = this[`on${type}`];
    if (typeof handler === "function") handler(event ?? { type });
  }
}

// --- URL facade --------------------------------------------------------------

/**
 * `window.URL` facade: subclasses the host `URL` (parse/throw parity with the
 * baseline comes from the host) and overrides `createObjectURL` to emit the
 * happy-dom `blob:nodedata:` prefix (the upstream test suite pins it). The
 * constructor rethrows an invalid URL as a plain `TypeError('Invalid URL')`
 * exactly like happy-dom (the host adds `code`/`input` own keys that a
 * `toEqual(new TypeError(...))` comparison would not match).
 */
export class URL extends globalThis.URL {
  constructor(url, base) {
    try {
      super(url, base);
    } catch {
      super("about:blank");
      throw new TypeError("Invalid URL");
    }
  }
  static createObjectURL(object) {
    return `blob:nodedata:${randomUUID()}`;
  }
  static revokeObjectURL(url) {}
}

// --- VirtualConsole ----------------------------------------------------------

const LOG_LEVEL = { log: 0, info: 1, warn: 2, error: 3 };
const LOG_TYPE = {
  log: "log",
  table: "table",
  trace: "trace",
  dir: "dir",
  dirxml: "dirxml",
  group: "group",
  groupCollapsed: "groupCollapsed",
  debug: "debug",
  timeLog: "timeLog",
  info: "info",
  count: "count",
  timeEnd: "timeEnd",
  warn: "warn",
  countReset: "countReset",
  error: "error",
  assert: "assert",
};

export class VirtualConsole {
  constructor(printer) {
    this._printer = printer;
    this._count = {};
    this._time = {};
    this._groupID = 0;
    this._groups = [];
  }
  assert(assertion, message, ...args) {
    if (!assertion) {
      this._printer.print({
        type: LOG_TYPE.assert,
        level: LOG_LEVEL.error,
        message: ["Assertion failed:", ...(message ? [message, ...args] : args)],
        group: this._groups[this._groups.length - 1] || null,
      });
    }
  }
  clear() {
    this._printer.clear();
  }
  count(label = "default") {
    if (!this._count[label]) this._count[label] = 0;
    this._count[label]++;
    this._printer.print({
      type: LOG_TYPE.count,
      level: LOG_LEVEL.info,
      message: [`${label}: ${this._count[label]}`],
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  countReset(label = "default") {
    delete this._count[label];
    this._printer.print({
      type: LOG_TYPE.countReset,
      level: LOG_LEVEL.warn,
      message: [`${label}: 0`],
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  debug(message, ...args) {
    this._printer.print({
      type: LOG_TYPE.debug,
      level: LOG_LEVEL.log,
      message: message ? [message, ...args] : args,
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  dir(data) {
    this._printer.print({
      type: LOG_TYPE.dir,
      level: LOG_LEVEL.log,
      message: [data],
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  dirxml(data) {
    this._printer.print({
      type: LOG_TYPE.dirxml,
      level: LOG_LEVEL.log,
      message: [data],
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  error(message, ...args) {
    this._printer.print({
      type: LOG_TYPE.error,
      level: LOG_LEVEL.error,
      message: message ? [message, ...args] : args,
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  exception(...args) {
    this.error(...args);
  }
  group(label) {
    this._groupID++;
    const group = {
      id: this._groupID,
      label: label || "default",
      collapsed: false,
      parent: this._groups[this._groups.length - 1] || null,
    };
    this._groups.push(group);
    this._printer.print({
      type: LOG_TYPE.group,
      level: LOG_LEVEL.log,
      message: [label || "default"],
      group,
    });
  }
  groupCollapsed(label) {
    this._groupID++;
    const group = {
      id: this._groupID,
      label: label || "default",
      collapsed: true,
      parent: this._groups[this._groups.length - 1] || null,
    };
    this._groups.push(group);
    this._printer.print({
      type: LOG_TYPE.groupCollapsed,
      level: LOG_LEVEL.log,
      message: [label || "default"],
      group,
    });
  }
  groupEnd() {
    this._groups.pop();
  }
  info(message, ...args) {
    this._printer.print({
      type: LOG_TYPE.info,
      level: LOG_LEVEL.info,
      message: message ? [message, ...args] : args,
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  log(message, ...args) {
    this._printer.print({
      type: LOG_TYPE.log,
      level: LOG_LEVEL.log,
      message: message ? [message, ...args] : args,
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  profile() {
    throw new Error("Method not implemented.");
  }
  profileEnd() {
    throw new Error("Method not implemented.");
  }
  table(data) {
    this._printer.print({
      type: LOG_TYPE.table,
      level: LOG_LEVEL.log,
      message: [data],
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  time(label = "default") {
    this._time[label] = performance.now();
  }
  timeEnd(label = "default") {
    const startedAt = this._time[label];
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    this._printer.print({
      type: LOG_TYPE.timeEnd,
      level: LOG_LEVEL.info,
      message: [`${label}: ${durationMs}ms - timer ended`],
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  timeLog(label = "default") {
    const startedAt = this._time[label];
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    this._printer.print({
      type: LOG_TYPE.timeLog,
      level: LOG_LEVEL.log,
      message: [`${label}: ${durationMs}ms`],
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  timeStamp() {
    throw new Error("Method not implemented.");
  }
  trace(message, ...args) {
    this._printer.print({
      type: LOG_TYPE.trace,
      level: LOG_LEVEL.log,
      message: [
        ...(message ? [message, ...args] : args),
        new Error("stack").stack.replace("Error: stack", ""),
      ],
      group: this._groups[this._groups.length - 1] || null,
    });
  }
  warn(message, ...args) {
    this._printer.print({
      type: LOG_TYPE.warn,
      level: LOG_LEVEL.warn,
      message: message ? [message, ...args] : args,
      group: this._groups[this._groups.length - 1] || null,
    });
  }
}

// --- Clipboard ---------------------------------------------------------------

export class ClipboardItem {
  constructor(data, options) {
    this._data = data;
    this.presentationStyle = "unspecified";
    if (options && options.presentationStyle) {
      this.presentationStyle = options.presentationStyle;
    }
  }
  get types() {
    return Object.keys(this._data);
  }
  async getType(type) {
    if (!this._data[type]) {
      throw new TypeError(`Failed to execute 'getType' on 'ClipboardItem': The type '${type}' was not found`);
    }
    if (this._data[type] instanceof Blob) {
      return this._data[type];
    }
    return new Blob([await this._data[type]], { type });
  }
}

export class Clipboard {
  constructor(ownerNavigator = null) {
    this._ownerNavigator = ownerNavigator;
    this._data = [];
  }
  async read() {
    const permissionStatus = await this._permissions().query({ name: "clipboard-read" });
    if (permissionStatus.state === "denied") {
      throw new TypeError("Failed to execute 'read' on 'Clipboard': The request is not allowed");
    }
    return this._data;
  }
  async readText() {
    const permissionStatus = await this._permissions().query({ name: "clipboard-read" });
    if (permissionStatus.state === "denied") {
      throw new TypeError(
        "Failed to execute 'readText' on 'Clipboard': The request is not allowed",
      );
    }
    let text = "";
    for (const item of this._data) {
      if (item.types.includes("text/plain")) {
        const data = await item.getType("text/plain");
        text += typeof data === "string" ? data : await data.text();
      }
    }
    return text;
  }
  async write(data) {
    const permissionStatus = await this._permissions().query({ name: "clipboard-write" });
    if (permissionStatus.state === "denied") {
      throw new TypeError("Failed to execute 'write' on 'Clipboard': The request is not allowed");
    }
    this._data = data;
  }
  async writeText(text) {
    const permissionStatus = await this._permissions().query({ name: "clipboard-write" });
    if (permissionStatus.state === "denied") {
      throw new TypeError(
        "Failed to execute 'writeText' on 'Clipboard': The request is not allowed",
      );
    }
    this._data = [new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }) })];
  }
  _permissions() {
    if (this._ownerNavigator && typeof this._ownerNavigator.permissions === "object") {
      return this._ownerNavigator.permissions;
    }
    return new Permissions();
  }
}

// --- Permissions (navigator.permissions.query) -------------------------------

const PERMISSION_STATUSES = new WeakMap();

export class PermissionStatus {
  constructor(name, permissions) {
    this.name = name;
    this.state = "granted";
    this.onchange = null;
    PERMISSION_STATUSES.set(this, permissions);
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

export class Permissions {
  constructor() {
    this._statuses = new Map();
  }
  async query(permissionDesc) {
    const name = permissionDesc.name;
    let status = this._statuses.get(name);
    if (!status) {
      status = new PermissionStatus(name, this);
      this._statuses.set(name, status);
    }
    return status;
  }
}

// --- install ----------------------------------------------------------------

export function install(ctx) {
  ctx.defineAccessor(Window.prototype, "ImageData", function getImageData() {
    return ImageData;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "IntersectionObserver", function getIntersectionObserver() {
    return IntersectionObserver;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "Blob", function getBlob() {
    return Blob;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "File", function getFile() {
    return File;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "FileReader", function getFileReader() {
    return FileReader;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "TypeError", function getTypeError() {
    return globalThis.TypeError;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "ClipboardItem", function getClipboardItem() {
    return ClipboardItem;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "Clipboard", function getClipboard() {
    return Clipboard;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "Permissions", function getPermissions() {
    return Permissions;
  }, undefined);
}
