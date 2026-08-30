// Real differential scenario (T25D): the live childNodes / NodeList collection.
//
// Scope is exactly the live childNodes surface — length, indexed access,
// iteration and collection identity after tree mutations — with no query index
// or HTMLCollection. The observations intentionally use nodeType instead of
// nodeName so the frozen Element.nodeName casing gap (T23A) never masks
// collection parity. Mutation follows the T24C facade (append/insert/move/
// remove/replace); the collection is captured once and re-read live.
export const id = "dom-child-nodelist";
export const description = "real differential: live childNodes length, index, iteration, identity and mutation reflection";
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

    parent.appendChild(first);
    parent.appendChild(text);

    const list = parent.childNodes;
    api.record.value("captured-length", list.length);
    api.record.identity("child-nodes-is-live-list", parent.childNodes, list);
    api.record.value("indexed-types", [list[0] && list[0].nodeType, list[1] && list[1].nodeType]);

    parent.appendChild(last);
    api.record.value("live-after-append-length", list.length);
    api.record.value("live-after-append-types", Array.from(list, (node) => node.nodeType));

    // Moving an existing child to the front is an ordinary mutation; a live
    // collection reflects the new Core document order.
    parent.insertBefore(last, first);
    api.record.value("live-after-move-types", Array.from(list, (node) => node.nodeType));

    parent.removeChild(first);
    api.record.value("live-after-remove-count", list.length);

    const replacement = document.createElement("replacement");
    parent.replaceChild(replacement, text);
    api.record.value("live-after-replace-types", Array.from(list, (node) => node.nodeType));

    api.record.value("empty-list-length", document.createElement("empty").childNodes.length);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
