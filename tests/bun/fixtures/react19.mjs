import assert from "node:assert/strict";
import { Window } from "../../../index.js";

const window = new Window({ url: "http://localhost:5173/" });
const { document } = window;
for (const [name, value] of Object.entries({
  window,
  document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MutationObserver: window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

// Import after installing the DOM, as consumers do in their test preload.
const { act, createElement: h, useState, version } = await import("react");
const { createRoot } = await import("react-dom/client");
assert.match(version, /^19\./);
const diagnostics = [];
const originalError = console.error;
console.error = (...args) => diagnostics.push(args.map(String).join(" "));
const container = document.createElement("div");
document.body.appendChild(container);
const root = createRoot(container);

function App() {
  const [page, setPage] = useState("Home");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState("");
  return h("div", null,
    h("header", null, h("nav", null,
      h("a", {
        href: "/settings",
        onClick(event) {
          event.preventDefault();
          setPage("Settings");
        },
      }, "Settings"))),
    h("aside", null, "Agent Flow"),
    h("main", null, h("section", null,
      h("h1", null, page),
      h("form", {
        onSubmit(event) {
          event.preventDefault();
          setSaved(name);
        },
      },
      h("label", { htmlFor: "agent-name" }, "Agent name"),
      h("input", {
        id: "agent-name",
        name: "agentName",
        value: name,
        onChange: (event) => setName(event.target.value),
      }),
      h("p", { id: "draft" }, name),
      h("button", { type: "submit" }, "Save")),
      h("p", { role: "status" }, saved))),
    h("footer", null, "Ready"));
}

try {
  await act(() => root.render(h(App)));
  assert.equal(container.querySelector("h1").textContent, "Home");
  for (const tag of ["nav", "aside", "header", "main", "section", "footer"]) {
    const element = container.querySelector(tag);
    assert.equal(element.constructor, window.HTMLElement);
    assert.equal(element instanceof window.HTMLUnknownElement, false);
  }

  await act(() => container.querySelector("nav a").click());
  assert.equal(container.querySelector("h1").textContent, "Settings");

  const input = container.querySelector("input");
  input.focus();
  assert.equal(document.activeElement, input);
  // Simulate a user edit through the DOM setter, bypassing React's own value
  // tracker so the bubbling input event must reach React's onChange handler.
  let prototype = Object.getPrototypeOf(input);
  while (!Object.hasOwn(prototype, "value")) prototype = Object.getPrototypeOf(prototype);
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value").set;
  await act(() => {
    setValue.call(input, "Navigation agent");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  assert.equal(container.querySelector("#draft").textContent, "Navigation agent");
  assert.equal(input.value, "Navigation agent");
  assert.equal(document.activeElement, input);

  await act(() => container.querySelector("button").click());
  assert.equal(container.querySelector('[role="status"]').textContent, "Navigation agent");
  assert.deepEqual(diagnostics, []);
} finally {
  try {
    await act(() => root.unmount());
    assert.equal(container.childNodes.length, 0);
    await window.happyDOM.close();
  } finally {
    console.error = originalError;
    window.destroy();
  }
}
console.log("React 19 navigation and form interactions passed");
