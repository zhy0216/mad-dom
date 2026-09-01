// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/node/Node.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public Node surface — isConnected,
// childNodes, nodeValue/nodeName, sibling/parent navigation, contains,
// hasChildNodes, isSameNode, cloneNode, the tree-mutation methods
// (appendChild/removeChild/insertBefore/replaceChild), normalize and the
// custom-element lifecycle callbacks. The internal NodeFactory construction
// tests and internal symbol-slot writes are dropped (internal implementation
// detail with no public observation surface).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-node";
export const description = "real differential: public Node navigation, contains, cloneNode, tree mutation, normalize, lifecycle";
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
    // isConnected / childNodes / navigation.
    const div = document.createElement("div");
    const span = document.createElement("span");
    const text = document.createTextNode("text");
    const comment = document.createComment("comment");
    div.appendChild(span);
    span.appendChild(text);
    span.appendChild(comment);
    api.record.value("connected-before", div.isConnected);
    document.body.appendChild(div);
    api.record.value(
      "connected-after",
      div.isConnected && span.isConnected && text.isConnected,
    );
    api.record.value("child-nodes-len", div.childNodes.length);
    api.record.value("first-child", div.firstChild === span);
    api.record.value("last-child", div.lastChild === span);
    api.record.value("prev-sibling", span.previousSibling);
    api.record.value("next-sibling", span.nextSibling);
    api.record.value("first-of-span", span.firstChild === text);
    api.record.value("last-of-span", span.lastChild === comment);
    api.record.value("has-child-nodes", div.hasChildNodes());
    api.record.value("empty-has-child-nodes", document.createElement("i").hasChildNodes());
    api.record.value("text-node-value", text.nodeValue);
    api.record.value("text-node-name", text.nodeName);
    api.record.value("element-node-value", div.nodeValue);

    // contains.
    api.record.value("contains-span", div.contains(span));
    api.record.value("contains-text", div.contains(text));
    api.record.value("contains-self", div.contains(div));
    api.record.value("contains-null", div.contains(null));
    api.record.value("contains-undefined", div.contains(undefined));
    api.record.value("contains-outer", div.contains(document.createElement("b")));

    // cloneNode shallow / deep.
    const cloneShallow = div.cloneNode();
    api.record.value("clone-shallow-len", cloneShallow.childNodes.length);
    const cloneDeep = div.cloneNode(true);
    api.record.value("clone-deep-len", cloneDeep.childNodes.length);
    api.record.value("clone-deep-child", cloneDeep.childNodes[0].nodeName);
    api.record.value("clone-distinct", cloneDeep !== div);

    // appendChild / move / removeChild.
    const parent1 = document.createElement("div");
    const child = document.createElement("span");
    parent1.appendChild(child);
    api.record.value("append-parent", child.parentNode === parent1);
    api.record.value("append-child-len", Array.from(parent1.childNodes).length);
    const parent2 = document.createElement("div");
    parent2.appendChild(child);
    api.record.value("move-child-parent", child.parentNode === parent2);
    api.record.value("move-from-len", Array.from(parent1.childNodes).length);
    api.record.value("move-to-len", Array.from(parent2.childNodes).length);
    api.record.value("connected-after-append", child.isConnected);
    document.body.appendChild(parent2);
    api.record.value("connected-when-connected", child.isConnected);
    const removed = parent2.removeChild(child);
    api.record.value("removed-parent", child.parentNode);
    api.record.value("removed-len", Array.from(parent2.childNodes).length);
    api.record.value("removed-connected", child.isConnected);
    api.record.value("removed-returned", removed === child);

    // insertBefore with a reference and with null (append).
    const ibParent = document.createElement("div");
    const ib1 = document.createElement("span");
    const ib2 = document.createElement("span");
    const ibNew = document.createElement("span");
    ibParent.appendChild(ib1);
    ibParent.appendChild(ib2);
    ibParent.insertBefore(ibNew, ib2);
    api.record.value("insert-before-order", Array.from(ibParent.childNodes, (n) => n.nodeName));
    ibParent.insertBefore(document.createElement("b"), null);
    api.record.value("insert-before-null-order", Array.from(ibParent.childNodes, (n) => n.nodeName));

    // replaceChild.
    const rcParent = document.createElement("div");
    const rcOld = document.createElement("span");
    const rcNew = document.createElement("span");
    rcParent.appendChild(rcOld);
    rcParent.replaceChild(rcNew, rcOld);
    api.record.value("replace-child-order", Array.from(rcParent.childNodes, (n) => n.nodeName));

    // normalize merges adjacent text and drops empty ones.
    const nDiv = document.createElement("div");
    const nSpan = document.createElement("span");
    nSpan.append(document.createTextNode("sp"), document.createTextNode("an"));
    const nB = document.createElement("b");
    nB.append(
      document.createTextNode(""),
      document.createTextNode(""),
      document.createTextNode(""),
    );
    nDiv.append(
      document.createTextNode(""),
      document.createTextNode("d"),
      document.createTextNode(""),
      document.createTextNode("i"),
      document.createTextNode("v"),
      nSpan,
      document.createTextNode(""),
      nB,
      document.createTextNode(""),
    );
    api.record.value("normalize-before", nDiv.childNodes.length);
    nDiv.normalize();
    api.record.value("normalize-after", nDiv.childNodes.length);
    api.record.value(
      "normalize-nodes",
      Array.from(nDiv.childNodes, (n) => n.nodeValue ?? n.nodeName),
    );
    api.record.value("normalize-span-len", nSpan.childNodes.length);
    api.record.value("normalize-b-len", nB.childNodes.length);

    // isSameNode.
    api.record.value("is-same-self", div.isSameNode(div));
    api.record.value("is-same-other", div.isSameNode(span));

    // parentElement.
    api.record.value("span-parent-element", span.parentElement === div);
    api.record.value("div-parent-element", div.parentElement === document.body);

    // dispatchEvent — non-bubbling, bubbling and preventDefault.
    const evChild = document.createElement("span");
    const evParent = document.createElement("div");
    evParent.appendChild(evChild);
    const nonBubble = new window.Event("click", { bubbles: false });
    let nonBubbleChild = null;
    let nonBubbleParent = null;
    evChild.addEventListener("click", (e) => (nonBubbleChild = e));
    evParent.addEventListener("click", (e) => (nonBubbleParent = e));
    api.record.value("dispatch-non-bubble-ret", evChild.dispatchEvent(nonBubble));
    api.record.value("dispatch-non-bubble-child", nonBubbleChild === nonBubble);
    api.record.value("dispatch-non-bubble-parent", nonBubbleParent);

    const bubble = new window.Event("click", { bubbles: true });
    let bubbleTarget = null;
    let bubbleParent = null;
    let bubbleParentTarget = null;
    evChild.addEventListener("click", (e) => (bubbleTarget = e.target));
    evParent.addEventListener("click", (e) => {
      bubbleParent = e;
      bubbleParentTarget = e.target;
    });
    api.record.value("dispatch-bubble-ret", evChild.dispatchEvent(bubble));
    api.record.value("dispatch-bubble-target", bubbleTarget === evChild);
    api.record.value("dispatch-bubble-parent", bubbleParent === bubble);
    api.record.value("dispatch-bubble-parent-target", bubbleParentTarget === evChild);

    const cancelable = new window.Event("click", { bubbles: true, cancelable: true });
    evChild.addEventListener("click", (e) => e.preventDefault());
    api.record.value("dispatch-prevent-default-ret", evChild.dispatchEvent(cancelable));

    // Custom element lifecycle callbacks fire on connect / disconnect.
    const lifecycleOutput = [];
    class CustomCounterElement extends window.HTMLElement {
      connectedCallback() {
        lifecycleOutput.push("Counter:connected");
      }
      disconnectedCallback() {
        lifecycleOutput.push("Counter:disconnected");
      }
    }
    window.customElements.define("custom-counter", CustomCounterElement);
    document.body.innerHTML = "<custom-counter></custom-counter>";
    document.body.innerHTML = "";
    api.record.value("custom-element-lifecycle", lifecycleOutput);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
