import { afterEach, describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";

const windows = [];
function windowForTest() {
  const window = new Window();
  windows.push(window);
  return window;
}
afterEach(() => {
  for (const window of windows.splice(0)) window.destroy();
});

describe.skipIf(!isNativeAvailable())("reusing selector syntax", () => {
  test("repeated queries, matches and closest read current attributes and tree order", () => {
    const { document } = windowForTest();
    document.body.innerHTML = '<main><i class="reuse active" data-state="on"></i>' +
      '<i class="reuse" data-state="off"><b></b></i></main>';
    const scope = document.body.firstChild;
    const first = scope.firstChild;
    const second = first.nextSibling;
    const nested = second.firstChild;
    const selector = 'main > .reuse.active[data-state="on"]';
    const snapshot = scope.querySelectorAll(selector);
    for (let i = 0; i < 3; i++) {
      expect(scope.querySelector(selector)).toBe(first);
      expect(first.matches(selector)).toBe(true);
      expect(nested.closest(selector)).toBeNull();
    }

    first.className = "reuse";
    second.className = "reuse active";
    second.setAttribute("data-state", "on");
    expect(scope.querySelector(selector)).toBe(second);
    expect(first.matches(selector)).toBe(false);
    expect(nested.closest(selector)).toBe(second);
    expect(Array.from(snapshot)).toEqual([first]);

    first.className = "reuse active";
    scope.insertBefore(second, first);
    expect(Array.from(scope.querySelectorAll(selector))).toEqual([second, first]);
    scope.removeChild(second);
    expect(scope.querySelector(selector)).toBe(first);
    expect(second.matches(selector)).toBe(false);
    expect(nested.closest(selector)).toBeNull();
  });

  test("the same syntax stays isolated across element, fragment, shadow and document scopes", () => {
    const a = windowForTest();
    const b = windowForTest();
    const selector = '.reuse[data-state="on"]';
    a.document.body.innerHTML = '<section><i class="reuse" data-state="on"></i></section>';
    b.document.body.innerHTML = '<b class="reuse" data-state="on"></b>';
    const section = a.document.body.firstChild;
    const inA = section.firstChild;
    const inB = b.document.body.firstChild;
    const fragment = a.document.createDocumentFragment();
    const inFragment = inA.cloneNode();
    fragment.appendChild(inFragment);
    const shadow = section.attachShadow({ mode: "open" });
    const inShadow = inA.cloneNode();
    shadow.appendChild(inShadow);

    for (let i = 0; i < 3; i++) {
      expect(Array.from(a.document.querySelectorAll(selector))).toEqual([inA]);
      expect(Array.from(section.querySelectorAll(selector))).toEqual([inA]);
      expect(Array.from(b.document.querySelectorAll(selector))).toEqual([inB]);
      expect(Array.from(fragment.querySelectorAll(selector))).toEqual([inFragment]);
      expect(Array.from(shadow.querySelectorAll(selector))).toEqual([inShadow]);
    }
    section.removeChild(inA);
    expect(a.document.querySelector(selector)).toBeNull();
    expect(b.document.querySelector(selector)).toBe(inB);
    expect(fragment.querySelector(selector)).toBe(inFragment);
    expect(shadow.querySelector(selector)).toBe(inShadow);
    a.destroy();
    windows.splice(windows.indexOf(a), 1);
    expect(b.document.querySelector(selector)).toBe(inB);
  });

  test("cache eviction preserves query results and syntax error diagnostics", () => {
    const { document } = windowForTest();
    document.body.innerHTML = '<i class="retained"></i>';
    const retained = document.body.firstChild;
    const errorFor = (selector) => {
      try { document.querySelector(selector); }
      catch (error) { return { code: error.code, message: error.message }; }
      throw new Error(`expected syntax error for ${selector}`);
    };
    const invalid = ["div:::", "div >", "[=x]"];
    const before = invalid.map(errorFor);
    expect(before.every((error) => error.code === "ERR_MAD_DOM_SYNTAX")).toBe(true);
    expect(document.querySelector("i.retained")).toBe(retained);
    // More unique successful parses than the bounded syntax cache can retain.
    for (let i = 0; i < 300; i++) expect(document.querySelector(`i.eviction-${i}`)).toBeNull();
    expect(document.querySelector("i.retained")).toBe(retained);
    expect(invalid.map(errorFor)).toEqual(before);
    expect(invalid.map(errorFor)).toEqual(before);
  });
});

describe.skipIf(!isNativeAvailable())("empty replaceChildren", () => {
  for (const kind of ["element", "fragment", "shadow"]) {
    test(`${kind} clearing preserves removed identities, live collections and observer records`, async () => {
      const window = windowForTest();
      const { document } = window;
      const element = document.createElement("div");
      document.body.appendChild(element);
      const parent = kind === "fragment" ? document.createDocumentFragment() :
        kind === "shadow" ? element.attachShadow({ mode: "open" }) : element;
      const first = document.createElement("i");
      const nested = document.createElement("b");
      first.appendChild(nested);
      const text = document.createTextNode("kept");
      const last = document.createElement("em");
      parent.appendChild(first);
      parent.appendChild(text);
      parent.appendChild(last);
      const children = parent.childNodes;
      const elements = parent.children;
      const snapshot = parent.querySelectorAll("i, em");
      expect(Array.from(children)).toEqual([first, text, last]);
      expect(Array.from(elements)).toEqual([first, last]);
      const deliveries = [];
      const observer = new window.MutationObserver((records) => deliveries.push(records));
      observer.observe(parent, { childList: true });

      expect(parent.replaceChildren()).toBeUndefined();
      expect(deliveries).toHaveLength(0);
      expect(children.length).toBe(0);
      expect(elements.length).toBe(0);
      expect(parent.firstChild).toBeNull();
      expect(parent.lastChild).toBeNull();
      expect(parent.querySelector("i")).toBeNull();
      expect(Array.from(snapshot)).toEqual([first, last]);
      expect(first.firstChild).toBe(nested);
      expect(nested.parentNode).toBe(first);
      expect(text.data).toBe("kept");
      for (const node of [first, text, last]) {
        expect(node.parentNode).toBeNull();
        expect(node.previousSibling).toBeNull();
        expect(node.nextSibling).toBeNull();
      }
      await Promise.resolve();
      expect(deliveries).toHaveLength(1);
      const records = deliveries[0];
      expect(records.flatMap((record) => Array.from(record.removedNodes))).toEqual([first, text, last]);
      expect(records.every((record) => record.target === parent && record.type === "childList" && record.addedNodes.length === 0)).toBe(true);
      expect(records.map((record) => record.previousSibling)).toEqual([null, null, null]);
      expect(records.map((record) => record.nextSibling)).toEqual([text, last, null]);

      parent.replaceChildren();
      await Promise.resolve();
      expect(deliveries).toHaveLength(1);
      parent.appendChild(first);
      expect(children[0]).toBe(first);
      expect(elements[0]).toBe(first);
      expect(parent.querySelector("b")).toBe(nested);
      observer.disconnect();
    });
  }

  test("disconnection is synchronous, follows complete removal and permits reentrant appends", async () => {
    const window = windowForTest();
    const { document } = window;
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const sentinel = document.createElement("span");
    const order = [];
    class Item extends window.HTMLElement {
      disconnectedCallback() {
        order.push(`${this.id}:${parent.childNodes.length}:${this.isConnected}`);
        if (this.id === "first") parent.appendChild(sentinel);
      }
    }
    window.customElements.define("clear-item", Item);
    const first = document.createElement("clear-item");
    first.id = "first";
    const nested = document.createElement("clear-item");
    nested.id = "nested";
    first.appendChild(nested);
    const second = document.createElement("clear-item");
    second.id = "second";
    parent.appendChild(first);
    parent.appendChild(second);
    const observer = new window.MutationObserver(() => order.push("observer"));
    observer.observe(parent, { childList: true });

    parent.replaceChildren();
    order.push("returned");
    expect(order).toEqual(["first:0:false", "nested:1:false", "second:1:false", "returned"]);
    expect(parent.firstChild).toBe(sentinel);
    expect(parent.lastChild).toBe(sentinel);
    expect(first.firstChild).toBe(nested);
    expect(second.parentNode).toBeNull();
    await Promise.resolve();
    expect(order.at(-1)).toBe("observer");
    observer.disconnect();
  });
});
