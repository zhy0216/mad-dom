// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/element/Element.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public Element surface — className/role,
// classList (value/add/remove/replace/toggle/contains/item), namespaceURI,
// nodeName/localName/tagName, textContent, innerHTML/outerHTML, the attribute
// accessors, dataset/id, querySelector/querySelectorAll, matches/closest,
// getElementsByTagName/getElementsByClassName, the DocumentFragment splice
// semantics on appendChild/insertBefore and cloneNode. The internal
// HTMLParser/HTMLSerializer/QuerySelector spyOn delegation tests and internal
// symbol-slot writes are dropped (internal implementation detail);
// uppercase attribute-name normalization differences are out of the scenario
// surface (the scenario uses lowercase names).
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-element";
export const description = "real differential: public Element className/role, classList, attributes, inner/outerHTML, query and tree surface";
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
    const element = document.createElement("div");

    // className / role.
    element.setAttribute("class", "class");
    api.record.value("className-read", element.className);
    element.className = "class";
    api.record.value("className-write", element.getAttribute("class"));
    element.setAttribute("role", "role");
    api.record.value("role-read", element.role);
    element.role = "role";
    api.record.value("role-write", element.getAttribute("role"));

    // classList.
    element.setAttribute("class", "value1 value2");
    api.record.value("classList-value", element.classList.value);
    api.record.value("classList-length", element.classList.length);
    api.record.value("classList-0", element.classList[0]);
    api.record.value("classList-1", element.classList[1]);
    element.classList.add("foo", "bar", "baz");
    api.record.value("classList-add", element.outerHTML);
    element.className = "";
    element.classList.add("bar", "baz");
    api.record.value("classList-add-2", element.outerHTML);
    element.classList.remove("baz");
    api.record.value("classList-remove", element.outerHTML);
    element.classList.replace("bar", "foo");
    api.record.value("classList-replace", element.outerHTML);
    api.record.value("classList-contains", element.classList.contains("foo"));
    api.record.value("classList-toggle-on", element.classList.toggle("baz"));
    api.record.value("classList-toggle-off", element.classList.toggle("baz"));
    api.record.value("classList-item-0", element.classList.item(0));

    // namespace / names.
    api.record.value("namespaceURI", element.namespaceURI);
    api.record.value("nodeName", element.nodeName);
    api.record.value("localName", element.localName);
    api.record.value("tagName", element.tagName);

    // textContent (entity decoding).
    const textDiv = document.createElement("div");
    textDiv.innerHTML = "<div>&gt;</div>";
    api.record.value("textContent", textDiv.textContent);

    // innerHTML / outerHTML.
    const container = document.createElement("div");
    const innerDiv = document.createElement("div");
    innerDiv.textContent = "text1";
    container.appendChild(innerDiv);
    api.record.value("innerHTML", container.innerHTML);
    api.record.value("outerHTML", container.outerHTML);

    // attribute accessors.
    element.setAttribute("data-foo", "bar");
    api.record.value("getAttribute", element.getAttribute("data-foo"));
    api.record.value("hasAttribute", element.hasAttribute("data-foo"));
    api.record.value("getAttribute-missing", element.getAttribute("missing"));
    element.removeAttribute("data-foo");
    api.record.value("after-remove", element.hasAttribute("data-foo"));
    api.record.value("attributes-length", element.attributes.length);
    api.record.value("attributes-getNamedItem", element.attributes.getNamedItem("class")?.value);
    api.record.value("attributes-item-0", element.attributes.item(0)?.name);
    api.record.value(
      "attributes-iter",
      Array.from(element.attributes, (attr) => attr.name),
    );
    api.record.value("attributes-toString", element.attributes.toString());

    // dataset / id.
    element.dataset.hello = "world";
    api.record.value("dataset", element.dataset.hello);
    element.id = "id";
    api.record.value("id", element.id);

    // querySelector / matches / closest.
    element.innerHTML = '<div class="inner" id="inner"></div>';
    api.record.value("querySelector", element.querySelector(".inner")?.id);
    api.record.value("querySelectorAll", element.querySelectorAll(".inner").length);
    const inner = element.querySelector("#inner");
    api.record.value("matches", inner.matches(".inner"));
    api.record.value("closest", inner.closest("div") === element);

    // getElementsByTagName / getElementsByClassName.
    api.record.value("getElementsByTagName", element.getElementsByTagName("div").length);
    api.record.value("getElementsByClassName", element.getElementsByClassName("inner").length);

    // innerHTML setter parses.
    const parsed = document.createElement("div");
    parsed.innerHTML = '<div class="child1"></div><span class="child2"></span>';
    api.record.value("innerHTML-set", parsed.innerHTML);
    api.record.value(
      "innerHTML-set-children",
      Array.from(parsed.children, (child) => child.nodeName),
    );

    // DocumentFragment splice on appendChild / insertBefore.
    const template = document.createElement("template");
    template.innerHTML = "<div>Div</div><span>Span</span>";
    const host = document.createElement("div");
    host.appendChild(template.content.cloneNode(true));
    api.record.value("fragment-host-inner", host.innerHTML);
    api.record.value("fragment-child-count", template.content.cloneNode(true).childNodes.length);

    const child1 = document.createElement("span");
    const child2 = document.createElement("span");
    const template2 = document.createElement("template");
    template2.innerHTML = "<div>Template DIV 1</div><span>Template SPAN 1</span>";
    const host2 = document.createElement("div");
    host2.appendChild(child1);
    host2.appendChild(child2);
    host2.insertBefore(template2.content.cloneNode(true), child2);
    api.record.value("insert-fragment-inner", host2.innerHTML);
    api.record.value("insert-fragment-count", host2.children.length);

    // cloneNode shallow / deep.
    const parent = document.createElement("div");
    parent.innerHTML = "<span>text</span>";
    api.record.value("clone-shallow", parent.cloneNode(false).childNodes.length);
    api.record.value("clone-deep", parent.cloneNode(true).childNodes.length);
    api.record.value("clone-deep-child", parent.cloneNode(true).childNodes[0].nodeName);
  } catch (error) {
    api.record.error(error, "facade");
  }
}
