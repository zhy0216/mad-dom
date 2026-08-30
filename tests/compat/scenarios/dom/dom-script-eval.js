// Real differential scenario (T47): `window.eval` script evaluation with
// document/window global binding and script-error propagation.
//
// Probes the deterministic eval surface only: arithmetic, `typeof` reads of the
// window-bound globals, the document/window bindings themselves, DOM access
// through `document`, closures, the `this === window` global identity, and the
// synchronous propagation of a script error to the eval caller. Assignment /
// `var` landing and undeclared-read `ReferenceError` semantics are excluded
// here (they are VM-global mechanics with no stable cross-implementation
// observable), as is any element `nodeName` casing (T23A divergence).
export const id = "dom-script-eval";
export const description = "real differential: window.eval arithmetic, document/window global binding, DOM access, closures and synchronous script-error propagation";
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
    api.record.value("eval-arithmetic", window.eval("1 + 2 * 3"));
    api.record.value("eval-string", window.eval("'a' + 'b'"));
    api.record.value("eval-typeof-document", window.eval("typeof document"));
    api.record.value("eval-typeof-window", window.eval("typeof window"));
    api.record.value("eval-typeof-htmlelement", window.eval("typeof HTMLElement"));
    api.record.value("eval-typeof-settimeout", window.eval("typeof setTimeout"));
    api.record.value("eval-typeof-url", window.eval("typeof URL"));
    api.record.value("eval-typeof-promise", window.eval("typeof Promise"));
    api.record.value("eval-document-body", window.eval("document.body !== null"));
    api.record.value("eval-create-element-type", window.eval("document.createElement('div').nodeType"));
    api.record.value("eval-this-is-window", window.eval("this === window"));
    api.record.value("eval-closure", window.eval("(function(){ var n = 0; return function(){ return ++n; }; })()()"));

    try {
      window.eval("throw new Error('script boom')");
      api.record.value("eval-throw-name", "did-not-throw");
    } catch (error) {
      api.record.error(error, "sync-throw");
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
