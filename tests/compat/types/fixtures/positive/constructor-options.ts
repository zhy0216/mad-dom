// Positive fixture: constructor signatures with typed option objects.
// Covers: Window constructor option object, CustomEvent constructor with
// ICustomEventInit detail payload, DetachedWindowAPI accessor.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import { CustomEvent, Window } from "dom-under-test";

const window = new Window({ url: "https://mad-dom.test/", width: 800, height: 600 });
const event = new CustomEvent("ready", {
  bubbles: true,
  detail: { attempt: 1 },
});

window.happyDOM.waitUntilComplete();

export const exported = { window, event };
