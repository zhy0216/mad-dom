// Document.write facade extension (integration-test surface).
//
// Installs `Document.prototype.write(...)`:
//
//   1. parses the HTML fragment and appends it to the document body (through
//      the T24C mutation surface + the T29 HTML parser, so the written nodes
//      land in the arena like any innerHTML parse);
//   2. extracts every `<script>…</script>` block and evaluates it with the
//      owning window's `eval` binding (T47 `node:vm` context, so the script
//      sees the window surface as globals: `Function` / `Object` /
//      `addEventListener` / `setTimeout` …);
//   3. a throwing script is contained through the same window `error`-event
//      dispatch the async timer surface uses (`dispatchWindowError`), so a
//      `window.addEventListener('error', …)` observer sees `event.error` —
//      happy-dom's `document.write` script behavior.
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

const SCRIPT_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    scripts.push(match[1]);
  }
  return scripts;
}

let ctx = null;

export function install(extensionCtx) {
  if (ctx === null) ctx = extensionCtx;
  const installCtx = extensionCtx;
  installCtx.defineMethod(Document.prototype, "write", function write(...texts) {
    const windowFacade = ctx.windowFacadeOfDocument(this);
    const html = texts.map((value) => String(value)).join("");

    // Append the parsed fragment to the body (write streams into the open
    // document; a parse failure is not a script error).
    try {
      const fragment = this.createDocumentFragment();
      fragment.innerHTML = html;
      const body = this.body;
      if (body !== null) body.appendChild(fragment);
    } catch {
      // Ignore parse-level failures; script errors are handled below.
    }

    if (windowFacade === undefined) return;
    for (const code of extractScripts(html)) {
      try {
        windowFacade.eval(code);
      } catch (error) {
        dispatchWindowError(windowFacade, error);
      }
    }
  });
}
