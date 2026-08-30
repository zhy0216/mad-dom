// Positive fixture: the T32 live collection surface. Document and Element
// getElementsByTagName / getElementsByClassName returning a live HTMLCollection
// with the length / item / namedItem / indexed-read / iteration surface.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
// Instances are typed through function parameters because MAD DOM only mints
// windows through createWindow() — its Window is not constructible.
import { Document, Element } from "dom-under-test";

function useLiveCollections(document: Document, element: Element): void {
  // Document-scoped live collections.
  const tags = document.getElementsByTagName("div");
  const classes = document.getElementsByClassName("item");
  const all = document.getElementsByTagName("*");

  // Element-scoped live collections (descendants only).
  const scoped = element.getElementsByTagName("span");
  const scopedClass = element.getElementsByClassName("row");

  // HTMLCollection read surface.
  const count: number = tags.length;
  const first: Element | null = tags.item(0);
  const named: Element | null = classes.namedItem("app");
  const indexed: Element = all[0];
  const scopedCount: number = scoped.length;

  // Iteration over the live collection.
  let total = 0;
  for (const node of scopedClass) {
    total += 1;
    void node;
  }

  const result = { count, first, named, indexed, scopedCount, total };
  void result;
}

export const exported = { useLiveCollections };
