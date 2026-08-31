// XMLHttpRequest facade extension (integration-test surface).
//
// Installs `window.XMLHttpRequest` — a fetch-backed XHR that satisfies the
// happy-dom integration surface used by XMLHttpRequest.test.js:
//
//   - `open(method, url, async)`, `setRequestHeader`, `send(body)`, `abort()`,
//     `getResponseHeader(name)` / `getAllResponseHeaders()`, the
//     `readyState` / `status` / `statusText` / `responseText` /
//     `responseURL` / `response` members and the four readyState constants;
//   - async (`async = true`, the default): the request runs through the
//     owning window's fetch facade (cookies, user-agent, referrer included);
//   - sync (`async = false`): the send blocks until completion by driving a
//     child `bun` process that performs the fetch and serializes the result
//     (there is no synchronous HTTP in-process), then dispatches `load`.
//
// Listener surface extends the global `EventTarget`, so
// `addEventListener('load' | 'error' | 'readystatechange', …)` and the
// `onload` / `onerror` / `onreadystatechange` handlers work.

import { spawnSync } from "node:child_process";

import { Window } from "../window.js";
import { isFormData, serializeFormData } from "./form-data.js";

export const seam = Object.freeze({
  id: "facade/extensions/xhr",
  owner: "integration",
  gate: "integration",
  status: "implemented",
});

const METHOD = Symbol("mad-dom-xhr-method");
const URL = Symbol("mad-dom-xhr-url");
const ASYNC = Symbol("mad-dom-xhr-async");
const HEADERS = Symbol("mad-dom-xhr-request-headers");
const RESPONSE_HEADERS = Symbol("mad-dom-xhr-response-headers");
const WINDOW = Symbol("mad-dom-window");

const UNSENT = 0;
const OPENED = 1;
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

function dispatchType(target, type) {
  const event = new globalThis.Event(type);
  target.dispatchEvent(event);
  const handler = target[`on${type}`];
  if (typeof handler === "function") {
    handler.call(target, event);
  }
}

// Child `bun` script for the sync send path: performs the fetch and prints a
// JSON envelope (status / statusText / final URL / raw headers / base64 body).
const SYNC_FETCH_SCRIPT = `
const payload = JSON.parse(process.argv[1]);
const { method, url, headers, body, credentials, referrer } = payload;
(async () => {
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : Buffer.from(body, "base64"),
      redirect: "follow",
    });
    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    const headerEntries = {};
    for (const [key, value] of response.headers) headerEntries[key] = value;
    console.log(JSON.stringify({
      ok: true,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: headerEntries,
      body: bodyBuffer.toString("base64"),
    }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
  }
})();
`;

function syncFetch(windowFacade, method, url, requestHeaders, body) {
  const payload = {
    method,
    url,
    headers: Object.fromEntries(requestHeaders),
    body: body === null ? null : Buffer.from(body).toString("base64"),
  };
  const proc = spawnSync(process.execPath, ["-e", SYNC_FETCH_SCRIPT, JSON.stringify(payload)], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (proc.error) {
    throw new windowFacade.DOMException(`Failed to execute "send()": ${proc.error.message}`, "NetworkError");
  }
  const result = JSON.parse(proc.stdout);
  if (!result.ok) {
    throw new windowFacade.DOMException(`Failed to execute "send()": ${result.error}`, "NetworkError");
  }
  return result;
}

export class XMLHttpRequest extends globalThis.EventTarget {
  static get UNSENT() {
    return UNSENT;
  }
  static get OPENED() {
    return OPENED;
  }
  static get HEADERS_RECEIVED() {
    return HEADERS_RECEIVED;
  }
  static get LOADING() {
    return LOADING;
  }
  static get DONE() {
    return DONE;
  }

  readyState = UNSENT;
  status = 0;
  statusText = "";
  responseText = "";
  response = null;
  responseURL = "";
  timeout = 0;
  withCredentials = false;

  constructor() {
    super();
    this[METHOD] = "GET";
    this[URL] = "";
    this[ASYNC] = true;
    this[HEADERS] = [];
    this[RESPONSE_HEADERS] = {};
  }

  get UNSENT() {
    return UNSENT;
  }
  get OPENED() {
    return OPENED;
  }
  get HEADERS_RECEIVED() {
    return HEADERS_RECEIVED;
  }
  get LOADING() {
    return LOADING;
  }
  get DONE() {
    return DONE;
  }

  open(method, url, async = true) {
    this[METHOD] = String(method).toUpperCase();
    this[URL] = String(url);
    this[ASYNC] = async !== false;
    this[HEADERS] = [];
    this[RESPONSE_HEADERS] = {};
    this.status = 0;
    this.statusText = "";
    this.responseText = "";
    this.response = null;
    this.responseURL = "";
    this.readyState = OPENED;
    dispatchType(this, "readystatechange");
  }

  setRequestHeader(name, value) {
    if (this.readyState !== OPENED) {
      throw new DOMException("Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.", "InvalidStateError");
    }
    const key = String(name).toLowerCase();
    const index = this[HEADERS].findIndex(([entryName]) => entryName.toLowerCase() === key);
    if (index >= 0) {
      this[HEADERS][index][1] = `${this[HEADERS][index][1]}, ${String(value)}`;
    } else {
      this[HEADERS].push([String(name), String(value)]);
    }
  }

  getResponseHeader(name) {
    const key = String(name).toLowerCase();
    const value = this[RESPONSE_HEADERS][key];
    return value === undefined ? null : value;
  }

  getAllResponseHeaders() {
    return Object.entries(this[RESPONSE_HEADERS])
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
  }

  abort() {
    this.readyState = UNSENT;
    this.response = null;
    this.responseText = "";
  }

  send(body = null) {
    if (this.readyState !== OPENED) {
      throw new DOMException("Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.", "InvalidStateError");
    }
    const windowFacade = this[WINDOW];
    if (this[ASYNC]) {
      void this.sendAsync(windowFacade, body);
    } else {
      this.sendSync(windowFacade, body);
    }
  }

  async sendAsync(windowFacade, body) {
    this.readyState = LOADING;
    dispatchType(this, "readystatechange");
    try {
      const bodyBuffer = normalizeRequestBody(windowFacade, body);
      const headers = {};
      let contentTypeFromBody = null;
      for (const [name, value] of this[HEADERS]) {
        headers[name] = value;
      }
      if (bodyBuffer?.contentType && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
        headers["Content-Type"] = bodyBuffer.contentType;
        contentTypeFromBody = bodyBuffer.contentType;
      }
      const response = await windowFacade.fetch(this[URL], {
        method: this[METHOD],
        headers,
        body: bodyBuffer?.buffer ?? (isBodyPresent(body) ? String(body) : undefined),
      });
      this.readyState = HEADERS_RECEIVED;
      dispatchType(this, "readystatechange");
      const responseHeaders = {};
      for (const [key, value] of response.headers) {
        responseHeaders[key.toLowerCase()] = value;
      }
      this[RESPONSE_HEADERS] = responseHeaders;
      this.status = response.status;
      this.statusText = response.statusText;
      this.responseURL = response.url;
      this.readyState = DONE;
      const text = await response.text();
      this.responseText = text;
      this.response = text;
      dispatchType(this, "readystatechange");
      dispatchType(this, "load");
    } catch (error) {
      this.readyState = DONE;
      dispatchType(this, "error");
    }
  }

  sendSync(windowFacade, body) {
    try {
      const bodyBuffer = normalizeRequestBody(windowFacade, body);
      const headers = {};
      for (const [name, value] of this[HEADERS]) {
        headers[name] = value;
      }
      if (bodyBuffer?.contentType && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
        headers["Content-Type"] = bodyBuffer.contentType;
      }
      const result = syncFetch(windowFacade, this[METHOD], this[URL], Object.entries(headers), bodyBuffer?.buffer ?? null);
      this.readyState = HEADERS_RECEIVED;
      const responseHeaders = {};
      for (const [key, value] of Object.entries(result.headers)) {
        responseHeaders[key.toLowerCase()] = value;
      }
      this[RESPONSE_HEADERS] = responseHeaders;
      this.status = result.status;
      this.statusText = result.statusText;
      this.responseURL = result.url;
      this.responseText = Buffer.from(result.body, "base64").toString("utf8");
      this.response = this.responseText;
      this.readyState = DONE;
      dispatchType(this, "readystatechange");
      dispatchType(this, "load");
    } catch (error) {
      this.readyState = DONE;
      dispatchType(this, "error");
    }
  }
}

function isBodyPresent(body) {
  return body !== null && body !== undefined;
}

function normalizeRequestBody(windowFacade, body) {
  if (body === null || body === undefined) return null;
  if (isFormData(body)) {
    const { buffer, contentType } = serializeFormData(body);
    return { buffer, contentType };
  }
  if (typeof body === "string" || typeof body === "number" || typeof body === "boolean") {
    return { buffer: Buffer.from(String(body)), contentType: "text/plain;charset=UTF-8" };
  }
  return null;
}

function createWindowXHR(windowFacade) {
  class WindowXMLHttpRequest extends XMLHttpRequest {}
  Object.defineProperty(WindowXMLHttpRequest.prototype, WINDOW, {
    value: windowFacade,
    configurable: true,
  });
  return WindowXMLHttpRequest;
}

const XHR_SURFACE = new WeakMap();

export function install(ctx) {
  ctx.defineAccessor(
    Window.prototype,
    "XMLHttpRequest",
    function getXMLHttpRequest() {
      const handle = ctx.documentContext.handleOf(this.document);
      let constructor = XHR_SURFACE.get(handle);
      if (constructor === undefined) {
        constructor = createWindowXHR(this);
        XHR_SURFACE.set(handle, constructor);
      }
      return constructor;
    },
    undefined,
  );
}
