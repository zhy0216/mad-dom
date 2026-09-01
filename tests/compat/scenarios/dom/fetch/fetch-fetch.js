// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/fetch/Fetch.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to the public API: this scenario ports the `window.fetch`
// behaviours that are observable **offline** — Request-construction failures
// (protocol-relative / relative-without-location URLs), unsupported-scheme
// rejection, the HTTPS→HTTP mixed-content security check and pre-aborted-signal
// rejection. Every assertion rejects before any real network I/O. The network
// paths (which the upstream file drives by mocking the Node `http`/`https`
// modules and asserting the internal `requestHistory` / `FetchHTTPSCertificate`
// key+`cert`, redirects, compression, cookies and stream-close edge cases) are
// host/mock-dependent and not differentially portable; they are dropped. The
// `FetchHTTPSCertificate` internal import therefore only appears in dropped
// assertions.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "fetch-fetch";
export const description =
  "real differential: window.fetch offline error contract — protocol-relative/relative-path URL rejection, unsupported scheme, HTTPS mixed-content block and pre-aborted-signal rejection";
export const targets = "real";

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
    // --- protocol-relative URL rejection (Request construction) ---
    {
      let error = null;
      try {
        await window.fetch("//example.com/");
      } catch (e) {
        error = e;
      }
      api.record.error(error, "promise-rejection");
    }

    // --- relative path with no location on the document ---
    {
      let error = null;
      try {
        await window.fetch("/some/path");
      } catch (e) {
        error = e;
      }
      api.record.error(error, "promise-rejection");
    }

    // --- unsupported protocol ---
    {
      let error = null;
      try {
        await window.fetch("ftp://example.com/");
      } catch (e) {
        error = e;
      }
      api.record.error(error, "promise-rejection");
    }

    // --- HTTPS page requesting an HTTP endpoint (mixed content) ---
    {
      const httpsWindow = new entry.Window({ url: "https://localhost:8080/" });
      let error = null;
      try {
        await httpsWindow.fetch("http://localhost:8080/some/path");
      } catch (e) {
        error = e;
      }
      api.record.error(error, "promise-rejection");
    }

    // --- already-aborted signal with a custom reason ---
    {
      const abortController = new window.AbortController();
      abortController.abort(1);
      let error = null;
      try {
        await window.fetch("https://example.com", { signal: abortController.signal });
      } catch (e) {
        error = e;
      }
      api.record.error(error, "promise-rejection");
    }

    // --- already-aborted signal without a reason ---
    {
      const abortController = new window.AbortController();
      abortController.abort();
      let error = null;
      try {
        await window.fetch("https://localhost:8080/test/", {
          method: "GET",
          signal: abortController.signal,
        });
      } catch (e) {
        error = e;
      }
      api.record.error(error, "promise-rejection");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
