// Real differential scenario (T24C): the public Node mutation surface.
//
// The observations intentionally use nodeType, child counts and identity
// relations instead of serialized tag names. MAD DOM's frozen T23 contract
// lowercases Element.nodeName while happy-dom exposes the WHATWG uppercase
// spelling; that unrelated casing difference should not mask mutation parity.
export const id = "dom-mutations";
export const description = "real differential: append, insert, move, remove, replace and DocumentFragment mutation semantics";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = typeof entry.createWindow === "function" ? entry.createWindow() : new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }

  const document = window.document;

  try {
    const parent = document.createElement("parent");
    const first = document.createElement("first");
    const text = document.createTextNode("text");
    const last = document.createElement("last");
    const middle = document.createElement("middle");

    api.record.identity("append-return-first", parent.appendChild(first), first);
    api.record.identity("append-return-text", parent.appendChild(text), text);
    api.record.identity("append-return-last", parent.appendChild(last), last);
    api.record.value("after-append-types", Array.from(parent.childNodes, (node) => node.nodeType));

    api.record.identity("insert-return-middle", parent.insertBefore(middle, last), middle);
    api.record.value("after-insert-types", Array.from(parent.childNodes, (node) => node.nodeType));
    api.record.identity("middle-parent-after-insert", middle.parentNode, parent);

    // Moving an existing child is an ordinary native operation, not a second
    // JavaScript-side tree update.
    api.record.identity("move-return-first", parent.appendChild(first), first);
    api.record.value("after-move-types", Array.from(parent.childNodes, (node) => node.nodeType));
    api.record.identity("moved-first-is-last", parent.lastChild, first);

    api.record.identity("remove-return-middle", parent.removeChild(middle), middle);
    api.record.value("after-remove-count", parent.childNodes.length);
    api.record.identity("removed-middle-detached", middle.parentNode, null);

    const replacement = document.createElement("replacement");
    api.record.identity("replace-return-last", parent.replaceChild(replacement, first), first);
    api.record.value("after-replace-types", Array.from(parent.childNodes, (node) => node.nodeType));
    api.record.identity("replacement-parent", replacement.parentNode, parent);
    api.record.identity("replaced-first-detached", first.parentNode, null);

    const fragment = document.createDocumentFragment();
    const fragmentText = document.createTextNode("fragment-text");
    const fragmentElement = document.createElement("fragment-element");
    fragment.appendChild(fragmentText);
    fragment.appendChild(fragmentElement);

    api.record.identity("fragment-insert-return", parent.insertBefore(fragment, replacement), fragment);
    api.record.value("after-fragment-types", Array.from(parent.childNodes, (node) => node.nodeType));
    api.record.value("fragment-empty-after-insert", fragment.childNodes.length);
    api.record.identity("fragment-text-moved", fragmentText.parentNode, parent);
    api.record.identity("fragment-element-moved", fragmentElement.parentNode, parent);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
