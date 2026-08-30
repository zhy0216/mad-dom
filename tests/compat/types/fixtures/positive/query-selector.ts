// Positive fixture: the T31 selector query surface. Document and Element
// querySelector/querySelectorAll, matches/closest and getElementById, plus the
// static NodeList read surface (item + iteration).
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
// Instances are typed through function parameters because MAD DOM only mints
// windows through createWindow() — its Window is not constructible.
import { Document, Element } from "dom-under-test";

function useSelectorSurface(document: Document, element: Element): void {
  // querySelector / querySelectorAll on a Document.
  const single = document.querySelector("div.main");
  const all = document.querySelectorAll("p");
  const first: Element | null = all.item(0);
  const byId: Element | null = document.getElementById("root");

  // Element-scoped queries and matches / closest.
  const scoped = element.querySelectorAll("li.item");
  const doesMatch: boolean = element.matches("div");
  const nearest: Element | null = element.closest("section");

  // Iteration over the static collection.
  let count = 0;
  for (const node of all) {
    count += 1;
    void node;
  }

  const result = { single, first, byId, scoped, doesMatch, nearest, count };
  void result;
}

export const exported = { useSelectorSurface };
