import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Window, isNativeAvailable } from "../../index.js";
import { install as installNode } from "../../js/facade/extensions/node.js";
import { hasMaterializedNodeHandle, nodeDocumentStateOf, nodeHandleOf } from "../../js/facade/extensions/classes.js";

const windows = [];
function freshWindow() {
  const window = new Window();
  windows.push(window);
  return window;
}
afterEach(() => {
  for (const window of windows.splice(0)) window.destroy();
});

describe.skipIf(!isNativeAvailable())("scoped query token snapshots", () => {
  test("reading query results preserves lazy handles and canonical wrapper identity", () => {
    const { document } = freshWindow();
    const scope = document.body;
    scope.innerHTML = '<span>One</span><p>Two</p><button>Three</button>';
    const result = scope.querySelectorAll("span, p, button");
    expect(result.length).toBe(3);
    expect(result.item(3)).toBeNull();
    expect(result[3]).toBeUndefined();
    expect(Array.from(result, element => element.localName)).toEqual(["span", "p", "button"]);
    for (const element of result) expect(hasMaterializedNodeHandle(element)).toBe(false);
    const repeat = scope.querySelectorAll("span, p, button");
    expect(repeat).not.toBe(result);
    for (let i = 0; i < result.length; i++) {
      expect(repeat[i]).toBe(result[i]);
      expect(hasMaterializedNodeHandle(repeat[i])).toBe(false);
    }
    expect(document.querySelector("p")).toBe(result[1]);
    expect(hasMaterializedNodeHandle(result[0])).toBe(false);
    expect(hasMaterializedNodeHandle(result[2])).toBe(false);
  });

  test("scoped queries converge with both existing native and lazy wrappers", () => {
    const { document } = freshWindow();
    document.body.innerHTML = '<span id="seen">Existing</span><span>Parsed</span>';
    const seen = document.querySelector("#seen");
    const created = document.createElement("span");
    document.body.append(created);
    const results = document.body.querySelectorAll("span");
    expect(results[0]).toBe(seen);
    expect(results[2]).toBe(created);
    expect(document.body.firstChild).toBe(seen);
    expect(seen.nextSibling).toBe(results[1]);
    expect(document.querySelectorAll("span")[1]).toBe(results[1]);
    const other = freshWindow();
    other.document.body.innerHTML = "<span>Other document</span>";
    const otherSpan = other.document.body.querySelectorAll("span")[0];
    expect(otherSpan).not.toBe(results[0]);
    expect(otherSpan.ownerDocument).toBe(other.document);
  });

  test("retained results keep their membership while nodes and later queries update", () => {
    const { document } = freshWindow();
    const scope = document.body;
    scope.innerHTML = '<span class="selected">One</span><span class="selected">Two</span>';
    const original = scope.querySelectorAll(".selected");
    original[0].removeAttribute("class");
    original[1].remove();
    expect(scope.querySelectorAll(".selected").length).toBe(0);
    expect(original.length).toBe(2);
    expect(original[0].textContent).toBe("One");
    expect(original[1].textContent).toBe("Two");
    expect(original[1].isConnected).toBe(false);
    scope.innerHTML = '<span class="selected">Replacement</span>';
    const replacement = scope.querySelectorAll(".selected")[0];
    expect(replacement).not.toBe(original[0]);
    expect(replacement.textContent).toBe("Replacement");
    expect(original[0].textContent).toBe("One");
  });

  test("fragments and shadow roots stay scoped and preserve document order", () => {
    const { document } = freshWindow();
    document.body.innerHTML = '<span>Outside</span><div></div>';
    const fragment = document.createDocumentFragment();
    const first = document.createElement("span");
    const second = document.createElement("span");
    fragment.append(first, second);
    const original = fragment.querySelectorAll("span");
    expect(Array.from(original)).toEqual([first, second]);
    const shadow = document.querySelector("div").attachShadow({ mode: "open" });
    shadow.append(fragment);
    expect(fragment.querySelectorAll("span").length).toBe(0);
    expect(Array.from(shadow.querySelectorAll("span"))).toEqual([first, second]);
    expect(document.body.querySelectorAll("span").length).toBe(1);
    expect(Array.from(original)).toEqual([first, second]);
  });

  test("uncommon, foreign, and custom element results retain their exact prototypes", () => {
    const window = freshWindow();
    const { document } = window;
    class Widget extends window.HTMLElement {}
    window.customElements.define("query-widget", Widget);
    document.body.innerHTML = '<main><svg><rect></rect></svg><meter></meter><query-unknown></query-unknown><query-widget></query-widget></main>';
    const scope = document.querySelector("main");
    const results = scope.querySelectorAll("*|*");
    expect(results.length).toBe(5);
    expect(results[0]).toBeInstanceOf(window.SVGSVGElement);
    expect(results[1]).toBeInstanceOf(window.SVGRectElement);
    expect(results[0].namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(results[1].namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(Object.getPrototypeOf(results[2])).toBe(Object.getPrototypeOf(document.createElement("meter")));
    expect(Object.getPrototypeOf(results[3])).toBe(window.HTMLElement.prototype);
    expect(results[4]).toBeInstanceOf(Widget);
    const ordinary = Array.from(document.querySelectorAll("*|*"));
    for (const element of results) expect(ordinary.includes(element)).toBe(true);
  });

  test("recording-only extension installs preserve custom constructor registration", () => {
    installNode({
      defineMethod() {},
      defineAccessor() {},
      registerHandleType() {},
      documentContext: { handleOf() { return null; } },
    });
    const window = freshWindow();
    class Widget extends window.HTMLElement {}
    window.customElements.define("query-after-install", Widget);
    const constructed = new Widget();
    window.document.body.append(constructed);
    expect(window.document.body.querySelectorAll("query-after-install")[0]).toBe(constructed);
    window.document.body.innerHTML = "<query-after-install></query-after-install>";
    const parsed = window.document.body.querySelectorAll("query-after-install")[0];
    expect(parsed).toBeInstanceOf(Widget);
    expect(window.document.querySelector("query-after-install")).toBe(parsed);
  });

  test("invalid selectors and destroyed scopes retain errors", () => {
    const window = freshWindow();
    const scope = window.document.body;
    expect(() => scope.querySelectorAll("[")).toThrow();
    expect(scope.querySelectorAll("missing-element").length).toBe(0);
    window.destroy();
    expect(() => scope.querySelectorAll("*")).toThrow();
  });

  test("repeated pseudo-class queries reflect CharacterData changes without structural mutations", () => {
    const { document } = freshWindow();
    const scope = document.createElement("section");
    const paragraph = document.createElement("p");
    const text = document.createTextNode("");
    paragraph.appendChild(text);
    scope.appendChild(paragraph);
    document.body.appendChild(scope);
    for (const parent of [document, scope]) {
      expect(Array.from(parent.querySelectorAll("p:empty"))).toEqual([paragraph]);
      expect(Array.from(parent.querySelectorAll("p:empty"))).toEqual([paragraph]);
    }
    text.data = "content";
    for (const parent of [document, scope]) expect(parent.querySelectorAll("p:empty").length).toBe(0);
    text.data = "";
    for (const parent of [document, scope]) expect(parent.querySelectorAll("p:empty")[0]).toBe(paragraph);
  });

  test("query cache classification is independent of replacement String methods", () => {
    const { document } = freshWindow();
    const paragraph = document.createElement("p");
    const text = document.createTextNode("");
    paragraph.appendChild(text);
    document.body.appendChild(paragraph);
    const includes = String.prototype.includes;
    let initial;
    let after;
    try {
      String.prototype.includes = () => false;
      initial = document.querySelectorAll("p:empty").length;
      text.data = "changed";
      after = document.querySelectorAll("p:empty").length;
    } finally {
      String.prototype.includes = includes;
    }
    expect(initial).toBe(1);
    expect(after).toBe(0);
  });

  test("raw native attribute and structural writes invalidate every affected cached scope", () => {
    const { document } = freshWindow();
    document.body.innerHTML = '<section><i class="chosen">One</i><i>Two</i></section>';
    const scope = document.body.firstChild;
    const first = scope.firstChild;
    const second = first.nextSibling;
    const selector = "i.chosen";
    const nativeDocument = nodeDocumentStateOf(scope).documentHandle;
    const scopes = [document, document.body, scope];
    const snapshots = scopes.map(parent => parent.querySelectorAll(selector));
    for (const parent of scopes) expect(parent.querySelectorAll(selector)[0]).toBe(first);

    nodeHandleOf(first).removeAttribute("class");
    nodeHandleOf(second).setAttribute("class", "chosen");
    for (const parent of scopes) expect(Array.from(parent.querySelectorAll(selector))).toEqual([second]);
    nodeHandleOf(first).setAttribute("class", "chosen");
    nativeDocument.appendChild(nodeHandleOf(scope), nodeHandleOf(first));
    for (const parent of scopes) expect(Array.from(parent.querySelectorAll(selector))).toEqual([second, first]);
    nativeDocument.removeChild(nodeHandleOf(scope), nodeHandleOf(second));
    for (const parent of scopes) expect(Array.from(parent.querySelectorAll(selector))).toEqual([first]);
    for (const snapshot of snapshots) expect(Array.from(snapshot)).toEqual([first]);
  });

  test("a mutation during result wrapping cannot save an old snapshot under a new generation", () => {
    const { document } = freshWindow();
    document.body.innerHTML = "<i></i>";
    const appended = document.createElement("i");
    const map = Array.prototype.map;
    let mutated = false;
    let first;
    try {
      Array.prototype.map = function (callback, thisArg) {
        const result = map.call(this, callback, thisArg);
        if (!mutated && this.length === 1 && this[0]?.constructor?.name === "NodeHandle") {
          mutated = true;
          document.body.appendChild(appended);
        }
        return result;
      };
      first = document.querySelectorAll("i");
    } finally {
      Array.prototype.map = map;
    }
    expect(mutated).toBe(true);
    expect(first.length).toBe(1);
    expect(document.querySelectorAll("i").length).toBe(2);
  });

  test("cached empty and nonempty results never suppress syntax or destroyed-window errors", () => {
    const window = freshWindow();
    const { document } = window;
    document.body.innerHTML = "<section><i></i></section>";
    const scope = document.body.firstChild;
    const scopes = [document, scope];
    for (const parent of scopes) {
      expect(parent.querySelectorAll("i").length).toBe(1);
      expect(parent.querySelectorAll("absent").length).toBe(0);
      for (let i = 0; i < 40; i++) parent.querySelectorAll(`i[eviction-${i}]`);
      for (let repeat = 0; repeat < 2; repeat++) {
        expect(parent.querySelectorAll("i").length).toBe(1);
        expect(parent.querySelectorAll("absent").length).toBe(0);
        expect(() => parent.querySelectorAll("i[=]")).toThrow();
      }
    }
    window.destroy();
    for (const parent of scopes) {
      for (const selector of ["i", "absent", "i[=]"]) {
        expect(() => parent.querySelectorAll(selector)).toThrow();
      }
    }
  });

  test("adoption invalidates cached scope results and cached typed matches", () => {
    const source = freshWindow();
    const target = freshWindow();
    const scope = source.document.createElement("section");
    const child = source.document.createElement("i");
    scope.appendChild(child);
    const children = scope.childNodes;
    for (let i = 0; i < 2; i++) {
      expect(scope.querySelectorAll("i")[0]).toBe(child);
      expect(scope.matches("section")).toBe(true);
      expect(scope.matches("div")).toBe(false);
    }
    const adopted = target.document.adoptNode(scope);
    expect(adopted.querySelectorAll("i").length).toBe(1);
    expect(adopted.matches("section")).toBe(true);
    expect(() => scope.querySelectorAll("i")).toThrow();
    expect(() => scope.matches("section")).toThrow();
    expect(() => scope.matches("div")).toThrow();
    expect(() => scope.textContent).toThrow();
    expect(() => children.length).toThrow();
    expect(() => Array.from(children)).toThrow();
  });

  test.each(["without-query-tokens", "without-materialization"])("optional native capability fallback: %s", scenario => {
    const fixture = fileURLToPath(new URL("./fixtures/query-token-legacy-probe.mjs", import.meta.url));
    const result = Bun.spawnSync([process.execPath, fixture, scenario], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    expect(result.stdout.toString().trim()).toBe("PASS");
  });
});
