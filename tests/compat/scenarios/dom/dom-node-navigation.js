// Real differential scenario (T23): detached Element/Text creation and node
// navigation through the public entry of each implementation.
//
// Scope is exactly the T23 vertical slice: document.createElement /
// document.createTextNode plus the Node navigation surface (nodeType, nodeName,
// parentNode, firstChild, lastChild, previousSibling, nextSibling, childNodes).
// Tree building is deliberately absent — facade mutation is T24C's scope — so
// every relation is exercised on freshly minted, detached nodes.
export const id = "dom-node-navigation";
export const description = "real differential: detached Element/Text creation, nodeType/nodeName and basic navigation";
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
    const div = document.createElement("div");
    const text = document.createTextNode("hello");

    api.record.value("element-node-type", div.nodeType);
    api.record.value("element-node-name", div.nodeName);
    api.record.value("text-node-type", text.nodeType);
    api.record.value("text-node-name", text.nodeName);

    api.record.value("element-parent-node", div.parentNode);
    api.record.value("element-first-child", div.firstChild);
    api.record.value("element-last-child", div.lastChild);
    api.record.value("element-previous-sibling", div.previousSibling);
    api.record.value("element-next-sibling", div.nextSibling);
    api.record.value("element-child-count", div.childNodes.length);

    api.record.value("text-parent-node", text.parentNode);
    api.record.value("text-first-child", text.firstChild);
    api.record.value("text-last-child", text.lastChild);
    api.record.value("text-previous-sibling", text.previousSibling);
    api.record.value("text-next-sibling", text.nextSibling);
    api.record.value("text-child-count", text.childNodes.length);

    api.record.identity("distinct-elements", document.createElement("div"), document.createElement("div"));
    api.record.identity(
      "distinct-texts",
      document.createTextNode("x"),
      document.createTextNode("x"),
    );
  } catch (error) {
    api.record.error(error, "facade");
  }
}
