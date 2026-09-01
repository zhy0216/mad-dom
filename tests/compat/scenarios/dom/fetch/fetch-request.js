// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/fetch/Request.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: every assertion goes through
// `new window.Request(...)` / the `window.Request` public members. The
// internal symbol-slot reads (`request[<internal content-length>]` /
// `request[<internal content-type>]`) have no public equivalent and are
// dropped; the
// `window.happyDOM.waitUntilComplete()` tests that mock the internal
// `FetchBodyUtility.consumeBodyStream` / `MultipartFormDataParser
// .streamToFormData` are host/mock-dependent and are dropped; the multipart
// file round-trip that reads a fixture from the file system is dropped; the
// `vi.spyOn(Math, 'random')` boundary pin is not needed because the round-trip
// assertions only observe field names/values (the boundary is never asserted).
// The `clone()` body-stream test that mutates the internal body-buffer slot is
// dropped. `Buffer`/`ReadableStream` reads are re-expressed as
// `request.text()` / `new TextDecoder().decode(...)`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "fetch-request";
export const description =
  "real differential: Request constructor defaults, URL resolution, method/mode/credentials/headers/redirect/referrer, body methods (arrayBuffer/text/json/blob/formData), clone and validation errors";
export const targets = "real";

const TEST_URL = "https://example.com/";

async function readBodyText(request) {
  const chunks = [];
  for await (const chunk of request.body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function entriesToObject(headers) {
  const out = {};
  for (const [key, value] of headers) {
    out[key] = value;
  }
  return out;
}

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  try {
    // --- constructor defaults ---
    {
      const request = new window.Request(TEST_URL);
      let headersLength = 0;
      for (const _header of request.headers) headersLength++;
      api.record.value("default-method", request.method);
      api.record.value("default-headers-instance", request.headers instanceof window.Headers);
      api.record.value("default-headers-length", headersLength);
      api.record.value("default-body", request.body);
      api.record.value("default-body-used", request.bodyUsed);
      api.record.value("default-signal-instance", request.signal instanceof window.AbortSignal);
      api.record.value("default-redirect", request.redirect);
      api.record.value("default-referrer-policy", request.referrerPolicy);
      api.record.value("default-credentials", request.credentials);
      api.record.value("default-referrer", request.referrer);
      api.record.value("default-mode", request.mode);
    }

    // --- URL handling ---
    api.record.value("url-from-request", new window.Request(new window.Request(TEST_URL)).url);
    api.record.value("url-from-request-url-object", new window.Request(new window.Request(new URL(TEST_URL))).url);
    api.record.value("url-from-string", new window.Request(TEST_URL).url);
    api.record.value("url-from-url-object", new window.Request(new URL(TEST_URL)).url);
    {
      window.happyDOM?.setURL("https://example.com/other/path/");
      api.record.value("url-empty-string", new window.Request("").url);
      api.record.value("url-relative", new window.Request("/path/").url);
    }

    {
      // invalid URL on about:blank
      const aboutWindow = new entry.Window();
      let error = null;
      try {
        new aboutWindow.Request("/path/");
      } catch (e) {
        error = e;
      }
      api.record.error(error, "sync-throw");
    }

    // --- method ---
    api.record.value("method-from-request", new window.Request(new window.Request(TEST_URL, { method: "POST" })).method);
    api.record.value("method-from-init", new window.Request(TEST_URL, { method: "POST" }).method);

    // --- mode ---
    api.record.value("mode-from-init", new window.Request(TEST_URL, { mode: "same-origin" }).mode);
    for (const [name, init] of Object.entries({
      invalid: { mode: "invalid" },
      navigate: { mode: "navigate" },
      websocket: { mode: "websocket" },
    })) {
      let error = null;
      try {
        new window.Request(TEST_URL, init);
      } catch (e) {
        error = e;
      }
      api.record.error(error, `mode-${name}`);
    }

    // --- body from Request / init ---
    api.record.value(
      "body-from-request",
      await readBodyText(new window.Request(new window.Request(TEST_URL, { method: "POST", body: "Hello World" }))),
    );
    api.record.value("body-from-init", await readBodyText(new window.Request(TEST_URL, { method: "POST", body: "Hello World" })));

    // --- credentials ---
    api.record.value("credentials-from-request", new window.Request(new window.Request(TEST_URL, { credentials: "include" })).credentials);
    api.record.value("credentials-from-init", new window.Request(TEST_URL, { credentials: "include" }).credentials);

    // --- headers from Request / init ---
    {
      const headers = new window.Headers();
      headers.set("X-Test", "Hello World");
      headers.set("X-Test-2", "Hello World 2");
      const otherRequest = new window.Request(TEST_URL, { headers });
      const request = new window.Request(otherRequest);
      api.record.value("headers-copy-distinct-request", otherRequest.headers === headers);
      api.record.value("headers-copy-distinct-request2", request.headers === headers);
      api.record.value("headers-from-request", entriesToObject(request.headers));
    }
    {
      const headers = new window.Headers();
      headers.set("X-Test", "Hello World");
      headers.set("X-Test-2", "Hello World 2");
      const request = new window.Request(TEST_URL, { headers });
      api.record.value("headers-copy-distinct-init", request.headers === headers);
      api.record.value("headers-from-init", entriesToObject(request.headers));
    }

    // --- removes unsafe headers ---
    {
      const request = new window.Request(TEST_URL, {
        headers: {
          "accept-charset": "unsafe",
          "accept-encoding": "unsafe",
          "access-control-request-headers": "unsafe",
          "access-control-request-method": "unsafe",
          connection: "unsafe",
          "content-length": "unsafe",
          cookie: "unsafe",
          cookie2: "unsafe",
          date: "unsafe",
          dnt: "unsafe",
          expect: "unsafe",
          host: "unsafe",
          "keep-alive": "unsafe",
          origin: "unsafe",
          referer: "unsafe",
          te: "unsafe",
          trailer: "unsafe",
          "transfer-encoding": "unsafe",
          upgrade: "unsafe",
          via: "unsafe",
          "proxy-unsafe": "unsafe",
          "sec-unsafe": "unsafe",
          "safe-header": "safe",
        },
      });
      api.record.value("unsafe-headers-removed", entriesToObject(request.headers));
    }

    // --- content type header ---
    api.record.value(
      "content-type-from-request",
      new window.Request(new window.Request(TEST_URL, { method: "POST", body: "Hello World" })).headers.get("Content-Type"),
    );
    api.record.value("content-type-from-init", new window.Request(TEST_URL, { method: "POST", body: "Hello World" }).headers.get("Content-Type"));

    // --- redirect ---
    api.record.value("redirect-from-request", new window.Request(new window.Request(TEST_URL, { redirect: "manual" })).redirect);
    api.record.value("redirect-from-init", new window.Request(TEST_URL, { redirect: "manual" }).redirect);

    // --- referrer policy ---
    api.record.value(
      "referrer-policy-from-request",
      new window.Request(new window.Request(TEST_URL, { referrerPolicy: "no-referrer" })).referrerPolicy,
    );
    api.record.value("referrer-policy-from-init", new window.Request(TEST_URL, { referrerPolicy: "no-referrer" }).referrerPolicy);

    // --- signal identity ---
    {
      const signal = new window.AbortSignal();
      api.record.value("signal-from-request-identity", new window.Request(new window.Request(TEST_URL, { signal })).signal === signal);
      api.record.value("signal-from-init-identity", new window.Request(TEST_URL, { signal }).signal === signal);
    }

    // --- referrer ---
    {
      window.happyDOM?.setURL("https://example.com/other/path/");
      const cases = [
        new window.Request(TEST_URL).referrer,
        new window.Request(TEST_URL, { referrer: "" }).referrer,
        new window.Request(TEST_URL, { referrer: "no-referrer" }).referrer,
        new window.Request(TEST_URL, { referrer: "client" }).referrer,
        new window.Request(TEST_URL, { referrer: "https://example.com/path/" }).referrer,
        new window.Request(TEST_URL, { referrer: new URL("https://example.com/path/") }).referrer,
        new window.Request(TEST_URL, { referrer: "/path/" }).referrer,
      ];
      api.record.value("referrer-cases", cases);
    }

    // --- GET/HEAD with body ---
    for (const [name, init] of Object.entries({
      get: { body: "Hello world" },
      head: { body: "Hello world", method: "HEAD" },
    })) {
      let error = null;
      try {
        new window.Request(TEST_URL, init);
      } catch (e) {
        error = e;
      }
      api.record.error(error, `body-${name}`);
    }

    // --- embedded credentials ---
    for (const [name, url] of Object.entries({
      user: "https://user@example.com",
      password: "https://user:pass@example.com",
    })) {
      let error = null;
      try {
        new window.Request(url);
      } catch (e) {
        error = e;
      }
      api.record.error(error, `credentials-${name}`);
    }

    // --- invalid referrer policy / redirect ---
    let error = null;
    try {
      new window.Request(TEST_URL, { referrerPolicy: "invalid" });
    } catch (e) {
      error = e;
    }
    api.record.error(error, "invalid-referrer-policy");
    error = null;
    try {
      new window.Request(TEST_URL, { redirect: "invalid" });
    } catch (e) {
      error = e;
    }
    api.record.error(error, "invalid-redirect");

    // --- url getter / toStringTag ---
    api.record.value("url-getter", new window.Request(TEST_URL).url);
    api.record.value("to-string-tag", String(new window.Request(TEST_URL)));

    // --- body methods ---
    {
      const request = new window.Request(TEST_URL, { method: "POST", body: "Hello World" });
      const arrayBuffer = await request.arrayBuffer();
      api.record.value("arraybuffer-instance", arrayBuffer instanceof ArrayBuffer);
      api.record.value("arraybuffer-text", new TextDecoder().decode(arrayBuffer));
      api.record.value("arraybuffer-body-used", request.bodyUsed);
    }
    {
      const request = new window.Request(TEST_URL, { method: "POST", body: "Hello World" });
      const buffer = await request.buffer();
      api.record.value("buffer-text", buffer.toString());
    }
    {
      const request = new window.Request(TEST_URL, { method: "POST", body: "Hello World" });
      api.record.value("text-result", await request.text());
    }
    {
      const request = new window.Request(TEST_URL, { method: "POST", body: '{ "key1": "value1" }' });
      api.record.value("json-result", await request.json());
    }
    {
      const request = new window.Request(TEST_URL, {
        method: "POST",
        body: "Hello World",
        headers: { "Content-Type": "text/plain" },
      });
      const blob = await request.blob();
      api.record.value("blob-instance", blob instanceof window.Blob);
      api.record.value("blob-type", blob.type);
      api.record.value("blob-text", await blob.text());
    }
    {
      const formData = new window.FormData();
      formData.append("some", "test");
      const request = new window.Request(TEST_URL, { method: "POST", body: formData });
      const result = await request.formData();
      api.record.value("formdata-multipart-instance", result instanceof window.FormData);
      api.record.value("formdata-multipart-get", result.get("some"));
    }
    {
      const urlSearchParams = new URLSearchParams();
      urlSearchParams.append("some", "test");
      const request = new window.Request(TEST_URL, { method: "POST", body: urlSearchParams });
      const result = await request.formData();
      api.record.value("formdata-urlencoded-instance", result instanceof window.FormData);
      api.record.value("formdata-urlencoded-get", result.get("some"));
    }
    {
      const request = new window.Request(TEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "key1=value1&key2=value2&key3=value3",
      });
      const result = await request.formData();
      api.record.value("formdata-string-urlencoded", [result.get("key1"), result.get("key2"), result.get("key3")]);
    }
    {
      const urlSearchParams = new URLSearchParams();
      urlSearchParams.set("key1", "value1");
      urlSearchParams.set("key2", "value2");
      urlSearchParams.set("key3", "value3");
      const request = new window.Request(TEST_URL, { method: "POST", body: urlSearchParams });
      const result = await request.formData();
      let size = 0;
      for (const _entry of result) size++;
      api.record.value("formdata-urlencoded-size", [result.get("key1"), result.get("key2"), result.get("key3"), size]);
    }
    {
      const formData = new window.FormData();
      formData.set("key1", "value1");
      formData.set("key2", "value2");
      formData.set("key3", "value3");
      const request = new window.Request(TEST_URL, { method: "POST", body: formData });
      const result = await request.formData();
      let size = 0;
      for (const _entry of result) size++;
      api.record.value("formdata-multipart-fields", [result.get("key1"), result.get("key2"), result.get("key3"), size]);
    }

    // --- clone ---
    {
      window.happyDOM?.setURL("https://example.com/other/path/");
      const signal = new window.AbortSignal();
      const request = new window.Request(TEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "Hello world",
        signal,
        redirect: "error",
        referrerPolicy: "no-referrer",
        credentials: "include",
        referrer: "https://example.com/path/",
      });
      const clone = request.clone();
      api.record.value("clone-url", clone.url);
      api.record.value("clone-method", clone.method);
      api.record.value("clone-content-type", clone.headers.get("Content-Type"));
      api.record.value("clone-signal-identity", clone.signal === signal);
      api.record.value("clone-redirect", clone.redirect);
      api.record.value("clone-referrer-policy", clone.referrerPolicy);
      api.record.value("clone-credentials", clone.credentials);
      api.record.value("clone-referrer", clone.referrer);
      api.record.value("clone-text", await clone.text());
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
