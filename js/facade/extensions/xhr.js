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
// The public state-machine surface mirrors the happy-dom baseline so the
// differential XMLHttpRequest scenario can drive it offline: `responseType`
// getter/setter validation, `responseText` / `responseXML` accessor errors,
// forbidden-method / sync-response-type validation in `open()`, the
// `setRequestHeader` boolean returns (false for forbidden headers) and the
// `send()` / `setRequestHeader()` / `overrideMimeType()` state guards.
//
// Listener surface extends the global `EventTarget`, so
// `addEventListener('load' | 'error' | 'readystatechange', …)` and the
// `onload` / `onerror` / `onreadystatechange` handlers work.

import { syncFetch } from "../sync-fetch.js";

import { Window } from "../window.js";
import { isFormData, serializeFormData } from "./form-data.js";
import { isHeaderForbidden } from "./fetch.js";

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
const WINDOW = Symbol("mad-dom-window");
const READY_STATE = Symbol("mad-dom-xhr-ready-state");
const RESPONSE = Symbol("mad-dom-xhr-response");
const RESPONSE_BODY = Symbol("mad-dom-xhr-response-body");
const RESPONSE_TYPE = Symbol("mad-dom-xhr-response-type");
const ABORTED = Symbol("mad-dom-xhr-aborted");
const ABORT_CONTROLLER = Symbol("mad-dom-xhr-abort-controller");
const OVERRIDDEN_MIME_TYPE = Symbol("mad-dom-xhr-overridden-mime-type");

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

  constructor() {
    super();
    if (!this[WINDOW]) {
      throw new TypeError(
        `Failed to construct 'XMLHttpRequest': 'XMLHttpRequest' was constructed outside a Window context.`,
      );
    }
    this.upload = new this[WINDOW].XMLHttpRequestUpload();
    this.withCredentials = false;
    this[METHOD] = "GET";
    this[URL] = "";
    this[ASYNC] = true;
    this[HEADERS] = [];
    this[READY_STATE] = UNSENT;
    this[RESPONSE] = null;
    this[RESPONSE_BODY] = null;
    this[RESPONSE_TYPE] = "";
    this[ABORTED] = false;
    this[ABORT_CONTROLLER] = null;
    this[OVERRIDDEN_MIME_TYPE] = null;
  }

  get readyState() {
    return this[READY_STATE];
  }

  get status() {
    return this[RESPONSE]?.status || 0;
  }

  get statusText() {
    return this[RESPONSE]?.statusText || "";
  }

  get response() {
    return this[RESPONSE] ? this[RESPONSE_BODY] : "";
  }

  get responseText() {
    if (this.responseType !== "text" && this.responseType !== "") {
      throw new this[WINDOW].DOMException(
        `Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was '${this.responseType}').`,
        "InvalidStateError",
      );
    }
    return this[RESPONSE_BODY] !== null ? this[RESPONSE_BODY] : "";
  }

  get responseXML() {
    if (this.responseType !== "document" && this.responseType !== "") {
      throw new this[WINDOW].DOMException(
        `Failed to read the 'responseXML' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'document' (was '${this.responseType}').`,
        "InvalidStateError",
      );
    }
    return this.responseType === "" ? null : this[RESPONSE_BODY];
  }

  get responseURL() {
    return this[RESPONSE]?.url || "";
  }

  get responseType() {
    return this[RESPONSE_TYPE];
  }

  set responseType(type) {
    if (this.readyState !== OPENED && this.readyState !== UNSENT) {
      throw new this[WINDOW].DOMException(
        `Failed to set the 'responseType' property on 'XMLHttpRequest': The object's state must be OPENED or UNSENT.`,
        "InvalidStateError",
      );
    }
    if (!this[ASYNC]) {
      throw new this[WINDOW].DOMException(
        `Failed to set the 'responseType' property on 'XMLHttpRequest': The response type cannot be changed for synchronous requests made from a document.`,
        "InvalidStateError",
      );
    }
    this[RESPONSE_TYPE] = type;
  }

  open(method, url, async = true, user, password) {
    const window = this[WINDOW];
    if (!async && this.responseType && this.responseType !== "text") {
      throw new window.DOMException(
        `Failed to execute 'open' on 'XMLHttpRequest': Synchronous requests from a document must not set a response type.`,
        "InvalidAccessError",
      );
    }
    const headers = new window.Headers();
    if (user) {
      const authBuffer = Buffer.from(`${user}:${password || ""}`);
      headers.set("Authorization", "Basic " + authBuffer.toString("base64"));
    }
    this[ASYNC] = async;
    this[ABORTED] = false;
    this[RESPONSE] = null;
    this[RESPONSE_BODY] = null;
    this[METHOD] = String(method);
    this[URL] = String(url);
    this[HEADERS] = [];
    this[ABORT_CONTROLLER] = new window.AbortController();
    // Method / URL / credentials validation flows through the public Request
    // constructor (mirrors happy-dom building `new window.Request(...)` in
    // `open()`), so forbidden methods and unsupported syntax raise the same
    // `DOMException`s.
    new window.Request(url, {
      method,
      headers,
      signal: this[ABORT_CONTROLLER].signal,
      credentials: this.withCredentials ? "include" : "same-origin",
    });
    this[READY_STATE] = OPENED;
  }

  setRequestHeader(name, value) {
    if (this.readyState !== OPENED) {
      throw new this[WINDOW].DOMException(
        `Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.`,
        "InvalidStateError",
      );
    }
    if (isHeaderForbidden(name)) {
      return false;
    }
    const key = String(name).toLowerCase();
    const index = this[HEADERS].findIndex(([entryName]) => entryName.toLowerCase() === key);
    if (index >= 0) {
      this[HEADERS][index][1] = `${this[HEADERS][index][1]}, ${String(value)}`;
    } else {
      this[HEADERS].push([String(name), String(value)]);
    }
    return true;
  }

  getResponseHeader(name) {
    return this[RESPONSE]?.headers.get(name) ?? null;
  }

  getAllResponseHeaders() {
    if (!this[RESPONSE]) {
      return "";
    }
    const result = [];
    for (const [name, value] of this[RESPONSE].headers) {
      const lowerName = name.toLowerCase();
      if (lowerName !== "set-cookie" && lowerName !== "set-cookie2") {
        result.push(`${name}: ${value}`);
      }
    }
    return result.join("\r\n");
  }

  abort() {
    if (this[ABORTED]) {
      return;
    }
    this[ABORTED] = true;
    this[ABORT_CONTROLLER]?.abort();
  }

  overrideMimeType(mimeType) {
    if (this.readyState === LOADING || this.readyState === DONE) {
      throw new this[WINDOW].DOMException(
        `Failed to execute 'overrideMimeType' on 'XMLHttpRequest': MIME type cannot be overridden when the request state is LOADING or DONE.`,
        "InvalidStateError",
      );
    }
    this[OVERRIDDEN_MIME_TYPE] = mimeType;
  }

  send(body = null) {
    if (this.readyState !== OPENED) {
      throw new this[WINDOW].DOMException(
        `Failed to execute 'send' on 'XMLHttpRequest': Connection must be opened before send() is called.`,
        "InvalidStateError",
      );
    }
    const windowFacade = this[WINDOW];
    if (this[ASYNC]) {
      void this.sendAsync(windowFacade, body);
    } else {
      this.sendSync(windowFacade, body);
    }
  }

  async sendAsync(windowFacade, body) {
    this[READY_STATE] = LOADING;
    dispatchType(this, "readystatechange");
    dispatchType(this, "loadstart");
    try {
      const bodyBuffer = normalizeRequestBody(windowFacade, body);
      const headers = {};
      for (const [name, value] of this[HEADERS]) {
        headers[name] = value;
      }
      if (bodyBuffer?.contentType && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
        headers["Content-Type"] = bodyBuffer.contentType;
      }
      const response = await windowFacade.fetch(this[URL], {
        method: this[METHOD],
        headers,
        body: bodyBuffer?.buffer ?? (isBodyPresent(body) ? String(body) : undefined),
      });
      this[RESPONSE] = response;
      this[READY_STATE] = HEADERS_RECEIVED;
      dispatchType(this, "readystatechange");
      const text = await response.text();
      this[RESPONSE_BODY] = text;
      this[READY_STATE] = DONE;
      dispatchType(this, "readystatechange");
      dispatchType(this, "load");
      dispatchType(this, "loadend");
    } catch (error) {
      this[READY_STATE] = DONE;
      dispatchType(this, "error");
      dispatchType(this, "loadend");
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
      const responseHeaders = new windowFacade.Headers(result.headers);
      this[RESPONSE] = {
        status: result.status,
        statusText: result.statusText,
        url: result.url,
        headers: responseHeaders,
      };
      this[READY_STATE] = HEADERS_RECEIVED;
      this[RESPONSE_BODY] = Buffer.from(result.body, "base64").toString("utf8");
      this[READY_STATE] = DONE;
      dispatchType(this, "readystatechange");
      dispatchType(this, "load");
      dispatchType(this, "loadend");
    } catch (error) {
      this[READY_STATE] = DONE;
      dispatchType(this, "error");
      dispatchType(this, "loadend");
    }
  }
}

class XMLHttpRequestUpload extends globalThis.EventTarget {}

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
  class WindowXMLHttpRequestUpload extends XMLHttpRequestUpload {}
  Object.defineProperty(WindowXMLHttpRequest.prototype, WINDOW, {
    value: windowFacade,
    configurable: true,
  });
  Object.defineProperty(WindowXMLHttpRequestUpload.prototype, WINDOW, {
    value: windowFacade,
    configurable: true,
  });
  return { XMLHttpRequest: WindowXMLHttpRequest, XMLHttpRequestUpload: WindowXMLHttpRequestUpload };
}

const XHR_SURFACE = new WeakMap();

export function install(ctx) {
  ctx.defineAccessor(
    Window.prototype,
    "XMLHttpRequest",
    function getXMLHttpRequest() {
      const handle = ctx.documentContext.handleOf(this.document);
      let surface = XHR_SURFACE.get(handle);
      if (surface === undefined) {
        surface = createWindowXHR(this);
        XHR_SURFACE.set(handle, surface);
      }
      return surface.XMLHttpRequest;
    },
    undefined,
  );
  ctx.defineAccessor(
    Window.prototype,
    "XMLHttpRequestUpload",
    function getXMLHttpRequestUpload() {
      const handle = ctx.documentContext.handleOf(this.document);
      let surface = XHR_SURFACE.get(handle);
      if (surface === undefined) {
        surface = createWindowXHR(this);
        XHR_SURFACE.set(handle, surface);
      }
      return surface.XMLHttpRequestUpload;
    },
    undefined,
  );
}
