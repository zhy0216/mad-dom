// Real differential scenario (T46): Headers and Request surface.
//
// Scope is exactly the T46 Headers + Request slice, calibrated against the
// locked happy-dom 20.11.11 observable behavior on a default (about:blank)
// window:
//
//   - Headers construction from object / pairs / a Headers instance, the
//     case-insensitive get/has/append/set/delete surface, first-seen header
//     name casing, value joining, the iteration / forEach surface,
//     `getSetCookie`, the array-pair validation error, and the baseline's
//     deliberate lack of WHATWG name validation;
//   - Request construction (URL resolution against the window location,
//     method / mode / credentials / referrer / redirect defaults), the body
//     stream presence, `bodyUsed` flipping with the double-consumption
//     `InvalidStateError`, Request-from-Request, `clone()`, forbidden-header
//     stripping and auto `Content-Type`;
//   - Request validation errors verbatim (arg count, relative-URL on
//     about:blank, embedded credentials, forbidden / unsupported methods,
//     GET-with-body, navigate / websocket / invalid mode, invalid referrer
//     policy and redirect).
//
// Every probe is fully offline: no network is touched.
export const id = "dom-fetch-headers-request";
export const description =
  "real differential: Headers (construction, casing, validation absence, getSetCookie) and Request (construction, bodyUsed, clone, forbidden headers, validation errors)";
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
  const { Headers, Request } = window;

  try {
    // 1. Headers construction and the read surface.
    const headers = new Headers({ a: "1", "X-B": "2" });
    api.record.value("h-get", headers.get("a"));
    api.record.value("h-get-case-insensitive", headers.get("A"));
    api.record.value("h-has-case", headers.has("x-b"));
    api.record.value("h-missing-get", headers.get("missing"));
    api.record.value("h-missing-has", headers.has("missing"));
    api.record.value("h-iter", [...headers.entries()]);
    api.record.value("h-iter-symbol", [...headers]);
    api.record.value("h-keys", [...headers.keys()]);
    api.record.value("h-values", [...headers.values()]);
    const pairs = [];
    headers.forEach((value, key) => pairs.push([key, value]));
    api.record.value("h-foreach", pairs);
    api.record.value("h-get-set-cookie-empty", headers.getSetCookie());

    // 2. append / set / delete semantics (value arrays, first-seen casing).
    headers.append("a", "3");
    api.record.value("h-append-get", headers.get("a"));
    api.record.value("h-append-iter", [...headers]);
    headers.append("X-B", "4");
    api.record.value("h-append-existing-casing", [...headers]);
    headers.set("a", "9");
    api.record.value("h-set-iter", [...headers]);
    headers.delete("X-B");
    api.record.value("h-delete-iter", [...headers]);
    headers.delete("missing");
    api.record.value("h-delete-missing-iter", [...headers]);

    // 3. getSetCookie reflects appended Set-Cookie values.
    headers.append("Set-Cookie", "a=b");
    headers.append("Set-Cookie", "c=d");
    api.record.value("h-get-set-cookie", headers.getSetCookie());
    api.record.value("h-set-cookie-get", headers.get("Set-Cookie"));

    // 4. Headers from a Headers instance copies independently.
    const copy = new Headers(headers);
    copy.set("a", "99");
    api.record.value("h-copy-original", [...headers]);
    api.record.value("h-copy-mutated", [...copy]);

    // 5. Pairs init keeps the supplied casing and validates pair shape.
    const pairsInit = new Headers([["X-One", "1"], ["x-two", "2"]]);
    api.record.value("h-pairs-init", [...pairsInit]);
    // happy-dom's Headers performs no WHATWG name validation: an invalid name
    // is stored verbatim.
    const invalidName = new Headers([["bad name", "v"]]);
    api.record.value("h-invalid-name", [...invalidName]);
    try {
      new Headers(["single"]);
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    // 6. Request construction surface.
    const request = new Request("https://example.com/x", {
      method: "POST",
      body: "hello",
      headers: { "Content-Type": "text/plain" },
    });
    api.record.value("req-url", request.url);
    api.record.value("req-method", request.method);
    api.record.value("req-mode", request.mode);
    api.record.value("req-credentials", request.credentials);
    api.record.value("req-referrer", request.referrer);
    api.record.value("req-referrer-policy", request.referrerPolicy);
    api.record.value("req-redirect", request.redirect);
    api.record.value("req-body-present", !!request.body);
    api.record.value("req-body-used-before", request.bodyUsed);
    api.record.value("req-headers", [...request.headers]);
    api.record.value("req-own-keys", Object.keys(request));
    api.record.value("req-tag", Object.prototype.toString.call(request));

    // 7. bodyUsed flips on consumption; a second consumption throws.
    api.record.value("req-text", await request.text());
    api.record.value("req-body-used-after", request.bodyUsed);
    try {
      await request.text();
    } catch (error) {
      api.record.error(error, "promise-rejection");
    }

    // 8. Request-from-Request keeps URL / method / body.
    const rebuilt = new Request(request);
    api.record.value("req-from-req-url", rebuilt.url);
    api.record.value("req-from-req-method", rebuilt.method);
    api.record.value("req-from-req-text", await rebuilt.text());

    // 9. clone() consumes independently.
    const cloned = new Request("https://example.com/y", { method: "POST", body: "clone-me" });
    const clonedCopy = cloned.clone();
    api.record.value("req-clone-distinct", cloned !== clonedCopy);
    api.record.value("req-clone-copy-text", await clonedCopy.text());
    api.record.value("req-clone-original-text", await cloned.text());
    api.record.value("req-clone-url", clonedCopy.url);

    // 10. Forbidden request headers are stripped.
    const stripped = new Request("https://example.com", {
      headers: {
        Cookie: "a=1",
        "Accept-Encoding": "x",
        "X-Foo": "1",
        "proxy-authorization": "x",
        "Sec-Fetch-Mode": "x",
      },
    });
    api.record.value("req-forbidden-stripped", [...stripped.headers]);

    // 11. A string body auto-sets Content-Type.
    const withBody = new Request("https://example.com", { method: "POST", body: "x" });
    api.record.value("req-auto-content-type", withBody.headers.get("Content-Type"));
    api.record.value("req-auto-content-type-iter", [...withBody.headers]);

    // 12. Request validation errors (verbatim name + message).
    try {
      new Request(undefined);
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("/relative");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://user:pass@example.com/");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://example.com", { method: "TRACE" });
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://example.com", { method: "get foo" });
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://example.com", { method: "GET", body: "x" });
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://example.com", { mode: "navigate" });
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://example.com", { mode: "websocket" });
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://example.com", { mode: "bogus" });
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://example.com", { referrerPolicy: "bogus" });
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
    try {
      new Request("https://example.com", { redirect: "bogus" });
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
