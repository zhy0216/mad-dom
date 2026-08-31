import { afterAll, describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import {
  AbortController,
  AbortSignal,
  Headers,
  Request,
  Response,
} from "../../js/facade/extensions/fetch.js";

// T46 fetch network surface integration tests (Headers / Request / Response /
// AbortController / AbortSignal / window.fetch).
//
// They drive the fetch surface through the official package entry and pin the
// acceptance criteria:
//
//   - offline coverage — success, failure, abort, streaming and header
//     behavior are all tested without any public network: `data:` URLs for
//     success and the local loopback server for the cookie round-trip;
//   - construction / bodyUsed / clone / errors / redirects — the baseline
//     happy-dom observable surface (verbatim exception names and messages,
//     double-consumption InvalidStateError, Set-Cookie stripping, the
//     redirect/error/json statics);
//   - cookie interaction — `window.fetch` sends the owning window's
//     `document.cookie` jar on a same-origin request and folds `Set-Cookie`
//     response headers back into the same jar;
//   - no network state in Core — the fetch classes are pure per-window
//     platform objects over Bun/WHATWG primitives, so no Core change exists.
//
// The structural block needs no native artifact; the runtime blocks skip
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

const nativeAvailable = isNativeAvailable();

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function thrownAsync(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("fetch export shapes (T46)", () => {
  test("fetch.js exports the compat classes and the frozen seam", async () => {
    const mod = await import("../../js/facade/extensions/fetch.js");
    expect(Object.keys(mod).sort()).toEqual([
      "AbortController",
      "AbortSignal",
      "Headers",
      "Request",
      "Response",
      "install",
      "seam",
    ]);
    expect(mod.seam.owner).toBe("T46");
    expect(Object.isFrozen(mod.seam)).toBe(true);
  });

  test("the compat classes are reachable and window-bound through the facade", () => {
    expect(typeof Headers).toBe("function");
    expect(typeof Request).toBe("function");
    expect(typeof Response).toBe("function");
    expect(typeof AbortController).toBe("function");
    expect(typeof AbortSignal).toBe("function");
  });
});

describe.skipIf(!nativeAvailable)("window fetch surface (T46)", () => {
  test("a default window exposes the fetch constructors and window.fetch", () => {
    const win = new Window();
    try {
      expect(typeof win.Headers).toBe("function");
      expect(typeof win.Request).toBe("function");
      expect(typeof win.Response).toBe("function");
      expect(typeof win.AbortController).toBe("function");
      expect(typeof win.AbortSignal).toBe("function");
      expect(typeof win.fetch).toBe("function");
      expect(win.fetch).toBe(win.fetch);
      expect(new win.Headers({ a: "1" }) instanceof win.Headers).toBe(true);
      expect(new win.Request("https://example.com/") instanceof win.Request).toBe(true);
      expect(new win.Response("x") instanceof win.Response).toBe(true);
      expect(new win.AbortController().signal instanceof win.AbortSignal).toBe(true);
    } finally {
      win.destroy();
    }
  });

  test("the constructors are per-window (identity is isolated per window)", () => {
    const winA = new Window();
    const winB = new Window();
    try {
      expect(winA.Request).not.toBe(winB.Request);
      expect(winA.Response).not.toBe(winB.Response);
      expect(winA.Headers).not.toBe(winB.Headers);
      expect(winA.AbortSignal).not.toBe(winB.AbortSignal);
    } finally {
      winA.destroy();
      winB.destroy();
    }
  });

  test("Headers: construction, read surface, first-seen casing and no name validation", () => {
    const win = new Window();
    try {
      const { Headers: WindowHeaders } = win;
      const headers = new WindowHeaders({ a: "1", "X-B": "2" });
      expect(headers.get("a")).toBe("1");
      expect(headers.get("A")).toBe("1");
      expect(headers.has("x-b")).toBe(true);
      expect(headers.get("missing")).toBeNull();
      expect([...headers.entries()]).toEqual([["a", "1"], ["X-B", "2"]]);
      expect([...headers.keys()]).toEqual(["a", "X-B"]);
      expect([...headers.values()]).toEqual(["1", "2"]);

      headers.append("a", "3");
      expect(headers.get("a")).toBe("1, 3");
      headers.set("a", "9");
      expect([...headers]).toEqual([["a", "9"], ["X-B", "2"]]);
      headers.delete("x-b");
      expect([...headers]).toEqual([["a", "9"]]);

      // The baseline performs no WHATWG name validation.
      const invalidName = new WindowHeaders([["bad name", "v"]]);
      expect([...invalidName]).toEqual([["bad name", "v"]]);

      const badPair = thrown(() => new WindowHeaders(["single"]));
      expect(badPair).toBeInstanceOf(DOMException);
      expect(badPair.name).toBe("InvalidStateError");
      expect(badPair.message).toBe('Failed to construct "Headers": The provided init is not a valid array.');
    } finally {
      win.destroy();
    }
  });

  test("Headers: getSetCookie collects the Set-Cookie values", () => {
    const win = new Window();
    try {
      const { Headers: WindowHeaders } = win;
      const headers = new WindowHeaders();
      expect(headers.getSetCookie()).toEqual([]);
      headers.append("Set-Cookie", "a=b");
      headers.append("Set-Cookie", "c=d");
      expect(headers.getSetCookie()).toEqual(["a=b", "c=d"]);
      expect(headers.get("set-cookie")).toBe("a=b, c=d");
    } finally {
      win.destroy();
    }
  });

  test("Request: construction surface matches the baseline defaults", () => {
    const win = new Window();
    try {
      const request = new win.Request("https://example.com/x", {
        method: "POST",
        body: "hello",
        headers: { "Content-Type": "text/plain" },
      });
      expect(request.url).toBe("https://example.com/x");
      expect(request.method).toBe("POST");
      expect(request.mode).toBe("cors");
      expect(request.credentials).toBe("same-origin");
      expect(request.referrer).toBe("about:client");
      expect(request.referrerPolicy).toBe("");
      expect(request.redirect).toBe("follow");
      expect(request.body).not.toBeNull();
      expect(request.bodyUsed).toBe(false);
      expect([...request.headers]).toEqual([["Content-Type", "text/plain"]]);
      expect(Object.prototype.toString.call(request)).toBe("[object Request]");
      expect(Object.keys(request)).toEqual([]);
    } finally {
      win.destroy();
    }
  });

  test("Request: bodyUsed flips on consumption and a double consumption throws InvalidStateError", async () => {
    const win = new Window();
    try {
      const request = new win.Request("https://example.com/x", { method: "POST", body: "hello" });
      expect(await request.text()).toBe("hello");
      expect(request.bodyUsed).toBe(true);
      const error = await thrownAsync(() => request.text());
      expect(error).toBeInstanceOf(DOMException);
      expect(error.name).toBe("InvalidStateError");
      expect(error.message).toBe('Body has already been used for "https://example.com/x".');
    } finally {
      win.destroy();
    }
  });

  test("Request: clone() and Request-from-Request reuse the body independently", async () => {
    const win = new Window();
    try {
      const request = new win.Request("https://example.com/y", { method: "POST", body: "clone-me" });
      const copy = request.clone();
      expect(copy).not.toBe(request);
      expect(copy.url).toBe(request.url);
      expect(await copy.text()).toBe("clone-me");
      expect(await request.text()).toBe("clone-me");

      const rebuilt = new win.Request(request);
      expect(rebuilt.method).toBe("POST");
      expect(await rebuilt.text()).toBe("clone-me");
    } finally {
      win.destroy();
    }
  });

  test("Request: validation errors match the baseline (name + message)", () => {
    const win = new Window();
    try {
      const argError = thrown(() => new win.Request(undefined));
      expect(argError).toBeInstanceOf(TypeError);
      expect(argError.message).toBe("Failed to construct 'Request': 1 argument required, only 0 present.");

      const relativeError = thrown(() => new win.Request("/relative"));
      expect(relativeError).toBeInstanceOf(DOMException);
      expect(relativeError.name).toBe("NotSupportedError");
      expect(relativeError.message).toBe(
        "Failed to construct 'Request': Invalid URL \"/relative\" on document location 'about:blank'. Relative URLs are not permitted on current document location.",
      );

      const methodError = thrown(() => new win.Request("https://example.com", { method: "TRACE" }));
      expect(methodError.name).toBe("InvalidStateError");
      expect(methodError.message).toBe("'TRACE' is not a valid HTTP method.");

      const bodyError = thrown(() => new win.Request("https://example.com", { method: "GET", body: "x" }));
      expect(bodyError.name).toBe("InvalidStateError");
      expect(bodyError.message).toBe("Request with GET/HEAD method cannot have body.");

      const modeError = thrown(() => new win.Request("https://example.com", { mode: "navigate" }));
      expect(modeError.name).toBe("SecurityError");
      expect(modeError.message).toBe(
        "Failed to construct 'Request': Cannot construct a Request with a RequestInit whose mode member is set as 'navigate'.",
      );
    } finally {
      win.destroy();
    }
  });

  test("Response: construction surface, Set-Cookie stripping and auto Content-Type", () => {
    const win = new Window();
    try {
      const response = new win.Response("hello", {
        status: 201,
        statusText: "Created",
        headers: { "X-A": "1", "Set-Cookie": "a=b" },
      });
      expect(response.status).toBe(201);
      expect(response.statusText).toBe("Created");
      expect(response.ok).toBe(true);
      expect(response.type).toBe("basic");
      expect(response.url).toBe("");
      expect(response.redirected).toBe(false);
      expect(response.bodyUsed).toBe(false);
      expect([...response.headers]).toEqual([
        ["X-A", "1"],
        ["Content-Type", "text/plain;charset=UTF-8"],
      ]);
      expect(response.headers.has("Set-Cookie")).toBe(false);
      expect(Object.keys(response)).toEqual([
        "bodyUsed",
        "redirected",
        "type",
        "url",
        "status",
        "statusText",
        "ok",
        "headers",
      ]);
      expect(Object.prototype.toString.call(response)).toBe("[object Response]");
    } finally {
      win.destroy();
    }
  });

  test("Response: bodyUsed flips on consumption and a double consumption throws", async () => {
    const win = new Window();
    try {
      const response = new win.Response("hello");
      expect(await response.text()).toBe("hello");
      expect(response.bodyUsed).toBe(true);
      const error = await thrownAsync(() => response.text());
      expect(error.name).toBe("InvalidStateError");
      expect(error.message).toBe('Body has already been used for "".');
      expect((await new win.Response("abc").buffer()).length).toBe(3);
      expect(await new win.Response('{"a":1}').json()).toEqual({ a: 1 });
    } finally {
      win.destroy();
    }
  });

  test("Response: the body stream is stable and readable (streaming)", async () => {
    const win = new Window();
    try {
      const response = new win.Response("stream-body");
      expect(response.body).not.toBeNull();
      expect(response.body).toBe(response.body);
      const reader = response.body.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(new TextDecoder().decode(first.value)).toBe("stream-body");
      // A direct body read does not flip bodyUsed (baseline semantics).
      expect(response.bodyUsed).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test("Response: redirect / error / json statics and clone", async () => {
    const win = new Window();
    try {
      const redirect = win.Response.redirect("https://example.com/next", 301);
      expect(redirect.status).toBe(301);
      expect(redirect.headers.get("Location")).toBe("https://example.com/next");
      expect(await redirect.text()).toBe("");

      const invalidRedirect = thrown(() => win.Response.redirect("https://example.com", 200));
      expect(invalidRedirect.name).toBe("InvalidStateError");
      expect(invalidRedirect.message).toBe("Failed to create redirect response: Invalid redirect status code.");

      const errorResponse = win.Response.error();
      expect(errorResponse.status).toBe(0);
      expect(errorResponse.type).toBe("error");

      const jsonResponse = win.Response.json({ a: 1 }, { status: 201, headers: { "X-Custom": "yes" } });
      expect(jsonResponse.status).toBe(201);
      expect(jsonResponse.headers.get("Content-Type")).toBe("application/json");
      expect(await jsonResponse.text()).toBe('{"a":1}');

      const jsonUndef = thrown(() => win.Response.json(undefined));
      expect(jsonUndef).toBeInstanceOf(TypeError);
      expect(jsonUndef.message).toBe("data is not JSON serializable");

      const clonable = new win.Response("hello");
      const copy = clonable.clone();
      expect(copy).not.toBe(clonable);
      expect(await copy.text()).toBe("hello");
      expect(await clonable.text()).toBe("hello");
    } finally {
      win.destroy();
    }
  });

  test("AbortController/AbortSignal: reason, event and read-only surface", () => {
    const win = new Window();
    try {
      const controller = new win.AbortController();
      expect(controller.signal.aborted).toBe(false);
      expect(controller.signal.reason).toBeUndefined();
      expect(Object.prototype.toString.call(controller.signal)).toBe("[object AbortSignal]");

      const events = [];
      controller.signal.addEventListener("abort", (event) => {
        events.push({ type: event.type, isTarget: event.target === controller.signal });
      });
      controller.abort();
      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBeInstanceOf(DOMException);
      expect(controller.signal.reason.name).toBe("AbortError");
      expect(controller.signal.reason.message).toBe("signal is aborted without reason");
      // A second abort is ignored.
      controller.abort("custom");
      expect(controller.signal.reason.message).toBe("signal is aborted without reason");
      expect(events).toEqual([{ type: "abort", isTarget: true }]);

      const staticSignal = win.AbortSignal.abort("boom");
      expect(staticSignal.aborted).toBe(true);
      expect(String(staticSignal.reason)).toBe("boom");
      staticSignal.aborted = false;
      staticSignal.reason = "ignored";
      expect(staticSignal.aborted).toBe(true);
      expect(String(staticSignal.reason)).toBe("boom");
      expect(thrown(() => staticSignal.throwIfAborted())).toBe("boom");
    } finally {
      win.destroy();
    }
  });

  test("AbortSignal addEventListener honours the signal option (T09)", () => {
    const win = new Window();
    try {
      const controller = new win.AbortController();
      const callbackController = new win.AbortController();
      const signal = controller.signal;
      let calls = 0;
      const listener = () => {
        calls += 1;
      };
      // The listener is registered against a live signal...
      signal.addEventListener("abort", listener, { signal: callbackController.signal });
      // ...and removed as soon as that signal aborts, so the abort below never
      // reaches it (happy-dom baseline, exercised by fetch/AbortController.test.ts).
      callbackController.abort();
      controller.abort();
      expect(signal.aborted).toBe(true);
      expect(calls).toBe(0);

      // An already-aborted signal removes the listener immediately.
      const preAborted = win.AbortSignal.abort("pre");
      let preCalls = 0;
      signal.addEventListener("abort", () => {
        preCalls += 1;
      }, { signal: preAborted });
      controller.abort("again");
      expect(preCalls).toBe(0);
    } finally {
      win.destroy();
    }
  });

  test("window.fetch succeeds offline on data: URLs (status, headers, text)", async () => {
    const win = new Window();
    try {
      const response = await win.fetch("data:text/plain,hello%20world");
      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
      expect(response.type).toBe("basic");
      expect(response.url).toBe("");
      expect([...response.headers]).toEqual([["Content-Type", "text/plain"]]);
      expect(await response.text()).toBe("hello world");
      expect(response.bodyUsed).toBe(true);

      const charset = await win.fetch("data:text/plain;charset=utf-8,hi");
      expect(charset.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
      expect(await charset.text()).toBe("hi");

      const base64 = await win.fetch("data:text/plain;base64,aGVsbG8=");
      expect(await base64.text()).toBe("hello");
    } finally {
      win.destroy();
    }
  });

  test("window.fetch rejects an already-aborted signal and an unsupported scheme", async () => {
    const win = new Window();
    try {
      const preAborted = new win.AbortController();
      preAborted.abort("canceled");
      const abortError = await thrownAsync(() =>
        win.fetch("data:text/plain,no", { signal: preAborted.signal }),
      );
      // happy-dom rejects with the raw abort reason.
      expect(abortError).toBe("canceled");

      const noReason = new win.AbortController();
      noReason.abort();
      const noReasonError = await thrownAsync(() => win.fetch("data:text/plain,no", { signal: noReason.signal }));
      expect(noReasonError).toBeInstanceOf(DOMException);
      expect(noReasonError.name).toBe("AbortError");
      expect(noReasonError.message).toBe("signal is aborted without reason");

      const ftpError = await thrownAsync(() => win.fetch("ftp://example.com/"));
      expect(ftpError).toBeInstanceOf(DOMException);
      expect(ftpError.name).toBe("NotSupportedError");
      expect(ftpError.message).toBe(
        'Failed to fetch from "ftp://example.com/": URL scheme "ftp" is not supported.',
      );
    } finally {
      win.destroy();
    }
  });

  test("window.fetch returns a Promise that resolves after a microtask boundary", async () => {
    const win = new Window();
    try {
      const promise = win.fetch("data:text/plain,hi");
      expect(promise instanceof Promise).toBe(true);
      const events = [];
      promise.then(() => events.push("fetch-first"));
      Promise.resolve().then(() => events.push("microtask"));
      await promise;
      events.push("after-await");
      expect(events).toEqual(["microtask", "fetch-first", "after-await"]);
    } finally {
      win.destroy();
    }
  });

  test("window.fetch round-trips document.cookie over the loopback transport (cookie interaction)", async () => {
    const win = new Window();
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        // `globalThis.Response` — the imported compat Response needs a window.
        return new globalThis.Response(`cookie=${request.headers.get("cookie") ?? ""}`, {
          headers: { "Set-Cookie": "server-cookie=42; Path=/" },
        });
      },
    });
    try {
      const base = `http://127.0.0.1:${server.port}/`;
      // Navigate the simulated window to the same origin so the jar matches.
      win.location.href = base;
      win.document.cookie = "from-jar=1; Path=/";
      expect(win.document.cookie).toContain("from-jar=1");

      const response = await win.fetch(base);
      const text = await response.text();
      // The request carried the jar cookie; the response Set-Cookie is folded
      // back into the jar and stripped from the exposed headers (baseline).
      expect(text).toContain("from-jar=1");
      expect(win.document.cookie).toContain("server-cookie=42");
      expect(response.headers.has("Set-Cookie")).toBe(false);
    } finally {
      server.stop(true);
      win.destroy();
    }
  });
});
