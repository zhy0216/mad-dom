// Positive fixture: the T47 window timer / task-scheduling / script-evaluation
// surface.
// Covers: setTimeout/clearTimeout/setInterval/clearInterval with inferred host
// timer ids, requestAnimationFrame/cancelAnimationFrame with a numeric
// timestamp callback, queueMicrotask, window.eval (number result), the window
// EventTarget (error listener add/remove, dispatch of a window.ErrorEvent with
// its message/error payload) and the window/globalThis self-references.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import { Window } from "dom-under-test";

const window = new Window({ width: 1024, height: 768 });

const timeoutId = window.setTimeout((n: number, s: string) => void [n, s], 10, 1, "x");
window.clearTimeout(timeoutId);
const intervalId = window.setInterval(() => {}, 20);
window.clearInterval(intervalId);

const rafId = window.requestAnimationFrame((timestamp: number) => void timestamp);
window.cancelAnimationFrame(rafId);

window.queueMicrotask(() => {});

const evaluated: number = window.eval("1 + 2");
const evalDocumentType: string = window.eval("typeof document");

const selfWindow = window.window;
const selfGlobal = window.globalThis;
void selfWindow;
void selfGlobal;

const errorHandler = () => {};
window.addEventListener("error", errorHandler);
window.removeEventListener("error", errorHandler);
const errorEvent = new window.ErrorEvent("error", { message: "boom", error: new Error("boom") });
const errorMessage: string = errorEvent.message;
const errorValue: unknown = errorEvent.error;
const dispatched: boolean = window.dispatchEvent(errorEvent);

export const result = {
  timeoutId,
  intervalId,
  rafId,
  evaluated,
  evalDocumentType,
  selfWindow,
  selfGlobal,
  errorMessage,
  errorValue,
  dispatched,
};
