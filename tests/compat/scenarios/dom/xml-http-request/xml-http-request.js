// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/xml-http-request/XMLHttpRequest.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: this scenario ports the XMLHttpRequest
// **public state machine** that is observable offline — constructor defaults,
// the readyState constants, `open()` validation (forbidden methods, sync +
// non-text responseType), the `responseType` getter/setter guards,
// `setRequestHeader` state/forbidden-header returns, `getResponseHeader` /
// `getAllResponseHeaders` before a response, the `send()`-before-open guard,
// the `responseText` accessor error and `abort()`. The readyState enum values
// are inlined from
// tests/happy-dom/vendor-src-enums/xml-http-request/XMLHttpRequestReadyStateEnum.ts
// and the response-type strings from
// tests/happy-dom/vendor-src-enums/xml-http-request/XMLHttpResponseTypeEnum.ts
// (the vendored literals, not guessed).
//
// The response-driven assertions (status / statusText / response variants /
// responseURL / responseText after `send()`, `progress`/`load`/`loadend`
// events, abort-during-request, `overrideMimeType` in LOADING/DONE) all mock
// the internal `Fetch` / `SyncFetch` prototypes or the Node `https` module in
// the upstream file; those internal mocks have no public equivalent and are
// dropped. The window is pinned to an HTTPS URL so relative URLs resolve
// without network.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "xml-http-request";
export const description =
  "real differential: XMLHttpRequest public state machine — constants, constructor defaults, open/setRequestHeader/send guards, responseType validation, responseText accessor and abort";
export const targets = "real";

const WINDOW_URL = "https://localhost:8080";
const REQUEST_URL = "/path/to/resource/";
const FORBIDDEN_REQUEST_METHODS = ["TRACE", "TRACK", "CONNECT"];
const FORBIDDEN_REQUEST_HEADERS = [
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

// Inlined from XMLHttpRequestReadyStateEnum.ts.
const READY_STATE = { unsent: 0, opened: 1, headersReceived: 2, loading: 3, done: 4 };
// Inlined from XMLHttpResponseTypeEnum.ts.
const RESPONSE_TYPE = { arraybuffer: "arraybuffer", blob: "blob", document: "document", json: "json", text: "text" };

function syncGrab(fn) {
  try {
    return fn();
  } catch (error) {
    return { threw: true, name: error?.name, message: error?.message };
  }
}

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window({ url: WINDOW_URL });
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  try {
    const XMLHttpRequest = window.XMLHttpRequest;

    // --- readyState constants ---
    api.record.value("const-UNSENT", XMLHttpRequest.UNSENT);
    api.record.value("const-OPENED", XMLHttpRequest.OPENED);
    api.record.value("const-HEADERS_RECEIVED", XMLHttpRequest.HEADERS_RECEIVED);
    api.record.value("const-LOADING", XMLHttpRequest.LOADING);
    api.record.value("const-DONE", XMLHttpRequest.DONE);

    // --- constructor defaults ---
    const request = new XMLHttpRequest();
    api.record.value("readyState-init", request.readyState);
    api.record.value("status-init", request.status);
    api.record.value("statusText-init", request.statusText);
    api.record.value("response-init", request.response);
    api.record.value("responseText-init", request.responseText);
    api.record.value("responseURL-init", request.responseURL);
    api.record.value("responseType-init", request.responseType);
    api.record.value("withCredentials-init", request.withCredentials);
    api.record.value("responseXML-init", request.responseXML);

    // --- getResponseHeader / getAllResponseHeaders before any request ---
    api.record.value("getResponseHeader-before", request.getResponseHeader("key1"));
    api.record.value("getAllResponseHeaders-before", request.getAllResponseHeaders());

    // --- send() before open() throws ---
    api.record.value("send-before-open", syncGrab(() => request.send()));
    api.record.value("setRequestHeader-before-open", syncGrab(() => request.setRequestHeader("key", "value")));

    // --- responseType setter in UNSENT state ---
    api.record.value("responseType-set-document", syncGrab(() => {
      const r = new XMLHttpRequest();
      r.responseType = RESPONSE_TYPE.document;
      return r.responseType;
    }));

    // --- responseText accessor error for non-text responseType ---
    {
      const r = new XMLHttpRequest();
      r.responseType = RESPONSE_TYPE.json;
      api.record.value("responseText-json-err", syncGrab(() => r.responseText));
      api.record.value("responseXML-json-err", syncGrab(() => r.responseXML));
    }

    // --- open() -> OPENED ---
    const opened = new XMLHttpRequest();
    api.record.value("open-opened", syncGrab(() => opened.open("GET", REQUEST_URL, true)));
    api.record.value("readyState-after-open", opened.readyState);

    // --- open() forbidden methods ---
    for (const method of FORBIDDEN_REQUEST_METHODS) {
      const r = new XMLHttpRequest();
      api.record.value(`open-forbidden-${method}`, syncGrab(() => r.open(method, REQUEST_URL, true)));
    }

    // --- open() sync with non-text responseType ---
    {
      const r = new XMLHttpRequest();
      r.responseType = RESPONSE_TYPE.json;
      api.record.value("open-sync-with-json", syncGrab(() => r.open("GET", REQUEST_URL, false)));
    }

    // --- setRequestHeader returns true / false ---
    {
      const r = new XMLHttpRequest();
      r.open("GET", REQUEST_URL, true);
      api.record.value("setRequestHeader-true", r.setRequestHeader("test-header", "test"));
      const forbidden = {};
      for (const header of FORBIDDEN_REQUEST_HEADERS) {
        forbidden[header] = r.setRequestHeader(header, "test");
      }
      api.record.value("setRequestHeader-forbidden", forbidden);
    }

    // --- responseType setter on a synchronous request throws ---
    {
      const r = new XMLHttpRequest();
      r.open("GET", REQUEST_URL, false);
      api.record.value("responseType-set-sync", syncGrab(() => {
        r.responseType = RESPONSE_TYPE.json;
        return r.responseType;
      }));
    }

    // --- open() after responseType set to a non-text value (sync guard order) ---
    {
      const r = new XMLHttpRequest();
      r.responseType = RESPONSE_TYPE.json;
      api.record.value("responseType-then-sync-open", syncGrab(() => r.open("GET", REQUEST_URL, false)));
    }

    // --- overrideMimeType before send does not throw ---
    {
      const r = new XMLHttpRequest();
      api.record.value("overrideMimeType-unsent", syncGrab(() => r.overrideMimeType("application/xml")));
      r.open("GET", REQUEST_URL, true);
      api.record.value("overrideMimeType-opened", syncGrab(() => r.overrideMimeType("application/xml")));
    }

    // --- abort() on an OPENED (not sent) request ---
    {
      const r = new XMLHttpRequest();
      r.open("GET", REQUEST_URL, true);
      api.record.value("abort-opened", syncGrab(() => r.abort()));
      api.record.value("readyState-after-abort", r.readyState);
    }

    // --- the readyState enum values on a fresh instance flow through open() ---
    {
      const r = new XMLHttpRequest();
      api.record.value("readyState-unsent-value", r.readyState === READY_STATE.unsent);
      r.open("GET", REQUEST_URL, true);
      api.record.value("readyState-opened-value", r.readyState === READY_STATE.opened);
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
