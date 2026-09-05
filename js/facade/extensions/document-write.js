// document.write and Browser content/navigation share this classic-script
// pipeline. Execution is opt-in; module/iframe loading is tracked separately.
import { Document } from "../document.js";
import { dispatchWindowError } from "./timers.js";
import { fetchScriptSync } from "./fetch.js";
import { windowTasks } from "../window-tasks.js";
import { Event } from "./events.js";

export const seam = Object.freeze({
  id: "facade/extensions/document-write",
  owner: "integration",
  gate: "integration",
  status: "implemented",
});

const WRITTEN_DOCUMENTS = new WeakSet();
const CURRENT_SCRIPT = new WeakMap();
let ctx = null;

export function replaceDocumentContent(document, html) {
  document.parseHtml(String(html));
  WRITTEN_DOCUMENTS.add(document);
}

function execute(window, script, source) {
  CURRENT_SCRIPT.set(window.document, script);
  try { window.eval(source); }
  catch (error) {
    const settings = window.happyDOM.settings;
    if (settings.disableErrorCapturing || settings.errorCapture !== "tryAndCatch") throw error;
    dispatchWindowError(window, error);
  } finally { CURRENT_SCRIPT.delete(window.document); }
}

function loadError(window, script, error) {
  window.console.error(error);
  script.dispatchEvent(new Event("error"));
}

function reportAsyncScriptError(owner, generation, error) {
  // Host exception machinery can retain the callback after it throws. Keep
  // this closure outside evaluateScript so it cannot retain the Window/DOM.
  globalThis.queueMicrotask(() => {
    if (!owner.closed && owner.generation === generation) throw error;
  });
}

function evaluateScript(window, script) {
  const owner = windowTasks(window);
  if (owner.closed) return;
  const settings = window.happyDOM.settings;
  const type = script.getAttribute("type");
  if (type !== null && type !== "application/x-ecmascript" && type !== "application/x-javascript" && !type.startsWith("text/javascript")) return;
  const src = script.getAttribute("src");
  if (src === null) {
    if (settings.enableJavaScriptEvaluation && script.textContent) execute(window, script, script.textContent);
    return;
  }
  if (!src) return;
  let url;
  try { url = new URL(src, window.location.href).href; } catch { return; }
  if (settings.disableJavaScriptFileLoading || !settings.enableJavaScriptEvaluation) {
    if (settings.handleDisabledFileLoadingAsSuccess) script.dispatchEvent(new Event("load"));
    else loadError(window, script, new DOMException(`Failed to load script "${url}". JavaScript file loading is disabled.`, "NotSupportedError"));
    return;
  }
  const init = {
    credentials: script.getAttribute("crossorigin") === "use-credentials" ? "include" : "same-origin",
    referrerPolicy: script.getAttribute("referrerpolicy") || "",
  };
  if (!script.hasAttribute("async") && !script.hasAttribute("defer")) {
    let response;
    try {
      response = fetchScriptSync(window, url, init);
      if (!response.ok) throw new Error(`Failed to load script "${url}". Status: ${response.status}`);
    } catch (error) { loadError(window, script, error); return; }
    execute(window, script, Buffer.from(response.body ?? "").toString());
    script.dispatchEvent(new Event("load"));
    return;
  }
  const generation = owner.generation;
  const loaded = (async () => {
    let source;
    try {
      const response = await window.fetch(url, init);
      if (!response.ok) throw new Error(`Failed to load script "${url}". Status: ${response.status}`);
      source = await response.text();
    } catch (error) {
      if (!owner.closed && owner.generation === generation) loadError(window, script, error);
      return;
    }
    if (owner.closed || owner.generation !== generation) return;
    execute(window, script, source);
    script.dispatchEvent(new Event("load"));
  })();
  owner.track(loaded);
  // In uncaught/process-level mode the script promise must remain observable
  // as a host error even though the owner settles its bookkeeping on failure.
  void loaded.catch((error) => reportAsyncScriptError(owner, generation, error));
}

export function evaluateScripts(window, root) {
  for (const script of root.querySelectorAll("script")) evaluateScript(window, script);
}

export function install(extensionCtx) {
  if (ctx === null) ctx = extensionCtx;
  const installCtx = extensionCtx;
  installCtx.defineAccessor(Document.prototype, "currentScript", function currentScript() {
    return CURRENT_SCRIPT.get(this) ?? null;
  }, undefined);
  installCtx.defineMethod(Document.prototype, "open", function open() {
    this.parseHtml("");
    WRITTEN_DOCUMENTS.delete(this);
    return this;
  });
  installCtx.defineMethod(Document.prototype, "write", function write(...texts) {
    const windowFacade = ctx.windowFacadeOfDocument(this);
    const html = texts.map((value) => String(value)).join("");

    if (!WRITTEN_DOCUMENTS.has(this)) {
      // First write: replace the document content with a freshly parsed full
      // document (happy-dom `write()` first-write mode) so `<head>` / `<body>`
      // are restructured like the baseline, then evaluate the parsed scripts.
      WRITTEN_DOCUMENTS.add(this);
      try {
        replaceDocumentContent(this, html);
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
    for (const script of scripts) evaluateScript(windowFacade, script);
  });
}
