// Real differential scenario (T25E): the Node.textContent accessor.
//
// Scope is exactly the WHATWG `textContent` getter/setter the T25E binding/
// facade implements — reads, writes, the WebIDL `DOMString?` setter conversion
// (null clears, numbers stringify), tree-order concatenation over deep trees,
// text-node data, NUL-byte storage and the property descriptor. The scenario
// records an error wherever a side throws, so a mismatch in the stored value
// surfaces as a recorded difference rather than an infrastructure failure.
// Since T48B NUL bytes are stored verbatim, matching happy-dom.
export const id = "dom-text-content";
export const description = "real differential: Node.textContent getter/setter reads, writes, string conversion, null, deep trees and descriptors";
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
    const el = document.createElement("div");
    api.record.value("empty-get", el.textContent);

    // Round-trip.
    el.textContent = "hello";
    api.record.value("get-after-set", el.textContent);

    // WebIDL DOMString? setter conversion: null acts as the empty string.
    el.textContent = null;
    api.record.value("get-after-null", el.textContent);
    api.record.value("child-count-after-null", el.childNodes.length);

    // Non-string values are coerced with String().
    el.textContent = 42;
    api.record.value("get-after-number", el.textContent);
    api.record.value("child-count-after-number", el.childNodes.length);

    // Setting textContent replaces children with a single text node.
    el.textContent = "replaced";
    api.record.value("child-count-after-replace", el.childNodes.length);
    api.record.value("first-child-type", el.childNodes[0] && el.childNodes[0].nodeType);
    api.record.value("first-child-name", el.childNodes[0] && el.childNodes[0].nodeName);

    // An empty value clears every child and inserts no text node.
    el.textContent = "";
    api.record.value("get-after-empty", el.textContent);
    api.record.value("child-count-after-empty", el.childNodes.length);

    // Deep trees read the tree-order concatenation of descendant text.
    const root = document.createElement("root");
    const a = document.createElement("a");
    const b = document.createElement("b");
    a.appendChild(document.createTextNode("1"));
    b.appendChild(document.createTextNode("2"));
    root.appendChild(a);
    root.appendChild(b);
    root.appendChild(document.createTextNode("3"));
    api.record.value("deep-concat", root.textContent);

    // Text nodes read and set their own data.
    const text = document.createTextNode("data");
    api.record.value("text-get", text.textContent);
    text.textContent = "changed";
    api.record.value("text-get-after-set", text.textContent);

    // A NUL byte in the setter value: stored verbatim by both sides (T48B
    // happy-dom parity).
    try {
      el.textContent = "a\u0000b";
      api.record.value("nul-stored", el.textContent);
    } catch (error) {
      api.record.error(error, "sync-throw");
    }

    // Property descriptor on the element's direct prototype: MAD DOM and
    // happy-dom both keep the accessor off the element's direct prototype
    // (T48A), so the descriptor reads present: false on it.
    const proto = Object.getPrototypeOf(el);
    api.record.descriptor("textContent-descriptor", proto, "textContent");
  } catch (error) {
    api.record.error(error, "facade");
  }
}
