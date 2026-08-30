// `fetch` network surface facade extension (T46).
//
// Installs the happy-dom public contract for `Headers`, `Request`, `Response`,
// `AbortController`, `AbortSignal` and `window.fetch` onto the `Window`
// facade, calibrated against the locked happy-dom 20.11.11 observable
// behavior. T46's boundary is "不构建浏览器网络栈；优先适配 Bun 能力": the
// classes below are thin, calibrated compat wrappers over the WHATWG / Bun
// primitives (the global `URL`, `DOMException`, `ReadableStream`, `Buffer`),
// and the actual HTTP I/O for `http:`/`https:` requests is delegated to Bun's
// native `fetch`. `data:` URLs are parsed and answered offline (mirroring
// happy-dom's `DataURIParser`), so every success / failure / abort / stream /
// header behavior is testable without any public network.
//
// # Why compat wrappers instead of direct reuse
//
// Bun's native `Request`/`Response`/`Headers`/`AbortController` differ from
// the happy-dom baseline in observable ways: happy-dom throws `DOMException`
// with specific names and verbatim messages on invalid modes / methods /
// bodies, keeps the first-seen header-name casing, stores no `Content-Type`
// charset for `data:` responses, defaults `Request.credentials` to
// `"same-origin"` and `referrer` to `"about:client"`, strips `Set-Cookie`
// from constructed responses and rejects double body consumption with
// `InvalidStateError` ("Body has already been used for …"). Reusing the native
// classes directly would fail the T46 differential gates (exception types,
// promise timing, `bodyUsed`), so each class replicates the baseline surface
// while the I/O underneath stays on Bun. The classes keep **no DOM tree state**
// (CONTRACT.md): they are pure per-window platform objects, exactly like the
// T45 storage / cookie jar, so Core is untouched.
//
// # The per-window context (`WINDOW`)
//
// happy-dom wires each constructor as a per-window subclass carrying the
// window on a private symbol (`WindowContextClassExtender`). This module does
// the same: the accessors mint one subclass per window (cached by the native
// document handle), and instances read their window context from the
// prototype symbol, so `new window.Request(…)`, `new window.AbortSignal(…)`
// and `window.fetch` all resolve against the owning window's location,
// navigator, cookie jar and `DOMException`/`Headers`/`Response` constructors.
//
// # Cookie interaction
//
// `window.fetch` bridges `document.cookie` and HTTP: for same-origin /
// credentials-include requests the per-window cookie jar is sent as the
// `Cookie` header, and `Set-Cookie` headers in `http(s)` responses are parsed
// back into the same jar (mirroring happy-dom's `FetchRequestHeaderUtility` /
// `FetchResponseHeaderUtility`). The jar itself stays owned by the T45
// platform state; this module only reaches it through the small
// `fetchCookieJar` bridge exported by window-platform.js.

import { Buffer } from "node:buffer";

import { Window } from "../window.js";
import { fetchCookieJar } from "./window-platform.js";

export const seam = Object.freeze({
  id: "facade/extensions/fetch",
  owner: "T46",
  gate: "T46",
  status: "implemented",
});

// --- internal slots ----------------------------------------------------------

// The per-window facade context (mirrors happy-dom's `PropertySymbol.window`).
const WINDOW = Symbol("mad-dom-fetch-window");

// Headers.
const ENTRIES = Symbol("mad-dom-headers-entries");

// Request.
const METHOD = Symbol("mad-dom-request-method");
const MODE = Symbol("mad-dom-request-mode");
const BODY = Symbol("mad-dom-body-stream");
const BUFFER = Symbol("mad-dom-body-buffer");
const REQUEST_HEADERS = Symbol("mad-dom-request-headers");
const CREDENTIALS = Symbol("mad-dom-request-credentials");
const CONTENT_LENGTH = Symbol("mad-dom-request-content-length");
const CONTENT_TYPE = Symbol("mad-dom-request-content-type");
const REDIRECT = Symbol("mad-dom-request-redirect");
const REFERRER_POLICY = Symbol("mad-dom-request-referrer-policy");
const SIGNAL = Symbol("mad-dom-request-signal");
const REFERRER = Symbol("mad-dom-request-referrer");
const REQUEST_URL = Symbol("mad-dom-request-url");
const BODY_USED = Symbol("mad-dom-body-used");

// AbortSignal.
const ABORTED = Symbol("mad-dom-abort-aborted");
const REASON = Symbol("mad-dom-abort-reason");
const ABORT_IMPL = Symbol("mad-dom-abort-implement");

// AbortEventTarget.
const LISTENERS = Symbol("mad-dom-event-listeners");

// --- data: URI parsing (mirrors happy-dom DataURIParser) ---------------------

function parseDataURI(uri) {
  if (!/^data:/i.test(uri)) {
    throw new TypeError('`uri` does not appear to be a Data URI (must begin with "data:")');
  }
  // Strip newlines.
  uri = uri.replace(/\r?\n/g, "");
  const firstComma = uri.indexOf(",");
  if (firstComma === -1 || firstComma <= 4) {
    throw new TypeError("malformed data: URI");
  }
  // Remove the "data:" scheme and parse the metadata.
  const meta = uri.substring(5, firstComma).split(";");
  let charset = "";
  let base64 = false;
  let type = meta[0] || "text/plain";
  for (let i = 1; i < meta.length; i++) {
    if (meta[i] === "base64") {
      base64 = true;
    } else if (meta[i]) {
      type += `;${meta[i]}`;
      if (meta[i].indexOf("charset=") === 0) {
        charset = meta[i].substring(8);
      }
    }
  }
  // Defaults to US-ASCII only if type is not provided.
  if (!meta[0] && !charset.length) {
    type += ";charset=US-ASCII";
    charset = "US-ASCII";
  }
  const encoding = base64 ? "base64" : "ascii";
  const data = unescape(uri.substring(firstComma + 1));
  const buffer = Buffer.from(data, encoding);
  return { type, charset, buffer };
}

// --- body stream helpers (mirrors happy-dom FetchBodyUtility) ----------------

function bufferStream(buffer) {
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    },
  });
  return { readableStream };
}

function getBodyStream(body) {
  if (body === null || body === undefined) {
    return { stream: null, buffer: null, contentType: null, contentLength: null };
  }
  if (body instanceof URLSearchParams) {
    const buffer = Buffer.from(body.toString());
    return {
      buffer,
      stream: bufferStream(buffer),
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
      contentLength: buffer.length,
    };
  }
  if (Buffer.isBuffer(body)) {
    return {
      buffer: body,
      stream: bufferStream(body),
      contentType: null,
      contentLength: body.length,
    };
  }
  if (body instanceof ArrayBuffer) {
    const buffer = Buffer.from(body);
    return {
      buffer,
      stream: bufferStream(buffer),
      contentType: null,
      contentLength: body.byteLength,
    };
  }
  if (ArrayBuffer.isView(body)) {
    const buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    return {
      buffer,
      stream: bufferStream(buffer),
      contentType: null,
      contentLength: body.byteLength,
    };
  }
  if (body instanceof ReadableStream) {
    return { buffer: null, stream: { readableStream: body }, contentType: null, contentLength: null };
  }
  const buffer = Buffer.from(String(body));
  return {
    buffer,
    stream: bufferStream(buffer),
    contentType: "text/plain;charset=UTF-8",
    contentLength: buffer.length,
  };
}

async function consumeBodyStream(requestOrResponse) {
  const body = requestOrResponse.body;
  if (body === null || !(body instanceof ReadableStream)) {
    return Buffer.alloc(0);
  }
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  let readResult = await reader.read();
  while (!readResult.done) {
    const chunk = readResult.value;
    bytes += chunk.length;
    chunks.push(chunk);
    readResult = await reader.read();
  }
  if (typeof chunks[0] === "string") {
    return Buffer.from(chunks.join(""));
  }
  return Buffer.concat(chunks, bytes);
}

function cloneBodyStream(window, requestOrResponse) {
  if (requestOrResponse.bodyUsed) {
    throw new window.DOMException(
      "Failed to clone body stream of request: Request body is already used.",
      "InvalidStateError",
    );
  }
  if (requestOrResponse.body === null || requestOrResponse.body === undefined) {
    return null;
  }
  if (requestOrResponse[BUFFER]) {
    return bufferStream(requestOrResponse[BUFFER]).readableStream;
  }
  const [stream1, stream2] = requestOrResponse.body.tee();
  requestOrResponse[BODY] = { readableStream: stream1 };
  return stream2;
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// --- forbidden request headers (mirrors happy-dom FetchRequestHeaderUtility) --

const FORBIDDEN_HEADER_NAMES = [
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "content-transfer-encoding",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
];

function removeForbiddenHeaders(headers) {
  for (const key of Object.keys(headers[ENTRIES])) {
    if (
      FORBIDDEN_HEADER_NAMES.includes(key) ||
      key.startsWith("proxy-") ||
      key.startsWith("sec-")
    ) {
      delete headers[ENTRIES][key];
    }
  }
}

// --- request validation (mirrors happy-dom FetchRequestValidationUtility) ----

const VALID_REFERRER_POLICIES = [
  "",
  "no-referrer",
  "no-referrer-when-downgrade",
  "same-origin",
  "origin",
  "strict-origin",
  "origin-when-cross-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
];
const VALID_REDIRECTS = ["error", "manual", "follow"];
const SUPPORTED_SCHEMAS = ["data:", "http:", "https:"];
const FORBIDDEN_REQUEST_METHODS = ["TRACE", "TRACK", "CONNECT"];
const REQUEST_METHOD_REGEXP = /^[A-Z]+$/;

function validateMethod(request) {
  if (!request[METHOD] || FORBIDDEN_REQUEST_METHODS.includes(request[METHOD])) {
    throw new DOMException(
      `'${request[METHOD] || ""}' is not a valid HTTP method.`,
      "InvalidStateError",
    );
  }
  if (!REQUEST_METHOD_REGEXP.test(request[METHOD])) {
    throw new DOMException(
      `'${request[METHOD]}' HTTP method is unsupported.`,
      "InvalidStateError",
    );
  }
}

function validateBody(request) {
  if (request[BODY] && (request[METHOD] === "GET" || request[METHOD] === "HEAD")) {
    throw new DOMException("Request with GET/HEAD method cannot have body.", "InvalidStateError");
  }
}

function validateURL(url) {
  if (url.username !== "" || url.password !== "") {
    throw new DOMException(`${url} is an url with embedded credentials.`, "NotSupportedError");
  }
}

function validateReferrerPolicy(referrerPolicy) {
  if (!VALID_REFERRER_POLICIES.includes(referrerPolicy)) {
    throw new DOMException(`Invalid referrer policy "${referrerPolicy}".`, "SyntaxError");
  }
}

function validateRedirect(redirect) {
  if (!VALID_REDIRECTS.includes(redirect)) {
    throw new DOMException(`Invalid redirect "${redirect}".`, "SyntaxError");
  }
}

// --- referrer handling (mirrors happy-dom FetchRequestReferrerUtility) -------

function getInitialReferrer(window, referrer) {
  if (referrer === "" || referrer === "no-referrer" || referrer === "client") {
    return referrer;
  }
  if (referrer) {
    const referrerURL = referrer instanceof URL ? referrer : new URL(referrer, window.location.href);
    return referrerURL.origin === window.location.origin ? referrerURL : "client";
  }
  return "client";
}

// --- Headers -----------------------------------------------------------------

/**
 * `window.Headers` facade (T46), replicating the happy-dom baseline: a
 * case-insensitive keyed list that keeps the first-seen header-name casing,
 * appends multiple values and joins them with ", " on read, and performs **no**
 * WHATWG name/value validation (so even names a browser would reject are
 * stored). Constructor init accepts a `Headers` instance, an array of
 * `[name, value]` pairs (a non-pair entry throws `InvalidStateError`) or a
 * plain object.
 */
export class Headers {
  constructor(init) {
    this[ENTRIES] = {};
    if (init) {
      if (init instanceof Headers) {
        this[ENTRIES] = JSON.parse(JSON.stringify(init[ENTRIES]));
      } else if (Array.isArray(init)) {
        for (const entry of init) {
          if (entry.length !== 2) {
            throw new DOMException(
              'Failed to construct "Headers": The provided init is not a valid array.',
              "InvalidStateError",
            );
          }
          this.append(entry[0], entry[1]);
        }
      } else {
        for (const name of Object.keys(init)) {
          this.set(name, init[name]);
        }
      }
    }
  }

  append(name, value) {
    const lowerName = name.toLowerCase();
    if (this[ENTRIES][lowerName]) {
      this[ENTRIES][lowerName].value.push(value);
    } else {
      this[ENTRIES][lowerName] = { name, value: [value] };
    }
  }

  delete(name) {
    delete this[ENTRIES][name.toLowerCase()];
  }

  get(name) {
    return this[ENTRIES][name.toLowerCase()]?.value.join(", ") ?? null;
  }

  getSetCookie() {
    const entry = this[ENTRIES]["set-cookie"];
    if (!entry) {
      return [];
    }
    return entry.value;
  }

  set(name, value) {
    this[ENTRIES][name.toLowerCase()] = { name, value: [value] };
  }

  has(name) {
    return !!this[ENTRIES][name.toLowerCase()];
  }

  forEach(callback, thisArg) {
    const thisArgValue = thisArg ?? this[WINDOW];
    for (const header of Object.values(this[ENTRIES])) {
      callback.call(thisArgValue, header.value.join(", "), header.name, this);
    }
  }

  *keys() {
    for (const header of Object.values(this[ENTRIES])) {
      yield header.name;
    }
  }

  *values() {
    for (const header of Object.values(this[ENTRIES])) {
      yield header.value.join(", ");
    }
  }

  *entries() {
    for (const header of Object.values(this[ENTRIES])) {
      yield [header.name, header.value.join(", ")];
    }
  }

  *[Symbol.iterator]() {
    for (const header of Object.values(this[ENTRIES])) {
      yield [header.name, header.value.join(", ")];
    }
  }
}

// --- Request -----------------------------------------------------------------

/**
 * `window.Request` facade (T46), replicating the happy-dom construction and
 * observable surface: mode / method / body / URL / referrer-policy / redirect
 * validation with the baseline `DOMException` names and verbatim messages,
 * relative URL resolution against the window location, the default
 * `credentials` of `"same-origin"`, `referrer` of `"about:client"` and a
 * fresh `window.AbortSignal` when none is given, forbidden-header stripping
 * and the `bodyUsed` / `clone` semantics. The body is stored as a buffer (for
 * buffer-backed inputs) plus a single backing `ReadableStream`, so
 * `request.body === request.body` holds and consumption flips `bodyUsed`.
 */
export class Request {
  [BODY_USED] = false;
  [METHOD] = "GET";
  [BODY] = null;
  [BUFFER] = null;
  [MODE] = "cors";
  [REQUEST_HEADERS] = null;
  [CREDENTIALS] = "same-origin";
  [CONTENT_LENGTH] = null;
  [CONTENT_TYPE] = null;
  [REDIRECT] = "follow";
  [REFERRER_POLICY] = "";
  [SIGNAL] = null;
  [REFERRER] = "client";
  [REQUEST_URL] = null;

  constructor(input, init) {
    const window = this[WINDOW];
    if (!window) {
      throw new TypeError(
        "Failed to construct 'Request': 'Request' was constructed outside a Window context.",
      );
    }
    if (typeof input !== "string" && !input) {
      throw new TypeError("Failed to construct 'Request': 1 argument required, only 0 present.");
    }
    this[METHOD] = (init?.method || input.method || "GET").toUpperCase();
    if (init?.mode) {
      switch (init.mode) {
        case "navigate":
        case "websocket":
          throw new DOMException(
            `Failed to construct 'Request': Cannot construct a Request with a RequestInit whose mode member is set as '${init.mode}'.`,
            "SecurityError",
          );
        case "same-origin":
        case "no-cors":
        case "cors":
          this[MODE] = init.mode;
          break;
        default:
          throw new DOMException(
            `Failed to construct 'Request': The provided value '${init.mode}' is not a valid enum value of type RequestMode.`,
            "SyntaxError",
          );
      }
    } else if (input instanceof Request) {
      this[MODE] = input.mode;
    }
    const bodyInput =
      input instanceof Request && (input[BUFFER] || input.body)
        ? input[BUFFER] || cloneBodyStream(window, input)
        : init?.body ?? null;
    const { stream, buffer, contentType, contentLength } = getBodyStream(bodyInput);
    this[BUFFER] = buffer;
    this[BODY] = stream;
    this[CREDENTIALS] = init?.credentials || input.credentials || "same-origin";
    this[REQUEST_HEADERS] = new window.Headers(init?.headers || input.headers || {});
    removeForbiddenHeaders(this[REQUEST_HEADERS]);
    if (contentLength) {
      this[CONTENT_LENGTH] = contentLength;
    } else if (!this[BODY] && (this[METHOD] === "POST" || this[METHOD] === "PUT")) {
      this[CONTENT_LENGTH] = 0;
    }
    if (contentType) {
      if (!this[REQUEST_HEADERS].has("Content-Type")) {
        this[REQUEST_HEADERS].set("Content-Type", contentType);
      }
      this[CONTENT_TYPE] = contentType;
    } else if (input instanceof Request && input[CONTENT_TYPE]) {
      this[CONTENT_TYPE] = input[CONTENT_TYPE];
    }
    this[REDIRECT] = init?.redirect || input.redirect || "follow";
    this[REFERRER_POLICY] = (init?.referrerPolicy || input.referrerPolicy || "").toLowerCase();
    this[SIGNAL] = init?.signal || input.signal || new window.AbortSignal();
    this[REFERRER] = getInitialReferrer(
      window,
      init?.referrer !== null && init?.referrer !== undefined ? init?.referrer : input.referrer,
    );
    if (input instanceof URL) {
      this[REQUEST_URL] = input;
    } else {
      try {
        this[REQUEST_URL] =
          input instanceof Request && input.url
            ? new URL(input.url, window.location.href)
            : new URL(input, window.location.href);
      } catch {
        throw new DOMException(
          `Failed to construct 'Request': Invalid URL "${input}" on document location '${window.location}'.${
            window.location.origin === "null"
              ? " Relative URLs are not permitted on current document location."
              : ""
          }`,
          "NotSupportedError",
        );
      }
    }
    validateMethod(this);
    validateBody(this);
    validateURL(this[REQUEST_URL]);
    validateReferrerPolicy(this[REFERRER_POLICY]);
    validateRedirect(this[REDIRECT]);
  }

  get method() {
    return this[METHOD];
  }

  get body() {
    return this[BODY]?.readableStream || null;
  }

  get mode() {
    return this[MODE];
  }

  get headers() {
    return this[REQUEST_HEADERS];
  }

  get redirect() {
    return this[REDIRECT];
  }

  get referrerPolicy() {
    return this[REFERRER_POLICY];
  }

  get signal() {
    return this[SIGNAL];
  }

  get bodyUsed() {
    return this[BODY_USED];
  }

  get credentials() {
    return this[CREDENTIALS];
  }

  get referrer() {
    if (!this[REFERRER] || this[REFERRER] === "no-referrer") {
      return "";
    }
    if (this[REFERRER] === "client") {
      return "about:client";
    }
    return this[REFERRER].toString();
  }

  get url() {
    return this[REQUEST_URL].href;
  }

  get [Symbol.toStringTag]() {
    return "Request";
  }

  async arrayBuffer() {
    if (this[BODY_USED]) {
      throw new DOMException(`Body has already been used for "${this.url}".`, "InvalidStateError");
    }
    this[BODY_USED] = true;
    const buffer = await consumeBodyStream(this);
    return toArrayBuffer(buffer);
  }

  async buffer() {
    if (this[BODY_USED]) {
      throw new DOMException(`Body has already been used for "${this.url}".`, "InvalidStateError");
    }
    this[BODY_USED] = true;
    return consumeBodyStream(this);
  }

  async text() {
    if (this[BODY_USED]) {
      throw new DOMException(`Body has already been used for "${this.url}".`, "InvalidStateError");
    }
    this[BODY_USED] = true;
    return new TextDecoder().decode(await consumeBodyStream(this));
  }

  async json() {
    const text = await this.text();
    return JSON.parse(text);
  }

  clone() {
    return new this[WINDOW].Request(this);
  }
}

// --- Response ----------------------------------------------------------------

const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];

/**
 * `window.Response` facade (T46), replicating the happy-dom construction and
 * observable surface: `status`/`statusText`/`ok` from the init (defaults 200 /
 * ""), `type` `"basic"`, `url` `""`, `redirected` `false`, `bodyUsed` `false`
 * and a `Headers` instance with `Set-Cookie`/`Set-Cookie2` stripped. String /
 * buffer bodies also set `Content-Type` (`text/plain;charset=UTF-8`) when the
 * init headers lack one. `text()`/`arrayBuffer()`/`buffer()`/`json()` flip
 * `bodyUsed` and reject a second consumption with `InvalidStateError`; the
 * `redirect` / `error` / `json` statics and `clone()` mirror the baseline.
 */
export class Response {
  constructor(body, init) {
    const window = this[WINDOW];
    if (!window) {
      throw new TypeError(
        `Failed to construct '${this.constructor.name}': '${this.constructor.name}' was constructed outside a Window context.`,
      );
    }
    // Own-field order mirrors the baseline class-field layout, so
    // `Object.keys(response)` matches happy-dom.
    this.bodyUsed = false;
    this.redirected = false;
    this.type = "basic";
    this.url = "";
    this.status = init?.status !== undefined ? init.status : 200;
    this.statusText = init?.statusText || "";
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new window.Headers(init?.headers);
    // "Set-Cookie" and "Set-Cookie2" are not allowed in response headers per spec.
    this.headers.delete("Set-Cookie");
    this.headers.delete("Set-Cookie2");
    if (body) {
      const { stream, buffer, contentType } = getBodyStream(body);
      this[BODY] = stream;
      if (buffer) {
        this[BUFFER] = buffer;
      }
      if (contentType && !this.headers.has("Content-Type")) {
        this.headers.set("Content-Type", contentType);
      }
    }
  }

  get [Symbol.toStringTag]() {
    return "Response";
  }

  get body() {
    return this[BODY]?.readableStream || null;
  }

  async arrayBuffer() {
    if (this.bodyUsed) {
      throw new DOMException(`Body has already been used for "${this.url}".`, "InvalidStateError");
    }
    this.bodyUsed = true;
    let buffer = this[BUFFER];
    if (!buffer) {
      buffer = await consumeBodyStream(this);
    }
    return toArrayBuffer(buffer);
  }

  async buffer() {
    if (this.bodyUsed) {
      throw new DOMException(`Body has already been used for "${this.url}".`, "InvalidStateError");
    }
    this.bodyUsed = true;
    let buffer = this[BUFFER];
    if (!buffer) {
      buffer = await consumeBodyStream(this);
    }
    return buffer;
  }

  async text() {
    if (this.bodyUsed) {
      throw new DOMException(`Body has already been used for "${this.url}".`, "InvalidStateError");
    }
    this.bodyUsed = true;
    let buffer = this[BUFFER];
    if (!buffer) {
      buffer = await consumeBodyStream(this);
    }
    return new TextDecoder().decode(buffer);
  }

  async json() {
    const text = await this.text();
    return JSON.parse(text);
  }

  clone() {
    const window = this[WINDOW];
    const body = cloneBodyStream(window, this);
    const response = new window.Response(body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
    response[BUFFER] = this[BUFFER];
    response.ok = this.ok;
    response.redirected = this.redirected;
    response.type = this.type;
    response.url = this.url;
    return response;
  }

  static redirect(url, status = 302) {
    const window = this[WINDOW];
    if (!REDIRECT_STATUS_CODES.includes(status)) {
      throw new DOMException(
        "Failed to create redirect response: Invalid redirect status code.",
        "InvalidStateError",
      );
    }
    return new window.Response(null, {
      headers: {
        location: new URL(String(url)).toString(),
      },
      status,
    });
  }

  static error() {
    const response = new this[WINDOW].Response(null, { status: 0, statusText: "" });
    response.type = "error";
    return response;
  }

  static json(data, init) {
    const window = this[WINDOW];
    const body = JSON.stringify(data);
    if (body === undefined) {
      throw new TypeError("data is not JSON serializable");
    }
    const headers = new window.Headers(init && init.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return new window.Response(body, {
      status: 200,
      ...init,
      headers,
    });
  }
}

// --- AbortEventTarget (minimal internal event dispatch for AbortSignal) ------

class AbortEventTarget {
  constructor() {
    this[LISTENERS] = new Map();
  }

  addEventListener(type, listener, options) {
    if (typeof listener !== "function" && (listener == null || typeof listener.handleEvent !== "function")) {
      return;
    }
    let listeners = this[LISTENERS].get(type);
    if (listeners === undefined) {
      listeners = [];
      this[LISTENERS].set(type, listeners);
    }
    if (!listeners.includes(listener)) {
      listeners.push({ listener, once: Boolean(options?.once) });
    }
  }

  removeEventListener(type, listener) {
    const listeners = this[LISTENERS].get(type);
    if (listeners === undefined) return;
    const index = listeners.findIndex((entry) => entry.listener === listener);
    if (index !== -1) {
      listeners.splice(index, 1);
      if (listeners.length === 0) {
        this[LISTENERS].delete(type);
      }
    }
  }

  dispatchEvent(event) {
    const listeners = this[LISTENERS].get(event.type);
    if (listeners === undefined) return true;
    for (const entry of [...listeners]) {
      if (entry.once) {
        this.removeEventListener(event.type, entry.listener);
      }
      try {
        if (typeof entry.listener === "function") {
          entry.listener.call(this, event);
        } else {
          entry.listener.handleEvent.call(entry.listener, event);
        }
      } catch {
        // A throwing listener must not break the abort dispatch.
      }
    }
    return true;
  }
}

// --- AbortSignal / AbortController -------------------------------------------

/**
 * `window.AbortSignal` facade (T46): an `EventTarget`-like signal with the
 * baseline `aborted` / `reason` reads, `throwIfAborted`, the `abort` event
 * (fired once on `abort()`) and the `abort` / `timeout` / `any` statics. An
 * `abort()` without a reason stores the happy-dom `AbortError` ("signal is
 * aborted without reason") so `fetch` rejections and `signal.reason` match the
 * baseline; `reason` is read-only and a second abort is ignored.
 */
export class AbortSignal extends AbortEventTarget {
  static abort(reason) {
    const signal = new this();
    signal[REASON] =
      reason !== undefined
        ? reason
        : new this[WINDOW].DOMException("signal is aborted without reason", "AbortError");
    signal[ABORTED] = true;
    return signal;
  }

  static timeout(time) {
    const window = this[WINDOW];
    const signal = new this();
    globalThis.setTimeout(() => {
      signal[ABORT_IMPL](new window.DOMException("signal timed out", "TimeoutError"));
    }, time);
    return signal;
  }

  static any(signals) {
    for (const signal of signals) {
      if (signal[ABORTED]) {
        return this.abort(signal[REASON]);
      }
    }
    const anySignal = new this();
    const handlers = new Map();
    const stopListening = () => {
      for (const signal of signals) {
        signal.removeEventListener("abort", handlers.get(signal));
      }
    };
    for (const signal of signals) {
      const handler = () => {
        stopListening();
        anySignal[ABORT_IMPL](signal[REASON]);
      };
      handlers.set(signal, handler);
      signal.addEventListener("abort", handler);
    }
    return anySignal;
  }

  constructor() {
    super();
    if (!this[WINDOW]) {
      throw new TypeError("Failed to construct 'AbortSignal': Illegal constructor");
    }
    this[ABORTED] = false;
    this[REASON] = undefined;
    this.onabort = null;
  }

  get [Symbol.toStringTag]() {
    return "AbortSignal";
  }

  get aborted() {
    return this[ABORTED];
  }

  set aborted(_value) {
    // Read-only per the baseline.
  }

  get reason() {
    return this[REASON];
  }

  set reason(_value) {
    // Read-only per the baseline.
  }

  throwIfAborted() {
    if (this[ABORTED]) {
      throw this[REASON];
    }
  }

  [ABORT_IMPL](reason) {
    if (this[ABORTED]) {
      return;
    }
    this[REASON] =
      reason !== undefined
        ? reason
        : new this[WINDOW].DOMException("signal is aborted without reason", "AbortError");
    this[ABORTED] = true;
    const event = { type: "abort", target: this };
    this.dispatchEvent(event);
  }
}

/**
 * `window.AbortController` facade (T46): an own `signal` property minted from
 * `window.AbortSignal` and a one-shot `abort(reason)` that aborts the signal
 * (ignored once already aborted).
 */
export class AbortController {
  constructor() {
    this.signal = new this[WINDOW].AbortSignal();
  }

  abort(reason) {
    this.signal[ABORT_IMPL](reason);
  }
}

// --- per-window surface ------------------------------------------------------

// Native DocumentHandle → per-window fetch constructors. Weak: a collected /
// destroyed document stops holding its classes.
const FETCH_SURFACE = new WeakMap();

function nativeDocumentOfWindow(ctx, windowFacade) {
  const document = windowFacade.document;
  if (document === null || document === undefined) return null;
  return ctx.documentContext.handleOf(document);
}

function createFetchSurface(windowFacade) {
  class WindowHeaders extends Headers {}
  class WindowRequest extends Request {}
  class WindowResponse extends Response {}
  class WindowAbortController extends AbortController {}
  class WindowAbortSignal extends AbortSignal {}
  for (const constructor of [
    WindowHeaders,
    WindowRequest,
    WindowResponse,
    WindowAbortController,
    WindowAbortSignal,
  ]) {
    Object.defineProperty(constructor.prototype, WINDOW, {
      value: windowFacade,
      configurable: true,
    });
  }
  // The statics need the window context too (mirrors happy-dom setting the
  // symbol on `Response` / `AbortSignal` themselves).
  Object.defineProperty(WindowResponse, WINDOW, { value: windowFacade, configurable: true });
  Object.defineProperty(WindowAbortSignal, WINDOW, { value: windowFacade, configurable: true });
  return {
    Headers: WindowHeaders,
    Request: WindowRequest,
    Response: WindowResponse,
    AbortController: WindowAbortController,
    AbortSignal: WindowAbortSignal,
  };
}

function fetchSurface(ctx, windowFacade) {
  const handle = nativeDocumentOfWindow(ctx, windowFacade);
  let surface = FETCH_SURFACE.get(handle);
  if (surface === undefined) {
    surface = createFetchSurface(windowFacade);
    FETCH_SURFACE.set(handle, surface);
  }
  return surface;
}

// --- window.fetch ------------------------------------------------------------

function toNativeSignal(signal) {
  const NativeAbortController = globalThis.AbortController;
  if (signal.aborted) {
    const controller = new NativeAbortController();
    controller.abort(signal.reason);
    return controller.signal;
  }
  const controller = new NativeAbortController();
  const onAbort = () => {
    controller.abort(signal.reason);
    signal.removeEventListener("abort", onAbort);
  };
  signal.addEventListener("abort", onAbort);
  return controller.signal;
}

async function fetchImpl(ctx, windowFacade, url, init) {
  const surface = fetchSurface(ctx, windowFacade);
  const request = new surface.Request(url, init);

  // happy-dom's `fetch` is `async … { return await new Fetch({url, init}).send() }`:
  // the Request is built synchronously (a construction error rejects the
  // returned promise without a microtask hop) and the send itself is reached
  // through one `await`. This single hop keeps the promise timing — a
  // `Promise.resolve().then` queued right after `fetch()` runs before the
  // fetch reaction — identical to the baseline (T46 differential gate).
  await Promise.resolve();

  if (request.signal.aborted) {
    if (request.signal.reason !== undefined) {
      throw request.signal.reason;
    }
    throw new windowFacade.DOMException("signal is aborted without reason", "AbortError");
  }

  const protocol = new URL(request.url).protocol;
  if (!SUPPORTED_SCHEMAS.includes(protocol)) {
    throw new windowFacade.DOMException(
      `Failed to fetch from "${request.url}": URL scheme "${protocol.replace(/:$/, "")}" is not supported.`,
      "NotSupportedError",
    );
  }

  if (protocol === "data:") {
    const result = parseDataURI(request.url);
    return new surface.Response(result.buffer, {
      headers: { "Content-Type": result.type },
    });
  }

  // http(s): adapt Bun's native fetch. Real network I/O (exactly like
  // happy-dom, which uses node http/https), with the per-window cookie jar
  // bridged onto the wire and `Set-Cookie` responses parsed back into it.
  const requestURL = new URL(request.url);
  const wireHeaders = new surface.Headers();
  for (const [key, value] of request.headers) {
    wireHeaders.set(key, value);
  }
  const originURL = new URL(windowFacade.location.href);
  const isCORS = originURL.origin !== requestURL.origin;
  wireHeaders.set("Accept-Encoding", "gzip, deflate, br");
  wireHeaders.set("Connection", "close");
  if (!wireHeaders.has("User-Agent")) {
    wireHeaders.set("User-Agent", windowFacade.navigator.userAgent);
  }
  if (request[REFERRER] instanceof URL) {
    wireHeaders.set("Referer", request[REFERRER].href);
  }
  const jar = fetchCookieJar(ctx.documentContext.handleOf(windowFacade.document));
  if (
    request.credentials === "include" ||
    (request.credentials === "same-origin" && !isCORS)
  ) {
    const cookieHeader = jar?.readCookies(requestURL, false) ?? "";
    if (cookieHeader) {
      wireHeaders.set("Cookie", cookieHeader);
    }
  } else {
    wireHeaders.delete("Cookie");
    wireHeaders.delete("Cookie2");
  }
  if (!wireHeaders.has("Accept")) {
    wireHeaders.set("Accept", "*/*");
  }
  if (!wireHeaders.has("Content-Type") && request[CONTENT_TYPE]) {
    wireHeaders.set("Content-Type", request[CONTENT_TYPE]);
  }

  const plainHeaders = {};
  for (const [key, value] of wireHeaders) {
    plainHeaders[key] = value;
  }

  let nativeResponse;
  try {
    nativeResponse = await globalThis.fetch(request.url, {
      method: request.method,
      headers: plainHeaders,
      body: request.body ?? undefined,
      redirect: request.redirect,
      signal: toNativeSignal(request.signal),
    });
  } catch (error) {
    if (request.signal.aborted) {
      throw request.signal.reason !== undefined
        ? request.signal.reason
        : new windowFacade.DOMException("signal is aborted without reason", "AbortError");
    }
    throw new windowFacade.DOMException(
      `Failed to execute "fetch()" on "Window" with URL "${request.url}": ${error.message}`,
      "NetworkError",
    );
  }

  const responseHeaders = {};
  for (const [key, value] of nativeResponse.headers) {
    responseHeaders[key] = value;
  }
  const response = new surface.Response(nativeResponse.body, {
    status: nativeResponse.status,
    statusText: nativeResponse.statusText,
    headers: responseHeaders,
  });
  response.url = request.url;
  response.redirected = nativeResponse.redirected;

  // `Set-Cookie` response headers update the per-window cookie jar (mirrors
  // happy-dom's FetchResponseHeaderUtility).
  if (jar) {
    for (const header of nativeResponse.headers.getSetCookie()) {
      const cookie = jar.parseCookie(requestURL, header);
      if (cookie) {
        jar.addCookies([cookie]);
      }
    }
  }

  return response;
}

// --- install -----------------------------------------------------------------

/**
 * Installs the T46 fetch surface.
 *
 * `window.fetch` is a shared prototype method (like happy-dom's class method);
 * the constructors are per-window subclasses minted by the accessors and
 * cached by the native document handle, so every window owns its own
 * `Headers`/`Request`/`Response`/`AbortController`/`AbortSignal` constructors
 * and `new window.Request(…)` resolves against the owning window.
 */
export function install(ctx) {
  ctx.defineMethod(Window.prototype, "fetch", function fetch(url, init) {
    return fetchImpl(ctx, this, url, init);
  });

  ctx.defineAccessor(Window.prototype, "Headers", function getHeaders() {
    return fetchSurface(ctx, this).Headers;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "Request", function getRequest() {
    return fetchSurface(ctx, this).Request;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "Response", function getResponse() {
    return fetchSurface(ctx, this).Response;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "AbortController", function getAbortController() {
    return fetchSurface(ctx, this).AbortController;
  }, undefined);

  ctx.defineAccessor(Window.prototype, "AbortSignal", function getAbortSignal() {
    return fetchSurface(ctx, this).AbortSignal;
  }, undefined);
}
