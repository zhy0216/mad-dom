import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "../../index.js";

const windows = [];
function createWindow() {
  const window = new Window({ url: "https://mad-dom.test/" });
  windows.push(window);
  return window;
}

afterEach(() => {
  for (const window of windows.splice(0)) window.destroy();
});

describe("HTML element constructor selection", () => {
  test("Window exposes the actual iframe class for created, parsed, cloned and imported nodes", () => {
    const window = createWindow();
    const other = createWindow();
    const { document } = window;
    const constructor = window.HTMLIFrameElement;
    expect(typeof constructor).toBe("function");
    expect(constructor.name).toBe("HTMLIFrameElement");
    expect(document.defaultView.HTMLIFrameElement).toBe(constructor);

    const container = document.createElement("div");
    container.innerHTML = '<iframe src="/embedded" name="preview"></iframe>';
    const parsed = container.firstElementChild;
    for (const iframe of [
      document.createElement("iframe"),
      document.createElement("IFRAME"),
      document.createElementNS("http://www.w3.org/1999/xhtml", "iframe"),
      parsed,
      parsed.cloneNode(true),
      document.importNode(other.document.createElement("iframe"), true),
    ]) {
      expect(iframe.constructor).toBe(constructor);
      expect(Object.getPrototypeOf(iframe)).toBe(constructor.prototype);
      expect(iframe).toBeInstanceOf(constructor);
      expect(iframe).toBeInstanceOf(window.HTMLElement);
      expect(iframe).not.toBeInstanceOf(window.HTMLUnknownElement);
      expect(Object.prototype.toString.call(iframe)).toBe("[object HTMLIFrameElement]");
    }
    expect(parsed.src).toBe("https://mad-dom.test/embedded");
    parsed.name = "updated";
    expect(parsed.getAttribute("name")).toBe("updated");
    parsed.sandbox.add("allow-scripts");
    expect(parsed.getAttribute("sandbox")).toBe("allow-scripts");
    expect(document.createElement("div")).not.toBeInstanceOf(constructor);
    expect(document.activeElement).not.toBeInstanceOf(constructor);
  });

  // Standard elements whose DOM interface is HTMLElement itself.
  test.each([
    "abbr", "address", "article", "aside", "b", "bdi", "bdo", "cite", "code",
    "dd", "dfn", "dt", "em", "figcaption", "figure", "footer", "header",
    "hgroup", "i", "kbd", "main", "mark", "nav", "noscript", "rp", "rt",
    "ruby", "s", "samp", "search", "section", "small", "strong", "sub",
    "summary", "sup", "u", "var", "wbr",
  ])("%s uses HTMLElement across creation, parsing, cloning and import", (tag) => {
    const window = createWindow();
    const other = createWindow();
    const { document } = window;
    const container = document.createElement("div");
    container.innerHTML = tag === "wbr" ? "<wbr>" : `<${tag}></${tag}>`;
    const parsed = container.firstElementChild;
    for (const element of [
      document.createElement(tag),
      document.createElement(tag.toUpperCase()),
      document.createElementNS("http://www.w3.org/1999/xhtml", tag),
      parsed,
      parsed.cloneNode(true),
      document.importNode(other.document.createElement(tag), true),
    ]) {
      expect(element.localName).toBe(tag);
      expect(element.constructor).toBe(window.HTMLElement);
      expect(Object.getPrototypeOf(element)).toBe(window.HTMLElement.prototype);
      expect(element).not.toBeInstanceOf(window.HTMLUnknownElement);
      expect(Object.prototype.toString.call(element)).toBe("[object HTMLElement]");
    }
  });

  test("unknown names, custom elements and non-HTML namespaces keep their classes", () => {
    const window = createWindow();
    const { document } = window;
    expect(document.createElement("madeuptag").constructor).toBe(window.HTMLUnknownElement);
    expect(document.createElement("my-widget").constructor).toBe(window.HTMLElement);
    expect(document.createElement("div").constructor).toBe(window.HTMLDivElement);
    for (const tag of ["nav", "iframe"]) {
      expect(document.createElementNS(null, tag).constructor).toBe(window.Element);
      expect(document.createElementNS("http://www.w3.org/2000/svg", tag).constructor).toBe(window.SVGElement);
    }
  });
});
