// Negative fixture: wrong argument types passed to public methods.
// Every marked line below MUST be rejected by BOTH dom-under-test targets.
// Instances are typed through function parameters so the fixture stays a pure
// signature check (no window construction on either target; `new Window()` is
// the package-entry path since T48E).
import { Document, Window } from "dom-under-test";

function rejectWrongArgumentTypes(window: Window, document: Document): void {
  // @ts-expect-error - Window.document is read-only
  window.document = document;

  // @ts-expect-error - Window.destroy takes no arguments
  window.destroy("now");

  // @ts-expect-error - Document.destroy takes no arguments
  document.destroy("later");
}

export const exported = { rejectWrongArgumentTypes };
