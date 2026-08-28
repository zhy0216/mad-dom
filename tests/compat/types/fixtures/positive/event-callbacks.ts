// Positive fixture: event callback parameter types.
// Covers: addEventListener listener signatures (TEventListener), event
// callback parameter typing, enum member comparison in event handlers.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import { Event, EventPhaseEnum, Window } from "dom-under-test";

const window = new Window();
const document = window.document;

document.addEventListener("click", (event) => {
  const phase: number = event.eventPhase;
  if (phase === EventPhaseEnum.bubbling) {
    event.stopPropagation();
  }
});

const listener = (event: Event): void => {
  if (event.defaultPrevented) {
    return;
  }
};
document.addEventListener("submit", listener);

export const exported = { phaseEnum: EventPhaseEnum.none, listener };
