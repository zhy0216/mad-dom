// Positive fixture: the T34 attribute-node and token-list surface. Element
// attributes/classList/namespaceURI, the live NamedNodeMap / Attr reads,
// document.createAttribute and the DOMTokenList mutator/iteration surface.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
// happy-dom does not re-export NamedNodeMap/DOMTokenList/Attr from its entry,
// so types are derived from the element's members instead of named imports.
// Instances are typed through function parameters so the fixture stays a pure
// signature check (no window construction on either target; `new Window()` is
// the package-entry path since T48E).
import { Document, Element } from "dom-under-test";

function useAttributeNodes(document: Document, element: Element): void {
  // The element attribute-node surface (types inferred from the members).
  const map = element.attributes;
  const list = element.classList;
  const namespaceUri: string | null = element.namespaceURI;

  // NamedNodeMap read surface: length, item, getNamedItem, indexed reads and
  // iteration over Attr wrappers.
  const count: number = map.length;
  const first = map.item(0);
  const named = map.getNamedItem("id");
  const indexed = map[0];
  const value: string | null = indexed.value;
  const name: string = indexed.name;

  // document.createAttribute yields a detached Attr.
  const created = document.createAttribute("data-created");
  const createdName: string = created.name;

  // DOMTokenList mutator and read surface over the class attribute.
  const tokenCount: number = list.length;
  const raw: string = list.value;
  const at: string | null = list.item(0);
  const has: boolean = list.contains("a");
  list.add("x", "y");
  list.remove("z");
  const toggled: boolean = list.toggle("a", true);
  const replaced: boolean = list.replace("a", "b");

  // Iteration over the token list.
  let total = 0;
  for (const token of list) {
    total += token.length;
  }
  list.forEach((token: string, index: number) => {
    void token;
    void index;
  });

  const result = {
    count,
    first,
    named,
    indexed,
    value,
    name,
    namespaceUri,
    created,
    createdName,
    tokenCount,
    raw,
    at,
    has,
    toggled,
    replaced,
    total,
  };
  void result;
}

export const exported = { useAttributeNodes };
