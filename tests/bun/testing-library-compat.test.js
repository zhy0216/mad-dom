import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, within } from "@testing-library/dom";
import { Window } from "../../index.js";
import { Document } from "../../js/facade/document.js";
import { loadNative } from "../../js/native-loader.js";
import { nodeHandleOf } from "../../js/facade/extensions/classes.js";

const windows = [];
function freshWindow() {
  const window = new Window();
  windows.push(window);
  return window;
}

afterEach(() => {
  for (const window of windows.splice(0)) window.destroy();
});

describe("Testing Library DOM compatibility", () => {
  test("node type constants are available on the constructor and node instances", () => {
    const window = freshWindow();
    const text = window.document.createTextNode("Projects");
    expect(window.Node.ELEMENT_NODE).toBe(1);
    expect(window.document.DOCUMENT_NODE).toBe(9);
    expect(window.document.body.ELEMENT_NODE).toBe(window.document.body.nodeType);
    expect(text.TEXT_NODE).toBe(text.nodeType);
  });

  test("getAttributeNode exposes the existing live attribute with HTML name normalization", () => {
    const { document } = freshWindow();
    const button = document.createElement("button");
    expect(button.getAttributeNode("aria-label")).toBeNull();
    button.setAttribute("aria-label", "Open");
    const attribute = button.getAttributeNode("ARIA-LABEL");
    expect(attribute).toBe(button.attributes.getNamedItem("aria-label"));
    attribute.value = "Close";
    expect(button.getAttribute("aria-label")).toBe("Close");
    button.removeAttribute("aria-label");
    expect(button.getAttributeNode("aria-label")).toBeNull();
  });

  test("defaultView identifies the owning window and is null for standalone documents", () => {
    const first = freshWindow();
    const second = freshWindow();
    expect(first.document.defaultView).toBe(first);
    expect(second.document.defaultView).toBe(second);
    expect(first.document.createElement("input").ownerDocument.defaultView).toBe(first);
    const detached = new Document(loadNative().createDocument());
    try {
      expect(detached.defaultView).toBeNull();
    } finally {
      detached.destroy();
    }
  });

  test("role queries retain the default visibility filter and event constructors", () => {
    const window = freshWindow();
    window.document.body.innerHTML = '<h1>Projects</h1><button>Open</button><button hidden>Hidden</button>';
    const query = within(window.document.body);
    expect(query.getByRole("heading", { name: "Projects", level: 1 }).textContent).toBe("Projects");
    expect(query.getAllByRole("button")).toHaveLength(1);
    const button = query.getByRole("button", { name: "Open" });
    let clicks = 0;
    button.addEventListener("click", event => {
      expect(event).toBeInstanceOf(window.MouseEvent);
      clicks++;
    }, { once: true });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(clicks).toBe(1);
  });

  test("label queries and input events use each control's native value setter", () => {
    const window = freshWindow();
    window.document.body.innerHTML = '<label for="search">Search projects</label><input id="search">' +
      '<label>Notes<textarea></textarea></label><label>Priority<select><option>Low</option><option>High</option></select></label>';
    const query = within(window.document.body);
    for (const [name, value] of [["Search projects", "New project"], ["Notes", "Details"], ["Priority", "High"]]) {
      const control = query.getByLabelText(name);
      const nativeValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value");
      expect(typeof nativeValue.set).toBe("function");
      let trackedWrites = 0;
      let inputs = 0;
      Object.defineProperty(control, "value", {
        get() { return nativeValue.get.call(this); },
        set() { trackedWrites++; },
      });
      control.addEventListener("input", () => inputs++);
      fireEvent.input(control, { target: { value } });
      expect(query.getByDisplayValue(value)).toBe(control);
      expect(inputs).toBe(1);
      expect(trackedWrites).toBe(0);
    }
  });
});

describe("label control association", () => {
  test("all labelable controls expose stable live NodeLists", () => {
    const window = freshWindow();
    for (const tag of ["input", "button", "select", "textarea", "meter", "progress", "output"]) {
      const control = window.document.createElement(tag);
      const labels = control.labels;
      expect(labels).toBeInstanceOf(window.NodeList);
      expect(Object.prototype.toString.call(labels)).toBe("[object NodeList]");
      expect(control.labels).toBe(labels);
      expect(labels.length).toBe(0);
      const label = window.document.createElement("label");
      label.append(control);
      expect(labels.length).toBe(1);
      expect(labels.item(0)).toBe(label);
      expect(labels[0]).toBe(label);
      expect(labels.item(1)).toBeNull();
      expect(labels[1]).toBeUndefined();
      expect(Array.prototype.slice.call(labels)).toEqual([label]);
      expect(Array.from(labels.entries())).toEqual([[0, label]]);
      expect(Object.keys(labels)).toEqual(["0"]);
      label.removeChild(control);
      expect(labels.length).toBe(0);
    }
  });

  test("labels remain in tree order and do not duplicate explicit ancestor associations", () => {
    const { document } = freshWindow();
    document.body.innerHTML = '<label for="field">First<input id="field"></label><label for="field">Second</label>';
    const input = document.querySelector("input");
    const labels = input.labels;
    const first = document.querySelector("label");
    const second = first.nextElementSibling;
    expect(Array.from(labels)).toEqual([first, second]);
    document.body.insertBefore(second, first);
    expect(Array.from(labels)).toEqual([second, first]);
    second.htmlFor = "missing";
    expect(Array.from(labels)).toEqual([first]);
    input.type = "hidden";
    expect(input.labels).toBeNull();
    expect(labels.length).toBe(0);
    input.type = "text";
    expect(input.labels).toBe(labels);
    expect(Array.from(labels)).toEqual([first]);
  });

  test("implicit labels follow the first eligible descendant after type and tree changes", () => {
    const { document } = freshWindow();
    document.body.innerHTML = '<label><input><textarea></textarea></label>';
    const label = document.querySelector("label");
    const input = document.querySelector("input");
    const textarea = document.querySelector("textarea");
    const inputLabels = input.labels;
    const textareaLabels = textarea.labels;
    expect(Array.from(inputLabels)).toEqual([label]);
    expect(textareaLabels.length).toBe(0);
    input.type = "hidden";
    expect(inputLabels.length).toBe(0);
    expect(Array.from(textareaLabels)).toEqual([label]);
    input.type = "text";
    label.insertBefore(textarea, input);
    expect(inputLabels.length).toBe(0);
    expect(Array.from(textareaLabels)).toEqual([label]);
  });

  test("cached associations observe native mutations and literal IDs", () => {
    const { document } = freshWindow();
    document.body.innerHTML = '<label>Caption</label><input><input>';
    const label = document.querySelector("label");
    const [first, second] = document.querySelectorAll("input");
    first.id = 'field["name"]';
    second.id = "second";
    label.htmlFor = first.id;
    const firstLabels = first.labels;
    const secondLabels = second.labels;
    expect(Array.from(firstLabels)).toEqual([label]);
    expect(secondLabels.length).toBe(0);
    nodeHandleOf(label).setAttribute("for", "second");
    expect(firstLabels.length).toBe(0);
    expect(Array.from(secondLabels)).toEqual([label]);
    const duplicate = document.createElement("div");
    duplicate.id = "second";
    const parentHandle = nodeHandleOf(document.body);
    loadNative().DocumentHandle.prototype.insertBefore.call(parentHandle, parentHandle, nodeHandleOf(duplicate), nodeHandleOf(second));
    expect(secondLabels.length).toBe(0);
    duplicate.remove();
    expect(Array.from(secondLabels)).toEqual([label]);
  });

  test("retained labels follow controls across shadow and detached roots", () => {
    const window = freshWindow();
    const { document } = window;
    document.body.innerHTML = '<label for="field">Outside</label><input id="field"><div></div>';
    const input = document.querySelector("input");
    const labels = input.labels;
    const outside = document.querySelector("label");
    expect(Array.from(labels)).toEqual([outside]);
    const shadow = document.querySelector("div").attachShadow({ mode: "open" });
    const inside = document.createElement("label");
    inside.htmlFor = "field";
    shadow.append(inside, input);
    expect(Array.from(labels)).toEqual([inside]);
    const fragment = document.createDocumentFragment();
    fragment.append(input);
    expect(labels.length).toBe(0);
    fragment.append(inside);
    expect(Array.from(labels)).toEqual([inside]);
    window.destroy();
    expect(() => labels.length).toThrow();
  });

  test("explicit IDs resolve literally, update after mutation, and reject non-labelable matches", () => {
    const { document } = freshWindow();
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.id = 'field["name"]';
    label.htmlFor = input.id;
    document.body.append(label, input);
    expect(label.getAttribute("for")).toBe(input.id);
    expect(label.control).toBe(input);
    input.type = "hidden";
    expect(label.control).toBeNull();
    input.setAttribute("type", "HIDDEN");
    expect(label.control).toBeNull();
    input.type = "text";
    const duplicate = document.createElement("div");
    duplicate.id = input.id;
    document.body.insertBefore(duplicate, input);
    expect(label.control).toBeNull();
    duplicate.remove();
    expect(label.control).toBe(input);
    input.id = "renamed";
    expect(label.control).toBeNull();
  });

  test("implicit labels select the first labelable descendant and explicit for never falls back", () => {
    const { document } = freshWindow();
    document.body.innerHTML = '<form><label><input type="hidden"><span><textarea></textarea></span><input></label></form>';
    const label = document.querySelector("label");
    expect(label.control).toBe(document.querySelector("textarea"));
    expect(label.form).toBe(document.querySelector("form"));
    label.htmlFor = "missing";
    expect(label.control).toBeNull();
    expect(label.form).toBeNull();
    label.htmlFor = "";
    expect(label.control).toBeNull();
  });

  test("label associations stay in detached and shadow trees", () => {
    const { document } = freshWindow();
    document.body.innerHTML = '<input id="field"><div></div>';
    const detached = document.createDocumentFragment();
    const label = document.createElement("label");
    label.htmlFor = "field";
    detached.append(label);
    expect(label.control).toBeNull();
    const input = document.createElement("input");
    input.id = "field";
    detached.append(input);
    expect(label.control).toBe(input);
    const shadow = document.querySelector("div").attachShadow({ mode: "open" });
    shadow.append(detached);
    expect(label.control).toBe(input);
    input.remove();
    expect(label.control).toBeNull();
  });
});
