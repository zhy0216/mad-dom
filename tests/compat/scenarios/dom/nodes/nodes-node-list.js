// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/node/NodeList.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public NodeList surface reachable through
// `element.childNodes` — invalid-index reads return undefined, `item()` returns
// null past the end, iteration and Array.from preserve order, and `forEach`
// defaults the callback `this` to the owning Window (the default-`thisArg`
// behaviour is part of the public contract). The `new NodeList(...)` internal
// constructor tests (illegal-constructor symbol) are dropped.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-node-list";
export const description = "real differential: live childNodes NodeList — invalid index, item, iterator, Array.from, forEach thisArg";
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
    // Invalid index reads on childNodes return undefined.
    document.body.innerHTML =
      '<div class="container">' +
      '<div class="tab" data-track-id="one"></div>' +
      '<div class="tab" data-track-id="two"></div>' +
      "</div>";
    const container = document.querySelector(".container");
    api.record.value("idx-object", container.childNodes[{}]);
    api.record.value("idx-array", container.childNodes[[]]);
    api.record.value("idx-neg", container.childNodes[-1]);
    api.record.value("idx-999", container.childNodes[999]);
    api.record.value("idx-null", container.childNodes[null]);
    api.record.value("idx-undefined", container.childNodes[undefined]);

    // item() and iteration.
    const text = document.createTextNode("test");
    const comment = document.createComment("test");
    document.body.appendChild(text);
    document.body.appendChild(comment);
    api.record.value("item-0", document.body.childNodes.item(0) === text);
    api.record.value("item-1", document.body.childNodes.item(1) === comment);
    api.record.value("item-past-end", document.body.childNodes.item(99));

    // iterator.
    const parent = document.createElement("div");
    const node1 = document.createTextNode("node1");
    const node2 = document.createComment("node2");
    const node3 = document.createTextNode("node3");
    parent.appendChild(node1);
    parent.appendChild(node2);
    parent.appendChild(node3);
    const iterated = [];
    for (const node of parent.childNodes) {
      iterated.push(node === node1 ? "n1" : node === node2 ? "n2" : "n3");
    }
    api.record.value("iterated", iterated);

    // Array.from().
    api.record.value("array-from-count", Array.from(parent.childNodes).length);
    api.record.value(
      "array-from-node-names",
      Array.from(parent.childNodes, (node) => node.nodeName),
    );

    // forEach with the default `this` (the Window) and with an explicit thisArg.
    const thisArgs = [];
    parent.childNodes.forEach(function () {
      thisArgs.push(this === window ? "window" : "other");
    });
    api.record.value("forEach-default-this", thisArgs);

    const explicitThis = {};
    const explicitArgs = [];
    parent.childNodes.forEach(function () {
      explicitArgs.push(this === explicitThis ? "explicit" : "other");
    }, explicitThis);
    api.record.value("forEach-explicit-this", explicitArgs);

    // forEach callback arguments (node, index, nodeList).
    const seen = [];
    parent.childNodes.forEach((node, index, list) => {
      seen.push(`${index}:${node.nodeName}:${list === parent.childNodes}`);
    });
    api.record.value("forEach-args", seen);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
