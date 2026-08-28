// Positive fixture: type-only export references.
// Covers: type export reference (I* interface, T* alias) used in annotations.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import type { IEventInit, TEventListener } from "dom-under-test";
import { Event } from "dom-under-test";

const init: IEventInit = { bubbles: true, cancelable: false, composed: true };

const listener: TEventListener = (event) => {
  if (event.cancelable) {
    event.preventDefault();
  }
};

const typedListener: TEventListener = (event: Event): void => {
  if (event.defaultPrevented) {
    return;
  }
};

export const exported = { init, listener, typedListener };
