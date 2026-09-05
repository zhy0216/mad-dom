// Document.write facade extension (integration-test surface).
//
// Installs `Document.prototype.write(...)` with the happy-dom `write()` split:
//
//   - **First write** (per document): parses the markup as a *full document*
//     through the native full-document parser (`document.parseHtml`, the T29
//     load path), so happy-dom's restructuring is observable — `<title>` lands
//     in `document.head`, `<div>` / `<script>` land in `document.body`, and
//     `documentElement.outerHTML` renders the proper `<head>` / `<body>`
//     shape (baseline-calibrated byte for byte);
//   - **Every later write**: parses the markup as a fragment and appends it to
//     the body (write streams into the open document), exactly like the
//     previous behavior.
//
// In both modes the `<script>` elements the parse produced are then evaluated
// in document order through the owning window's `eval` binding (T47 `node:vm`
// context, so a script sees the window surface as globals) — but only when the
// window's happy-dom settings enable it (`settings.enableJavaScriptEvaluation`,
// happy-dom parity: a default detached window does not evaluate scripts). An
// external script (`src` attribute) is fetched through the window's `fetch`
// unless `settings.disableJavaScriptFileLoading` is set; a failing fetch (no
// server, offline) is tolerated and never blocks `waitUntilComplete` — the
// fetch promise is registered as pending work and settles either way.
//
// A throwing script is contained through the same window `error`-event dispatch
// the async timer surface uses (`dispatchWindowError`), so a
// `window.addEventListener('error', …)` observer sees `event.error` —
// happy-dom's `document.write` script behavior.
//
// The owning window is recovered through the facade reverse map in
// js/facade/window.js (`ctx.windowFacadeOfDocument`).

import { Document } from "../document.js";
import { dispatchWindowError } from "./timers.js";

export const seam = Object.freeze({
  id: "facade/extensions/document-write",
  owner: "integration",
  gate: "integration",
  status: "implemented",
});

// Documents that already had their first write (the full-document parse mode).
// happy-dom tracks `isFirstWrite` / `isFirstWriteAfterOpen` on the document;
// mad-dom has no `document.open()` yet, so the first write is the only
// full-document parse.
const WRITTEN_DOCUMENTS = new WeakSet();

let ctx = null;

// Evaluates one parsed `<script>` element the way happy-dom's script loading
// does for a `document.write` with `evaluateScripts`: an inline script runs
// synchronously through the window's `eval` binding (a throwing script becomes
// a window `error` event); an external script is fetched through the window's
// `fetch` (registered as pending work so `waitUntilComplete` waits for it) and
// its response text is evaluated — a failing fetch is tolerated.
function evaluateScript(windowFacade, settings, script) {
  const src = script.getAttribute("src");
  if (src !== null && src.trim() !== "") {
    if (settings.disableJavaScriptFileLoading) return;
    let url;
    try {
      url = new URL(src, windowFacade.location.href).href;
    } catch {
      return;
    }
    const loaded = (async () => {
      try {
        const fetchFn =
          typeof windowFacade.fetch === "function" ? windowFacade.fetch.bind(windowFacade) : globalThis.fetch;
        const response = await fetchFn(url, { redirect: "follow" });
        if (!response.ok) return;
        const code = await response.text();
        windowFacade.eval(code);
      } catch {
        // happy-dom tolerates a failing external script load (no server,
        // offline): the element stays in the tree, no script runs, and
        // `waitUntilComplete` still resolves.
      }
    })();
    windowFacade.happyDOM.registerPending(loaded);
    return;
  }
  try {
    windowFacade.eval(script.textContent);
  } catch (error) {
    dispatchWindowError(windowFacade, error);
  }
}

// Evaluates every `<script>` the parse produced, in document order, when the
// window's happy-dom settings enable JavaScript evaluation.
export function evaluateScripts(windowFacade, root) {
  const settings = windowFacade.happyDOM?.settings ?? null;
  if (settings === null || !settings.enableJavaScriptEvaluation) return;
  for (const script of root.querySelectorAll("script")) {
    evaluateScript(windowFacade, settings, script);
  }
}

export function install(extensionCtx) {
  if (ctx === null) ctx = extensionCtx;
  const installCtx = extensionCtx;
  installCtx.defineMethod(Document.prototype, "write", function write(...texts) {
    const windowFacade = ctx.windowFacadeOfDocument(this);
    const html = texts.map((value) => String(value)).join("");

    if (!WRITTEN_DOCUMENTS.has(this)) {
      // First write: replace the document content with a freshly parsed full
      // document (happy-dom `write()` first-write mode) so `<head>` / `<body>`
      // are restructured like the baseline, then evaluate the parsed scripts.
      WRITTEN_DOCUMENTS.add(this);
      try {
        this.parseHtml(html);
      } catch {
        // Ignore parse-level failures; script errors are handled below.
      }
      if (windowFacade !== undefined) evaluateScripts(windowFacade, this);
      return;
    }

    // Later writes: append the parsed fragment to the body (write streams into
    // the open document; a parse failure is not a script error).
    let scripts = [];
    try {
      const fragment = this.createDocumentFragment();
      fragment.innerHTML = html;
      scripts = [...fragment.querySelectorAll("script")];
      const body = this.body;
      if (body !== null) body.appendChild(fragment);
    } catch {
      // Ignore parse-level failures; script errors are handled below.
    }

    if (windowFacade === undefined) return;
    const settings = windowFacade.happyDOM?.settings ?? null;
    if (settings === null || !settings.enableJavaScriptEvaluation) return;
    for (const script of scripts) {
      evaluateScript(windowFacade, settings, script);
    }
  });
}
