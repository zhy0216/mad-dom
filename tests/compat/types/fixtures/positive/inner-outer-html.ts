// Positive fixture: the T29 innerHTML / outerHTML and document-structure
// surface. Element innerHTML/outerHTML read/write plus the
// documentElement / head / body accessors.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
// Instances are typed through function parameters because MAD DOM only mints
// windows through createWindow() — its Window is not constructible.
import { Document, Element } from "dom-under-test";

function useHtmlSurface(document: Document, element: Element): void {
  // innerHTML / outerHTML read/write on an Element.
  element.innerHTML = "<p>one</p><p>two</p>";
  const inner: string = element.innerHTML;
  element.outerHTML = "<section id='s'></section>";
  const outer: string = element.outerHTML;

  // Document structure accessors.
  const root = document.documentElement;
  const head = document.head;
  const body = document.body;
  if (root && head && body) {
    body.appendChild(element);
    root.setAttribute("lang", "en");
  }

  const result = { inner, outer, root, head, body };
  void result;
}

export const exported = { useHtmlSurface };
