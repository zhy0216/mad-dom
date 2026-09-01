import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";

// XMLHttpRequest public state machine tests (W3 differential parity).
//
// They pin the happy-dom 20.11.11 observable XHR surface that the
// `xml-http-request` differential scenario drives offline: the readyState
// constants, constructor defaults, the `open()` validation guards (forbidden
// methods via the public Request constructor, sync + non-text responseType),
// the `responseType` getter/setter guards, the `setRequestHeader` boolean
// returns, `getResponseHeader` / `getAllResponseHeaders` before a response,
// the `send()`-before-open guard, the `responseText` accessor error and
// `abort()`. No request is ever sent, so no network is touched.

const nativeAvailable = isNativeAvailable();

describe.skipIf(!nativeAvailable)("XMLHttpRequest public state machine (W3)", () => {
  test("exposes the readyState constants and per-window constructor", () => {
    const win = new Window({ url: "https://localhost:8080" });
    try {
      const XMLHttpRequest = win.XMLHttpRequest;
      expect(XMLHttpRequest.UNSENT).toBe(0);
      expect(XMLHttpRequest.OPENED).toBe(1);
      expect(XMLHttpRequest.HEADERS_RECEIVED).toBe(2);
      expect(XMLHttpRequest.LOADING).toBe(3);
      expect(XMLHttpRequest.DONE).toBe(4);
      const request = new XMLHttpRequest();
      expect(request instanceof XMLHttpRequest).toBe(true);
      expect(request.readyState).toBe(0);
      expect(request.status).toBe(0);
      expect(request.statusText).toBe("");
      expect(request.response).toBe("");
      expect(request.responseText).toBe("");
      expect(request.responseURL).toBe("");
      expect(request.responseType).toBe("");
      expect(request.withCredentials).toBe(false);
      expect(request.getResponseHeader("key1")).toBe(null);
      expect(request.getAllResponseHeaders()).toBe("");
    } finally {
      win.destroy();
    }
  });

  test("open() moves to OPENED and validates forbidden methods through the Request constructor", () => {
    const win = new Window({ url: "https://localhost:8080" });
    try {
      const request = new win.XMLHttpRequest();
      request.open("GET", "/path/to/resource/", true);
      expect(request.readyState).toBe(1);

      for (const method of ["TRACE", "TRACK", "CONNECT"]) {
        const r = new win.XMLHttpRequest();
        expect(() => r.open(method, "/path/to/resource/", true)).toThrow(
          new win.DOMException(`'${method}' is not a valid HTTP method.`, "InvalidStateError"),
        );
      }

      const r = new win.XMLHttpRequest();
      r.responseType = "json";
      expect(() => r.open("GET", "/path/to/resource/", false)).toThrow(
        new win.DOMException(
          "Failed to execute 'open' on 'XMLHttpRequest': Synchronous requests from a document must not set a response type.",
          "InvalidAccessError",
        ),
      );
    } finally {
      win.destroy();
    }
  });

  test("responseType guards match the baseline", () => {
    const win = new Window({ url: "https://localhost:8080" });
    try {
      const request = new win.XMLHttpRequest();
      request.responseType = "document";
      expect(request.responseType).toBe("document");

      // Sync requests reject a non-text response type.
      const sync = new win.XMLHttpRequest();
      sync.open("GET", "/path/to/resource/", false);
      expect(() => {
        sync.responseType = "json";
      }).toThrow(
        new win.DOMException(
          "Failed to set the 'responseType' property on 'XMLHttpRequest': The response type cannot be changed for synchronous requests made from a document.",
          "InvalidStateError",
        ),
      );

      // responseText is only readable for '' or 'text'.
      const json = new win.XMLHttpRequest();
      json.responseType = "json";
      expect(() => json.responseText).toThrow(
        new win.DOMException(
          "Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was 'json').",
          "InvalidStateError",
        ),
      );
    } finally {
      win.destroy();
    }
  });

  test("setRequestHeader returns true/false and send() guards the opened state", () => {
    const win = new Window({ url: "https://localhost:8080" });
    try {
      const request = new win.XMLHttpRequest();
      // Not opened → throws.
      expect(() => request.setRequestHeader("key", "value")).toThrow(
        new win.DOMException(
          "Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.",
          "InvalidStateError",
        ),
      );
      expect(() => request.send()).toThrow(
        new win.DOMException(
          "Failed to execute 'send' on 'XMLHttpRequest': Connection must be opened before send() is called.",
          "InvalidStateError",
        ),
      );

      request.open("GET", "/path/to/resource/", true);
      expect(request.setRequestHeader("test-header", "test")).toBe(true);
      for (const header of ["accept-charset", "content-length", "cookie", "host", "origin"]) {
        expect(request.setRequestHeader(header, "test")).toBe(false);
      }
    } finally {
      win.destroy();
    }
  });

  test("abort() and overrideMimeType() follow the baseline state machine", () => {
    const win = new Window({ url: "https://localhost:8080" });
    try {
      const request = new win.XMLHttpRequest();
      request.open("GET", "/path/to/resource/", true);
      request.abort();
      // On an OPENED-but-not-sent request abort() marks the request aborted
      // without moving the readyState (the readyState flips to UNSENT only
      // through the in-flight send's abort listener — mirroring happy-dom).
      expect(request.readyState).toBe(1);

      request.overrideMimeType("application/xml");
      expect(request.readyState).toBe(1);
    } finally {
      win.destroy();
    }
  });
});
