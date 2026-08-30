// T43 Shadow DOM integration tests.
//
// Drives the complete T43 slice through the official package entry
// (index.js → js/entry.js) and pins the acceptance criteria:
//
//   - `attachShadow` open/closed mode with the happy-dom argument validation,
//     and the `ShadowRoot` facade wrapper (`host` / `mode` / `nodeType` /
//     `instanceof window.ShadowRoot`) with stable identity;
//   - the structural boundary: ordinary DOM navigation, `childNodes`, queries,
//     `textContent`, `innerHTML`/`outerHTML` and serialization on the host
//     never pierce into the shadow tree, while the shadow root's own tree is a
//     reachable, mutable parent;
//   - the shadow-including `isConnected` (a node inside an attached shadow
//     tree is connected; detaching the host disconnects it);
//   - composed vs non-composed propagation order across the boundary (host and
//     document listeners fire only for `composed` events, `event.target` stays
//     the leaf — no retargeting — and the composed path includes the shadow
//     root and the host), and a closed root never leaks through `host.shadowRoot`;
//   - the basic named slot assignment (`assignedNodes` / `assignedElements`)
//     and the `slot` attribute reflection;
//   - the clone / serialization baseline: cloning a host does not clone its
//     shadow tree (the happy-dom `clonable: false` default) and the light DOM
//     is what serializes.
//
// The structural block needs no native artifact; the runtime blocks skip
// without the locally built one (npm run dev:build, or MAD_DOM_NATIVE_PATH),
// exactly like the other native suites.

import { afterAll, describe, expect, test } from "bun:test";
import { createWindow, isNativeAvailable } from "../../index.js";
import { Node } from "../../js/facade/extensions/node.js";
import { ShadowRoot } from "../../js/facade/extensions/shadow-dom.js";
import { Window } from "../../js/facade/window.js";

const nativeAvailable = isNativeAvailable();

const createdWindows = [];

function freshWindow() {
  const win = createWindow();
  createdWindows.push(win);
  return win;
}

afterAll(() => {
  for (const win of createdWindows) {
    win.destroy();
  }
});

describe("T43 shadow-dom facade surface", () => {
  test("attachShadow / shadowRoot / slot are fixed members on Node.prototype", () => {
    for (const name of ["attachShadow", "assignedNodes", "assignedElements"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be a method on Node.prototype`).toBeDefined();
      expect(typeof descriptor.value).toBe("function");
    }
    for (const name of ["shadowRoot", "slot"]) {
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
      expect(descriptor, `${name} must be an accessor on Node.prototype`).toBeDefined();
      expect(typeof descriptor.get).toBe("function");
    }
    for (const name of ["host", "mode"]) {
      const descriptor = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, name);
      expect(descriptor, `${name} must be an accessor on ShadowRoot.prototype`).toBeDefined();
      expect(typeof descriptor.get).toBe("function");
    }
  });

  test("window.ShadowRoot exposes the facade class", () => {
    const win = freshWindow();
    expect(win.ShadowRoot).toBe(ShadowRoot);
  });
});

describe.skipIf(!nativeAvailable)("T43 Shadow DOM", () => {
  test("attachShadow creates an open shadow root with host/mode identity", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });

    expect(root).toBeInstanceOf(win.ShadowRoot);
    expect(root.mode).toBe("open");
    expect(root.host).toBe(host);
    expect(host.shadowRoot).toBe(root);
    expect(root.nodeType).toBe(11);
    expect(root.parentNode).toBe(null);
  });

  test("attachShadow validates its argument like the baseline", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");

    expect(() => host.attachShadow()).toThrow(TypeError);
    expect(() => host.attachShadow({})).toThrow(TypeError);
    expect(() => host.attachShadow({ mode: "nope" })).toThrow(TypeError);
    host.attachShadow({ mode: "open" });
    expect(() => host.attachShadow({ mode: "open" })).toThrow();
  });

  test("a closed root never leaks through the public shadowRoot read", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });

    expect(root).toBeInstanceOf(win.ShadowRoot);
    expect(root.mode).toBe("closed");
    expect(root.host).toBe(host);
    expect(host.shadowRoot).toBe(null);
  });

  test("ordinary navigation and queries never pierce the shadow boundary", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("span");
    inner.textContent = "x";
    root.appendChild(inner);
    const light = document.createElement("em");
    host.appendChild(light);

    expect(host.childNodes.length).toBe(1);
    expect(host.firstChild).toBe(light);
    expect(root.childNodes.length).toBe(1);
    expect(inner.parentNode).toBe(root);
    expect(host.querySelector("span")).toBe(null);
    expect(root.querySelector("span")).toBe(inner);
    expect(host.innerHTML).toBe("<em></em>");
    expect(root.innerHTML).toBe("<span>x</span>");
    expect(host.outerHTML).toBe("<div><em></em></div>");
    expect(host.textContent).toBe("");
    expect(root.textContent).toBe("x");

    root.textContent = "updated";
    expect(root.textContent).toBe("updated");
    expect(host.childNodes.length).toBe(1);
  });

  test("shadow-including isConnected follows the host", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("span");
    root.appendChild(inner);

    expect(inner.isConnected).toBe(false);
    document.body.appendChild(host);
    expect(inner.isConnected).toBe(true);
    expect(root.isConnected).toBe(true);
    document.body.removeChild(host);
    expect(inner.isConnected).toBe(false);
  });

  test("composed vs non-composed propagation order across the boundary", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("span");
    root.appendChild(inner);
    document.body.appendChild(host);

    const order = [];
    const on = (node, capture) => (event) => {
      order.push([
        node === host ? "host" : node === root ? "root" : "inner",
        event.eventPhase,
        event.target === inner,
      ]);
    };
    host.addEventListener("boom", on(host, true), { capture: true });
    root.addEventListener("boom", on(root, true), { capture: true });
    inner.addEventListener("boom", on(inner, true), { capture: true });
    inner.addEventListener("boom", on(inner, false));
    root.addEventListener("boom", on(root, false));
    host.addEventListener("boom", on(host, false));

    inner.dispatchEvent(new win.Event("boom", { bubbles: true, composed: false }));
    expect(order).toEqual([
      ["root", 1, true],
      ["inner", 1, true],
      ["inner", 2, true],
      ["root", 3, true],
    ]);

    order.length = 0;
    inner.dispatchEvent(new win.Event("boom", { bubbles: true, composed: true }));
    expect(order).toEqual([
      ["host", 1, true],
      ["root", 1, true],
      ["inner", 1, true],
      ["inner", 2, true],
      ["root", 3, true],
      ["host", 3, true],
    ]);
  });

  test("composedPath includes the host for a composed event and stops at the root otherwise", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("span");
    root.appendChild(inner);
    document.body.appendChild(host);

    const composed = new win.Event("boom", { bubbles: true, composed: true });
    inner.dispatchEvent(composed);
    const path = composed.composedPath();
    expect(path[0]).toBe(inner);
    expect(path[1]).toBe(root);
    expect(path[2]).toBe(host);
    expect(path[3]).toBe(document.body);
    expect(path[path.length - 1].nodeType).toBe(9);

    const nonComposed = new win.Event("boom", { bubbles: true, composed: false });
    inner.dispatchEvent(nonComposed);
    expect(nonComposed.composedPath()).toEqual([inner, root]);
  });

  test("basic named slot assignment and the slot attribute", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const named = document.createElement("slot");
    named.setAttribute("name", "one");
    const fallback = document.createElement("slot");
    root.appendChild(named);
    root.appendChild(fallback);

    const a = document.createElement("span");
    a.setAttribute("slot", "one");
    a.textContent = "A";
    const b = document.createElement("span");
    b.textContent = "B";
    host.appendChild(a);
    host.appendChild(b);

    expect(a.slot).toBe("one");
    expect(b.slot).toBe("");
    expect(named.assignedNodes()).toEqual([a]);
    expect(named.assignedElements()).toEqual([a]);
    expect(fallback.assignedNodes()).toEqual([b]);
    expect(fallback.assignedElements()).toEqual([b]);
    expect(named.assignedNodes({ flatten: true })).toEqual([a]);
    expect(document.createElement("div").assignedNodes()).toEqual([]);
  });

  test("cloning a host does not clone its shadow tree (serialization baseline)", () => {
    const win = freshWindow();
    const document = win.document;
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.appendChild(document.createElement("span"));
    host.appendChild(document.createElement("i"));

    const clone = host.cloneNode(true);
    expect(clone.shadowRoot).toBe(null);
    expect(clone.childNodes.length).toBe(1);
    expect(clone.outerHTML).toBe("<div><i></i></div>");
    expect(root.innerHTML).toBe("<span></span>");
  });
});
