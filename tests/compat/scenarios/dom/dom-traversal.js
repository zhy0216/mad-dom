// Real differential scenario (T35): the traversal surface.
//
// Scope is exactly the T35 slice — createTreeWalker / createNodeIterator, the
// whatToShow mask, function and acceptNode object filters, the pre-order /
// reverse / directional walks, currentNode reads and writes, the NodeIterator
// root handling, and the mutation-during-walk guarantee (a removed node is
// never visited again and the walk never touches a dangling id). Reentrancy is
// covered by a filter that mutates the tree mid-walk.
//
// The observations deliberately use identity keys (a Map from the captured
// elements to their ids), nodeType numbers and boolean counts — never element
// nodeName (the frozen T23A casing gap), never `Element.id` (not implemented),
// never errors (the T21A napi4 error degradation) and never descriptor probes.
// The scenario keeps its probes inside one tree built with innerHTML, so the
// walkers' identity and order records match the baseline observation for
// observation.
export const id = "dom-traversal";
export const description = "real differential: createTreeWalker/createNodeIterator, whatToShow, function and acceptNode filters, pre-order/reverse/directional walks, currentNode and mutation-during-walk";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    document.body.innerHTML =
      '<div id="a"><span id="a1"></span></div><div id="b"><p id="b1"></p><p id="b2"></p></div>';
    const body = document.body;
    const nodes = {
      body,
      a: document.getElementById("a"),
      a1: document.getElementById("a1"),
      b: document.getElementById("b"),
      b1: document.getElementById("b1"),
      b2: document.getElementById("b2"),
    };
    const keyOf = new Map(Object.entries(nodes).map(([key, node]) => [node, key]));
    const label = (node) =>
      node === null ? "null" : keyOf.get(node) ?? `nodeType:${node.nodeType}`;
    const NF = window.NodeFilter;

    // 1. Surface presence and the NodeFilter constants.
    api.record.value("surface-create-tree-walker", typeof document.createTreeWalker);
    api.record.value("surface-create-node-iterator", typeof document.createNodeIterator);
    api.record.value("surface-window-node-filter", typeof window.NodeFilter);
    api.record.value("surface-window-tree-walker", typeof window.TreeWalker);
    api.record.value("surface-window-node-iterator", typeof window.NodeIterator);
    api.record.value("node-filter-accept", NF.FILTER_ACCEPT);
    api.record.value("node-filter-reject", NF.FILTER_REJECT);
    api.record.value("node-filter-skip", NF.FILTER_SKIP);
    api.record.value("node-filter-show-all", NF.SHOW_ALL);
    api.record.value("node-filter-show-element", NF.SHOW_ELEMENT);
    api.record.value("node-filter-show-text", NF.SHOW_TEXT);
    api.record.value("node-filter-show-comment", NF.SHOW_COMMENT);

    // 2. Pre-order walk with SHOW_ELEMENT and no filter.
    {
      const walker = document.createTreeWalker(body, NF.SHOW_ELEMENT);
      api.record.value("walker-root-is-body", walker.root === body);
      api.record.value("walker-what-to-show-raw", walker.whatToShow);
      api.record.value("walker-filter-null", walker.filter === null);
      api.record.value("walker-current-init", walker.currentNode === body);
      api.record.event("order", { key: label(walker.nextNode()) });
      api.record.event("order", { key: label(walker.nextNode()) });
      api.record.event("order", { key: label(walker.nextNode()) });
      api.record.event("order", { key: label(walker.nextNode()) });
      api.record.event("order", { key: label(walker.nextNode()) });
      api.record.value("order-next-null", walker.nextNode() === null);
      api.record.value("order-current-is-last", walker.currentNode === nodes.b2);
    }

    // 3. Default whatToShow (-1) is returned raw while every node is shown.
    {
      const walker = document.createTreeWalker(body);
      api.record.value("default-what-to-show-raw", walker.whatToShow);
      api.record.event("default", { key: label(walker.nextNode()) });
    }

    // 4. FILTER_REJECT prunes the rejected subtree; FILTER_SKIP descends.
    {
      const walker = document.createTreeWalker(
        body,
        NF.SHOW_ELEMENT,
        (node) => (node === nodes.a ? NF.FILTER_REJECT : NF.FILTER_ACCEPT),
      );
      let node;
      while ((node = walker.nextNode()) !== null) api.record.event("reject", { key: label(node) });
    }
    {
      const walker = document.createTreeWalker(
        body,
        NF.SHOW_ELEMENT,
        (node) => (node === nodes.a ? NF.FILTER_SKIP : NF.FILTER_ACCEPT),
      );
      let node;
      while ((node = walker.nextNode()) !== null) api.record.event("skip", { key: label(node) });
    }

    // 5. An acceptNode object filter with `this` bound to the object.
    {
      let seenThisMatches = false;
      const filter = {
        acceptNode(node) {
          seenThisMatches = this === filter;
          return node === nodes.b1 ? NF.FILTER_REJECT : NF.FILTER_ACCEPT;
        },
      };
      const walker = document.createTreeWalker(body, NF.SHOW_ELEMENT, filter);
      let node;
      while ((node = walker.nextNode()) !== null) api.record.event("object-filter", { key: label(node) });
      api.record.value("object-filter-this", seenThisMatches);
    }

    // 6. whatToShow masks node types inline.
    {
      const walker = document.createTreeWalker(body, NF.SHOW_TEXT);
      api.record.value("show-text-elements-none", walker.nextNode() === null);
    }
    {
      const text = document.createTextNode("hello");
      body.appendChild(text);
      const textWalker = document.createTreeWalker(body, NF.SHOW_TEXT);
      api.record.event("show-text", { key: label(textWalker.nextNode()) });
      const elementWalker = document.createTreeWalker(body, NF.SHOW_ELEMENT);
      const elementKeys = [];
      let node;
      while ((node = elementWalker.nextNode()) !== null) elementKeys.push(label(node));
      api.record.value("show-element-excludes-text", !elementKeys.includes("nodeType:3"));
      api.record.value("show-element-count", elementKeys.length);
    }

    // 7. currentNode write and the directional methods.
    {
      const walker = document.createTreeWalker(body, NF.SHOW_ELEMENT);
      walker.currentNode = nodes.a;
      api.record.value("current-write", walker.currentNode === nodes.a);
      api.record.event("dir-first-child", { key: label(walker.firstChild()) });
      api.record.event("dir-parent", { key: label(walker.parentNode()) });
      api.record.event("dir-parent-root", { key: label(walker.parentNode()) });
      api.record.value("dir-parent-root-null", walker.parentNode() === null);
      walker.currentNode = nodes.a;
      api.record.event("dir-last-child", { key: label(walker.lastChild()) });
      api.record.event("dir-previous-sibling", { key: label(walker.previousSibling()) });
      api.record.event("dir-next-sibling", { key: label(walker.nextSibling()) });
      api.record.value("dir-next-sibling-null", walker.nextSibling() === null);
    }

    // 8. NodeIterator: the first nextNode returns the root, then pre-order.
    {
      const iterator = document.createNodeIterator(body, NF.SHOW_ELEMENT);
      api.record.value("iterator-root", iterator.root === body);
      api.record.event("iterator", { key: label(iterator.nextNode()) });
      api.record.event("iterator", { key: label(iterator.nextNode()) });
      api.record.event("iterator", { key: label(iterator.nextNode()) });
      api.record.event("iterator", { key: label(iterator.nextNode()) });
      api.record.event("iterator", { key: label(iterator.nextNode()) });
      api.record.event("iterator", { key: label(iterator.nextNode()) });
      api.record.value("iterator-next-null", iterator.nextNode() === null);
    }

    // 9. NodeIterator previousNode walks backwards from the last leaf.
    {
      const iterator = document.createNodeIterator(body, NF.SHOW_ELEMENT);
      let node;
      while ((node = iterator.nextNode()) !== null && node !== nodes.b2) {}
      api.record.value("iterator-at-b2", node === nodes.b2);
      api.record.event("iterator-prev", { key: label(iterator.previousNode()) });
      api.record.event("iterator-prev", { key: label(iterator.previousNode()) });
      api.record.event("iterator-prev", { key: label(iterator.previousNode()) });
      api.record.event("iterator-prev", { key: label(iterator.previousNode()) });
      api.record.event("iterator-prev", { key: label(iterator.previousNode()) });
      api.record.value("iterator-prev-null", iterator.previousNode() === null);
    }

    // 10. Mutation during a walk: removing a node never revisits it and the
    // walk continues over the surviving tree.
    {
      const walker = document.createTreeWalker(body, NF.SHOW_ELEMENT);
      api.record.event("mutation", { key: label(walker.nextNode()) });
      nodes.a.removeChild(nodes.a1);
      let node;
      while ((node = walker.nextNode()) !== null) api.record.event("mutation", { key: label(node) });
      api.record.value("mutation-current-last", walker.currentNode === nodes.b2);
    }

    // 11. Reentrancy: a filter that removes a node mid-walk is observed by
    // the next step.
    {
      const walker = document.createTreeWalker(body, NF.SHOW_ELEMENT, (node) => {
        if (node === nodes.b) {
          const child = nodes.b.firstChild;
          if (child) nodes.b.removeChild(child);
        }
        return NF.FILTER_ACCEPT;
      });
      let node;
      while ((node = walker.nextNode()) !== null) api.record.event("reentrant", { key: label(node) });
    }
  } catch (error) {
    api.record.error(error, "facade");
  }
}
