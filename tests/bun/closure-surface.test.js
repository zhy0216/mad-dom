import { describe, expect, test } from "bun:test";
import { createWindow, Window, isNativeAvailable } from "../../index.js";

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

  test("createWindow still hands back the same window surface", () => {
    const win = createWindow();
    expect(win).toBeInstanceOf(Window);
    win.destroy();
  });
});
