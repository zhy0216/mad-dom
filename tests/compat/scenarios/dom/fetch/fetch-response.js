// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/fetch/Response.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: every assertion goes through
// `new window.Response(...)` / `window.Response` statics and public members.
// The `window.happyDOM.waitUntilComplete()` tests that mock the internal
// `FetchBodyUtility.consumeBodyStream` / `MultipartFormDataParser
// .streamToFormData` are host/mock-dependent and are dropped; the multipart
// file round-trip that reads a fixture from the file system is dropped; the
// `vi.spyOn(Math, 'random')` boundary pin is not needed because the round-trip
// assertions only observe field names/values; the stream-clone test that
// plants an internal node-stream on the stream is dropped.
// `Buffer`-based body reads are re-expressed via `text()` / `TextDecoder`.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "fetch-response";
export const description =
  "real differential: Response constructor defaults, status/statusText/ok/headers/body, body methods (arrayBuffer/blob/buffer/text/json/formData), clone and the redirect/error/json statics";
export const targets = "real";

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
      const response = new window.Response();
      let headersLength = 0;
      for (const _header of response.headers) headersLength++;
      api.record.value("default-status", response.status);
      api.record.value("default-status-text", response.statusText);
      api.record.value("default-ok", response.ok);
      api.record.value("default-headers-instance", response.headers instanceof window.Headers);
      api.record.value("default-headers-length", headersLength);
      api.record.value("default-body", response.body);
      api.record.value("default-body-used", response.bodyUsed);
    }

    // --- status / statusText / ok ---
    api.record.value("status-from-init", new window.Response(null, { status: 404 }).status);
    api.record.value("status-text-from-init", new window.Response(null, { statusText: "test" }).statusText);
    {
      const response199 = new window.Response(null, { status: 199 });
      const response200 = new window.Response(null, { status: 200 });
      const response299 = new window.Response(null, { status: 299 });
      const response300 = new window.Response(null, { status: 300 });
      api.record.value("ok-matrix", [response199.ok, response200.ok, response299.ok, response300.ok]);
    }

    // --- headers from init (copied, not same instance) ---
    {
      const headers = new window.Headers({
        "Content-Type": "text/plain",
        "Content-Length": "123",
      });
      const response = new window.Response(null, { headers });
      api.record.value("headers-copy-distinct", headers === response.headers);
      api.record.value("headers-from-init", entriesToObject(response.headers));
    }

    // --- body from init ---
    {
      const response = new window.Response("Hello World");
      const chunks = [];
      for await (const chunk of response.body) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
      }
      api.record.value("body-text", new TextDecoder().decode(Buffer.concat(chunks)));
    }

    // --- toStringTag ---
    api.record.value("to-string-tag", String(new window.Response()));

    // --- arrayBuffer ---
    {
      const response = new window.Response("Hello World");
      const arrayBuffer = await response.arrayBuffer();
      api.record.value("arraybuffer-instance", arrayBuffer instanceof ArrayBuffer);
      api.record.value("arraybuffer-text", new TextDecoder().decode(arrayBuffer));
      api.record.value("arraybuffer-body-used", response.bodyUsed);
    }

    // --- blob ---
    {
      const response = new window.Response("Hello World", {
        headers: { "Content-Type": "text/plain" },
      });
      const blob = await response.blob();
      api.record.value("blob-instance", blob instanceof window.Blob);
      api.record.value("blob-type", blob.type);
      api.record.value("blob-text", await blob.text());
    }

    // --- buffer ---
    {
      const response = new window.Response("Hello World");
      const buffer = await response.buffer();
      api.record.value("buffer-text", buffer.toString());
    }

    // --- text ---
    api.record.value("text-result", await new window.Response("Hello World").text());

    // --- json ---
    api.record.value("json-result", await new window.Response('{ "key1": "value1" }').json());

    // --- formData ---
    {
      const formData = new window.FormData();
      formData.append("some", "test");
      const response = new window.Response(formData);
      const result = await response.formData();
      api.record.value("formdata-multipart-instance", result instanceof window.FormData);
      api.record.value("formdata-multipart-get", result.get("some"));
    }
    {
      const urlSearchParams = new URLSearchParams();
      urlSearchParams.append("some", "test");
      const response = new window.Response(urlSearchParams);
      const result = await response.formData();
      api.record.value("formdata-urlencoded-instance", result instanceof window.FormData);
      api.record.value("formdata-urlencoded-get", result.get("some"));
    }
    {
      const urlSearchParams = new URLSearchParams();
      urlSearchParams.set("key1", "value1");
      urlSearchParams.set("key2", "value2");
      urlSearchParams.set("key3", "value3");
      const response = new window.Response(urlSearchParams);
      const result = await response.formData();
      let size = 0;
      for (const _entry of result) size++;
      api.record.value("formdata-urlencoded-size", [result.get("key1"), result.get("key2"), result.get("key3"), size]);
    }
    {
      const formData = new window.FormData();
      formData.set("key1", "value1");
      formData.set("key2", "value2");
      formData.set("key3", "value3");
      const response = new window.Response(formData);
      const result = await response.formData();
      let size = 0;
      for (const _entry of result) size++;
      api.record.value("formdata-multipart-fields", [result.get("key1"), result.get("key2"), result.get("key3"), size]);
    }

    // --- clone ---
    {
      const response = new window.Response("Hello World", {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "text/plain" },
      });
      const clone = response.clone();
      api.record.value("clone-distinct", clone !== response);
      api.record.value("clone-status", clone.status);
      api.record.value("clone-status-text", clone.statusText);
      api.record.value("clone-content-type", clone.headers.get("Content-Type"));
      api.record.value("clone-text", await clone.text());
    }
    {
      const response = new window.Response(null, {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "text/plain" },
      });
      const clone = response.clone();
      api.record.value("clone-no-body-distinct", clone !== response);
      api.record.value("clone-no-body-status", clone.status);
      api.record.value("clone-no-body-status-text", clone.statusText);
      api.record.value("clone-no-body-content-type", clone.headers.get("Content-Type"));
    }
    {
      const response = new window.Response("", {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "text/plain" },
      });
      const clone = response.clone();
      api.record.value("clone-empty-body-distinct", clone !== response);
      api.record.value("clone-empty-body-status", clone.status);
      api.record.value("clone-empty-body-status-text", clone.statusText);
      api.record.value("clone-empty-body-content-type", clone.headers.get("Content-Type"));
      api.record.value("clone-empty-body-text", await clone.text());
    }
    {
      const original = new window.Response("Hello World", {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/plain" },
      });
      const cloned = original.clone();
      const cloned2 = cloned.clone();
      api.record.value("clone-chain-texts", [await original.text(), await cloned.text(), await cloned2.text()]);
    }
    {
      const original = new window.Response("Hello World", {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/plain" },
      });
      const cloned = original.clone();
      api.record.value("clone-two-texts", [await original.text(), await cloned.text()]);
    }
    {
      // clone() after body consumption throws.
      const original = new window.Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue("Hello World");
            controller.close();
          },
        }),
        { status: 200, statusText: "OK", headers: { "Content-Type": "text/plain" } },
      );
      api.record.value("clone-used-before-text", await original.text());
      let error = null;
      try {
        original.clone();
      } catch (e) {
        error = e;
      }
      api.record.error(error, "clone-used");
    }

    // --- static redirect ---
    {
      const response = window.Response.redirect("https://example.com");
      api.record.value("redirect-default-status", response.status);
      api.record.value("redirect-default-location", response.headers.get("Location"));
    }
    {
      const response = window.Response.redirect("https://example.com", 301);
      api.record.value("redirect-301-status", response.status);
      api.record.value("redirect-301-location", response.headers.get("Location"));
    }
    {
      let error = null;
      try {
        window.Response.redirect("https://example.com", 200);
      } catch (e) {
        error = e;
      }
      api.record.error(error, "redirect-invalid-status");
    }

    // --- static error ---
    {
      const response = window.Response.error();
      api.record.value("error-status", response.status);
      api.record.value("error-status-text", response.statusText);
      api.record.value("error-type", response.type);
    }

    // --- static json ---
    {
      const data = { key1: "value1", key2: "value2" };
      const response = window.Response.json(data);
      api.record.value("json-static-status", response.status);
      api.record.value("json-static-status-text", response.statusText);
      api.record.value("json-static-content-type", response.headers.get("Content-Type"));
      api.record.value("json-static-body", await response.json());
    }
    {
      const data = { key1: "value1", key2: "value2" };
      const response = window.Response.json(data, {
        status: 201,
        statusText: "OK",
        headers: { "Content-Type": "test" },
      });
      api.record.value("json-static-custom-status", response.status);
      api.record.value("json-static-custom-status-text", response.statusText);
      api.record.value("json-static-custom-content-type", response.headers.get("Content-Type"));
      api.record.value("json-static-custom-body", await response.json());
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
