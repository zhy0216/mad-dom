// Real differential scenario (T46): Response, Abort and window.fetch surface.
//
// Scope is exactly the T46 Response + Abort + fetch slice, calibrated against
// the locked happy-dom 20.11.11 observable behavior on a default (about:blank)
// window:
//
//   - Response construction (status/statusText/ok/type/url/redirected/headers
//     with Set-Cookie stripped and auto Content-Type), the own-key layout,
//     `bodyUsed` flipping with the double-consumption `InvalidStateError`,
//     `buffer()` / `text()` / `json()`, `clone()` and the `redirect` / `error`
//     / `json` statics;
//   - AbortController / AbortSignal (`aborted` / `reason` reads, the default
//     AbortError reason, the abort event firing once, `AbortSignal.abort` /
//     `throwIfAborted`, read-only writes ignored);
//   - `window.fetch` on `data:` URLs (offline and deterministic on both
//     targets): success (plain / charset / base64 / empty-type data URIs),
//     promise timing (a `Promise.resolve()` microtask queued right after
//     `fetch()` settles before the fetch reaction), pre-aborted-signal
//     rejection and unsupported-scheme rejection.
//
// No public network is touched: every fetch probe uses a `data:` URL.
export const id = "dom-fetch-response-fetch";
export const description =
  "real differential: Response (construction, bodyUsed, clone, statics) + AbortController/AbortSignal + window.fetch on offline data: URLs (success, timing, abort, unsupported scheme)";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  try {
    // 1. Response construction surface.
    const response = new window.Response("hello", {
      status: 201,
      statusText: "Created",
      headers: { "X-A": "1", "Set-Cookie": "a=b" },
    });
    api.record.value("resp-status", response.status);
    api.record.value("resp-status-text", response.statusText);
    api.record.value("resp-ok", response.ok);
    api.record.value("resp-type", response.type);
    api.record.value("resp-url", response.url);
    api.record.value("resp-redirected", response.redirected);
    api.record.value("resp-body-used-before", response.bodyUsed);
    api.record.value("resp-headers", [...response.headers]);
    api.record.value("resp-set-cookie-stripped", response.headers.has("Set-Cookie"));
    api.record.value("resp-own-keys", Object.keys(response));
    api.record.value("resp-tag", Object.prototype.toString.call(response));

    // 2. bodyUsed flips on text(); a second consumption throws.
    api.record.value("resp-text", await response.text());
    api.record.value("resp-body-used-after", response.bodyUsed);
    try {
      await response.text();
    } catch (error) {
      api.record.error(error, "promise-rejection");
    }

    // 3. buffer() and json().
    const buffered = new window.Response("abc");
    api.record.value("resp-buffer-length", (await buffered.buffer()).length);
    const jsonResponse = new window.Response('{"a":1}', {
      headers: { "Content-Type": "application/json" },
    });
    api.record.value("resp-json", await jsonResponse.json());

    // 4. clone() consumes independently (and preserves the own fields).
    const clonable = new window.Response("hello");
    const responseClone = clonable.clone();
    api.record.value("resp-clone-distinct", clonable !== responseClone);
    api.record.value("resp-clone-copy-text", await responseClone.text());
    api.record.value("resp-clone-original-text", await clonable.text());
    api.record.value("resp-clone-own-keys", Object.keys(responseClone));

    // 5. Response statics.
    const redirect = window.Response.redirect("https://example.com/next", 301);
    api.record.value("resp-redirect-status", redirect.status);
    api.record.value("resp-redirect-location", redirect.headers.get("Location"));
    api.record.value("resp-redirect-headers", [...redirect.headers]);
    api.record.value("resp-redirect-text", await redirect.text());
    try {
      window.Response.redirect("https://example.com", 200);
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    const errorResponse = window.Response.error();
    api.record.value("resp-error-status", errorResponse.status);
    api.record.value("resp-error-type", errorResponse.type);
    api.record.value("resp-error-ok", errorResponse.ok);
    const jsonStatic = window.Response.json({ a: 1 }, { status: 201, headers: { "X-Custom": "yes" } });
    api.record.value("resp-json-static-status", jsonStatic.status);
    api.record.value("resp-json-static-content-type", jsonStatic.headers.get("Content-Type"));
    api.record.value("resp-json-static-headers", [...jsonStatic.headers]);
    api.record.value("resp-json-static-body", await jsonStatic.text());
    try {
      window.Response.json(undefined);
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    // 6. AbortController / AbortSignal surface.
    const controller = new window.AbortController();
    api.record.value("abort-aborted-before", controller.signal.aborted);
    api.record.value("abort-reason-before", String(controller.signal.reason));
    const abortEvents = [];
    controller.signal.addEventListener("abort", (event) => {
      abortEvents.push({ type: event.type, isTarget: event.target === controller.signal });
    });
    controller.abort();
    api.record.value("abort-aborted-after", controller.signal.aborted);
    api.record.value("abort-reason-name", controller.signal.reason?.name);
    api.record.value("abort-reason-message", controller.signal.reason?.message);
    // A second abort is ignored; the reason stays the same.
    controller.abort("custom reason");
    api.record.value("abort-reason-after-second", controller.signal.reason?.message);
    api.record.value("abort-events", abortEvents);
    api.record.value("abort-signal-tag", Object.prototype.toString.call(controller.signal));
    api.record.value("abort-controller-own-keys", Object.keys(controller));

    // 7. AbortSignal.abort / throwIfAborted / read-only writes.
    const staticSignal = window.AbortSignal.abort("boom");
    api.record.value("abort-static-aborted", staticSignal.aborted);
    api.record.value("abort-static-reason", String(staticSignal.reason));
    staticSignal.aborted = false;
    staticSignal.reason = "ignored";
    api.record.value("abort-static-writes-ignored", [staticSignal.aborted, String(staticSignal.reason)]);
    const noReasonSignal = window.AbortSignal.abort();
    api.record.value("abort-static-no-reason-name", noReasonSignal.reason?.name);
    api.record.value("abort-static-no-reason-message", noReasonSignal.reason?.message);
    try {
      noReasonSignal.throwIfAborted();
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    api.record.value("abort-signal-own-keys", Object.keys(noReasonSignal));

    // 8. fetch success on offline data: URLs.
    const plain = await window.fetch("data:text/plain,hello%20world");
    api.record.value("fetch-status", plain.status);
    api.record.value("fetch-ok", plain.ok);
    api.record.value("fetch-type", plain.type);
    api.record.value("fetch-url", plain.url);
    api.record.value("fetch-headers", [...plain.headers]);
    api.record.value("fetch-text", await plain.text());
    api.record.value("fetch-body-used", plain.bodyUsed);

    const charset = await window.fetch("data:text/plain;charset=utf-8,hi");
    api.record.value("fetch-charset-headers", [...charset.headers]);
    api.record.value("fetch-charset-text", await charset.text());

    const base64 = await window.fetch("data:text/plain;base64,aGVsbG8=");
    api.record.value("fetch-base64-text", await base64.text());

    const emptyType = await window.fetch("data:,plain-only");
    api.record.value("fetch-empty-type-headers", [...emptyType.headers]);
    api.record.value("fetch-empty-type-text", await emptyType.text());

    // 9. fetch returns a Promise and its resolution ordering matches (a
    // microtask queued right after fetch() runs before the fetch reaction).
    api.record.value("fetch-returns-promise", window.fetch("data:text/plain,p") instanceof Promise);
    const timingEvents = [];
    const timingPromise = window.fetch("data:text/plain,ordered");
    timingPromise.then(() => timingEvents.push("fetch-first"));
    Promise.resolve().then(() => timingEvents.push("microtask"));
    await timingPromise;
    timingEvents.push("after-await");
    api.record.value("fetch-timing-events", timingEvents);
    api.record.value("fetch-timing-ok", (await window.fetch("data:text/plain,ok")).ok);

    // 10. fetch rejection: pre-aborted signal (rejects with the raw reason).
    const preAborted = new window.AbortController();
    preAborted.abort("canceled");
    try {
      await window.fetch("data:text/plain,no", { signal: preAborted.signal });
      api.record.value("fetch-pre-aborted-resolved", true);
    } catch (error) {
      api.record.error(error, "promise-rejection");
    }
    const preAbortedNoReason = new window.AbortController();
    preAbortedNoReason.abort();
    try {
      await window.fetch("data:text/plain,no", { signal: preAbortedNoReason.signal });
      api.record.value("fetch-pre-aborted-no-reason-resolved", true);
    } catch (error) {
      api.record.error(error, "promise-rejection");
    }

    // 11. fetch rejection: unsupported scheme.
    try {
      await window.fetch("ftp://example.com/");
    } catch (error) {
      api.record.error(error, "promise-rejection");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
