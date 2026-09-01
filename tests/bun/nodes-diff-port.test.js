// W5 nodes-core differential port facade additions integration tests.
//
// Each facade addition that the W5 (nodes 核心内部类) diff-port wave made to
// js/facade/extensions/hdunit-nodes.js / child-nodelist.js / mutation.js is
// pinned by at least one assertion here, mirroring the happy-dom behaviour the
// rewritten node tests observed:
//
//   - ParentNode element getters (`children` on DocumentFragment,
//     `firstElementChild`, `lastElementChild`, `childElementCount`) and
//     `prepend` / `replaceChildren`;
//   - ChildNode mutation (`before` / `after` / `replaceWith`) with string
//     arguments becoming text nodes;
//   - NonDocumentChildNode `previousElementSibling` / `nextElementSibling`,
//     `parentElement`, `hasChildNodes`, `isSameNode`, `normalize`;
//   - `Element.role` reflection;
//   - NodeList `forEach` defaulting the callback `this` to the Window;
//   - `contains` / `insertBefore` null-handling.
import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "../../index.js";
import { Text } from "../../js/facade/extensions/classes.js";

const createdWindows = [];
function freshWindow(options) {
  const win = options === undefined ? new Window() : new Window(options);
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) win.destroy();
});

describe("W5 ParentNode element getters and mutation", () => {
  test("children / firstElementChild / lastElementChild / childElementCount on a fragment", () => {
    const window = freshWindow();
    const document = window.document;
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement("b"));
    fragment.appendChild(document.createTextNode("x"));
    fragment.appendChild(document.createElement("i"));
    expect(Array.from(fragment.children).map((child) => child.nodeName)).toEqual(["B", "I"]);
    expect(fragment.childElementCount).toBe(2);
    expect(fragment.firstElementChild.nodeName).toBe("B");
    expect(fragment.lastElementChild.nodeName).toBe("I");
  });

  test("firstElementChild / lastElementChild / childElementCount on an element", () => {
    const window = freshWindow();
    const document = window.document;
    const element = document.createElement("div");
    element.innerHTML = "<i></i>text<b></b>";
    expect(element.firstElementChild.nodeName).toBe("I");
    expect(element.lastElementChild.nodeName).toBe("B");
    expect(element.childElementCount).toBe(2);
  });

  test("prepend inserts at the front and replaceChildren swaps the children", () => {
    const window = freshWindow();
    const document = window.document;
    const element = document.createElement("div");
    element.innerHTML = '<i data-i="2"></i>';
    element.prepend(document.createElement("b"));
    expect(element.innerHTML).toBe("<b></b><i data-i=\"2\"></i>");
    element.replaceChildren("x", document.createElement("em"));
    expect(element.innerHTML).toBe("x<em></em>");
  });
});

describe("W5 ChildNode / NonDocumentChildNode mutation", () => {
  test("before / after / replaceWith with element and string arguments", () => {
    const window = freshWindow();
    const document = window.document;
    const host = document.createElement("div");
    host.innerHTML = '<i data-i="1"></i><i data-i="3"></i>';
    const mid = document.createElement("i");
    mid.setAttribute("data-i", "2");
    host.children[0].after(mid);
    expect(host.innerHTML).toBe(
      '<i data-i="1"></i><i data-i="2"></i><i data-i="3"></i>',
    );
    const first = document.createElement("i");
    first.setAttribute("data-i", "0");
    host.children[0].before(first);
    expect(host.innerHTML).toBe(
      '<i data-i="0"></i><i data-i="1"></i><i data-i="2"></i><i data-i="3"></i>',
    );
    host.children[1].replaceWith("X");
    expect(host.innerHTML).toBe(
      '<i data-i="0"></i>X<i data-i="2"></i><i data-i="3"></i>',
    );
    // Strings become text nodes (escaped in innerHTML), not parsed HTML.
    const box = document.createElement("div");
    box.innerHTML = "<i data-i=\"1\"></i>";
    box.children[0].after('<span class="x"></span>');
    expect(box.innerHTML).toBe(
      '<i data-i="1"></i>&lt;span class="x"&gt;&lt;/span&gt;',
    );
  });

  test("previousElementSibling / nextElementSibling skip non-element siblings", () => {
    const window = freshWindow();
    const document = window.document;
    const parent = document.createElement("div");
    const element1 = document.createElement("div");
    const comment = document.createComment("c");
    const element2 = document.createElement("div");
    parent.appendChild(element1);
    parent.appendChild(comment);
    parent.appendChild(element2);
    expect(comment.previousElementSibling).toBe(element1);
    expect(comment.nextElementSibling).toBe(element2);
    expect(element1.previousElementSibling).toBeNull();
    expect(element2.nextElementSibling).toBeNull();
  });

  test("parentElement / hasChildNodes / isSameNode", () => {
    const window = freshWindow();
    const document = window.document;
    const parent = document.createElement("div");
    const span = document.createElement("span");
    parent.appendChild(span);
    expect(span.parentElement).toBe(parent);
    expect(parent.hasChildNodes()).toBe(true);
    expect(document.createElement("i").hasChildNodes()).toBe(false);
    expect(span.isSameNode(span)).toBe(true);
    expect(span.isSameNode(parent)).toBe(false);
  });

  test("normalize merges adjacent text nodes and drops empty ones", () => {
    const window = freshWindow();
    const document = window.document;
    const div = document.createElement("div");
    const span = document.createElement("span");
    span.append(document.createTextNode("sp"), document.createTextNode("an"));
    const b = document.createElement("b");
    b.append(document.createTextNode(""), document.createTextNode(""));
    div.append(
      document.createTextNode(""),
      document.createTextNode("d"),
      document.createTextNode("i"),
      span,
      document.createTextNode(""),
      b,
    );
    expect(div.childNodes).toHaveLength(6);
    div.normalize();
    expect(div.childNodes).toHaveLength(3);
    expect(div.childNodes[0]).toBeInstanceOf(Text);
    expect(div.childNodes[0].data).toBe("di");
    expect(div.childNodes[1]).toBe(span);
    expect(span.childNodes).toHaveLength(1);
    expect(span.childNodes[0].data).toBe("span");
    expect(b.childNodes).toHaveLength(0);
  });
});

describe("W5 Element.role and NodeList.forEach", () => {
  test("role reflects the attribute", () => {
    const window = freshWindow();
    const document = window.document;
    const element = document.createElement("div");
    expect(element.role).toBe("");
    element.role = "button";
    expect(element.getAttribute("role")).toBe("button");
    element.setAttribute("role", "tab");
    expect(element.role).toBe("tab");
  });

  test("NodeList.forEach defaults the callback this to the Window", () => {
    const window = freshWindow();
    const document = window.document;
    document.body.appendChild(document.createElement("i"));
    const thisArgs = [];
    document.body.childNodes.forEach(function () {
      thisArgs.push(this === window ? "window" : "other");
    });
    expect(thisArgs).toEqual(["window"]);
    const explicitThis = {};
    document.body.childNodes.forEach(function () {
      expect(this).toBe(explicitThis);
    }, explicitThis);
  });

  test("contains and insertBefore accept null / undefined", () => {
    const window = freshWindow();
    const document = window.document;
    const parent = document.createElement("div");
    expect(parent.contains(null)).toBe(false);
    expect(parent.contains(undefined)).toBe(false);
    const child1 = document.createElement("span");
    const child2 = document.createElement("span");
    const newChild = document.createElement("span");
    parent.appendChild(child1);
    parent.appendChild(child2);
    parent.insertBefore(newChild, null);
    expect(Array.from(parent.childNodes)).toEqual([child1, child2, newChild]);
  });
});
