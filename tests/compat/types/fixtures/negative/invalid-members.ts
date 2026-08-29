// Negative fixture: unknown members and wrong assignment types.
// Every marked line below MUST be rejected by BOTH dom-under-test targets.
// Instances are typed through function parameters because MAD DOM only mints
// windows through createWindow() — its Window/Document are not constructible
// from user code (they require a genuine native handle).
import { Document, Window } from "dom-under-test";

function rejectInvalidUsage(window: Window, document: Document): void {
  // @ts-expect-error - "doesNotExist" is not on the public Window surface
  window.doesNotExist = true;

  // @ts-expect-error - "title" is a string; a number must be rejected
  document.title = 42;

  // @ts-expect-error - "fakeMethod" is not on the public Document surface
  document.fakeMethod();

  // @ts-expect-error - Window.document is a Document, not a string
  const windowDocumentAsString: string = window.document;

  // @ts-expect-error - destroy takes no arguments
  document.destroy(42);
}

export const exported = { rejectInvalidUsage };
