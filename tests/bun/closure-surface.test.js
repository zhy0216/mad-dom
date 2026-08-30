import { describe, expect, test } from "bun:test";
import { Window, isNativeAvailable } from "../../index.js";
import { createWindow } from "../../js/facade/window.js";

// T48 compatibility-closure surface tests.
//
// These pin the happy-dom-aligned surface additions that close the ledger's
// remaining facade/type gaps:
//
//   - Element.nodeName / tagName report the uppercased WHATWG tag name for HTML
//     namespace elements while localName stays the lowercased local tag name;
//     non-element nodes read nodeName verbatim and localName/tagName undefined;
//   - Document.readyState reads "interactive" and Document.title reflects the
//     first <title> element under head (create/update);
//   - window.happyDOM.waitUntilComplete() resolves after the microtask
//     checkpoint;
//   - Window is user-constructible like happy-dom (`new Window()` / options).
const nativeAvailable = isNativeAvailable();

describe.skipIf(!nativeAvailable)("T48 element name casing", () => {
  test("HTML element nodeName/tagName are uppercased, localName stays lowercased", () => {
    const window = new Window();
    const div = window.document.createElement("div");
    expect(div.nodeName).toBe("DIV");
    expect(div.tagName).toBe("DIV");
    expect(div.localName).toBe("div");

    const section = window.document.createElement("section");
    expect(section.nodeName).toBe("SECTION");
    expect(section.tagName).toBe("SECTION");
    expect(section.localName).toBe("section");
    window.destroy();
  });

  test("non-element nodes report the verbatim nodeName and undefined localName/tagName", () => {
    const window = new Window();
    const document = window.document;
    const text = document.createTextNode("hi");
    expect(text.nodeName).toBe("#text");
    expect(text.localName).toBeUndefined();
    expect(text.tagName).toBeUndefined();

    const fragment = document.createDocumentFragment();
    expect(fragment.nodeName).toBe("#document-fragment");
    expect(fragment.localName).toBeUndefined();
    window.destroy();
  });

  test("serialization keeps the lowercased tag name", () => {
    const window = new Window();
    const div = window.document.createElement("div");
    div.setAttribute("class", "x");
    expect(div.outerHTML).toBe('<div class="x"></div>');
    window.destroy();
  });
});

describe.skipIf(!nativeAvailable)("T48 document structure closure", () => {
  test("document.readyState reads interactive", () => {
    const window = new Window();
    expect(window.document.readyState).toBe("interactive");
    window.destroy();
  });

  test("document.title reflects the first title element", () => {
    const window = new Window();
    const document = window.document;
    expect(document.title).toBe("");

    document.title = "My Title";
    expect(document.title).toBe("My Title");
    const titleElement = document.querySelector("title");
    expect(titleElement).not.toBeNull();
    expect(titleElement.textContent).toBe("My Title");

    titleElement.textContent = "Changed";
    expect(document.title).toBe("Changed");
    window.destroy();
  });
});

describe.skipIf(!nativeAvailable)("T48A element class hierarchy", () => {
  test("createElement selects the per-tag direct prototype matching happy-dom", () => {
    const window = new Window();
    try {
      const document = window.document;
      const div = document.createElement("div");
      // The direct prototype is the per-tag class, and the chain runs
      // per-tag → HTMLElement → Element → Node exactly like happy-dom.
      expect(Object.getPrototypeOf(div)).toBe(window.HTMLDivElement.prototype);
      expect(Object.getPrototypeOf(window.HTMLDivElement.prototype)).toBe(window.HTMLElement.prototype);
      expect(Object.getPrototypeOf(window.HTMLElement.prototype)).toBe(window.Element.prototype);
      expect(Object.getPrototypeOf(window.Element.prototype)).toBe(window.Node.prototype);
      expect(div instanceof window.HTMLDivElement).toBe(true);
      expect(div instanceof window.HTMLElement).toBe(true);

      expect(document.createElement("span")).toBeInstanceOf(window.HTMLSpanElement);
      expect(document.createElement("p")).toBeInstanceOf(window.HTMLParagraphElement);
      expect(document.createElement("input")).toBeInstanceOf(window.HTMLInputElement);
      expect(document.createElement("button")).toBeInstanceOf(window.HTMLButtonElement);
      expect(document.createElement("template")).toBeInstanceOf(window.HTMLTemplateElement);
      expect(document.createElement("form")).toBeInstanceOf(window.HTMLFormElement);

      // Unknown names follow the happy-dom rule: a hyphenated undefined name is
      // a bare HTMLElement, a plain undefined name is an HTMLUnknownElement.
      expect(document.createElement("my-widget")).toBeInstanceOf(window.HTMLElement);
      expect(document.createElement("my-widget")).not.toBeInstanceOf(window.HTMLUnknownElement);
      expect(document.createElement("foobar")).toBeInstanceOf(window.HTMLUnknownElement);
      window.destroy();
    } catch (error) {
      window.destroy();
      throw error;
    }
  });

  test("the element members are inherited, so the direct prototype owns none of them", () => {
    const window = new Window();
    try {
      const div = window.document.createElement("div");
      const proto = Object.getPrototypeOf(div);
      // present: false on the direct prototype, matching happy-dom.
      expect(Object.getOwnPropertyDescriptor(proto, "getAttribute")).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(proto, "setAttribute")).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(proto, "textContent")).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(proto, "innerHTML")).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(proto, "querySelector")).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(proto, "tagName")).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(proto, "localName")).toBeUndefined();
      expect(Object.keys(proto)).toEqual([]);
      window.destroy();
    } catch (error) {
      window.destroy();
      throw error;
    }
  });

  test("Text/Comment hold no element members (happy-dom parity)", () => {
    const window = new Window();
    try {
      const document = window.document;
      const text = document.createTextNode("hi");
      const comment = document.createComment("c");
      for (const node of [text, comment]) {
        expect(node.localName).toBeUndefined();
        expect(node.tagName).toBeUndefined();
        expect(node.innerHTML).toBeUndefined();
        expect(node.getAttribute).toBeUndefined();
        expect(node.querySelector).toBeUndefined();
        // textContent stays on Node (all nodes have it).
        expect(node.textContent).toBeTypeOf("string");
        expect(() => node.getAttribute("x")).toThrow(TypeError);
        expect(() => node.getAttribute("x")).toThrow("is not a function");
      }
      window.destroy();
    } catch (error) {
      window.destroy();
      throw error;
    }
  });

  test("new DefinedClass() casts a real detached element whose localName reads the registered name", () => {
    const window = new Window();
    try {
      class Direct extends window.HTMLElement {}
      window.customElements.define("direct-el", Direct);
      const direct = new Direct();
      expect(direct.localName).toBe("direct-el");
      expect(direct.tagName).toBe("DIRECT-EL");
      expect(Object.getPrototypeOf(direct)).toBe(Direct.prototype);
      expect(direct instanceof Direct).toBe(true);
      expect(direct instanceof window.HTMLElement).toBe(true);
      // A real detached element: attributes work and it is not connected.
      direct.setAttribute("a", "b");
      expect(direct.getAttribute("a")).toBe("b");
      expect(direct.isConnected).toBe(false);
      expect(direct.parentNode).toBeNull();

      // The minted wrapper keeps identity when re-wrapped (append re-entry).
      const holder = window.document.createElement("div");
      holder.appendChild(direct);
      expect(direct.parentNode).toBe(holder);

      // An undefined class is an illegal constructor, like happy-dom.
      expect(() => new window.HTMLDivElement()).toThrow(TypeError);
      window.destroy();
    } catch (error) {
      window.destroy();
      throw error;
    }
  });

  test("DocumentFragment and shadow roots reach the ParentNode query and innerHTML surface", () => {
    const window = new Window();
    try {
      const document = window.document;
      const frag = document.createDocumentFragment();
      expect(Object.getPrototypeOf(frag)).toBe(window.DocumentFragment.prototype);
      frag.innerHTML = "<i>a</i><b>b</b>";
      expect(frag.childNodes).toHaveLength(2);
      expect(frag.querySelector("i")).not.toBeNull();

      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = "<span>x</span>";
      expect(root.querySelector("span")).not.toBeNull();
      expect(root.querySelector("span").textContent).toBe("x");
      window.destroy();
    } catch (error) {
      window.destroy();
      throw error;
    }
  });
});

describe.skipIf(!nativeAvailable)("T48 window.happyDOM", () => {
  test("happyDOM.waitUntilComplete resolves after microtasks", async () => {
    const window = new Window();
    expect(typeof window.happyDOM).toBe("object");
    const order = [];
    order.push("sync");
    const promise = window.happyDOM.waitUntilComplete();
    expect(promise).toBeInstanceOf(Promise);
    queueMicrotask(() => order.push("microtask"));
    await promise;
    order.push("after");
    expect(order).toEqual(["sync", "microtask", "after"]);
    window.destroy();
  });
});

describe.skipIf(!nativeAvailable)("T48 Window constructibility", () => {
  test("new Window() mints a working window and new Window(options) honors url", () => {
    const win = new Window();
    expect(win.document.body).toBeInstanceOf(Object);
    win.destroy();

    const configured = new Window({ url: "https://mad-dom.test/path" });
    expect(configured.location.href).toBe("https://mad-dom.test/path");
    configured.destroy();
  });

  test("the facade createWindow compat alias hands back the same window surface", () => {
    // T48E: createWindow is retired from the package entry (matching happy-dom);
    // the facade module keeps it as an internal compat alias with the same
    // surface as `new Window()`.
    const win = createWindow();
    expect(win).toBeInstanceOf(Window);
    win.destroy();
  });
});
